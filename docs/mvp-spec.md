# MVP Spec

## MVP Goal

在 4 到 6 周内验证一个问题：用户是否愿意为“AI 整理的个性化知识流 + 卡片级 AI 互动 + 知识沉淀”持续使用和付费。

## In Scope

### Knowledge Timeline

- 中间主 feed。
- 每条内容是一张知识卡片。
- 卡片包含标题、摘要、核心概念、来源、推荐理由和可信度状态。
- 支持点赞、收藏、追问、加入复习。

### Agent Pipeline

- 用户选择 3 到 5 个主题。
- Agent 根据主题定期搜索或读取 source connector。
- 内容进入去重、摘要、概念抽取和排序流程。
- MVP 阶段可先人工维护一部分高质量 source。

### AI Comment Interaction

- 每张卡片下可以向 AI 提问。
- AI 回复需要引用当前卡片、相关卡片和用户已点赞知识。
- 交互次数进入额度系统。

### Lightweight Knowledge Graph

- 点赞或收藏后抽取概念节点。
- 先用列表和局部关系展示，不做复杂大图。
- 每个概念节点能反查相关卡片。

### Review Queue

- 收藏内容进入复习队列。
- 根据时间、主题薄弱点和用户互动频率生成复习提醒。
- 复习卡片混入 timeline。

## Out of Scope

- 公开发帖和关注关系。
- 完整社交推荐。
- 大规模用户生成内容审核系统。
- 原生移动 App 首发。
- 复杂图谱编辑器。

## Success Metrics

- Day 1: 用户至少读完 8 张卡片。
- Day 7: 用户至少回来 3 天。
- Interaction: 每 10 张卡片产生至少 2 次 AI 追问。
- Deposit: 每个活跃用户每周收藏或点赞至少 10 张卡片。
- Payment Signal: 早期重度用户愿意为更高 AI 额度或自动 agent 运行付费。

