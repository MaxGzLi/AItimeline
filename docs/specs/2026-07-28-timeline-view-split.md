# Spec: App.tsx 拆分——时间线与深读视图落位 views/（2026-07-28，手术第四刀）

## 背景

App.tsx 3267 行；六个 view（Agent/Discover/Graph/Notifications/Review/Settings）已拆在 `apps/web/src/views/`，剩时间线视图（feed 列表 + 卡片详情面板 + 提问框 + 右栏）与深读视图仍内联在 App.tsx 的 JSX 里。本单把这两块拆出去，App.tsx 收缩为「状态机 + 布局壳 + 视图路由」。bug 考古归因 46% 的问题在 App.tsx/web，拆视图是温床收缩的第一步（状态下沉留给后续 UI 单渐进做）。

## 设计

### A. 拆出 `views/TimelineView.tsx`

- 范围：App.tsx 中 `activeView === "timeline"` 的全部 JSX 分支（约 2703-2970 段的 feed/详情区 + 3124 起的右栏），含时间线 tab 切换、卡片列表、卡片详情面板、提问 composer、右栏（今日复习/知识边界/沉淀概念）。
- 形态照 `views/AgentView.tsx` 先例：函数组件 + 显式 props 接口。所有状态与 handler 留在 App.tsx，以 props 传入；**本单不做状态下沉、不引 context**。
- props 数量多是预期的（这是诚实反映耦合度的中间态）；用一个 `TimelineViewProps` 接口整理，语义分组注释即可。
- 纯搬移原则：JSX 与其内联的小渲染辅助函数（仅时间线使用的）原样移动，不改结构、不改样式类名、不改文案 key。

### B. 拆出 `views/DeepReadView.tsx`

- 范围：`activeView === "deepread"` 分支（约 3005-3018 段及其引用的渲染函数）。同样的 props 形态。

### C. App.tsx 收尾

- 两个分支替换为 `<TimelineView …/>`、`<DeepReadView …/>`。
- 因搬移而不再被 App.tsx 引用的 import（图标、组件、工具函数）移到新视图文件；App.tsx 不留死 import。
- 预期 App.tsx 从 3267 行降到 ~2400 行以下。

## 明确不做

- 不做状态下沉、不引入 context/store、不改任何 hook。
- 不改视觉、不改文案、不改交互行为——像素级等价。
- 不动其他六个 view、不动 lib/、不动 api。
- 不顺手修样式或重命名。

## 验证标准

- `npm run typecheck` / `npm run build` / `npm test` 全绿。
- UI 像素级等价验证：临时端口起 API+Web（不许碰 8787/5173/5198），对时间线（有卡状态优先，空态亦可）与深读视图截图，放 `docs/e2e/runs/2026-07-28-timeline-view-split/`；无法截图则写精确复现步骤由验收人补拍比对。
- `git grep -c "activeView === \"timeline\"" apps/web/src/App.tsx` 只剩视图路由处的一处判断（导航高亮等布局壳内的判断不算）。

## 风险声明

- props 接口很宽是本单接受的中间态；收窄靠后续状态下沉单。
- 深读视图若与时间线共用局部组件，放 `views/` 下共享文件或各自复制均可，以不改行为为准，汇报里说明选择。
