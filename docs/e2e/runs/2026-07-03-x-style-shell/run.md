# 2026-07-03 · X 风格外壳与六视图迁移

用户确认的重设计(设计稿三轮迭代后通过):整体 UI 迁移到 X(Twitter)的视觉语法 ——
贴左三栏(84px 图标导航 / 600px 主栏 / 384px 右栏)、扁平帖子流 + 1px 分隔线、
蓝色 #话题标签、引用框呈现原文出处、右栏只放学习状态。

## Before

旧 UI(单一 App.tsx 大布局,右栏堆满操作面板)见上一个 run:
`docs/e2e/runs/2026-07-03-agent-ask-panel/agent-ask-answered.png`

## After

- `after-timeline-light.png` — 时间线(浅色):发帖框、上下文行、帖子、引用框、互动行、右栏模块
- `after-agent-reply-dark.png` — 发帖提问后,观察员在流内回帖(知识边界标记 + 出处引用 + 动作)
- `after-graph-dark.png` — 图谱视图:知识边界三区(已掌握 / 学习区 / 前沿区)
- `after-review-dark.png` — 复习视图:逐题间隔复习
- `after-discover-dark.png` — 发现视图:候选来源队列
- `after-agent-dark.png` — 智能体机器房:导入 / 候选源 / 导入记录 / 记忆与用量
- `after-settings-dark.png` — 设置视图

截图为整页高度(本地 API 在线,演示数据较多),用 `docs/e2e/cdp-shot.mjs` +
视图切换交互脚本采集。
