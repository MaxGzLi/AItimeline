# 2026-07-04 — 「为这个问题找来源」可点击(知识拓展闭环)

分支 `feat/discover-from-ask`。观察员回复里的 discover_sources chip 从纯展示 span 变为真按钮,接新端点 POST /api/discovery/run。Spec:`docs/specs/2026-07-04-discover-from-ask.md`。

## 截图(隔离环境 8793/5183,未配置搜索 key)

| 文件 | 说明 |
| --- | --- |
| `01-chip-clickable-light.png` | 库外问题的回复:「为这个问题找来源」为蓝色可点 chip。 |
| `02-unconfigured-note-light.png` | 点击后:提示未配置 AITIMELINE_SEARCH_API_KEY + 「去导入」跳智能体页。 |

交互脚本 `docs/e2e/interactions/discover-chip.js`(信号:`mode=chip;label=为这个问题找来源` / `mode=clicked;note=还没配置搜索服务…`)。已配置分支(stub provider 找到候选并持久化)由 smoke-api 断言覆盖。

## 验证

`npm run typecheck && npm run build && npm test` 全绿;smoke-api 新增:配置分支候选持久化、空参 400、未配置分支 configured=false。
