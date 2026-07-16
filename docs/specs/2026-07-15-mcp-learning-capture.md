# MCP 学习采集:外部 agent 对话自动入时间线

## 背景

用户大量学习发生在外部 AI 对话里(Claude Code / Claude 等):读链接、问问题、听 agent 讲解。这些学习痕迹目前完全流失在对话里,进不了时间线、图谱和复习循环。把 AITimeline 做成 MCP 服务后,任何接入的 agent 都能在学习发生时自动把「读过的来源」和「对话里学到的内容」存进来。(2026-07-15 用户拍板:场景=外部 AI 对话;粒度=链接和对话内容都成卡。)

## 目标

- 在 Claude Code 里 `claude mcp add aitimeline ...` 一条命令接入;之后正常聊天学习,无需手动操作,时间线里出现:①对话中读过/引用过的 URL 成的卡;②对话讲解内容本身成的卡(出处指向对话原文,界面明确标注「对话来源」)。
- 对话成卡走完整出处链:对话摘录注册为来源、卡片引文能点回摘录原文、grounding 校验照跑。
- 无模型配置时一切照常(确定性降级)。

## 方案(设计门禁记录)

### 1. 新来源类型 `conversation`(core)

- `SourceType` 增加 `"conversation"`(沿 `user_note` 先例)。
- 对话采集时,把 agent 提交的对话摘录(用户问题 + agent 讲解的原文片段)注册进 source registry:内容寻址、切 chunk、入版本链(复用 #127 机制)。卡片引文指向这些 chunk,grounding gate 原样校验——出处红线不破。
- 对话来源的记录字段:`agentName`(如 "claude-code")、`capturedAt`、`conversationTitle?`。

### 2. API 端点(apps/api)

- `POST /api/captures/source`:`{ url, reason?, topic? }` → 建 source candidate 入既有候选池,`intakeKind: "agent_capture"`;绕过订阅 relevance 过滤(agent 采集=明确学习意图,同存量回填先例),质量门禁与每日预算照走。已存在的 URL 幂等返回现状。
- `POST /api/captures/conversation`:`{ topic, excerpt, agentName?, sourceUrls? }` → 注册 conversation 来源 + 入队一个 card 生成 job(走既有 import 管线的 harness;无模型时降级为抽取式卡片:直接引对话摘录的关键句)。`excerpt` 长度上下限(过短拒绝,过长截断),同一摘录内容寻址幂等。
- `GET /api/captures/context`:返回精简学习上下文(近期主题、已确认概念 top N),供 agent 了解「用户已经会什么」来因材施教。只读,不含卡片正文。

### 3. MCP 服务(新 workspace `apps/mcp`)

- 纯 stdio MCP server(`@modelcontextprotocol/sdk`),plain `.mjs`(同 apps/api 惯例),薄封装:工具调用 → 本地 API HTTP 请求(`AITIMELINE_API_URL`,默认 `http://127.0.0.1:8787`)。**不直接碰模型、不直接碰快照文件。**
- 工具三个,与端点一一对应:`capture_source` / `capture_conversation` / `get_learning_context`。
- 「自动」靠 MCP server instructions 字段实现:随握手下发给 agent 的使用守则——什么时候采(用户明显在学一个主题、读了一个来源、一段讲解收尾时)、什么不采(闲聊、代码调试、用户未在学习)、隐私约束(只采与学习主题直接相关的摘录,不采用户个人信息)。
- README 段落写清 Claude Code 接入命令与验证方法。

### 4. 卡片可信标注(web)

- 对话来源的卡在流里带「对话」徽章(沿既有徽章语法,W7-G1 收紧过的体系),来源行显示 agent 名与采集日期;点引文回看对话摘录原文(复用既有引文查看)。
- 不做新页面;对话卡与普通卡同流同排序。

## 明确不做(一期)

- 不做远程/托管 MCP(仅本地 stdio;托管等公开上线一起做);
- 不做整段对话自动同步——只收 agent 主动提交的摘录,不做后台爬对话;
- 不做浏览器插件等非 MCP 采集入口;
- 不做 agent 写回操作(点赞/驳回/删除卡片等工具);
- 不做对话卡与文章卡的自动合并去重(既有图谱连接机制自然处理);
- 不做多用户/鉴权(本地单用户,复用现有 loopback 信任模型)。

## 假设与开放问题(用户可推翻)

- 对话卡默认较低初始 relevance(0.5 档),靠互动养上去——agent 讲的话可信度低于原始来源,不该抢流;
- `capture_conversation` 占每日自动预算(与回填同池),防对话灌爆;
- MCP 依赖 `@modelcontextprotocol/sdk` 是新增 npm 依赖(唯一新依赖);
- agent 名先取自工具入参 `agentName`,不做客户端指纹识别;
- 疑问/追问类内容一期不单独建模——agent 可把「用户问过什么」写进 excerpt,随卡入图谱。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿(网络隔离)。
2. smoke-api 新增断言:conversation 采集 → 来源注册(内容寻址幂等)+ 卡片生成(无模型降级路径)+ 引文指向摘录 chunk 且 grounding 校验通过;`agent_capture` 候选绕 relevance 但被质量门禁拦得住(坏摘录被拒);同 URL 重复采集幂等;预算耗尽时排队不超发。
3. MCP smoke(新 `scripts/smoke-mcp.mjs` 或并入 smoke-api):stdio 起服务,list tools 齐全,`capture_source`/`capture_conversation` 调用经 stub API 返回成功,server instructions 非空。
4. UI 截图:对话卡在流里的徽章与来源行,浅色+深色。
5. 真实验收(验收人):Claude Code 接入本地 MCP,真实聊一段学习对话,采集的链接卡与对话卡出现在流里,引文可回看。

## 实现偏离记录(2026-07-15)

实现与上文方案的出入,均已验证:

1. **对话成卡改为同步确定性成卡,不入队 job**:与笔记(`transformUserNote`)完全同构——摘录即卡片正文,自证引文,零模型参与。有模型也不改写:agent 的话再被模型改写会叠加幻觉面,摘录原文就是最诚实的卡。spec §2 里「入队 card 生成 job」不再需要。
2. **来源记录未新增字段**:`agentName` 放 `Source.author`、`capturedAt` 放 `publishedAt`,免 schema 扩展;`intakeKind: "agent_capture"` 在持久层双层校验(decode 枚举 + normalize)都已登记。
3. **摘录长度**:硬下限 120 字符(不足则报 HTTP 400)、超 4000 截断;工具描述向 agent 建议 200-4000。
4. **门禁断言的落实方式**:「坏摘录被拒」= 过短 400;URL 采集车道的质量门禁用瘦文章 fixture 断言(导入后 `rejected_source`)。相关性过滤确实不走:空库(无已确认概念)下采集照样入队。
5. **对话卡即时入流**(与笔记一致),不走 release plan 错峰;经 `capture_source` 采集的 URL 卡走既有导入管线,错峰照旧。
6. **smoke:mcp 成为第四个冒烟**,并入 `npm test` 与 CI;MCP 服务用内存管道直连断言(list tools / 三工具 / instructions 随握手下发),另有真实 stdio 子进程端到端在验收时人工跑过。
7. **证据账本表现与笔记同构**:TITLE/RECOMMENDED BECAUSE 两条主张不在摘录原文中会记「失败」(自证类卡的既有表现,非本单引入)。
