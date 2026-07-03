# 收尾小修批量（chore/cleanup-batch）

日期：2026-07-03
分支：`chore/cleanup-batch`

三件独立的收尾小修，合到一个 PR。

## 1. 中文化残余的 job.reason

跟进卡时间线上的「为你推荐 · …」上下文行 = 中文骨架 + 拼接的 `job.reason`，
而 `job.reason` 之前在几处仍是英文模板。改成平实自然的中文：

- `packages/core/src/harness/expansionPolicy.ts`
  - `buildExpansionReason` 的 5 条英文分支（冷却、复习、提问、点赞外扩、拉动继续）
  - `createFallbackFeedback` 的兜底 `reason`（会经 `buildExpansionReason` 末尾的
    `return feedback.reason` 流进 `job.reason`）
- `packages/core/src/agents/backgroundCuration.ts`
  - `createSourceImportJob` 的 `import_source` 任务 reason
  - `createSourceDiscoveryJob` 的 `discover_sources` 任务 reason

未改动：各处 suppression 的 reason（属 `AgentExpansionSuppression` / `BackgroundCurationSuppression`，
不是 `job.reason`，不会出现在时间线「为你推荐」行），保持改动最小。

`packages/core/src/harness/feedbackPolicy.ts` 的 `buildReason`、
`packages/core/src/discovery/sourceDiscovery.ts` 的候选 `buildReason` 本就已是中文，未动。

无 smoke 断言这些英文原文（smoke 里的 reason 都是测试自备输入，`smoke-api.mjs:247`
断言候选 reason 以「为」开头，仍成立），故无需同步改测试。

### 验证方式

`apps/api/data/*.json` 是本地持久化数据，改 core 前生成的旧卡会带旧英文 reason。
为得到干净截图：清空 `apps/api/data/`，用 `AITIMELINE_ENABLE_FIXTURES=1` 重启 API 重新播种，
再补两条互动信号 + 跑一次 `/api/curation/run` 生成新跟进卡。

截图 `timeline.png` 里两张跟进卡的「为你推荐 · …」行已全中文：

- 「…所以换个更简单的角度重新讲一遍。你提了问题，所以先做一张更简单、更贴近出处的跟进，再往外展开。」
- 「…所以准备了一张更深入的跟进卡片。你展开了讨论串或停留了很久，说明有兴趣，所以继续这条学习路径。」

（卡片标题/正文仍是英文：那是无模型时确定性兜底生成的帖子正文，不在本次范围内。）

## 2. 机器房用量改真实数据

`apps/web/src/views/AgentView.tsx` 用量区原来写死「128 剩余 AI 额度」（假口径）。
改成显示真实的观察员回复次数：

- `apps/web/src/lib/types.ts`：`ApiSnapshot` 补 `agentTurns: AgentTurnRecord[]` 字段声明
- `apps/web/src/App.tsx`：新增 `agentTurnCount` state，在 `refreshFromApi` 的
  `/api/snapshot` 响应里取 `snapshot.agentTurns.length`，传给 `AgentView`
- `apps/web/src/views/AgentView.tsx`：卡片改为 `{agentTurnCount}` + 标签「已用 Agent 回复」

截图 `agent-machine-room.png` 里「记忆与用量」显示「2 / 已用 Agent 回复」，
本次会话向 `/api/agent/ask` 提了 2 个问题，agentTurns 真实为 2。

## 3. 复习队列用当前时间

`apps/web/src/App.tsx`：`createReviewQueue(allCards, allSignals, new Date("2026-06-08T08:00:00.000Z"))`
去掉写死的第三参，改为 `createReviewQueue(allCards, allSignals)`，默认取当前时间
（`packages/core/src/review/spacedReview.ts` 的 `now = new Date()`）。

演示信号较旧，队列会全部到期——这是预期行为。截图 `timeline.png` 右侧「今日复习」
正常渲染，显示到期项与「开始复习（4）」。

## 验证结果

- `npm run typecheck`：通过
- `npm run build`：通过
- `npm test`（smoke:core + smoke:api + smoke:model）：全绿

## 截图

- `timeline.png`：时间线，跟进卡「为你推荐」行为中文；右侧复习面板正常
- `agent-machine-room.png`：智能体机器房，用量区显示真实「已用 Agent 回复 2」
