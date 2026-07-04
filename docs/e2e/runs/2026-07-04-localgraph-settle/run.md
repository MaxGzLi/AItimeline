# 局部图谱打开时节点乱蹦(力导向落位动画当着用户播放)

- 症状:新打开帖子详情页时,「在你的图谱里」模块内节点乱蹦乱跳一两秒才停(用户截图报 bug);后台策展不断加卡时还会反复重播。
- 根因:LinkedGraphCanvas 挂载/图谱签名变化时走 `alphaRef=1 + ensureRunning()`,从头播放力导向收敛动画;只有 prefers-reduced-motion 分支才走 `settle()`(同步收敛、一次画出定稿)。
- 修复:挂载/图谱变化一律 `requestAnimationFrame(() => settle())`;拖拽交互的 reheat 动画不变。
- 客观量测(headless,打开详情后每 200ms 快照 canvas,共 3.2s):
  - 修前(main@ba2088b):11 个不同画面,前 2000ms 每帧都在变。
  - 修后:2 个不同画面,600ms 后完全静止(600ms 处的一次变化是定稿重画)。
- `01-after-settled.png`:修复后落位的局部图谱(1440×900 暗色详情页右栏)。
