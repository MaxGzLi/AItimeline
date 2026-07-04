# 2026-07-04 — 双链自动补全

分支 `feat/wikilink-autocomplete`。发帖框与回复框输入 `[[` 弹出概念/卡片候选,键盘与鼠标均可选中,自动补 `]]`。Spec:`docs/specs/2026-07-04-wikilink-autocomplete.md`。

## 环境

- API:`PORT=8791 npm run dev:api`(隔离数据目录,截图前清空重建)。
- Web:`VITE_AITIMELINE_API_URL=http://127.0.0.1:8791 npm run dev -w @aitimeline/web -- --port 5181`。
- 截图:`docs/e2e/cdp-shot.mjs` + 交互脚本 `docs/e2e/interactions/wikilink-autocomplete.js`。

## 无头浏览器的坑(已修进交互脚本)

无头页面永远没有窗口焦点(`document.hasFocus() === false`),原生 focus 事件不触发;React 17+ 的 `onFocus` 委托的是冒泡的 **focusin**。交互脚本里对输入框手工派发 `focus` + `focusin` 两个事件,下拉的 focused 门控才会打开。首次执行(Codex)在其沙箱内 Chrome 直接 SIGABRT,未到达此层;验收补拍时定位并修复。

主题:无头 Chrome 的 `prefers-color-scheme` 为 dark,交互脚本用 URL hash(`#dark`)选择目标主题,按 `t` 键切换到位。

## 交互脚本兼行为断言

脚本返回信号(两主题均为):
`options=8;kinds=概念×4;first=RAG/评估/向量检索/智能体;enterPrevented=true;middleInsert=true;noMatch=true;closed=true;replyClick=true`

对应验收:候选上限 8、概念排前、Enter 选中不提交表单、文本中间补全光标正确、无匹配不弹、已闭合 `[[x]]` 不弹、回复框点击选中可用。

## 截图

| 文件 | 说明 |
| --- | --- |
| `01-autocomplete-light.png` | 发帖框输入 `[[`,下拉展开(8 条概念候选,↓ 高亮第二条);回复框中为点击选中后的 `[[产品策略]]`。 |
| `02-autocomplete-dark.png` | 同场景暗色主题。 |

## 验证

`npm run typecheck && npm run build && npm test` 全绿(Codex 执行后自验 + 验收人独立复跑)。
