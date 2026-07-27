# Spec: 供给预算账单与候选池卫生（2026-07-27）

## 背景与证据

2026-07-27 实测（真实用户库）：当日自动预算 20/20 用尽，产出 0 张新卡。去向：11 个 import_source「成功」但实为「来源质量门禁拒收，未生成卡」，7 个「来源抓取/导入失败」，2 个跟进生成。同时候选池积压 110 条 `queued` 状态候选——它们的任务早已终局，但没人把结果写回候选状态，成为僵尸；`pending` 池里还有约 130 条历史低质候选等着明天继续烧预算。

三个缺陷叠加成「预算空转」循环：
1. **预算按尝试记账**：拒收、抓取失败照样烧名额，且不可见（UI 只显示「今日已用 20/20」）。
2. **任务终局不写回候选状态**：失败/拒收的候选留在 `queued`，既不重试也不清退。
3. **回填选择无历史教训**：`scoreCandidateRecord` 不认识「这个域名已经被拒收过 N 次」，同类垃圾反复入选。

## 目标

- 预算去向可见：今天 20 个名额各自变成了什么，一眼看清。
- 廉价失败（没花模型钱的抓取失败）退还名额，当天可以再试别的候选。
- 候选池自动保洁：终局写回、僵尸修复、陈旧过期、劣迹域名降权/排除。
- 全部确定性实现（不新增模型调用），smoke 离线可测。

## 设计

### A. 预算账单（ledger）

1. `DailyAutoJobBudgetRecord`（core）增加可选计数字段：`produced`、`gateRejected`、`importFailed`、`refunded`（均为非负整数，缺省 0；persistenceStore 的 decoder 按可选字段处理，兼容旧快照）。
2. core 增加纯函数 `settleDailyAutoJobBudget(budget, outcome)`：outcome ∈ `produced | gate_rejected | import_failed_refundable | import_failed`；`import_failed_refundable` 会把 `used` 减 1（下界 0）并 `refunded` 加 1，其余只累加对应计数。
3. server 在 import_source 类自动任务终局处理处（materialize 路径）分类结算：
   - 产出卡数 > 0 → `produced`；
   - 门禁拒收 → `gate_rejected`（不退还：已花模型钱，且退还会让垃圾池一天内冲垮门禁）；
   - 抓取失败（现有「Source could not be fetched.」这一类，未进模型）→ `import_failed_refundable`（退还名额）；
   - 其余失败 → `import_failed`。
   分类依据优先用结果里的结构化字段；若现状只有 message 字符串，把这些 message 收敛成单处导出的常量再比对，禁止散落的魔法字符串。
4. `supplyStatus`（/api/timeline）增加 `todayLedger: { limit, used, produced, gateRejected, importFailed, refunded }`。

### B. 候选池卫生

5. **终局写回**（单一函数，所有 lane 共用）：import_source 任务终局时更新对应候选状态——出卡 → `imported`；门禁拒收 → `rejected_source`；抓取失败 → `unreachable`；其余失败 → `skipped` 并追加 rejectionReasons。现状部分 lane 已有零散写回的，收敛到这一个函数。
6. **僵尸修复**：`queueSupplyRefill` 开头做一次修复——状态为 `queued` 但队列里已无该候选的活跃任务（queued/running）的记录：能找到终局任务的按第 5 条映射写回；找不到的退回 `pending`。这会自动消化现存 110 条僵尸。
7. **陈旧过期**：`pending` 且 `createdAt` 距今超过 14 天的候选 → `skipped`，rejectionReasons 加 `"stale_candidate"`。在回填选择前执行。
8. **劣迹域名**：`scoreCandidateRecord` 增加域名先验——同 hostname 的候选中 `rejected_source`+`unreachable` 历史 ≥3 次则重罚分，≥5 次则直接不进回填选择（留在 pending 等过期）。hostname 解析失败的不罚。
9. 现存积压不需要一次性脚本：第 6/7 条在下一次回填运行时自然完成清理。

### C. UI（最小改动，扁平 X 风格，不新增组件框架）

10. 「自动生产」按钮的展开区（或既有浮层）与智能体页观察员区各加一行账单：`今日 已用 X/Y · 出卡 A · 拒收 B · 失败 C（退还 D）`。中英文案都要（跟随现有 i18n 方式）。

## 明确不做

- 不改质量门禁的判定逻辑与阈值。
- 不改预算上限语义与 `AITIMELINE_DAILY_AUTO_JOB_BUDGET` env。
- 不做候选池管理界面（列表/手动清退）。
- 不动 apps/mobile、订阅轮询节奏、backlog digest 的 pace。
- 不删除任何候选记录，只改状态。
- 不新增模型调用。

## 验收标准

- `npm run typecheck && npm run build && npm test` 全绿。
- smoke-api 新增断言（离线，用注入 fetch 与临时预算 env）：
  a) 门禁拒收 → ledger.gateRejected 计数、候选转 `rejected_source`、不退还；
  b) 抓取失败 → ledger.importFailed/refunded 计数、候选转 `unreachable`、退还后同日回填还能再排一个候选；
  c) 超过 14 天的 pending 候选被标 `skipped` + `stale_candidate`；
  d) 有 ≥5 次劣迹的域名候选不进回填选择;
  e) /api/timeline 的 supplyStatus.todayLedger 数字对得上。
- UI 改动截图放 `docs/e2e/runs/2026-07-27-supply-ledger/`（若执行环境无法截图，留复现步骤由验收人补做）。
