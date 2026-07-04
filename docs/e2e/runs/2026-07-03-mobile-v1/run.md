# 手机端 v1 截图 — 2026-07-03

Expo (React Native) 手机端 v1 的视觉验证。**这些是 Expo web(react-native-web)在手机视口 390×844 下的渲染**,用无头 Chrome + `docs/e2e/cdp-shot.mjs` 截取。真机需用 Expo Go 扫码运行(见 `apps/mobile/README.md`),真机与 web 渲染有细微差异,交互行为以真机为准。

## 环境

- Expo SDK 53 / React Native 0.79 / React 19,`npx expo start --web --offline`(离线模式,沙箱里 Expo 的启动网络探测会失败,`--offline` 跳过)。
- 本地 API:`AITIMELINE_ENABLE_FIXTURES=1 node apps/api/src/server.mjs`(127.0.0.1:8787)。
- 数据是真实的,不是假图:导入了 fixture 文章(2 篇 → 2 张卡片),给 post-1 发了一条评论(观察员带出处回帖),另加了 2 条发现候选。视口 390×840;`captureBeyondViewport` 为真,内容超过一屏的页面截图会更高。

## 截图

| 文件 | 页面 | 说明 |
| --- | --- | --- |
| `01-timeline-light.png` | 时间线(浅色) | 推荐信息流:上下文行、圆头像、认证徽章、#概念标签、原文出处引用框、互动行、底部 tab、蓝色悬浮发帖按钮。 |
| `02-timeline-dark.png` | 时间线(深色) | 跟随系统深色:纯黑底、1px 细线、蓝色不变。 |
| `03-thread-expanded.png` | 帖内线程展开 | 点回复展开:回复数徽章、你的评论(绿头像)、观察员带出处的回帖(蓝头像 AI + 认证徽章 + 依据)。 |
| `04-compose.png` | 发帖弹层 | 底部弹层「写笔记」+「发布」,提示文案,背景压暗的时间线。 |
| `05-review.png` | 复习页 | 先在时间线点赞一张卡使其进入复习队列,再切到复习:题号/到期/间隔、问题、概念来源、「显示答案」。 |
| `06-settings.png` | 设置页 | API 地址(默认 127.0.0.1:8787)+ 局域网提示、连接状态「已连接」(/health 探测通过)、主题分段控件(跟随系统/浅色/深色)。 |
| `07-discover.png` | 发现页 | 候选来源列表 + 状态 chip(待处理)+「立即整理」按钮。 |

## 说明

- 复习队列由本地会话信号(点赞/收藏)驱动,和 web 端一致;直接打开复习页(未交互)会显示空状态提示,这里先点赞再进入以展示题目。
- Tab 之间用 react-navigation 的 web 深链导航;截图工具通过 `history.pushState` + `popstate` 做客户端切换,以保留会话内的点赞状态。
- 未做(v2):图谱可视化、双链渲染、智能体机器房、来源导入、证据账本、推送。
