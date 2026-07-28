# Spec: server.mjs 拆模块 S1——供给侧域 + api 类型检查基座（2026-07-28，手术第三刀 1/3）

## 背景

server.mjs 8300 行无类型 JS，bug 考古归因 23% 的问题源（校验缺失、状态机无终局、签名靠人工核）。第三刀分三单按域拆出模块并逐文件开 `@ts-check`。本单是第一单：供给侧四个域 + 类型检查基座。路由与对外行为零改动。

## 总原则（三单通用，逐条硬性）

1. **纯搬移**：函数原样移动——不改名、不改签名、不改函数体、不调整逻辑。只允许两类编辑：加/改 import、需要跨模块使用时加 `export`。
2. 新模块放 `apps/api/src/domains/` 下；模块内只 export 被 server.mjs 或其他模块真实引用的函数，其余保持模块私有。
3. **禁止循环依赖**：域函数若与未拆域纠缠，可留待后续单（在汇报里说明），不许为凑数硬拆。`node --experimental-import-meta-resolve` 不用；用 `npm test` 全量跑通作为拆完的机器证明。
4. 每个新模块文件头部加 `// @ts-check`。类型基座（见 C 节）保证 CI 能抓到新模块内的真实签名错误。server.mjs 本体暂不开 @ts-check（错误太多，最后一单再收）。
5. smoke 四个脚本零 diff；`apps/web`、`apps/mobile`、`packages/core` 零 diff。

## A. 本单拆出的四个域

按前述纯搬移原则，把下列函数（含各自函数体内引用的模块级常量）从 server.mjs 移入对应新模块。清单按现 server.mjs 行号顺序给出函数名；同域内漏列的紧邻私有小助手（仅被该域调用的）应一并搬走并在汇报中列明。

### `domains/subscriptions.mjs`（约 1816-2400 行段）
handleCreateSubscription、handleUpdateSubscription、fetchAndParseSubscriptionFeed、getSubscriptionChannelId、buildYouTubeWatchUrl、fetchUploadsFallbackFeed、createBacklogSourceCandidate、catalogSubscriptionBacklog、getSubscriptionBacklogResponse、compareBacklogRecords、countBacklogImportJobsForDay、createBacklogImportJob、digestSubscriptionBacklog、digestDueSubscriptionBacklogs、pollDueSubscriptions、normalizeSubscriptionTitle、normalizeSubscriptionFilterModeForApi、selectDueSubscriptions、selectNewSubscriptionEntries、maxIsoDate、scoreSubscriptionEntryRelevance、createSubscriptionSourceCandidate、createSubscriptionImportJob、normalizeUrlKey

### `domains/supply.mjs`（约 2402-2930 + 6858-7030 行段）
getSupplyStatus、getTodayAutoJobLedger、getBudgetRemaining、queueSupplyRefill、getActiveImportSourceCandidateIds、repairZombieQueuedCandidates、collectTerminalImportJobsByCandidateId、getTerminalSourceImport、expireStaleSourceCandidates、countCandidateHostFailures、getCandidateHostname、getCandidateHostFailures、isExcludedCandidateHost、createSupplyRefillImportJob、maybeCreateSupplyDroughtNotification、getSupplyDroughtStartAt、formatSupplyDroughtNotificationBody、createSourceCandidateRecord、normalizeSourceCandidate、findMatchingSourceCandidateRecords、dedupeSourceCandidates、scoreCandidateRecord

### `domains/importSettlement.mjs`（约 4684-4845 行段）
classifyTerminalImportSource、applySourceCandidateOutcome、mergeCandidateRejectionReasons、settleTerminalImportSource、isTranscriptUnavailableMessage、isNetworkFailureMessage、collectKnownSourceUrls、collectKnownSourceTitles、dedupePostsById、getKnowledgePosts，以及常量 `sourceCandidateFailureMessages`。
- `apps/api/test/classifyTerminalImportSource.test.mjs` 的 import 路径改指 `../src/domains/importSettlement.mjs`（唯一允许的测试改动）。server.mjs 不保留 re-export。

### `domains/capture.mjs`（约 6594-6858 行段）
createAgentCaptureCandidateRecord、createAgentCaptureImportJob、queueAgentCaptureCandidates、queueDueAgentCaptures、handleCaptureSource、handleCaptureConversation、sanitizeCapturePostForResponse、getCaptureContextResponse

跨域引用处理：supply 依赖 importSettlement（如 getTerminalSourceImport 消费终局记录）、capture 依赖 supply 的候选构造时——正常 import，方向必须无环（预期方向：subscriptions/supply/capture → importSettlement；若实际相反，停下上报）。

## B. server.mjs 侧

- 顶部集中 import 四个新模块所需符号；被搬走的函数在 server.mjs 内的调用点一律不改（同名符号经 import 进入作用域）。
- 预期 server.mjs 减少约 1500-1800 行。

## C. api 类型检查基座

- 新增 `apps/api/tsconfig.json`：`allowJs: true`、`checkJs: false`（靠每文件 `// @ts-check` pragma 渐进开启）、`noEmit: true`、`strict: false`、`module/target: esnext`、`moduleResolution: bundler` 或 `nodenext`（以能解析 `packages/core/dist` 的 `.d.ts` 为准）、include `src/**/*.mjs`。
- `apps/api/package.json` 加 `"typecheck": "tsc -p tsconfig.json"`——根 `npm run typecheck --workspaces --if-present` 自动带上。
- 要求：四个新模块在 @ts-check 下零错误。JSDoc 注解不强制补全参数类型（strict:false 下隐式 any 合法），但 tsc 报出的真实错误（属性不存在、参数个数不符等）必须修 import/搬移方式而不是压制；`@ts-ignore` 禁用。

## 明确不做

- 不拆本单清单之外的域（research/notes/goals/review/briefs/curationRun/responses 留给 S2/S3）。
- 不改路由、不改响应字段、不改任何行为。
- 不给旧代码补类型注解（@ts-check 只覆盖新模块文件）。
- 不动 smoke、web、mobile、core。

## 验证标准

- `npm run typecheck` / `npm run build` / `npm test` 全绿（typecheck 现在含 api 工作区）。
- `wc -l apps/api/src/server.mjs` 明显下降；`git grep -n "function queueSupplyRefill" apps/api/src` 等抽查：每个被搬函数全仓只有一处定义。
- 验收人将用 `git diff --color-moved=zebra` 核对纯搬移。
