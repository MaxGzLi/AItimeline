# Spec: 信息流配图与首屏视觉（2026-08-02）

## 背景

时间线卡片目前纯文字，首屏画面单调不吸引人。媒体管线其实已存在一半：`KnowledgePostMedia`（assetId/caption/origin）schema 已就位，arXiv 论文图已在导入时抽取缓存（`cacheArxivFigureImages`），API 响应时补 url（`enrichPostsMedia`），但**只有详情页 `PostDetailView` 渲染，时间线卡片不渲染**；且普通文章、YouTube 完全没有抽图。

用户已拍板：原文图优先、AI 生成补位；配图与首屏版式一起做。

## 目标

**P1（原文图 + 时间线渲染 + 首屏版式）：**

1. 时间线卡片渲染 media 首图：已有论文图的卡立即在信息流里有图，X 风格大图卡（圆角、占满卡宽）。
2. 普通文章导入抽图：og:image / twitter:image / 正文首个内容图，按现有资产管线缓存到本地 `mediaRootDir`；抽取失败不阻断导入。
3. YouTube 导入抽封面：由 videoId 拼封面 URL 下载缓存为 image 资产；网络失败不阻断导入；mock/fixture 路径保持零网络。
4. 首屏版式：有图卡大图展示、无图卡紧凑文字，调整间距与字号层级形成视觉节奏；遵守项目 X 风扁平设计语法，拒绝「AI 感」模板。

**P2（AI 补位，独立 PR）：**

5. 无原文图的卡由后台任务生成结构图（本地 SVG，不依赖外链），origin 用已有的 `"derived"`。
6. 生成图接地：图中出现的文字（节点标签等）必须来自卡片概念/正文/引文，校验不过不入库；无模型配置时确定性降级（用 graphEdges/concepts 画简单关系图）或不配图。
7. 生成在后台 worker 跑，不阻塞导入与时间线响应。

## 不做

- 信息流不做外链图片热加载：只渲染本地缓存资产（隐私与稳定性）。
- 不做用户上传图、不改详情页现有媒体展示。
- 不为存量旧卡回填抽图（新导入生效即可；回填另立单）。
- SSRF 防护照旧作为公开前硬门槛处理，本单不加（与现有导入抓取同一风险面）。

## 验收清单

P1：
- [ ] 单测：文章抽图三用例——有 og:image、无任何图、正文首图兜底。
- [ ] 单测：YouTube 封面 URL 推导与资产登记；下载失败时导入仍成功且无 media。
- [ ] `KnowledgePostMediaOrigin` 新增来源值的 schema 变更向后兼容：旧快照加载不报错，网页对新字段全部可选链。
- [ ] smoke：零网络下 mock 导入路径全绿。
- [ ] UI 截图（docs/e2e/runs/）：有图卡、无图卡、混排首屏三态；首屏改版前后对比图。
- [ ] 设计语法审通过（功能点都在 ≠ 能看）。

P2：
- [ ] 单测：生成 SVG 的文字全部来自卡片语料的断言（喂入含杜撰标签的输出必须被拒）。
- [ ] smoke：无模型配置时降级路径产出确定性结果或干净跳过。
- [ ] UI 截图：AI 补位图卡在信息流中的呈现。

## 假设与开放问题（用户可推翻）

- origin 枚举扩展的具体值（如 `"article"` / `"video"` 或统一 `"source"`）在设计门禁定。
- 时间线卡片多图时只展示首图（X 的多图网格另立单）。
- 单张缓存图设大小上限（具体数值设计门禁定），超限跳过不阻断。
- P2 生成时机挂在现有 curation worker 循环里，配额并入现有供给预算体系——细节设计门禁定。

## 设计门禁

命中多条：持久化 schema 变更（origin 枚举扩展）、新生成逻辑（P2 需过接地思路评审）、预估超 300 行。实现前交方案草图，主会话批；P1/P2 分开批、分开出 PR。

## 方案（设计门禁 2026-08-02 主会话批准，P1）

- **origin 枚举**扩展为 `"paper" | "derived" | "article" | "video"`。所有登记层同步：core types、harness/schema、persistenceStore 快照校验、apps/api 的 validate 层——动手前先 `grep -rn '"paper"'` 全仓列清单逐一核对（快照字段双层登记陷阱，#131 教训）。
- **文章抽图**：articleImport 非 arXiv 路径，按 og:image → twitter:image → 正文首个 `<img>` 取首图；经现有可注入 fetcher 下载，content-type 必须 image/*、≤3MB，失败/超限静默跳过不阻断导入；存储复用 arxivHtmlImport 的 writeMediaFile 惯例（导出共享，禁止复制粘贴一份），asset id `${source.id}-image-lead`，url `/media/<sourceId>/<file>`。
- **YouTube 封面**：由 videoId 拼 `https://i.ytimg.com/vi/<id>/hqdefault.jpg`，走同一缓存管线，origin `"video"`；mock 路径保持零网络、不产媒体。
- **Web**：PostView 渲染 media[0]（resolveMediaUrl、懒加载、圆角大图、object-fit cover、最大高度封顶）；无图卡只做间距/层级微调。新 origin 值前端全部可选链兼容（#139 教训）。
- **取舍**：origin 分 `"article"`/`"video"` 而非统一 `"source"`——多一个枚举值成本为零，给后续 UI 角标保留信息量。P2（AI 补位）另过设计门禁，本轮不派。
