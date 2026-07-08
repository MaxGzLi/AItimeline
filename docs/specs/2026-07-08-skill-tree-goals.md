# 技能树 + 学习目标:先决闭包、分层、缺口驱动生产

## 背景与目标

功能路线图第四单,建立在 #110 掌握判定之上。用户定案的模型:学习路径不是线性的 A→C→B,而是**技能树**——目标概念 B 可能有 8 个先决,先决还有先决;系统要算出闭包、剪掉已掌握的、分层排出「现在能学什么」,并在图谱供给不足时**主动生产内容补缺口**。用户带着主观学习意图时,整个系统(推荐/发现/生产)向目标**倾斜**。

图谱边质量体检(2026-07-08,真实数据):76 张知识卡里 72 张带 graphEdges,含 **48 条 `requires` 边**(方向:source requires target,target 是先决),52 个端点中 51 个落在卡概念集内;1 个环(`deepdive ↔ mindtagger`,GEO 残留概念);2 组大小写变体。结论:地基可用,算法侧需要别名/大小写归一 + 确定性断环。

## 设计

### 1. 技能树构建(core:新模块 `packages/core/src/graph/skillTree.ts`)

- `buildSkillTree(input)` 纯函数,零模型调用。输入:`{goalConcept, cards, conceptAliases, knownConcepts}`;输出 `SkillTreeView`:
  - **先决闭包**:从目标概念沿 `requires` 边反向(target→source 的逆向,即收集目标的全部先决及先决的先决)遍历;所有概念经别名 + 大小写归一(复用 conceptAliases resolver)。
  - **断环**:检测到环时确定性断开(丢弃环内累计权重最低的一条边;权重相同按 id 字典序)。
  - **分层**:拓扑分层。第 0 层 = 无未满足先决、现在就能学的;最后一层 = 目标本身。
  - **必修/选修**:必修 = 目标的直接先决,或在闭包内被 ≥2 条 requires 边引用;其余选修。
  - **剪枝**:概念在 `knownConcepts` 里 → 标记 `mastered`(UI 折叠,不从树里删,保留全貌);整层全掌握则层标记完成。
  - **缺口标记**:闭包内**未掌握**概念满足其一即 `gap: true`(已掌握概念不算缺口,避免为其生产内容)——①库中没有任何非 connection_note 卡片覆盖;②只有 1 张卡且没有任何已知先决(无 requires 出边,图谱不知道它还能怎么拆,供给太浅)。
  - 每个节点带:概念名、层号、必修/选修、mastered/learning/gap 状态、支撑卡 postIds(限 5)。
- 目标概念本身不在图谱(无卡无边)时返回 `{tree: null, reason}` 不抛。

### 2. 学习目标持久化与 API(storage + api)

- 快照新增 `learningGoals: LearningGoalRecord[]`:`{id, concept, createdAt, status: "active"|"achieved"|"archived", achievedAt?}`;normalize 向后兼容(照 subscriptions 三件套先例)。active 目标同时最多 **3 个**(超出返回 400,防倾斜互相打架)。
- API:
  - `POST /api/goals`(body: concept):概念归一后需在图谱有卡或有边,否则 400;创建即触发**缺口生产**(见 §3);
  - `GET /api/goals`:返回目标列表,每个 active 目标附实时 `buildSkillTree` 结果;同时做**达成惰性检测**——active 目标概念已在 knownConcepts(晋升或手动)→ 置 achieved + 走现有 notifications 通道发达成通知(纯模板 zh/en);
  - `POST /api/goals/:id`(body: status: "archived"):归档;`DELETE /api/goals/:id`:删除。
- 复习完成晋升(#110 `promoteMasteryAfterReview`)后追加一步:晋升概念若命中 active 目标 → 同样置 achieved + 通知(与惰性检测幂等,已 achieved 不重复)。

### 3. 三个倾斜(api,全部轻量)

1. **生产倾斜**:立目标时对技能树 `gap` 概念入队 `concept_brief`(单次上限 3,**占每日预算、走既有门禁**,复用订阅单的 applyDailyAutoJobBudget 接线模式);目标激活期间 `GET /api/goals` 每次调用不重复入队(靠既有 conceptBriefs 记录与队列去重)。
2. **发现倾斜**:`collectConfirmedDiscoveryConcepts` 的概念池并入 active 目标闭包内未掌握概念(discovery 侧自然向目标倾斜,不改 discovery 逻辑本身)。
3. **推荐倾斜**:ranker 输入新增 `learningGoalConcepts`(active 目标闭包未掌握概念,归一后);卡片概念命中 → 加分(量级对齐 weakConcepts:+18/命中,封顶 36),reason 标注「在你的学习路径上」zh/en。api 侧 /api/timeline 组装输入时传入。

### 4. Web UI

- **图谱页**加「技能树」视图:有 active 目标时可切换;分层纵向排布(第 0 层在下、目标在上),节点显示概念名 + 状态色(mastered 绿 / learning 默认 / gap 虚线),必修实心、选修描边;X 风格扁平,复用 `--x-*` 变量,纯 DOM/CSS(不上 canvas,节点可点击跳概念页)。
- **目标管理**:图谱页技能树视图顶部——输入框声明目标(概念自动补全可复用现有 wikilink 自动补全的概念源)+ active 目标列表(进度 = 已掌握节点/总节点)+ 归档按钮。
- **侧栏**(ContextRail)知识边界面板下加一行:active 目标名 + 进度(如「学习目标 #RAG 3/8」),点击跳图谱技能树。
- 达成通知走既有通知页(kind 复用 `mastery_promotion` 的渲染分支或新增 kind,取实现简单者,i18n 双语)。
- i18n 双语齐全,组件内禁止中文硬编码。

## 明确不做

- 不做「四跳连名人」图谱彩蛋(后置)。
- 不做系统主动推荐学习目标(用户自己声明)。
- 不做多目标间的依赖/合并;不做目标的进度历史页。
- 树构建零模型调用(全确定性);缺口生产复用既有 concept_brief 管线,不新增生成路径。
- 不改复习间隔、晋升规则、门禁、预算逻辑本身。
- 不清理存量 GEO 残留概念数据(deepdive/mindtagger 环由断环逻辑兜住)。
- 不引入新 npm 依赖。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. smoke-core:构造带 requires 边的 fixture——闭包正确(含二级先决);分层拓扑正确;环被确定性断开不死循环;knownConcepts 剪枝标记;必修/选修判定;别名+大小写归一(DeepSeek-V3/v3 类变体合并);目标不在图谱返回 null 不抛;gap 标记两种条件各一例。
3. smoke-api:立目标→gap 概念入队 concept_brief 且占预算;重复 GET 不重复入队;active 上限 3;目标概念晋升后 achieved + 通知,幂等;learningGoalConcepts 传入 ranker 后命中卡 reason 可见;旧快照无 learningGoals 兼容。
4. UI 截图(验收人):技能树视图(分层+状态色)、目标声明与进度、侧栏进度行。
5. 真实数据验收(验收人):对真实图谱立一个目标(如 Mixture-of-Experts),树分层合理、gap 概念入队、时间线出现「学习路径」reason 的卡。
