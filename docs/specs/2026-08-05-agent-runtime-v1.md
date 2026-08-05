# agent 运行时 v1：模型驱动的工具循环（赛前唯一架构动作）

隶属 `2026-08-05-pre-hackathon-master-plan.md` 第四节。目标：对话不再是「预设端点」，
而是一个循环——模型看情况、选工具、看结果、再决定；同时把 #166 的已知限制
（回答正文不进快照、刷新就丢）顺手修掉。

设计原则：**在现有对话路由之上加一层，不替换它。** 无模型时整条确定性路径
（`runConversationTurn` 规则路由 + 行动按钮）原样保留当兜底，冒烟天然继承。

## 一、分层与新文件

- `packages/core/src/harness/agentLoop.ts`（新，TS + 单测）：循环引擎。
  协议类型、JSON 提取（剥 markdown 围栏）、解析失败重试一次、步数上限、
  会话消息拼装。**工具由调用方注入**（`Record<name, {description, argsHint, run(args)}>`），
  引擎本身不碰存储和网络。
- `apps/api/src/domains/agentChat.mjs`（新，@ts-check）：装配工具、持久化对话、暴露端点。
- `apps/api/data/agent-chat.json`（新独立存储文件，不进主快照——主快照 v2 加集合会拒载，这是绕开它的正解）。

## 二、协议（跑在现有「补全」接口上）

模型客户端一律用 `createConfiguredAskModelClient(env)`（config.mjs:71）拿，
`undefined` 即走无模型兜底。接口形状见 `ModelClient`（modelRunner.ts:35，只有 `complete`）。

每轮系统提示词列出工具清单与规则，要求模型只输出一个 JSON 对象，二选一：

```json
{"action":"tool","tool":"ask_grounded","args":{"question":"..."},"why":"一句话"}
{"action":"say","text":"...","done":true}
```

- **不能依赖 `responseFormat: "json_object"`**：命令式客户端会丢弃它
  （commandModelClient.ts:79-83），所以解析端必须自己剥围栏；`extractJsonPayload`
  目前在 modelRunner.ts:444 和 askGrounded.ts:254 各有一份文件私有实现，
  在 agentLoop 里做一个导出的公共版（顺手还了这笔重复债）。
- 解析失败：把错误说明追加成一条 user 消息重试一次；再失败则终止循环、
  以确定性路径的结果收尾。
- 步数上限：默认 6 次模型调用（`AITIMELINE_AGENT_MAX_STEPS` 可调），
  到顶强制走一步 `say` 收尾。temperature 0.2。
- 工具结果以紧凑 JSON 作为 user 消息回给模型（截断到合理长度，引用全文保留在事件里）。

## 三、工具清单（v1，全部是已核实原语的薄封装）

| 工具 | 做什么 | 复用什么（已核实的位置） |
|---|---|---|
| `search_library {query}` | 词面重合检索库内卡片，返回 top5 `{postId,title,overlapScore}` | 照 `selectResearchAnswerPost` 的重合率打分（research.mjs:419） |
| `ask_grounded {question, postId?}` | 带出处回答；没给 postId 先内部检索选卡 | 照 briefsDeepRead.mjs:28 `handleAsk` 的 5 行模式：找卡 → 过滤 registries → `mergeSourceRegistries` → `askGrounded`。返回 `{answer,citations,grounded}` |
| `enqueue_import {url, reason}` | 排导入任务（不当场抓取） | 三步惯用法：`createSingleJobPlan` + `curationStore.enqueuePlan` + `saveCurationJobRecords`（shared.mjs:10 / backgroundCurationQueue.ts:274）。`import_source` 是计费 kind，先过 `applyDailyAutoJobBudget`（backgroundCuration.ts:266），超额如实报 `budgetExhausted`（enqueuePlan 返回空数组即超额） |
| `propose_discovery {topic}` | 提出出网搜索，**不执行**：造一条 `pending_confirmation` 的 AgentTurnRecord + 确认问题，交界面走既有确认流 | turnRecord 组装照 research.mjs:107-118；问题用 `buildDiscoveryConfirmationQuestions`（conversationAgent.ts:403）；确认仍走既有 `POST /api/agent/confirm`，后续 `research_question` 任务路径零改动 |
| `get_due_reviews {}` | 到期复习清单 | 照 server.mjs:757-773 四步：`backfillLegacyReviewStates` → `getHardDismissedPostIds` → `getDueReviewStates` → `selectReviewPrompt` |
| `read_memory {}` / `edit_memory {edits, reason}` | 读/改用户记忆（留痕） | `getSnapshotUserMemory`（shared.mjs:181）；`applyUserMemoryEdits` + `saveUserMemory`（userMemoryControls.ts:92 / persistenceStore.ts:465）。字段白名单就是那九个列表 + explanationStyle，reason 必填 |
| `list_recent_tasks {}` | 最近任务概览 | `listAgentTasks`（agentTasks.mjs:68），limit 10 |

