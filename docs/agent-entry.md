# Agent Entry: 产品级 Agent 入口与知识边界模型

定位：Agent 是产品的第二入口。Timeline 是被动刷（系统推），Agent 是主动问（用户拉）。两者共享同一个大脑——SourceRegistry、知识图谱、用户记忆、掌握度、harness 验收门。

与通用 chat 助手（Grok/ChatGPT）的本质区别一句话：**通用助手的产出是"答案"，答完即散；这个 Agent 的产出是"用户知识边界地图的更新 + 知识库的扩建"**。每次对话都留下结构化资产：兴趣信号、边界标注、来源候选、复习项、学习路径。答案会过期，边界地图不会。

## 一、核心对象：知识边界（KnowledgeBoundary）

边界不是新数据，是对已有数据的一个视图 + 一个新信号源：

```text
输入：掌握度记录（knowledge-loops 的 ConceptMastery）
     + 图谱节点/边（graph/knowledgeGraph）
     + 记忆（known/weak/saved concepts, goals）
     + 交互信号（like/save/ask/dwell）
     + 对话提问（新信号源：每个问题都是一次“边界探针”）
输出：每个概念归入四区
     inside    已掌握（mastered / strength 高）
     learning  正在学（有信号、未毕业）
     frontier  未接触但与已知相邻（图谱邻居、goals 指向）→ 拓展候选
     dark      未接触且不相邻 → 需要建路径
```

新增 `graph/knowledgeBoundary.ts`：`buildKnowledgeBoundary(graph, mastery, memory) => BoundaryView`，纯确定性计算，无模型、无幻觉面。

**提问即定位**：用户每问一个问题，抽取概念、投影到边界上：

| 问题落点 | Agent 行为 |
| --- | --- |
| inside | grounded 回答 + "这是你已掌握的，要不要复习检验一下"（可转 quiz） |
| learning | grounded 回答 + 计入该概念的学习信号 + 必要时 reframe_simpler |
| frontier | 回答（如库内有料）+ "这在你的边界上" + 建议开系列/导入来源 |
| dark | 诚实说"你的知识库还没覆盖这里" + 给出从已知区到该点的路径提案 + 触发 discovery |

关键：**答不上来不是失败，是产品时刻**——通用 chat 会硬答（幻觉高发区），这个 Agent 把"边界外的问题"转化为 discovery 查询和学习路径，正是"帮助用户建立知识边界、方便拓展发散"的机制本体。

## 二、回答协议（区别于自由聊天的硬约束）

Agent 每个回合的产出是结构化对象，不是纯文本：

```ts
AgentTurnResult = {
  answer: { text, citations }          // grounded：只从 registry chunk 合成，过 grounding gate
  boundary: { zone, concepts }          // 这个问题落在你边界的哪里（确定性计算）
  actions: NextActionProposal[]         // 导入来源 / 开系列 / 加复习 / 发散推荐（用户确认才执行）
  signals: InteractionSignal[]          // 回流兴趣/薄弱信号（已有管道）
}
```

约束（与 groundedness.md 的原则一致）：
- 回答的事实部分只允许来自被引 chunk，走同一套 harness 验收门（含数字硬校验），没有旁路；
- 边界判断、路径规划是确定性计算，不经模型；
- 库内无料时不从模型知识硬答——明示"边界外"，转 discovery；
- 无模型配置时全链路仍可用：grounded QA 退化为抽取式（askGrounded 已实现），边界/路径本来就不需要模型。

## 三、发散与拓展的机制

1. **发散推荐**：回答之后附"与此相连"——该概念在图谱上的邻居中，选 learning/frontier 区的 2-3 个（`cardConnections` + boundary 现成）。
2. **拓展查询**：frontier/dark 区问题生成 discovery 查询（进 knowledge-loops 的 L3 管道），来源导入后以卡片形式回到 timeline——**对话种因，timeline 结果**，两个入口互相喂。
3. **学习路径**：dark 区问题触发路径提案：从用户 inside 区到目标概念的图谱最短路 + 缺失概念清单 → 一键转成 TopicSeries（对应 goals → syllabus）。
4. **需求理解**：对话是最高带宽的需求信号。每回合抽取的概念/意图写入 memory（interests、goals、recentQuestions 字段全部已有），直接改善 ranker 和 discovery 的输入——Agent 入口让"理解用户"从行为推断升级为用户亲口说。

## 四、计量与收费（从第一天就计量）

按回合的意图分档，与 monetization 的额度模型对齐：

| 档位 | 内容 | 成本特征 |
| --- | --- | --- |
| 免费/极低 | 边界查询、图谱路径、复习检验（确定性计算） | 无模型调用 |
| 标准额度 | grounded QA、简化重述、发散综合 | 1-2 次模型调用 |
| Credit | 触发深度研究：多源发现 + 导入 + 合成系列 | 多次调用 + 抓取 |

`AgentTurnRecord { userId, intent, tier, modelCalls, createdAt }` 持久化进 snapshot，计量先行，计费后接。免费档的存在很重要：边界地图的日常价值不烧钱，让用户天天回来；烧钱的动作（深研、拓展）有明确的"我要"动作，付费心理成立。

## 五、分期落地

**Phase A（确定性骨架，无模型依赖）**
- `graph/knowledgeBoundary.ts` + `agents/conversationAgent.ts`（规则意图路由：卡片上下文 → askGrounded；概念查询 → boundary；其余 → 诚实兜底 + discovery 提案）
- API：`POST /api/agent/ask`（turn 处理 + 信号回流 + turn 记录）
- Web：全局 Ask 输入框（侧栏常驻），回答区展示 answer / boundary 标注 / action 按钮
- 冒烟：无模型下四区问题各走对路径、信号落库、turn 计量落库

**Phase B（模型增强）**
- 模型做意图识别与跨卡 grounded 合成（多 chunk 综合回答，仍过验收门）
- 对话上下文记忆（多轮）；回合摘要写入 memory

**Phase C（边界可视 + 商业化）**
- 边界地图 UI（inside/learning/frontier 三环视图，替代"好看但没用"的大画布）
- 学习路径一键成系列；计费接线（额度扣减 + credit）

## 与既有文档的关系

- 技能（卡片按钮）与 Agent 入口不冲突：技能是边界上的"快捷动作"，Agent 是自由入口；两者共用 conversationAgent 的意图执行层。
- knowledge-loops 的 discovery（Sprint 1）是 Agent"拓展"动作的执行引擎，建设顺序不变，Agent 入口的 Phase A 可与其并行。
- groundedness 的验收门对 Agent 回答同样生效，无例外。
