# 帖内公开评论线程 (2026-07-03)

把卡片评论从只存浏览器 localStorage、只在详情抽屉可见,改成持久化的帖内公开线程:
用户评论任何知识卡,观察员有出处地回复,线程当场在帖子内展开,回复计入 agentTurns 用量。

## 环境

- 后台 API(带 fixtures):`AITIMELINE_ENABLE_FIXTURES=1 npm run dev:api`,监听 127.0.0.1:8787
- Web(Vite):`npm run dev`,本次跑在 127.0.0.1:5174
- 先导入一篇 fixture 文章生成两张真实持久化的卡:
  `POST /api/import/article {url: .../fixtures/article}`
- 截图工具:`docs/e2e/cdp-shot.mjs`(交互脚本见下)

## 截图

| 文件 | 说明 |
| --- | --- |
| `01-timeline-dark.png` | 时间线;每张卡的回复按钮(MessageCircle)默认收起 |
| `02-thread-open-dark.png` | 点回复按钮当场展开帖内线程,底部「回复…」输入框已填入评论,蓝色「发送」 |
| `03-observer-reply-dark.png` | 发送后:用户评论(你)+ 观察员回复(AI 头像 + 认证徽章 + 来源标题 +「依据」引用)内联出现,回复计数变成 2 |
| `04-observer-reply-light.png` | 浅色主题下的同一线程(多轮评论),对比度正常 |

交互脚本(注入页面):
- 展开:点 `.x-act[aria-expanded]`,填 `.x-reply-input`
- 发送:再点 `.x-reply-form .x-pill`,轮询等 `.x-reply .x-body` 出现观察员回复

## 结果

- 回复按钮从「打开抽屉」改成展开/收起帖内线程;详情抽屉仍可用(点卡片正文打开)。
- 观察员回复有出处:图中显示「知识观察员 · 来源:Learning agents need a timeline surface」,正文带「根据/依据」引用。
- 线程持久化:评论后重取 `/api/timeline`,user_comment + agent_reply 两个块仍在卡片 thread 上。
- 计量:每次评论 `snapshotSummary.agentTurns` +1。
- 验证:`npm run typecheck && npm run build && npm test` 全绿(smoke-api 新增帖内回复端点断言)。
