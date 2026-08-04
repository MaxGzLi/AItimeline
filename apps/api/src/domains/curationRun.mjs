// @ts-check

import { runDueBackgroundCurationJobs } from "../../../../packages/core/dist/index.js";
import { handleConceptBriefJob, handleDeepReadArticleJob } from "./briefsDeepRead.mjs";
import { queueDueAgentCaptures } from "./capture.mjs";
import { resolveContentLanguage } from "./config.mjs";
import {
  filterDuplicateFollowupCurationRecords,
  ingestSourceCandidateForBackground,
  materializeCurationJobRecords
} from "./importPipeline.mjs";
import {
  omitSnapshotFromProductionResult,
  queueDailyLearningGoalProductionGuarantee
} from "./learningGoals.mjs";
import {
  discoverSourcesForJob,
  handleResearchIdeaJob,
  handleResearchQuestionJob,
  runResearchWithStagedPersistence
} from "./research.mjs";
import { sanitizeCurationRecordForResponse } from "./responses.mjs";
import {
  buildSourceQualityUserContext,
  getDailyAutoJobBudgetRecord,
  normalizeIsoDate,
  summarizeSnapshot
} from "./shared.mjs";
import { digestDueSubscriptionBacklogs, pollDueSubscriptions } from "./subscriptions.mjs";
import { getSupplyStatus, maybeCreateSupplyDroughtNotification, queueSupplyRefill } from "./supply.mjs";

export async function executeCurationRun(
  {
    persistenceStore,
    curationStore,
    feedFetch,
    sourceImportWorker,
    ingestSource,
    searchProvider,
    askModelClient,
    deepReadModelClients,
    workerId,
    env
  },
  options = {}
) {
  const contentLanguage = resolveContentLanguage(persistenceStore, env);
  const runNow = options.now ?? new Date().toISOString();
  const runKinds = Array.isArray(options.kinds) ? options.kinds : undefined;
  const deepReadOnlyRun =
    Array.isArray(runKinds) && runKinds.length > 0 && runKinds.every((kind) => kind === "deep_read_article");
  const goalProductionGuarantee = deepReadOnlyRun
    ? {
        snapshot: persistenceStore.getSnapshot(),
        queued: false,
        records: [],
        budget: getDailyAutoJobBudgetRecord(persistenceStore.getSnapshot(), runNow),
        discardedJobIds: [],
        skippedConcepts: []
      }
    : queueDailyLearningGoalProductionGuarantee({
        persistenceStore,
        curationStore,
        userId: typeof options.userId === "string" && options.userId.trim() ? options.userId : "local-user",
        contentLanguage,
        now: runNow
      });
  const subscriptionPolling = deepReadOnlyRun
    ? { checked: 0, skipped: 0, queued: 0, pending: 0, errors: [] }
    : await pollDueSubscriptions({
        persistenceStore,
        curationStore,
        fetchImpl: feedFetch,
        contentLanguage,
        now: runNow
      });
  const shouldRefillForDrought = !runKinds || runKinds.includes("import_source");
  const backlogDigest =
    deepReadOnlyRun || !shouldRefillForDrought
      ? { queued: 0, skipped: 0 }
      : digestDueSubscriptionBacklogs({
          persistenceStore,
          curationStore,
          contentLanguage,
          now: runNow
        });
  const agentCaptureQueue =
    deepReadOnlyRun || !shouldRefillForDrought
      ? { queued: 0 }
      : queueDueAgentCaptures({
          persistenceStore,
          curationStore,
          contentLanguage,
          now: runNow
        });
  const supplyStatus = getSupplyStatus(persistenceStore.getSnapshot(), curationStore, runNow);
  const droughtNotification = maybeCreateSupplyDroughtNotification({
    persistenceStore,
    status: supplyStatus,
    contentLanguage,
    now: runNow
  });
  let supplyRefill = { queued: 0, skipped: 0, budgetRemaining: supplyStatus.budgetRemaining };

  if (shouldRefillForDrought && supplyStatus.drought) {
    supplyRefill = queueSupplyRefill({
      persistenceStore,
      curationStore,
      contentLanguage,
      now: runNow
    });
  }
  const batch = await runDueBackgroundCurationJobs(
    curationStore,
    {
      contentLanguage,
      sourceImportWorker,
      ingestSourceCandidate: (candidate) => ingestSourceCandidateForBackground(candidate, ingestSource),
      discoverSources: (job) => discoverSourcesForJob(job, searchProvider, persistenceStore, contentLanguage),
      loadSeedPost: (job) => persistenceStore.getSnapshot().posts.find((post) => post.id === job.postId),
      loadSourceQualityVerdicts: () => persistenceStore.getSnapshot().sourceQualityVerdicts,
      loadSourceQualityUserContext: () => buildSourceQualityUserContext(persistenceStore.getSnapshot()),
      researchQuestion: (job, context) =>
        runResearchWithStagedPersistence(
          persistenceStore.getSnapshot(),
          context.effectAt,
          (stagedStore) => handleResearchQuestionJob(
            job,
            stagedStore,
            sourceImportWorker,
            searchProvider,
            askModelClient,
            contentLanguage,
            context.effectAt,
            ingestSource
          )
        ),
      researchIdea: (job, context) =>
        runResearchWithStagedPersistence(
          persistenceStore.getSnapshot(),
          context.effectAt,
          (stagedStore) => handleResearchIdeaJob(
            job,
            stagedStore,
            sourceImportWorker,
            searchProvider,
            contentLanguage,
            context.effectAt,
            ingestSource
          )
        ),
      conceptBrief: (job) =>
        handleConceptBriefJob(
          job,
          persistenceStore,
          askModelClient,
          contentLanguage,
          runNow
        ),
      deepReadArticle: (job) =>
        handleDeepReadArticleJob(
          job,
          persistenceStore,
          deepReadModelClients,
          contentLanguage,
          runNow
        ),
      cooldownTopic: (job) => ({
        kind: job.kind,
        message: "Topic cooldown recorded by API worker."
      })
    },
    {
      now: runNow,
      limit: options.limit,
      kinds: options.kinds,
      workerId
    }
  );
  const filteredRecords = filterDuplicateFollowupCurationRecords(
    batch.records,
    persistenceStore.getSnapshot().posts
  );

  filteredRecords.forEach((record, index) => {
    if (record.result !== batch.records[index]?.result && record.result) {
      curationStore.updateTerminalResult(record.id, record.result);
    }
  });

  // 清扫此前轮次已结算的终结记录(见 compactMaterializedResults 注释);放在
  // materialize 之前,镜像同步会把压缩后的队列一并带进主快照。
  curationStore.compactMaterializedResults(runNow);

  const materializedRecords = materializeCurationJobRecords(
    persistenceStore,
    curationStore,
    filteredRecords,
    { appliedAt: batch.completedAt, contentLanguage }
  );
  const records = materializedRecords.map((record) => sanitizeCurationRecordForResponse(record));
  const filteredBatch = { ...batch, records };
  const snapshot = persistenceStore.getSnapshot();

  return {
    ...filteredBatch,
    alreadyRunning: false,
    subscriptionPolling,
    backlogDigest,
    agentCaptureQueue,
    supplyRefill,
    goalProductionGuarantee: omitSnapshotFromProductionResult(goalProductionGuarantee),
    droughtNotification,
    snapshotSummary: summarizeSnapshot(snapshot)
  };
}

