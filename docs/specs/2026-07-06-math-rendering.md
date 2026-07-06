# 公式 LaTeX 渲染(KaTeX)

## 背景

卡片里的公式现在是纯文本,不美观:正文里是扁平化的 `f(x)=∑w(x)_i f_i(x)`,「原文出处」引文里更是带着维基/ar5iv 的原始注释 `{\displaystyle f(x)=\sum _{i}w(x)_{i}f_{i}(x)}`(且和 Unicode 扁平版重复出现)。要像正经论文工具一样把公式渲染出来。

现状事实(2026-07-06 排查):

- 所有卡片正文(shortBody/summary/keyTakeaway/评论/问 AI 消息)走同一个渲染漏斗 `renderWithWikilinks`(`apps/web/src/lib/wikilinks.tsx:17`,纯文本 + `[[双链]]` 切分,无 markdown/HTML);title 和引文是裸插值(`PostView.tsx:248,281`、`PostDetailView.tsx:123,172,313`);换行靠 `white-space: pre-line`,时间线正文有 4 行 clamp(`.x-body-clamp` + `PostView.tsx:184-213` 的 JS 溢出测量)。
- 原始 LaTeX **只存在于** `KnowledgeChunk.content` / asset content(真实数据 66 处 `displaystyle`),两种形态:①「Unicode 扁平版 + `{\displaystyle …}`」连体重复;②行内裸 LaTeX(`h^l_t = \sum_{i=1}^{K_s} \text{FFN}_i(…)`)。summary/shortBody/title 等模型产出字段里目前**没有**定界符公式。
- 仓库无任何数学/markdown 依赖;CSS 惯例是唯一全局 `xshell.css` 由 `main.tsx:4` 副作用导入,第三方 CSS 走 Vite bundle 的裸 `import`。
- `apps/web/src` 目前零处 `dangerouslySetInnerHTML`。

## 方案

### 1. 依赖与渲染器

- 引入 **KaTeX**(npm 包 + `import "katex/dist/katex.min.css"`),新建 `apps/web/src/lib/math.tsx`:`renderMathInText(text)` 把文本切成「普通文本段 / 行内公式段 / 块级公式段」,公式段用 `katex.renderToString`(`throwOnError: false`,解析失败一律原文回退)产出 HTML,挂在专用 `<span className="x-math">`/`<div className="x-math-block">` 上。
- `dangerouslySetInnerHTML` **仅允许**用于 KaTeX 的输出(受控生成,非用户 HTML),这是本仓库首例,代码注释里写明这条边界。
- 深浅主题都要可读(KaTeX 默认继承文字色,确认即可)。

### 2. 识别规则(保守优先,宁可不渲染不可渲染错)

按优先级切分:

1. `$$…$$` → 块级公式;`$…$`(同行内、非转义、内容非纯数字/货币)→ 行内公式。这是**新内容**的标准形态(见 §4)。
2. `{\displaystyle …}`(引文 chunk 的注释形)→ 行内公式渲染其内容;**连体去重**:若其紧前方的一段文本是该公式的 Unicode 扁平重复(保守判定:比较去空白后的「符号骨架」相似度,拿不准就保留),把重复段隐藏,只留渲染后的公式。去重判定不确定时宁可两个都显示。
3. 行内裸 LaTeX 片段(含 `\sum`、`\frac`、`\text` 等常见命令 + 上下标/花括号的连续片段)→ 行内公式;识别规则要保守(必须含反斜杠命令才触发),避免把普通文本误判。

### 3. 接入点(全覆盖,一处漏斗 + 裸插值点)

- `renderWithWikilinks` 管线内(先切公式段、再对非公式段做双链解析,`[[…]]` 不进公式段)→ 覆盖时间线正文、详情 summary、智能体要点、评论/回帖(`PostReplyThread.tsx:73-75`)、问 AI 消息(`PostDetailView.tsx:255`)。
- 裸插值点逐个接:title(`PostView.tsx:248`、`PostDetailView.tsx:123`)、引文(`PostView.tsx:281`、`PostDetailView.tsx:172`)、来源片段列表(`PostDetailView.tsx:313`)、复习卡答案(`ReviewView.tsx` 的 answer 文本)。
- 时间线 4 行 clamp 与 JS 溢出测量不能被破坏:公式渲染后 clamp 仍生效、「显示更多」判断仍正确(块级公式在 clamp 里按行截断可接受,截图确认不炸版式)。

### 4. 新内容的公式产出(提示词轻量引导)

- 在模型提示词里加一条公式规范:「数学公式一律用 LaTeX 书写,行内 `$…$`、独立展示 `$$…$$`,不要用 Unicode 上下标扁平化」。注入点:`harness/modelRunner.ts` 的 Hard requirements(两个路径:~:190-212)、`harness/followupHarness.ts` 的 system prompt、`harness/askGrounded.ts` 的 system prompt。
- 不加校验门禁、不改 schema;纯提示词引导。
- **注意**:另一个并行任务(英语模式,spec `2026-07-06-english-mode.md`)也会动这三个文件的 Language policy 区域;你只**新增**一行公式规范,不碰语言相关行,减少合并冲突。

### 5. 存储不动(grounding 红线)

渲染是纯展示层变换:**任何存储的文本(post 字段、chunk content、thread body)一个字符都不改**;引用逐字性、citations、grounding 校验全部不受影响。不改 transform 抽取逻辑。

## 明确不做

- 不用 MathJax、不做公式编辑/复制为 LaTeX 等交互。
- 不重写/迁移老内容:正文里 `f(x)=∑w(x)_i f_i(x)` 这类 Unicode 扁平文本(无反斜杠命令)**不做**猜测性转换,维持原样;只有带 LaTeX 痕迹(定界符、`{\displaystyle}`、反斜杠命令)的才渲染。
- `apps/mobile` 不在本期。
- 不动 core 的校验、schema、transform;core 仅改上述三处提示词文本。

## 验证标准

- `npm run typecheck`、`npm run build`、`npm test` 全绿(smoke 不受影响;若动了 core 提示词,确认 smoke-core 里相关快照/断言仍过)。
- 截图(`docs/e2e/runs/2026-07-06-math-rendering/`),用含真实 LaTeX 的种子数据:
  a. 时间线卡:引文块里 `{\displaystyle …}` 渲染成公式、无连体重复(或保守保留,注明);
  b. 详情页:来源片段中行内裸 LaTeX 渲染;summary 含 `$…$` 的卡渲染正常(种子造一张);
  c. 一条含 `$$…$$` 块级公式的卡不炸 4 行 clamp;
  d. 非法 LaTeX(种子造一段)原文回退、不崩溃。
- 深/浅两主题各抽一张确认公式可读。
