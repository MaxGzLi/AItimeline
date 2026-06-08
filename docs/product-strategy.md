# Product Strategy

## Positioning

AITimeline 是一个由 AI Agent 驱动的知识型 timeline。它借用用户熟悉的信息流交互，但核心不是社交发布，也不是传统知识库，而是让 agent 把来源资料转化成能被刷、能被追问、能被复习、能连成图谱的知识帖子。

一句话定位：

> 把来源资料变成让人上瘾的学习 feed。

更准确的英文品类表达：

> Open-core agentic knowledge media.

## Why Open-Core

这个产品同时有两个用户群：

- 开发者和知识重度用户：想自定义 agent、source、prompt、ranking 和数据存储。
- 普通用户：想打开 App 就能刷、能问、能收藏、能复习。

所以不要在“开源项目”和“商业 App”之间二选一。正确取舍是：

- 用开源建立可信度、扩展性和早期社区，尤其是 agent harness、post schema、thread policy、graph policy 和 recommendation feedback loop。
- 用商业 App 卖省事、连续运行、同步、默认配置和 AI 互动额度。

## Product Principles

- Knowledge first: timeline 里的每条内容都必须能增加知识储备，而不是制造噪音。
- Agent visible enough: 用户要知道为什么这条内容被推给自己。
- Source grounded: 知识卡片必须保留来源和不确定性。
- Interaction deposits value: 点赞、收藏、评论和追问都要写回用户知识系统。
- Review is part of the feed: 复习不应该像另一个学习软件，而是自然混入 timeline。
- Feedback drives generation: 没互动的帖子要被降频、换表达或冷却；有互动的帖子要自动扩展深度或宽度。
- Media-native, not clickbait: 标题和 hook 要有吸引力，但不能牺牲事实、来源和学习价值。

## First Target Users

- AI、创业、产品、投资、科研方向的重度学习者。
- 每天看很多内容，但记不住、连不起来的人。
- 已经愿意为 ChatGPT、Notion、Readwise、Obsidian 或信息源付费的人。

## What We Avoid

- 不做纯社交网络。
- 不做营销号内容聚合。
- 不做完整复刻 X 的视觉和品牌。
- 不做一开始就很复杂的 3D 知识图谱。
- 不把所有 agent 配置暴露给普通用户。
- 不做另一个 NotebookLM clone。
- 不做另一个 AI 稍后读或 generic RAG chat。
