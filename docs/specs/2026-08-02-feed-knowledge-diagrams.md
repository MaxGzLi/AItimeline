# Spec: 信息流知识图——概念图主视觉 + 模型架构图（2026-08-02）

## 背景

用户对「配图」的真实诉求是**知识可视化**（脑图、架构图），不是文章原图（#147 已解决原图）。本单让知识卡以「知识图」为主视觉，取代并升级原 feed-visuals spec 的 P2（AI 补位）——那一段作废，以本 spec 为准。

数据地基已就位：每张卡带 `graphEdges`（sourceConcept —relation→ targetConcept + evidence + weight）与 `concepts`；时间线响应原样透传（`sanitizePostForResponse` 是全字段 spread，无需动 api）；web 已有图谱 canvas 组件与 #118 的标签碰撞剔除经验。

## 目标

**P1 概念图（确定性，无模型，本轮派）：**

1. 没有原文图的知识卡，时间线卡片渲染一张概念关系图作为主视觉：中心 = 卡片主概念，周围 = graphEdges 连出的概念，边上标关系；无 graphEdges 的卡退化为 concepts 放射脑图；concepts 也为空的卡不硬画（保持纯文字）。
2. 布局确定性：同一张卡每次渲染布局一致（以 postId 为种子），不因刷新跳动。
3. 标签互不压盖（#118 碰撞剔除经验）；暗/亮双主题下都清晰可读。
4. 视觉遵守 X 风扁平设计语法：图是知识的表达，不是装饰；禁止渐变、发光、「AI 感」模板。

**P2 架构图（模型生成，另一 PR，本轮不派）：**

5. 后台任务用模型从卡片正文/引文提炼结构 spec（节点/边/分组 + 图类型：架构|流程|对比），存卡片新字段，前端用同一渲染器绘制。
6. 接地：spec 中所有节点/分组文字必须能在卡片语料（title/summary/thread/citations/concepts）中找到出处，校验不过整图拒收；无模型时不生成（概念图兜底）。
7. 生成配额并入现有供给预算，不阻塞导入。

## 不做

- 不做交互式编辑/拖拽；不新增点击行为。
- 不引外部图库/mermaid 依赖，渲染全部自绘 SVG。
- P1 不动 schema/持久化、不动 apps/api（数据已在响应里）。
- 不改图谱页（GraphView）、不改深读页。

## 验收清单

P1：
- [ ] 布局纯函数单测（packages/core）：同 postId 布局稳定；0/1/2/8/20 个概念各档均无标签重叠断言；超量概念按 weight 截断且有序。
- [ ] 退化路径断言：无 graphEdges 走 concepts 脑图；concepts 为空返回不渲染信号。
- [ ] UI 截图（docs/e2e/runs/）：边多卡、边少卡、退化脑图卡、暗/亮双主题、与原文图卡/纯文字卡的混排首屏。
- [ ] 设计语法审：标签可读、无压盖、扁平克制（功能点都在 ≠ 能看）。
- [ ] typecheck / build / test 全绿（零网络）。

P2 验收另单细化（生成接地断言、无模型跳过、截图）。

## 假设与开放问题（用户可推翻）

- 有原文图的卡保持原文图、不叠加概念图（真实内容图优先）；要反过来是一行改动。
- 概念图节点上限 9（1 中心 + 8 周边），超出取 weight 最高的。
- P2 的结构 spec 存储字段形状在 P2 设计门禁时定。

## 方案（设计门禁 2026-08-02 主会话批准，P1）

- **布局**：`packages/core/src/graph/conceptMapLayout.ts` 纯函数——`layoutConceptMap({ postId, primaryConcept, concepts, graphEdges, width, height })` → `{ nodes: [{ concept, x, y, tier }], edges: [{ from, to, relation, weight }], degenerate: boolean }`。中心 + 环形放射；角度由 hash(postId + concept) 确定性打散（禁 Math.random）；半径按 weight 分层；标签宽度用字数近似估算做碰撞剔除，冲突时保留高 weight 节点。
- **渲染**：`apps/web` 新组件 `ConceptMapFigure`——纯 SVG（不用 canvas：需要跟随主题色，SVG + 现有 `--x-*` CSS 变量最直接）。挂在 PostView 现有媒体位同一位置（`media[0].url` 存在时让位给原文图）。
- **主题**：线条/文字/节点全部用现有 CSS 变量，不写死颜色（与 `.x-media` 强制白底相反——概念图必须跟主题走）。
- **尺寸**：与媒体位同宽，高度固定 ~240px（扁宽构图，不撑爆信息流节奏）。
- **取舍**：布局放 core（纯逻辑可 vitest）、渲染放 web（UI 层），符合「纯逻辑 vitest / UI 截图验收」的项目测试分层；不做力导向模拟（不确定 + 贵），环形分层布局在 9 节点内足够好。

### 2026-08-03 硬化修订

上面的方案让概念图画出「概念 --关系--> 概念」并配箭头。对真实数据量化之后，这一层关系断言撤掉：

- **P1 概念图只画卡片自身的概念**：中心 = 卡片主概念（`primaryConcept`，否则 `concepts` 第一个非空项），周围 = 该卡其余 `concepts`，边只是中心到周边的放射线。不画 relation、不画箭头、不画概念↔概念的连线。
- **理由**：`graphEdges` 的两个端点 `sourceConcept` / `targetConcept` 在 schema 里只过「非空字符串」检查，不像 `post.concepts` 那样要过接地门禁；全库 271 条关系边里 211 条（78%）两端概念不同时出现在自己的 evidence 里，72 条（27%）两端一个都没出现；extends 边 86%、requires 边 97%（合计 92%）的证据里找不到任何表示「扩展/基于」「需要/依赖」的词。无模型的确定性档位里 relation 还来自硬编码梯子，默认恒为 `extends`。把全库最不接地的一层放在产品最大的展示面上，还配箭头让它读起来更笃定，是反着「接地是产品承诺」的。
- **关系可视化推迟**：等 `KnowledgeGraphEdge` 加上「已核对」标记（关系词能在 evidence 里找到出处、两端概念都过接地门禁）之后再做，届时只画核对过的边。
- **不变的部分**：布局仍是 core 里以 postId 为种子的纯函数，确定性、标签包围盒碰撞剔除、weight 排序分层、自适应高度、`degenerate` 语义都照旧；详情页（`PostDetailView`）现有的「关系 + evidence」展示不动——那是带出处的展示，不是无出处的图形断言。
