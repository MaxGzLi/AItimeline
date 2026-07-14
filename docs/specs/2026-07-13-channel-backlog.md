# 频道存量回填:订阅频道的「学习存量」

## 背景与目标

订阅功能(#109)只从 YouTube RSS feed 拿数据,feed 只给最近约 15 条;用户想学一个频道的存量视频(例:@QuantPy,共 92 个)做不到。2026-07-13 实测:`@QuantPy` 页面可解析出频道 ID(现有逻辑);把频道 ID 的 `UC` 前缀换成 `UU` 即该频道「全部上传」播放列表,抓 `youtube.com/playlist?list=UU...` 一页拿到全部 92 个视频;抽查视频字幕轨存在;同机 RSS feed 端点连续 404/500——现有轮询唯一数据源并不稳。

目标:订阅的 YouTube 频道支持「学习存量」——一键把频道全部视频编成目录,按预算分批走现有导入管线生成带时间戳出处的卡片;进度可见、节奏可控、feed 不被刷屏。顺手修三个相邻缺陷(导入框频道误路由、订阅首轮轮询不触发、RSS 失败无兜底)。

## 设计

### 1. uploads 播放列表枚举(core)

- `packages/core/src/subscriptions/` 新增 `fetchChannelUploads({ channelId, fetchImpl })`:抓 `https://www.youtube.com/playlist?list=UU<频道ID去UC前缀>`,解析 `ytInitialData` 取 `videoId / title / 发布时间(若有)`;首屏约 100 条,存在翻页令牌时用页面自带的 InnerTube browse 接口(POST `/youtubei/v1/browse`,key 与 context 从页面 HTML 提取,与现有 watch 页抓取同风格)继续,**上限 10 页(约 1000 条)**,超出记 `truncated: true`。
- 全部请求经 `guardedFetch`(SSRF 防护);失败抛错由调用方记入订阅 `lastError`。
- 不引入 yt-dlp / 官方 API key,零配置,与现有抓取方式一致。

### 2. 编目录:候选入池 + 回填状态(api)

- 新端点 `POST /api/subscriptions/{id}/backlog`(仅 `kind === "youtube_channel"`):枚举 uploads → 每个视频建 source candidate 入既有候选池,`intakeKind: "subscription"`,候选记录新增可选字段 `subscriptionId` 与 `backlogOrder`(频道内从旧到新的序号);候选 id 沿用 `subscription-<订阅id>-<hash(url)>` 规则,重复编目录天然幂等(已存在的跳过)。
- `SubscriptionRecord` 新增可选 `backlog: { catalogedAt, videoCount, truncated? }`;快照 schema 不升版本(均为可选字段),normalize 兼容旧快照。
- 编目录只写元数据:不生成卡片、不调模型、不占每日预算。

### 3. 分批消化(api)

- **绕过 relevance、保留门禁**:用户点「学习存量」即明确意图,回填批次不走订阅轮询的 relevant 词面过滤;来源质量门禁与导入管线红线照走。
- **自动批次**:`pollDueSubscriptions` 同位置新增回填消化——每次 curation run,对每个有未消化目录的订阅,取 `backlogOrder` 最小(最旧优先)的 pending 回填候选最多 3 条转 `import_source` job(priority 0.6,低于订阅新视频),计入既有每日自动预算,另设**每日回填上限 8 条**(常量,不做配置)。
- **手动批次**:`POST /api/subscriptions/{id}/backlog/digest`:立即入队最多 5 条,占预算,余量不足入队到余量为止,返回 `{ queued, skipped, budgetRemaining }`,幂等(复用既有队列去重)。
- **无字幕跳过**:候选状态机新增 `skipped`(normalize 兼容);import job 因「无字幕/无可用字幕轨」失败时置 skipped 并记原因,不再被批次选中;网络类失败维持既有 `unreachable` 语义。
- **优先学**:目录条目可标「优先」(候选记录记 `prioritizedAt`),批次选择先取已优先的、再按从旧到新。
- feed 错峰复用既有 release plan 机制,不改 ranker。

### 4. 目录视图与入口(web,Agent 页订阅区)

- 新端点 `GET /api/subscriptions/{id}/backlog`:由候选池按 `subscriptionId` 过滤派生,返回条目 `{ candidateId, title, url, order, status, prioritized }` 与汇总 `{ total, imported, queued, pending, skipped }`。(不含发布日期:playlist 页只给「2 years ago」式相对时间,没有稳定绝对日期,目录按 `order` 表达先后。)
- 订阅条目(youtube_channel):未编目 → 「学习存量」按钮(调 §2 端点,按钮态反馈「已编目 N 条」);已编目 → 进度行「已学 x/N」+「再学一批」按钮(调 §3 手动端点)+ 可展开目录列表(标题 / 日期 / 状态 pill / 「优先」)。
- X 风格扁平、复用 `--x-*` 变量、贴左、无图标堆砌;i18n 双语,组件内禁止中文硬编码。

### 5. 顺手修三件

1. **导入框频道引导**:web 端识别「youtube host 且非视频路径」的 URL 时,不再误发 `/api/import/youtube`(现 `isYouTubeUrl` 对全部 youtube.com 放行导致报错);就地提示这是频道链接,预填订阅框并引导到订阅区。文案 i18n。
2. **订阅首轮触发**:创建订阅成功后,前端立即触发一次 `/api/curation/run`(消除 `hasQueuedScoutWork` 门槛导致的「刚订阅不轮询」)。
3. **RSS 兜底**:`pollDueSubscriptions` 抓 RSS 失败且订阅为 `youtube_channel` 时,回退抓 uploads 播放列表页首屏,把条目当 feed entries 走同样的新条目选择逻辑;成功则清 `lastError`、照常推进 `lastPolledAt / lastItemPublishedAt`。

## 明确不做

- 不做官方 YouTube Data API(key 配置)集成;不引入 yt-dlp 等外部依赖;
- 不做任意播放列表(非频道 uploads)导入;
- 不做一次性全量导入——分批与预算是红线;
- 不做目录搜索/筛选/拖拽排序;不做独立目录页面;
- 不改订阅轮询 relevant 过滤的冷启动策略(另单);
- 不动 ranker 与释放节奏本身(只是消费方);
- 超过 10 页(约 1000 条)的超大频道截断处理,不做完整遍历。

## 假设与开放问题(用户可推翻)

- 批次数值:自动每轮 3 条 / 每日回填上限 8 条 / 手动一批 5 条——常量,改起来便宜;
- 默认顺序从旧到新(教学频道老视频是基础课的假设);
- 回填绕过 relevance 过滤(点「学习存量」= 明确意图),质量门禁保留;
- 无字幕视频跳过后不重试;
- 目录视图放订阅条目展开区,不做独立页面。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿(网络隔离)。
2. smoke-api(loopback 固定样本:假 uploads 播放列表 HTML + 假 watch 页):编目录建 N 条候选且重复编目录幂等;自动批次从旧到新入队、占预算、每日上限生效;手动 digest 幂等、预算耗尽返回 skipped;无字幕候选置 skipped 且不再被批次选中;「优先」条目先入队;RSS 返回 500 时 youtube_channel 订阅回退 uploads 页拿到新条目并清 lastError;旧快照(无 backlog / subscriptionId / skipped)normalize 兼容。
3. UI 截图(验收人):订阅条目「学习存量」按钮态 / 进度行 / 展开目录列表,浅色+深色;导入框粘频道 URL 的引导态。
4. 真实数据验收(验收人):订阅 @QuantPy → 编目录 92 条 → 手动消化一批 → feed 出带时间戳出处的卡,目录进度同步更新。

## 实现偏离记录(2026-07-14)

实现与上文设计的出入,均已验证:

1. **YouTube 字幕修复超出原计划范围(修的是既有生产缺陷)**:实测发现 watch 页提取的 timedtext 字幕 URL 因缺 pot token 一律返回 200 空 body——主干上所有 YouTube 导入当时已经全坏。`fetchYouTubeTranscript` 改为先走 InnerTube ANDROID client 的 player 接口取字幕轨,失败再退回原 watch 页抓取。真实数据下 5/5 导入成功。
2. **供给枯竭补给排除回填候选**:`queueSupplyRefill` 会把 pending 回填候选当补给一次性抓走(实测超发 10 条),已加过滤(`backlogOrder` 存在即排除)——回填只走自己的分批车道。
3. **手动 digest 同样受每日回填上限约束**,返回值增加 `dailyRemaining`;额度耗尽时入队 0 条并计 skipped。
4. **播放列表解析兼容两种页面布局**:YouTube 已切到 lockupViewModel 新布局(旧 playlistVideoRenderer 仍存在于部分页面),枚举器两种都识别,翻页令牌按通用 `continuationCommand` 匹配。