export function createSafeSourceImportWorker(worker) {
  return {
    ...worker,
    runner: worker.runner,
    async run(input) {
      let result;

      try {
        result = await worker.run(input);
      } catch (error) {
        console.error("[aitimeline] source import worker threw before returning a result.", error);
        throw new Error("Source import failed.");
      }

      const rawError = result?.errorMessage ?? result?.importRecord?.errorMessage;
      const failed =
        result?.importRecord?.status === "failed" ||
        result?.qualityGate?.verdict === "reject";

      if (!failed && !rawError) {
        return result;
      }

      if (rawError) {
        console.error("[aitimeline] source import worker returned a failed result.", rawError);
      }

      return {
        ...result,
        errorMessage: "Source import failed.",
        ...(result?.importRecord
          ? {
              importRecord: {
                ...result.importRecord,
                ...(result.importRecord.status === "failed" || result.importRecord.errorMessage
                  ? { errorMessage: "Source import failed." }
                  : {})
              }
            }
          : {})
      };
    }
  };
}

export function createNeutralExposureFeedback(signal) {
  return {
    postId: signal.postId,
    topicId: signal.topicId,
    conceptIds: signal.conceptIds,
    signalStrength: 0,
    inferredState: "not_relevant",
    nextAction: "ask_clarifying_question",
    reason: "Pure impression only; topic state is unchanged."
  };
}

export function createEmptyCurationPlan(generatedAt) {
  const normalizedGeneratedAt = normalizeIsoDate(generatedAt);

  return {
    generatedAt: normalizedGeneratedAt,
    jobs: [],
    suppressions: [],
    acceptedSourceCandidateIds: [],
    cooledTopicIds: [],
    expansionPlan: {
      generatedAt: normalizedGeneratedAt,
      jobs: [],
      suppressions: [],
      cooledTopicIds: []
    }
  };
}
