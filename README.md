# AITimeline

AITimeline 是一个 open-core AI 知识流项目：开源部分负责 agent 工作流、知识卡片、排序、图谱和复习内核；商业 App 负责托管运行、多端同步、AI 互动额度、默认知识源和更完整的个人知识体验。

## Product Direction

目标不是做一个普通信息流，而是做一个会持续帮用户积累知识储备的 timeline：

- Agent 自动搜索、去重、总结和排序内容。
- 用户像刷信息流一样阅读知识卡片。
- 点赞、收藏和追问会沉淀进个人知识图谱。
- 不懂的点可以在卡片下和 AI 继续对话。
- 系统根据图谱薄弱点和遗忘曲线推送复习。

## Repo Shape

```text
apps/web          Hosted App 的 Web 原型
packages/core    可开源的知识流内核
docs             产品、商业、架构和上线策略
```

## Open-Core Boundary

开源内核优先服务开发者、重度知识用户和自托管玩家；收费 App 服务普通用户。

- 开源：agent runtime、connector 接口、知识卡片 schema、排序基础逻辑、图谱和复习算法、BYO API key。
- 收费：云端自动运行、多设备同步、高质量默认源包、AI 互动额度、深度研究、个性化长期记忆、移动端体验。

详见 [docs/product-strategy.md](./docs/product-strategy.md) 和 [docs/monetization.md](./docs/monetization.md)。

## Local Development

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite.

## Current MVP

第一版先验证四件事：

1. 用户是否愿意刷 AI 整理过的知识卡片。
2. 用户是否会对卡片持续追问。
3. 点赞内容是否能自然沉淀成知识图谱。
4. 复习提醒是否让用户感到自己真的在变聪明。

The current prototype also includes a mocked YouTube import flow: paste a YouTube URL, simulate transcript extraction, convert transcript segments into cited knowledge cards, and insert those cards into the ranked timeline.

## Next Planning Docs

- [docs/roadmap.md](./docs/roadmap.md): 前后端、agent、知识库、记忆和推荐系统的阶段路线。
- [docs/knowledge-transformation.md](./docs/knowledge-transformation.md): YouTube、文章、论文等来源如何被 agent 转化成 timeline 知识卡。
