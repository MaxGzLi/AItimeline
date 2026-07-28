# Spec: server.mjs 拆模块 S2——智能体与学习域（2026-07-28，手术第三刀 2/3）

## 背景

S1 已拆出供给侧四域（subscriptions/supply/importSettlement/capture）并落地 api 类型检查基座（`apps/api/tsconfig.json` + 每文件 `// @ts-check` 渐进开启）。本单拆智能体与学习五个域。总原则与 S1 完全一致（纯搬移、domains/ 目录、@ts-check 零错误、禁循环依赖、smoke 零 diff、行为零改动），此处不再重复，以 `docs/specs/2026-07-28-server-split-s1.md` 的「总原则」为准。

## A. 本单拆出的五个域

（函数名清单按 S1 拆完后的 server.mjs 为准；下列名单来自拆前盘点，若 S1 已顺路搬走个别函数，跳过即可）

### `domains/research.mjs`
handleAgentAsk、handleAgentConfirm、handleIdeaResearchRequest、runResearchWithStagedPersistence、handleResearchQuestionJob、handleResearchIdeaJob、createResearchQuestionJob、createResearchIdeaJob、createSingleJobPlan、normalizeChoiceMap、buildResearchQueries、buildIdeaResearchQueries、getResearchImportLimit、getSelectedConfirmationOptions、deriveResearchConcepts、rankResearchCandidates、withCandidateOrigin、resolveMergedImportPosts、researchRecommendedBecause、selectResearchAnswerPost、researchIdeaSide、ideaResearchRecommendedBecause、formatIdeaResearchNotificationBody、buildPostCitations、createResearchNotification、updateAgentTurn、getPreviousTurns、annotateAnswerWithSourceOrigins、formatOriginNote、researchCopy、tokenizeText、executeDiscoveryAction、handleDiscoveryRun、discoverSourcesForJob、getConfirmedDiscoveryConcepts、collectConfirmedDiscoveryConcepts、persistDiscoveredCandidates、toTrimmedStrings、cloneAnswerCitations

### `domains/notes.mjs`
handleUserNote、handleUserIdeaNote、handlePostReply

### `domains/review.mjs`
maybeCreateInitialReviewState、backfillLegacyReviewStates、createLegacyReviewBackfillStates、selectReviewPrompt、createReviewStateForGrade、addDaysIso、buildReviewEventRecordId、buildReviewCompletionRecordId、promoteMasteryAfterReview、createReviewedInteractionSignal、createMasteryPromotionNotification、createManualMasteryDemotionEvents、collectAutoMasteryPromotionKeys、collectMasteryPromotionBlacklist、buildAutoMasteryPromotionReason

### `domains/learningGoals.mjs`
handleListLearningGoals、handleCreateLearningGoal、handleArchiveLearningGoal、decorateLearningGoalRecord、buildLearningGoalTree、markAchievedLearningGoals、createLearningGoalAchievedNotification、queueGapConceptBriefsForSkillTrees、queueDailyLearningGoalProductionGuarantee、hasGoalProductionForDate、selectGoalGapConceptBriefDemand、selectGoalFollowupDemand、selectFollowupNextAction、isLearningGoalProductionJob、jobOverlapsTree、createTreeConceptKeySet、omitSnapshotFromProductionResult、collectActiveLearningGoalConcepts

### `domains/briefsDeepRead.mjs`
handleAsk、handleConceptBriefRequest、handleDeepReadRequest、handleDeepReadArticleJob、createDeepReadArticleJob、findDeepReadForDay、normalizeDeepReadTopic、handleConceptBriefJob、buildConceptBriefInput、createConceptBriefJob、findConceptBrief、countConceptReviews

跨域共享的小工具（如 getSnapshotUserMemory、getPostTopicId、uniqueStrings、parseOptionalDate 一类被多个域引用的）：放 `domains/shared.mjs`（S1 已建，同样 @ts-check），或留在 server.mjs 导出——选占用面小的方案，汇报里说明。

### S1 留置函数收尾

- `pollDueSubscriptions`（S1 留在 server，因依赖 collectConfirmedDiscoveryConcepts → collectActiveLearningGoalConcepts → buildLearningGoalTree 链）：本单拆完 research 与 learningGoals 后依赖链已断，将其搬回 `domains/subscriptions.mjs`。
- `settleTerminalImportSource`（TS 字面量 widening 问题）：继续留在 server.mjs，S3 处理，本单不动。

## 明确不做

- 不拆 curationRun/materialization/import 管线/响应 sanitizer/timeline 响应（留给 S3）。
- 其余同 S1「明确不做」。

## 验证标准

同 S1：typecheck（含 api）/build/test 全绿；被搬函数全仓唯一定义；`wc -l` 对比；验收人 `git diff --color-moved=zebra` 核对纯搬移。
