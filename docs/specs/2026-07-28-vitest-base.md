# Spec: vitest 单测基座（2026-07-28，结构手术第二刀）

## 背景

项目至今没有单元测试框架，验证全靠 typecheck + 四个 smoke 脚本。bug 考古结论：战役里每单靠「测试锁」杀掉的回归证明纯逻辑 bug 全部单测可杀，但 smoke 是整机黑盒，跑一轮分钟级，无法给纯函数提供快速、细粒度的护栏。本单落地 vitest 基座 + 第一批高杠杆纯逻辑测试；此后每单新代码带单测成为惯例（写进 CLAUDE.md/CONTRIBUTING.md）。手术顺序出自 bug 考古报告（第一刀 #139 已合并）。

## 设计

### A. 基座接线

1. **依赖**：vitest 装在仓库根 `devDependencies`（工作区共享），用当前最新稳定版，`^` 区间。不装 coverage 相关包。
2. **配置**：根目录 `vitest.config.ts`，`test.include` 覆盖两类路径：
   - `packages/core/src/**/*.test.ts`（与源码同目录共置）
   - `apps/api/test/**/*.test.mjs`
   不开 globals——测试文件显式 `import { describe, it, expect } from "vitest"`，省掉 types 配置。
3. **core 构建隔离（本单最大的坑，必须照做）**：core 的 `tsconfig.json` 现在 `include: ["src"]` 且 build/typecheck 共用一份。测试文件混进 `src/` 后：
   - 新建 `packages/core/tsconfig.build.json`：`extends: "./tsconfig.json"`，加 `"exclude": ["src/**/*.test.ts"]`；
   - `build` 脚本改为 `tsc -p tsconfig.build.json`；
   - `typecheck` 脚本保持 `tsc -p tsconfig.json --noEmit`（连测试一起查类型）。
   - 验收断言：`npm run build -w @aitimeline/core` 后 `dist/` 里不得出现任何 `*.test.*` 文件。
4. **脚本**：根 `package.json` 加 `"test:unit": "vitest run"`；`"test"` 链在 core build 之后、smoke 之前插入 `node --experimental-vm-modules` 之类的花活一律不要，就是 `vitest run`。`pretypecheck`/`prebuild` 不动。
5. **CI**：`.github/workflows/ci.yml` 在 `npm run build` 之后、Pack-consumer smoke 之前加一步 `- run: npm run test:unit`。其余步骤零改动。
6. **确定性**：所有测试禁止读真实时钟（不许 `Date.now()`/无参 `new Date()`），时间一律显式 ISO 字符串传入；无网络、无文件系统写入（api 测试若需临时目录用 `node:os` tmpdir + 用后即删，但本单的 api 测试对象是纯函数，应当用不到）。

### B. 第一批测试（每条断言都要能杀死一个具体变异；用行为命名 test 名）

7. `packages/core/src/review/reviewState.test.ts`：
   - 间隔梯子 1→3→7→14→30→30（`createInitialReviewState` + 连续 `advanceReviewState`，断言 `intervalDays` 与 `dueAt` 精确日期）；
   - `getDueReviewStates`/`getRestingReviewStates` 的边界：恰好等于 dueAt 时算 due 还是 resting，以现实现为准锁行为。
8. `packages/core/src/ranking/lifecycle.test.ts`：
   - 软驳回 30 天到期回归（`isSoftDismissalExpired`/`filterTimelineLifecycle` 边界前后各一条）；
   - 硬驳回永不回归（`getHardDismissedPostIds`）;
   - `isPureExposureSignal`/`isReadSignal` 的信号形状判定（纯曝光 impression dwell 0 是既有约定，锁死）。
9. `packages/core/src/ranking/ranker.test.ts`：
   - `rankPersonalizedTimeline` 在受控信号下的排序：有 like/save 信号的概念相关卡排到无信号卡之前；
   - 同分卡的稳定顺序（同输入两次调用结果一致）。
10. `packages/core/src/agents/backgroundCuration.test.ts`：
    - `applyDailyAutoJobBudget`：额度内放行、超额拒绝、跨日重置（用 timeZone 参数明确时区边界）；
    - `settleDailyAutoJobBudget`：produced/gateRejected/importFailed/refunded 四种 outcome 的计数落位，refunded 会归还名额而 gateRejected 不会；
    - `isMeteredAutoJobKind` 的计量/非计量清单。
11. `packages/core/src/harness/groundingGate.test.ts`：
    - `validateGrounding` fail-closed 三例：引文不在源文本中、卡片引用缺失、概念极性与证据相反（用 `isConceptPolarityCompatibleWithText`）；
    - 一例合法出处通过。
12. `packages/core/src/harness/schema.test.ts`：
    - `validateKnowledgePost` 拒绝缺必填字段、字段类型错误各一例；合法卡通过一例。
13. `apps/api/test/classifyTerminalImportSource.test.mjs`（api 可测性种子，为第三刀拆模块探路）：
    - 从 `../src/server.mjs` 导入已 export 的 `classifyTerminalImportSource`，锁 #136 的结算语义：抓取失败→退名额+unreachable、门禁拒收→不退+rejected_source 或 skipped、同源回退→produced；照 server.mjs 里 `sourceCandidateFailureMessages` 的真实文案构造输入。
    - 注意：import server.mjs 需要 core 已 build（`npm run test:unit` 在 `npm test` 链里位于 build 之后，CI 同理；本地单独跑 `test:unit` 前先 build 一次即可，README 不用写）。

### C. 文档

14. 根 `CLAUDE.md`：把「There is no unit-test framework; verification is typecheck + the three smoke scripts. New core behavior must be covered by extending a smoke script.」改为新口径：纯逻辑用 vitest 单测（`npm run test:unit`），跨模块/持久化/HTTP 行为用 smoke；新行为两者取其适者，不许裸奔。Commands 一节补 `test:unit`。
15. `CONTRIBUTING.md` 同步：第 3 条与「runtime smoke coverage」处补单测口径；CI 描述改为「typecheck, build, unit tests and all smokes」。

## 明确不做

- 不配 coverage 阈值、报告器、watch 别名。
- 不写 web/组件测试（jsdom 环境留给 App.tsx 拆分那一刀）。
- 不动 apps/mobile。
- 不把既有 smoke 断言改写成单测——smoke 一行不改（四个脚本零 diff）。
- 不测 `/api/*` 路由整机行为（smoke 已覆盖），api 只测已 export 的纯函数。
- 不重构被测代码：测试锁现状。若测出真 bug，不改代码，在汇报里单列「疑似真 bug」由验收人裁决。

## 验证标准

- `npm run typecheck`、`npm run build`、`npm test` 全绿（test 链里 vitest 全过）。
- `npm run test:unit` 单独可跑（core 已 build 前提下）。
- `ls packages/core/dist` 递归无 `*.test.*`。
- 七个测试文件全部存在，总断言数不设指标，但每个 test 名描述行为而非函数名。

## 风险声明

- server.mjs 被单测 import 后，其模块级副作用（当前没有）将来若有人加会炸单测——这是想要的约束，不是风险。
- vitest 与 Node 20 的 ESM/TS 解析对 core 的 `.ts` 源直跑没有障碍；api 的 `.mjs` 原生 ESM 亦然。
