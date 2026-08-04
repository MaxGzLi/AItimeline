# 浏览器插件细化:保存体验升级 + 注入毛边清理 + API 饿死修复

2026-08-04 立项。触发:用户要求单开 worktree 细化插件功能和体验,并当场报告
「注入卡点『在知识库中打开』,打开的知识库是空的」;随后点名三项保存升级
(保存分类、保存图片/视频链接、保存 X 文章),参考 Obsidian Web Clipper 的做法。

本单覆盖两个 PR:

- **PR-1(bug,先行)**:本机 API 被自己拖死,知识库空白的根因修复。
- **PR-2(功能)**:剪藏体验升级 + 注入面毛边清理(五视角评审裁决的 do 清单)。

---

## PR-1:API 饿死修复(轨道 C)

### 根因(2026-08-04 实测)

- `/api/timeline` 延迟 3~10 秒起步,约一半请求超时;API 进程持续 105% CPU;
  用户遇到的旧进程已经死过一次。网页拉不到数据 → 知识库渲染空态。
- 采样:CPU 全部烧在 JSON 大字符串解析/序列化与 V8 GC 风暴。
- 数据:主快照 67MB + curation-jobs.json 51MB。其中 **curationJobs 587 条全部
  是终结状态**(381 succeeded + 206 failed),succeeded 的 `result` 大血包占
  51.9MB(最大单条 21.8MB),且在两个文件里**双份存储**——约 104MB 是结算完
  就再也不该被反复搬运的死重。
- 代码:`persistenceStore.getSnapshot()`(persistenceStore.ts:293-327)每次调用
  = 从磁盘整读 + JSON.parse + 解码校验 + `JSON.parse(JSON.stringify(...))` 深拷贝
  (:2005)。每个 HTTP 请求、插件每隔几秒的停留信号、同进程 worker 的每步任务
  都各来一遍完整流程。

### 方案(设计门禁记录,主会话批)

1. **读路径缓存**:`readLatest()` 先 `stat` 文件(mtime+size),与上次相同就直接
   复用上次解码好的对象,不再整读整解;深拷贝从 JSON 往返换 `structuredClone`。
   对外语义不变(仍返回独立副本,commit 的 CAS 冲突检测照旧)。
