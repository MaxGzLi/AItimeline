# 提问闭环:提问即委托 —— 确认 → 自动取证 → 异步交作业

## 背景与问题

现状(已核实):库外(dark)问题走 `runConversationTurn`(packages/core/src/agents/conversationAgent.ts:69,无状态、不带历史轮次),回帖给「为这个问题找来源」按钮;点击后 `handleDiscoverSources`(apps/web/src/App.tsx:1386)调 `/api/discovery/run`,候选**默默**落进发现页;去重后新增为 0 时前端显示「没有找到新的来源,换个问法试试」(误导);候选要手动逐条导入;**导入完成后原问题永远不会被回答**。链路每环都对,连起来是断的。

目标体验:你问 → 它确认范围(回帖里 2~3 个带选项的问题)→ 它异步搜索、自动导入最好的来源、生成卡片、**用新卡片有出处地回答原问题**,答案送进通知流。全程 grounding 红线不动:回答只来自导入的来源。

## 设计

### 1. 轮次带上下文 + 待确认状态(core)

- `ConversationTurnInput` 增加 `previousTurns?: AgentTurnRecord[]`(同线程最近 ≤5 轮),模型路径把它拼进提示词;确定性回退路径忽略它(不硬造对话感)。
- `AgentTurnRecord` 增加 `status: "answered" | "pending_confirmation" | "researching" | "closed"`(现有记录缺省 answered,旧快照兼容)与 `threadId`(同一对话串共享)。

### 2. dark 回复:最近邻 + 确认问题(core + web)

dark 区回帖内容升级为三部分:
1. 诚实拒答(现文案保留);
2. **库内最近邻**:按概念重合度给 ≤2 张最接近的已有卡——「库里最接近的是《X》」,可点开(没有就不显示);
3. **确认块**:≤2 个单选问题,作为结构化 action 下发(复用现有 AgentReplyAction 机制,新 kind `confirm_discovery`),例:
   - 「你想要哪种?」定义与原理 / 最新进展 / 与我已知的对比
   - 「查多深?」快速回答(导 2 篇) / 深入研读(导 4-5 篇)

   web 端 AgentReplyThread 渲染为选项 chips,像回帖一样点选;选完调 `POST /api/agent/confirm { turnId, choices }`。确定性回退(无模型)用固定模板问题,选项映射到固定 query 修饰词——离线路径必须完整可跑。

### 3. 异步研究管线(api)

`POST /api/agent/confirm` 把任务塞进现有 curation 队列(新 job kind `research_question`),立即返回;worker 执行:

1. 按 choices 组装 queries → searchProvider 搜索(未配置 → 直接产出「搜索服务未配置」结果通知);
2. 候选打分(与问题的词面相关度 + 来源类型加权,确定性即可),**自动导入 top N**(快速=2,深读=4;导入走现有 import 管线与门禁),其余候选照旧进发现页备选;
3. 对每个导入来源产的卡跑现有 grounding 校验(不新造);全军覆没(门禁拦光/全部导入失败)也要产出结果通知,说明拦在哪;
4. 用 `askGrounded` 基于新卡回答原问题 → 写一条 `agent_answer` 通知 + 在原 turn 线程追加回答记录(status → answered)。

**来源记来路(复利标注的数据基础)**:导入的 source 记录上加 `origin: { turnId, question, createdAt }`。`askGrounded` 的回答引用来源时,若该来源有 origin 且 origin.turnId ≠ 当前 turn,回答里附一句「这条证据来自你 M 月 D 日的提问『…』」。

### 4. 通知流(api + web)

- 快照新增 `notifications: Array<{ id, kind: "agent_answer" | "research_progress", turnId, postIds, body, createdAt, readAt?: string }>`;`GET /api/notifications`、`POST /api/notifications/:id/read`。
- web 左侧栏新增「通知」入口(铃铛,未读计数小蓝点,贴 X 风格);通知项点开显示回答全文(含引文与出处跳转)+ 支撑它的新卡列表。**通知的存在独立于卡片生命周期**:原卡退场/被 ✕ 也照常展示,注一句「你提问的那张卡已退场」。
- 研究进行中,原对话处显示状态行:「正在找来源 → 读了 2 篇 → 已回复」(轮询现有刷新通道即可,不引入 websocket)。

### 5. 前端提示修正(顺带修掉已知误导)

`handleDiscoverSources` 一带的三个状态改文案+跳转:found → 「已找到 N 条来源,去发现页看」(带跳转);empty(去重后无新增)→ 「相关来源已在发现页(N 条待处理)」(带跳转);unconfigured → 「搜索服务未配置,在 .env 设置 AITIMELINE_SEARCH_API_KEY」。旧按钮路径与新确认路径并存(问 AI 面板的存量入口不删)。

## 明确不做

- 不做 websocket/SSE;进度靠现有轮询。
- 不做连接播报/概念归一(spec ②)。想法 tag(spec ③)不做。
- 不改 grounding 门禁、不放宽任何校验;回答永远不掺模型记忆。
- 不做多用户;userId 沿用 local-user 约定。
- 通知不做已读之外的管理(删除/归档后续再说)。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. smoke-api 扩展断言(硬要求,全部走确定性回退+fixture 搜索,离线):dark 问题返回确认 action;confirm 后队列出现 research job;worker 跑完自动导入 ≤N、候选剩余进发现页;产生 agent_answer 通知且回答含引文;来源带 origin;第二个问题命中同一来源时回答含复利标注;门禁全拦场景产生说明性通知;未配置搜索时产生「未配置」通知。
3. smoke-core:previousTurns 传入不破坏现有断言;AgentTurnRecord 新字段旧快照兼容。
4. UI 截图:确认 chips、进度状态行、通知列表、通知详情(含复利标注一句)。i18n zh/en 成对。
