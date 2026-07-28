# Spec: server.mjs 拆模块 S3——观察员管线、响应层与基建收口（2026-07-28，手术第三刀 3/3）

## 背景

S1（#142）拆供给侧、S2（#144）拆智能体与学习域后，server.mjs 剩 3803 行。本单是第三刀收官：拆出观察员管线、导入与物化、响应层、基建工具，server.mjs 收为「createApiServer 路由壳 + worker + 入口」（预计 ~1700 行）。总原则同 S1 spec「总原则」（纯搬移、@ts-check、禁循环依赖、smoke 零 diff、行为零改动）。

## A. 域模块（apps/api/src/domains/）

### `domains/curationRun.mjs`
executeCurationRun、createSafeSourceImportWorker、createNeutralExposureFeedback、createEmptyCurationPlan、settleTerminalImportSource。
- `settleTerminalImportSource` 是 S1 因 TS 字面量 widening 留置的：**本单例外允许**为其增加 JSDoc 类型注解（如 `@type`/`@satisfies` 或参数注解）以通过 @ts-check——只许加注释行，不许改任何代码行为；若注解仍解不掉，留在 server.mjs 并汇报。

### `domains/importPipeline.mjs`
importArticle、importYouTube、toSourceImportWorkerResult、persistImportAndReleasePlan、persistAutomaticConceptAliases、maybePersistConnectionNote、ensureMaterializationPlan、materializeCurationJobRecords、reconcileAndMaterializeCurationQueue、normalizeFollowupDedupeTitle、filterDuplicateFollowupCurationRecords、sanitizeFailedCurationRecord、filterDuplicateFollowupSourceImport、ingestSourceCandidate、ingestSourceCandidateForBackground。
- 注意 ensureMaterializationPlan/materializeCurationJobRecords/normalizeFollowupDedupeTitle/filterDuplicateFollowupCurationRecords 现在是 server.mjs 的 export（smoke 或测试可能直接 import）——搬走后 server.mjs **保留同名 re-export**（`export { … } from "./domains/importPipeline.mjs"`），先 `git grep` 确认外部引用后在汇报里写明哪些必须保留。

### `domains/responses.mjs`
getTimelineResponse、collectActiveLearningGoalBlockTopics、aggregateTodayDwellMsByBlockTopic、flattenTimelineArrangement、getDismissedPostsResponse、getNotificationsResponse、sanitizeNotificationRecordForResponse、parseDismissedPostMode、upsertDismissedPostRecord、enrichPostsMedia、getEvidenceLedgerResponse、findSourceRegistryForPost、sanitizeSnapshotForResponse、summarizeRecommendation、sanitizeSourceImportRecordForResponse、sanitizeSourceImportResultForResponse、sanitizePostForResponse、sanitizeCurationRecordForResponse、sanitizeSubscriptionRecordForResponse、getSettingsResponse、getWeeklyRecapResponse、markWeeklyRecapSeen。

### `domains/signals.mjs`
findCoalescedDailySignal、shouldEnqueueCoalescedProduction、updateTopicStateFromCoalescedDelta、getNewCoalescedActionFields、isProductionQualifiedSignal、updateTopicStateFromFeedback、getInterestedStrengthContribution、blendScores、clampScore，及常量 coalescedActionFields。

### `domains/config.mjs`
createConfiguredSourceImportWorker、readConfiguredContentLanguage、resolveContentLanguage、createConfiguredCommandModelClient、createConfiguredAskModelClient、createConfiguredDeepReadModelClients、firstNonBlankEnv、getDeepReadArticleTokenBudget、createConfiguredSearchProvider。

## B. 基建（apps/api/src/lib/）

### `lib/fileStorage.mjs`
createFileStorageAdapter、acquireWriterLock、writerLockError、createRollingBackup、writeAndSyncFile、fsyncDirectory。createFileStorageAdapter 是 export——server.mjs 保留 re-export（同 A 的规则，查引用后定）。

### `lib/http.mjs`
rejectOversizedContentLength、safelyDrainRequest、readJsonBody、sendJson、sendMediaFile、getMediaContentType、sendHtml、sendXml、getRequestOrigin、createBindingSecurity、isLoopbackHost、hasValidApiToken、resolveCorsOrigins，及 HttpError 若仍在 server/shared 之外。

### `lib/validate.mjs`
requireObjectBody、requireIsoDate、isValidIsoDateString、requireInteractionSignal、requireTopicState、requireSupportedSourceCandidates、parseReviewGrade、parseOptionalIdempotencyKey、parseOptionalUserId、parseOptionalDate。

### `lib/fixtures.mjs`
fixtureSubscriptionFeedXml、fixtureArticleHtml。

全部 lib/ 文件同样 `// @ts-check` 零错误。

## C. server.mjs 收口

- 留下：createApiServer（全部路由与 worker 状态机）、executeCurationRun 之外的 run 接线（runCurationWithGuard 等实例闭包）、normalizeWorkerIntervalMs、listen、主入口。
- 必要的 re-export（A/B 中标注的）集中放文件末尾并加一行注释说明「兼容外部 import」。

## 明确不做

- 不改任何路由行为、响应字段、错误文案。
- 不给 createApiServer 本体开 @ts-check（路由壳的类型化留给后续需要时单独立单）。
- 不动 smoke、web、mobile、core。
- 不重构、不改名、不合并函数。

## 验证标准

- `npm run typecheck` / `npm run build` / `npm test` 全绿。
- 被搬函数全仓唯一定义（re-export 不算重复定义）。
- 验收人 `git diff --color-moved=zebra` + 抽样逐字节比对。
- `wc -l apps/api/src/server.mjs` 预期 ~1700。