2. **终结任务瘦身**:任务落到 succeeded/failed 时,把 `result` 压成摘要
   (保留产物 id 列表/计数/错误信息,砍正文大血包)。动手前必须 grep 核实
   所有读旧 `result` 的现存路径(已知嫌疑:supply 的 backlog 回填是否回读
   succeeded 任务的 result,#136 一带的结算代码),读用户各自给出替代来源
   或豁免字段。
3. **一次性压缩存量数据**:脚本先备份再压(两个文件里的终结任务 result 同规则
   瘦身)。**动用户真实数据,等用户点头才跑**;代码修复不依赖它,只是不压的话
   首次加载仍慢。

放弃的选项:换存储引擎(SQLite)——工程量大,黑客松期间不动地基;
把 curationJobs 移出主快照——快照 v2 缺集合会拒绝加载(#151 教训),不冒险。

### 验收清单(PR-1)

- [ ] 复现测试先红后绿:同一文件未变化时 `getSnapshot()` 不再触发第二次
      磁盘读+解码(以 storage.read 调用计数断言);终结任务落库后 result
      已是摘要形状(新单测)。
- [ ] `npm run typecheck`、`npm run build`、`npm test` 全绿(含四个 smoke)。
- [ ] 修复后实测:未变化快照下 `/api/timeline` 与 `/api/inject/cards` 响应
      恢复亚秒级(本机手测记录数字进 PR)。
- [ ] 读旧 result 的路径逐一列在 PR 描述里,说明为何摘要化不伤它们。

---

## PR-2:插件细化(轨道 A)

### 背景

插件是产品的习惯入口(剪藏捡知识 + 注入送知识)。骨架(#154-#159)能跑通,
但保存只能存推文可见文本、没有分类、丢图片视频;注入面有五个已核实的真 bug
和一批演示确定性问题。五视角评审(剪藏体验/注入仿真/健壮性/演示契合/信号闭环)
共提 25 条,判官逐条对源码核实后裁决,叠加用户点名的三项保存升级。

### 目标

刷 X 的人顺手保存任何形态的推文内容(短文、长文、文章、带图带视频),保存时
可以顺手归类;注入卡在任何 X 主题下都以假乱真、行为可靠。

### 不做

- 小红书注入(愿景已定:小红书只存不注,等有手机 App 再议)。
- 注入卡常驻仿 X 操作栏(一排点了没反应的假回复/转发按钮=诚实问题+穿帮点)。
- 网页应用真路由(?post= 深链在 backlog,本次不做)。
- 视频文件下载(只存视频的封面图和链接,不碰视频本体)。
- Obsidian 式保存前弹窗编辑器(全弹窗打断摸鱼心流;取其「保存时可加属性/分类、
  按站点取内容」的思路,壳用 X 原生悬浮语法)。

### P0:保存体验升级(用户点名)

**P0-1 保存分类**。悬停「保存」按钮浮出分类条:候选来自
`GET /api/captures/context`(top 兴趣主题 + 活跃学习目标,已有接口),外加
自由输入;点某个分类 = 带 `topic` 字段保存(capture 接口现成字段,进
conceptIds + notes,零 API 改动);直接点「保存」= 不分类保存,现有一键
心流不变。分类条要用 X 的悬浮菜单语法(深浅主题各自贴原生)。

**P0-2 保存图片**。抓推文内 `pbs.twimg.com/media` 图片 URL(排除头像/表情),
随 capture 提交新增字段 `capturedMedia: [{kind:"image", url}]`;导入管线在
服务端下载进媒体库(#147 首图抽取的现成基建),挂为来源资产,出卡走现有
配图通路。API/core 契约改动,过设计门禁:字段形状、下载失败不阻塞出卡、
smoke 覆盖。

**P0-3 视频链接**。带视频的推文:存视频 poster 图(kind:"video" 带 posterUrl)
+ 推文链接本身就是视频链接;卡面配图用 poster。不下载视频。

**P0-2/P0-3 方案(设计门禁记录,2026-08-04 主会话批,单独 PR)**:

- 字段形状:`capturedMedia: [{kind:"image"|"video", url, posterUrl?}]`,服务端
  收口时图片最多 4 条、视频最多 1 条,URL 仅收 http/https。
- 通路:插件抓推文内 `pbs.twimg.com/media` 图片(排除引用块内的)与视频
  poster → capture 候选记录随 capturedText 同样方式存 `capturedMedia`(快照
  sourceCandidates 解码是整条 deepClone,未知字段存活;队列层校验只验必填
  不剥字段,均无需登记)→ `ingestSourceCandidate` 的 capturedText 分支取首图
  (无图取视频 poster)调 core 的 `cacheLeadImageAsset` 下载进媒体库(≤3MB、
  content-type 校验、任何失败返回 undefined 不阻塞)→ image asset 进 assets,
  worker 建 sourceRegistry 时自然收录 → `runImportSourceJob` 产卡后
  `attachLeadMediaToFirstCard` 挂首卡(origin:图=article、视频 poster=video)
  → 结算 `saveSourceImportResult` 落库,时间线响应 `enrichPostsMedia` 从
  registry 补 url,网页现有配图通路直接渲染。
- 放弃的选项:把下载挪到结算侧(要在 core 结果里塞图片字节,与 #162 刚做的
  result 瘦身背道而驰);全量下载 4 图(卡面只用首图,其余是死重)。

**P0-4 X 文章(Article)与折叠长文**。时间线上被折叠的长推文不再静默存半截:
检测折叠标志后按钮语义变「点开存全文」,导流到详情页存完整正文(幂等去重
意味着第一次存半截会永久污染,必须在源头拦)。X Article 页面(twitterArticle
结构)提取完整正文;选择器真机验证,验不过先写进 README 已知限制。

### P1:注入/剪藏真 bug(五项,判官已核实)

1. 保存按钮挂载可靠性:操作栏未出现时不打 processed 标记;已标记但按钮被
   React 重渲染吃掉的补挂。
2. 注入只在 `/home` 生效(通知/搜索/详情/他人主页一律不注入)。
3. 同锚点(热推被多人转推)去重,卡不再在格子间跳动闪烁。
4. content.js 的 sendMessage 包 try/catch,扩展重载后不再永久卡「保存中…」,
   提示刷新页面。
5. 拉卡失败/为空后 60 秒间隔重试 + 切回标签页补拉,拿到卡即停;扩展图标
   badge 显示可注入卡数(manifest 补 action)。

### P2:演示与体验确定性(判官 do 清单其余)

6. 成卡回执:保存后 background 以 2-3 秒间隔重发同 URL 的幂等 POST(注意 MV3
   存活期,上限 ~90 秒),status 变 imported 后通知标签页,按钮推进「已成卡」
   + 页内一条克制的滑入回执;点击开知识库。
7. 注入卡配色跟随 X 三主题(亮/暗蓝/纯黑):读 body 背景色映射主题打 data
   属性,三套色值,判定纯函数进 injectCore 带单测。
8. 标题/摘要 line-clamp,卡高不超过普通推文。
9. 24 小时内刚存且无复习到期的卡不注入(插件端过滤,防「当场复读」)。
10. planInjections 增加 minIndex:新卡只分配给当前视口下方的锚点,额度不浪费
    在已滚过的位置。
11. 复习到期卡 meta 行追加「 · 该复习了」(灰色小字,X 语法)。
12. 本机 API 未启动时报中文人话:「本机 AITimeline 没有运行(127.0.0.1:8787),
    启动后点击重试」。

### Backlog(本次不做,判官裁决留档)

- 注入卡悬停互动(记住了/不想看/有用)+ 跨会话重复控制。设计裁决已锁死:
  「记住了」必须打 `/api/review/{postId}/complete`,走 /api/signals 的
  reviewed 字段不推排程,是安慰剂,红线。
- 引用推文合并抓取被引正文(backlog 首位,富余先捞)。
- 监听生命周期显式清理(真 bug 但台上不可见,赛后第一批清债)。
- 网页 ?post=<id> 深链(做时回执与注入卡一起接)。
- 来源行改 X 链接卡片样式;头部细节(15px meta/@handle/实色头像)。
- 已存推文状态写 chrome.storage 跨刷新显示「已存过」。

### 验收清单(PR-2)

- [ ] P1 五项逐条:人工验收步骤写进 apps/extension/README(挂载补挂、路由
      门禁、锚点去重、重载提示、重试与 badge 各有一条可执行的验证步骤)。
- [ ] injectCore 新纯逻辑(主题判定、minIndex、24h 过滤、到期文案)全部有
      Vitest 单测;断言能杀死变异(边界值各一条)。
- [ ] P0-1:悬停出分类条,点分类保存后 `/api/source-candidates` 里该条
      candidate 的 conceptIds 含所选主题;直接点保存行为与现在完全一致。
- [ ] P0-2/P0-3:带图推文保存后,来源资产里有下载成功的图片,出卡带配图;
      图片下载失败时卡照常出(无图),不阻塞。smoke 覆盖 capturedMedia 通路。
- [ ] P0-4:折叠推文上按钮显示「点开存全文」且不发保存请求;详情页/文章页
      保存的 capturedText 是完整正文(真机各验一条,记录进 README)。
- [ ] 成卡回执:保存→按钮几秒内推进「已成卡」,X 页内出现回执;API 停掉时
      按钮走中文报错文案。
- [ ] 三主题各截一张注入卡截图(亮/暗蓝/纯黑),与前后真推文并排无违和;
      截图入 docs/e2e/runs/。
- [ ] `npm run typecheck`、`npm run build`、`npm test` 全绿。
- [ ] 用户过目:三主题截图 + 分类条交互 + 成卡回执动图,点头后合并。

### 假设与开放问题(用户可推翻)

- 分类条用「悬停浮出」而非保存前弹窗:保住一键保存的摸鱼心流,Obsidian 的
  弹窗编辑器思路只取「可加属性」不取「必经弹窗」。若用户更想要弹窗式,改壳
  不改通路,返工半天内。
- capturedMedia 只收 image/video 两种 kind,单条上限 4 图(X 上限)。
- X Article 的 DOM 结构以真机验证为准,选择器验不过就先降级为已知限制,
  不阻塞其余项合并。
- 五视角评审原始材料与判官完整裁决存档于会话工作流(25 条→14 do/6 backlog),
  本 spec 的 P1/P2/Backlog 即其裁决结果,未另存长文。
