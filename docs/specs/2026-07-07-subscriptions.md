# 订阅一期:RSS/Atom 博客 + YouTube 频道

## 背景与目标

功能缺口第二单。现在内容供给全靠兴趣信号驱动搜索,搜索是 GEO 重灾区(#107 已治理但治标);订阅让用户自己挑源,先天干净。用户定案:博客 RSS、YouTube 频道一期做;**播客(含转写)整体后置**;高产源要有筛选。

## 设计

### 1. Feed 解析(core:新模块 `packages/core/src/subscriptions/feedParser.ts`)

- 手写 RSS 2.0 + Atom 解析(**不引入 XML 解析依赖**,正则+手工状态处理;必须处理 CDATA、命名空间前缀、单条目缺字段),输出统一形状 `{title, link, publishedAt, summary}` 列表;解析失败返回空数组带 error 不抛。
- YouTube 频道 URL 归一化:`youtube.com/channel/UCxxx`、`youtube.com/@handle`、`youtube.com/feeds/videos.xml?channel_id=` 三种输入都收;`@handle` 形式需抓频道页 HTML 提取 `channelId`(用现有 fetch 注入模式,smoke 用 fixture HTML);统一转成 feed URL `youtube.com/feeds/videos.xml?channel_id=UCxxx`。
- feed 条目 kind 推断:youtube feed 条目 → youtube 导入管线;其余 → 文章导入管线。

### 2. 订阅数据与轮询(storage + api)

- 快照新增 `subscriptions: SubscriptionRecord[]`:`{id, kind: "rss"|"youtube_channel", feedUrl, siteUrl?, title, filterMode: "all"|"relevant"|"listOnly", createdAt, lastPolledAt?, lastItemPublishedAt?, lastError?}`;normalize 向后兼容。
- API:`POST /api/subscriptions`(加订阅:抓一次 feed 验证可解析,存 title;失败返回错误不入库)、`GET /api/subscriptions`、`DELETE /api/subscriptions/:id`、`POST /api/subscriptions/:id`(改 filterMode)。
- **轮询触发**:无定时器架构不变——挂在现有 `/api/curation/run`(页面驱动)开头:每源 `lastPolledAt` 距今 ≥ 6 小时才真的抓,否则跳过;单轮最多轮询 3 个源(轮转),防止打开页面卡住。
- 新条目(`publishedAt > lastItemPublishedAt`)处理按 filterMode:
  - `listOnly`:只记 sourceCandidates(status pending,intakeKind 新增 `"subscription"`),不入队;
  - `relevant`(默认):与用户确认概念(复用 #105 `getConfirmedDiscoveryConcepts` 的概念集)做词面相关性打分,过线的**入队 import**(占每日预算,走门禁),不过线的同 listOnly;
  - `all`:全部入队 import(占预算走门禁)。
  - 单源单轮入队上限 3 条(高产源防爆),超出的降级为 pending 候选。

### 3. Web 最小 UI

- 智能体页(AgentView)加「订阅」区:输入框贴 URL 添加;列表每行 = 标题 + kind 徽标 + filterMode 三档切换 + 上次更新时间 + 删除;空态一句话。
- 发现页候选行的 intake 文案支持 `subscription`(i18n 双语)。
- 不做独立订阅页;贴 X 风格扁平样式,复用现有 `.x-*` 类。

## 明确不做

- 播客(含 `<podcast:transcript>` 与转写 API)整体后置,本单不碰音频。
- 不做 OPML 导入导出、不做推送通知、不做定时器。
- 不引入新 npm 依赖(XML 手写解析)。
- 不改门禁、预算、深挖行为——订阅条目从候选入队起点后与既有管线完全同路。
- SSRF 现状维持(本地原型既有已知限制,feed 抓取同样不加防护,托管前统一处理)。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. smoke 扩展(smoke-core + smoke-api):
   - RSS 2.0 与 Atom fixture(含 CDATA、缺字段条目)解析出正确条目数与字段;坏 XML 返回空+error 不抛;
   - YouTube 三种 URL 形式归一化为同一 feed URL(`@handle` 用 fixture HTML);
   - 订阅轮询:新条目按 relevant 档过滤入队,重复轮询不重复入队(幂等);单轮入队上限生效;
   - `lastPolledAt` 未到 6 小时跳过;旧快照无 `subscriptions` 兼容。
3. UI 截图(验收人):订阅区添加/列表/三档切换。
4. 真实验证(验收人):加一个真实技术博客 RSS 和一个 YouTube 频道,跑一轮 curation,候选/入队行为符合档位。