**接地铁律**：说给用户的知识内容只能来自 `ask_grounded` 的返回（引用块由服务端从工具
结果原样透出，模型的 `say` 只做协调性话语——计划、状态、追问）。循环内一律不出网：
出网只有 `propose_discovery` → 用户确认 → 既有任务路径这一条。

## 四、端点与界面契约（对齐 #170 的轮询世界）

- `POST /api/agent/chat`，体 `{text, userId?}` → `{chatTurnId, status:"running"}`。
  立即落一条 turn 进独立存储，循环用 `setImmediate` 异步跑，事件边产生边写入。
- `GET /api/agent/chat/:id` → `{turn}`，界面 1–2 秒轮询直到终态。
- `GET /api/agent/chat?limit=N` → 最近 turn 列表（**刷新后重建对话流靠它**——
  #166「答案刷新就丢」到此修掉；根因是 AgentTurnRecord 没有答案正文字段，
  persistenceStore.ts:768 还会剥掉多余字段，所以答案正文存独立文件而不是硬塞快照）。

turn 形状：

```
{ id, userId, text, status: "running"|"succeeded"|"failed"|"awaiting_confirmation",
  events: [{type:"plan"|"tool"|"tool_result"|"say"|"error", at, text, data?}],
  answer?: {text, citations[]},        // ask_grounded 的原样结果
  actions?: [...],                      // 兜底路径的行动按钮 / 确认问题
  turnRecordId?,                        // propose_discovery 时给，供 /api/agent/confirm
  createdAt, updatedAt }
```

无模型兜底：`createConfiguredAskModelClient` 为 undefined 时，复用 `dispatchAgentTask`
的既有分流（parsePreferenceIntent → 喜好路；否则 handleAgentAsk），把结果包装成
同形状的 turn 事件。**界面只认识一种数据形状，感知不到有没有模型。**

## 五、独立存储文件（照抄已核实的模式）

- `createFileStorageAdapter(path, {ownerId, backupCount: 3})`（fileStorage.mjs:21），
  初始化八步照 server.mjs:190-236（默认路径 → env 覆盖 → resources 数组 →
  失败时倒序 close）。种子为空（新文件不用从快照搬）。
- 存储层模板照 backgroundCurationQueue.ts:207-271：空文件兜底
  `{version:2, revision:0, turns:[]}`、解码缓存、所有写走 `commitWithRetry`
  （revisionedStorage.ts:38）。
- **必须在 runtimeDecoder.ts:1 的种类枚举里加 `"agent-chat"`**（目前只有
  aitimeline | curation-jobs，这一步漏了会在解码处炸）。
- 容量：只留最近 200 条 turn，超出裁最老的；事件里的大字段不做二次压缩（v1 不需要）。

## 六、测试与验收

- vitest（agentLoop.test.ts）：围栏剥离、坏 JSON 重试一次后放弃、步数上限强制收尾、
  未知工具名/缺参的错误回传、`say` 提前结束。
- 新冒烟 `scripts/smoke-agent.mjs`（网络自由跑通，挂进 npm test 与 CI）：
  1. 无模型 POST /api/agent/chat 提问 → 轮询到终态 → 拿到确定性回答或「暂无依据」+ 行动按钮；
  2. 说一句喜好 → 记忆变更事件可见；
  3. 重开进程（或重建 store）→ GET 列表还能看到刚才的 turn（持久化生效）。
  日期一律用相对当前时间，不写死未来日期。
- 有模型（人工验收）：演示脚本三个动作——问答带出处、派活导入成卡、复习到期查询。
- 常规门：`npm run typecheck`、`npm run build`、`npm test` 全绿；
  core 改完要 `npm run build -w @aitimeline/core` 后 api 才能吃到。

## 七、边界（v1 明确不做）

流式 SSE（轮询够用）、多会话线程管理（单 userId 一条流）、工具并行、
把 agentTurns 旧数据迁进新存储、深读/简报类长任务当工具（仍走原队列）。
