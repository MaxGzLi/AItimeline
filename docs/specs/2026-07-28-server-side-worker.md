# Spec: 观察员搬出浏览器——服务端定时 worker（2026-07-28，结构手术第一刀）

## 背景

后台工作（订阅轮询、供给回填、到期任务执行）目前靠浏览器页面驱动：网页可见时每 45 秒 POST `/api/curation/run`。这一架构决定是 bug 考古中「接缝族」的根源（假超时烧预算 #138、提问后无产出的黑箱、页面不开就全停）。roadmap「Immediate Next Milestones」第 2 条即为此项。#138 已给 run 端点加了进程内互斥（`curationRunInFlightSince`，实例作用域，try/finally 释放），本单在其上把调度权移入 API 进程。

## 设计

### A. 服务端（apps/api/src/server.mjs）

1. **共享执行函数**：把 `/api/curation/run` 路由体内的执行管线抽成 `executeCurationRun(deps, options)`（订阅轮询、backlog digest、capture 队列、枯竭回填、runDueBackgroundCurationJobs、物化，全部原样搬移），路由与 worker 共用。路由对外行为一字不变（含 alreadyRunning 语义、响应字段）。
2. **定时 worker**：`createApiServer` 内新增 interval 循环，每个 tick 等价于一次 `{ limit: 4, kinds: 全部 }` 的自动 run。tick 必须走与路由同一把互斥：手动 run 在跑则本 tick 直接跳过（不排队等待），反之手动请求撞上 worker 运行返回 alreadyRunning（既有行为）。
3. **默认关闭、入口开启**：`createApiServer(options)` 默认不启动 worker（`options.worker` 缺省 false）——smoke 与嵌入式用法零影响。`node src/server.mjs` 主入口在 `AITIMELINE_WORKER !== "0"` 时开启。间隔 `AITIMELINE_WORKER_INTERVAL_MS` 默认 60000，下限钳到 5000。两个 env 进 `.env.example` 带注释。
4. **暂停/恢复**：`POST /api/worker` body `{ enabled: boolean }`（校验布尔，400 拒非法）。状态为 in-memory，重启回到默认开启；不做持久化（spec 明确的取舍）。
5. **状态可见**：`/api/timeline` 响应新增 `workerStatus: { enabled, running, intervalMs, lastRunAt?, lastRunSummary? }`。`lastRunSummary` 是简要计数（处理任务数、回填入队数、订阅检查数即可）。`running` 复用互斥标志。
6. server close 时 `clearInterval`；tick 内任何异常必须被捕获记日志，不得杀死 interval 或进程。

### B. 网页端（apps/web/src/App.tsx + lib/types.ts + lib/i18n.ts）

7. **删除页面驱动循环**：移除 45 秒 `runIfUseful` interval、visibilitychange 触发与 `hasQueuedScoutWork` 的触发用途（展示用途可留）。手动「运行观察员」按钮保留（走既有 runCuration）。
8. **开关接服务端**：「自动生产/自动观察员」开关改为调 `POST /api/worker`，显示状态以 `timeline.workerStatus.enabled` 为准；`aitl-auto-scout` localStorage 不再驱动任何运行逻辑（清掉相关读写）。
9. **状态栏由 workerStatus 驱动**：空闲/运行中/上次运行摘要（如「上次运行 3 分钟前 · 处理 2 项」），沿用现有状态栏文案风格，i18n 中英。#138 的 alreadyRunning/超时文案保留（手动路径仍会用到）。
10. `handleGenerateDeepRead` 手动生成路径不动。

### C. smoke（scripts/smoke-api.mjs）

11. 既有场景零改动（worker 默认关）。
12. 新场景（全离线、相对时钟）：
    a) 开 worker（interval 200ms）+ seed 一个到期任务，不调 `/api/curation/run`，轮询 `/api/curation/jobs` 直到该任务终局（带超时上限，失败信息给清楚）；
    b) `POST /api/worker {enabled:false}` 后 seed 第二个任务，等 ≥3 个 interval 确认未被处理；再 `{enabled:true}` 恢复后被处理；
    c) 互斥：用可控阻塞 fetch 让手动 run 挂住，期间跨多个 interval，断言 worker tick 没有叠跑（阻塞资源的抓取计数不增）；
    d) `/api/timeline` 的 `workerStatus` 字段形状与 enabled 翻转断言。

## 明确不做

- 不做跨进程/多实例调度与分布式锁（单进程假设不变）。
- 不做 worker 状态持久化（重启回默认开启）。
- 不做每源/每用户配额（#136 的每日预算已管总量）。
- 不改 `/api/curation/run` 路由的对外行为与响应契约。
- 不动 apps/mobile。
- 不动 #136/#138 刚合并的预算、池卫生、互斥逻辑本身（只复用）。

## 验证标准

- `npm run typecheck && npm run build && npm test` 全绿，含 C 节四条新断言。
- Web 开关与状态栏改动附截图（临时端口起真服务验证 worker 自转），或给出精确复现步骤由验收人补做。

## 风险声明

- worker 默认开启后，配了模型的实例会在后台真实消耗模型额度——每日预算（20/天）是既有的总闸，本单不改。
- 网页不再触发运行后，「打开页面立刻见到进展」的即时感依赖 worker 间隔（默认 60 秒），可接受。
