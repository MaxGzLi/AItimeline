// @ts-check

import {
  applyDailyAutoJobBudget,
  getDayKey,
  getDueReviewStates,
  getHardDismissedPostIds,
  normalizeConceptKey
} from "../../../../packages/core/dist/index.js";
import {
  HttpError,
  buildSourceId,
  createSingleJobPlan,
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  hashText,
  inferSourceType,
  isSourceCandidateIntakeKind,
  isSupportedSourceCandidateType,
  normalizeIsoDate,
  normalizeScore,
  normalizeStringArray,
  parseHttpUrl,
  requireString
} from "./shared.mjs";
import {
  applySourceCandidateOutcome,
  classifyTerminalImportSource,
  getKnowledgePosts,
  mergeCandidateRejectionReasons,
  sourceCandidateFailureMessages
} from "./importSettlement.mjs";

const supplyDroughtNewCardThreshold = 3;
const supplyDroughtWindowHours = 48;
const supplyRefillLimit = 5;
// Pending candidates that nobody picked up in two weeks are noise; they are
// retired (never deleted) so the refill ranking stops re-reading them.
const staleSourceCandidateDays = 14;
// Per-hostname failure history that a refill candidate inherits: heavy score
// penalty first, hard exclusion once the host has proven itself repeatedly bad.
const candidateHostFailurePenaltyThreshold = 3;
const candidateHostFailureExclusionThreshold = 5;
const candidateHostFailurePenalty = 0.5;

export function getSupplyStatus(snapshot, curationStore, nowValue) {
  const now = nowValue ? new Date(nowValue) : new Date();
  const windowStartMs = now.getTime() - supplyDroughtWindowHours * 60 * 60 * 1000;
  const newCards48h = getKnowledgePosts(snapshot.posts).filter((post) => {
    const createdAt = new Date(post.createdAt).getTime();

    return Number.isFinite(createdAt) && createdAt >= windowStartMs && createdAt <= now.getTime();
  }).length;
  const hardDismissedPostIds = getHardDismissedPostIds(snapshot.dismissedPosts);
  // Same cutoff as GET /api/review/due so the drought card count matches the review page.
  const reviewDueCount = getDueReviewStates(snapshot.reviewStates, now.toISOString()).filter(
    (state) => !hardDismissedPostIds.has(state.postId)
  ).length;

  return {
    newCards48h,
    pendingCandidates: snapshot.sourceCandidates.filter((record) => record.status === "pending").length,
    queuedCandidates: snapshot.sourceCandidates.filter((record) => record.status === "queued").length,
    activeSubscriptions: snapshot.subscriptions.length,
    queuedImports: curationStore.list("queued").filter((record) => record.job.kind === "import_source").length,
    budgetRemaining: getBudgetRemaining(snapshot, now),
    todayLedger: getTodayAutoJobLedger(snapshot, now),
    reviewDueCount,
    drought: newCards48h < supplyDroughtNewCardThreshold
  };
}

function getTodayAutoJobLedger(snapshot, nowValue) {
  const budget = getDailyAutoJobBudgetRecord(snapshot, nowValue);

  return {
    limit: getDailyAutoJobBudgetLimit(process.env),
    used: budget?.used ?? 0,
    produced: budget?.produced ?? 0,
    gateRejected: budget?.gateRejected ?? 0,
    importFailed: budget?.importFailed ?? 0,
    refunded: budget?.refunded ?? 0
  };
}

export function getBudgetRemaining(snapshot, nowValue) {
  const limit = getDailyAutoJobBudgetLimit(process.env);
  const budget = getDailyAutoJobBudgetRecord(snapshot, nowValue);
  const used = budget?.used ?? 0;

  return Math.max(0, limit - used);
}

export function queueSupplyRefill({ persistenceStore, curationStore, contentLanguage, now }) {
  const nowIso = normalizeIsoDate(now);
  // Refill is the only regular sweep over the whole candidate pool, so it also
  // does the housekeeping: unstick zombies, retire stale entries, then select.
  repairZombieQueuedCandidates(persistenceStore, curationStore, nowIso);
  expireStaleSourceCandidates(persistenceStore, nowIso);
  const snapshot = persistenceStore.getSnapshot();
  const activeCandidateIds = getActiveImportSourceCandidateIds(curationStore);
  const hostFailureCounts = countCandidateHostFailures(snapshot.sourceCandidates);
  const selectedRecords = snapshot.sourceCandidates
    .filter((record) => record.status === "pending")
    // Backlog-cataloged candidates drain through their own paced digest lane
    // (backlogDailyLimit); letting drought refill grab them would bypass it.
    .filter((record) => typeof record.backlogOrder !== "number")
    .filter((record) => !activeCandidateIds.has(record.candidate.id))
    .filter((record) => !isExcludedCandidateHost(record, hostFailureCounts))
    .sort(
      (left, right) =>
        scoreCandidateRecord(right, hostFailureCounts) - scoreCandidateRecord(left, hostFailureCounts)
    )
    .slice(0, supplyRefillLimit);

  if (!selectedRecords.length) {
    return {
      queued: 0,
      skipped: 0,
      budgetRemaining: getBudgetRemaining(snapshot, nowIso)
    };
  }

  const rawPlan = createSingleJobPlan(
    selectedRecords.map((record) => createSupplyRefillImportJob(record.candidate, nowIso, contentLanguage)),
    nowIso
  );
  const budgetResult = applyDailyAutoJobBudget({
    plan: rawPlan,
    budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
    limit: getDailyAutoJobBudgetLimit(process.env),
    now: nowIso
  });
  const acceptedIds = new Set(budgetResult.plan.acceptedSourceCandidateIds);
  const records = curationStore.enqueuePlan(budgetResult.plan, nowIso);
  let nextSnapshot = persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], nowIso);

  if (records.length) {
    nextSnapshot = persistenceStore.saveCurationJobRecords(records, nowIso);
  }

  const queuedCandidateRecords = selectedRecords
    .filter((record) => acceptedIds.has(record.candidate.id))
    .map((record) => ({
      ...record,
      status: "queued",
      updatedAt: nowIso,
      lastQueuedAt: nowIso
    }));

  if (queuedCandidateRecords.length) {
    nextSnapshot = persistenceStore.saveSourceCandidateRecords(queuedCandidateRecords, nowIso);
  }

  return {
    queued: queuedCandidateRecords.length,
    skipped: Math.max(0, selectedRecords.length - queuedCandidateRecords.length),
    budgetRemaining: getBudgetRemaining(nextSnapshot, nowIso)
  };
}

export function getActiveImportSourceCandidateIds(curationStore) {
  return new Set(
    curationStore
      .list()
      .filter((record) => record.status === "queued" || record.status === "running")
      .filter((record) => record.job.kind === "import_source")
      .flatMap((record) => record.job.sourceCandidate?.id ?? [])
  );
}

// A candidate left in `queued` with no live job can never be re-selected. Map it
// back from its terminal job when one exists, otherwise return it to `pending`.
function repairZombieQueuedCandidates(persistenceStore, curationStore, now) {
  const snapshot = persistenceStore.getSnapshot();
  const activeCandidateIds = getActiveImportSourceCandidateIds(curationStore);
  const zombies = snapshot.sourceCandidates.filter(
    (record) => record.status === "queued" && !activeCandidateIds.has(record.candidate.id)
  );

  if (!zombies.length) {
    return snapshot;
  }

  const terminalJobsByCandidateId = collectTerminalImportJobsByCandidateId(curationStore);
  const repaired = zombies.map((record) => {
    const terminalJob = terminalJobsByCandidateId.get(record.candidate.id);

    if (!terminalJob) {
      return { ...record, status: "pending", updatedAt: now };
    }

    return applySourceCandidateOutcome(
      record,
      classifyTerminalImportSource({
        record: terminalJob,
        sourceImport: getTerminalSourceImport(terminalJob),
        candidateRecord: record
      }),
      now
    );
  });

  return persistenceStore.saveSourceCandidateRecords(repaired, now);
}

function collectTerminalImportJobsByCandidateId(curationStore) {
  const byCandidateId = new Map();

  for (const jobRecord of curationStore.list()) {
    const candidateId = jobRecord.job.sourceCandidate?.id;

    if (
      jobRecord.job.kind !== "import_source" ||
      !candidateId ||
      !["succeeded", "failed", "skipped"].includes(jobRecord.status)
    ) {
      continue;
    }

    const previous = byCandidateId.get(candidateId);
    const at = jobRecord.completedAt ?? jobRecord.updatedAt ?? "";

    if (!previous || at >= (previous.completedAt ?? previous.updatedAt ?? "")) {
      byCandidateId.set(candidateId, jobRecord);
    }
  }

  return byCandidateId;
}

function getTerminalSourceImport(jobRecord) {
  return (
    jobRecord.result?.materializationPlan?.sourceImports?.[0] ??
    jobRecord.result?.sourceImports?.[0] ??
    jobRecord.result?.sourceImport
  );
}

// Pending candidates nobody selected in two weeks keep re-entering the ranking
// forever. Retire them so the pool stops growing without bound.
function expireStaleSourceCandidates(persistenceStore, now) {
  const cutoffMs = new Date(now).getTime() - staleSourceCandidateDays * 24 * 60 * 60 * 1000;
  const snapshot = persistenceStore.getSnapshot();
  const stale = snapshot.sourceCandidates
    .filter((record) => record.status === "pending")
    // Backlog entries drain through their own paced lane and are allowed to sit.
    .filter((record) => typeof record.backlogOrder !== "number")
    .filter((record) => {
      const createdAtMs = new Date(record.createdAt).getTime();

      return Number.isFinite(createdAtMs) && createdAtMs < cutoffMs;
    })
    .map((record) => ({
      ...record,
      status: "skipped",
      updatedAt: now,
      rejectionReasons: mergeCandidateRejectionReasons(record.rejectionReasons, [
        sourceCandidateFailureMessages.stale
      ])
    }));

  return stale.length ? persistenceStore.saveSourceCandidateRecords(stale, now) : snapshot;
}

// Domain prior: hosts that keep failing the gate or the fetch stop earning
// refill slots. Records are never deleted, so the history keeps accumulating.
function countCandidateHostFailures(records) {
  const counts = new Map();

  for (const record of records) {
    if (record.status !== "rejected_source" && record.status !== "unreachable") {
      continue;
    }

    const hostname = getCandidateHostname(record);

    if (hostname) {
      counts.set(hostname, (counts.get(hostname) ?? 0) + 1);
    }
  }

  return counts;
}

function getCandidateHostname(record) {
  try {
    return new URL(record.candidate.source.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function getCandidateHostFailures(record, hostFailureCounts) {
  const hostname = getCandidateHostname(record);

  return hostname ? (hostFailureCounts.get(hostname) ?? 0) : 0;
}

function isExcludedCandidateHost(record, hostFailureCounts) {
  return getCandidateHostFailures(record, hostFailureCounts) >= candidateHostFailureExclusionThreshold;
}

function createSupplyRefillImportJob(candidate, now, contentLanguage) {
  const candidateScore = scoreCandidateRecord({ candidate });

  return {
    id: `supply-refill-import-${hashText(candidate.id)}`,
    kind: "import_source",
    topicId: candidate.topicId ?? candidate.conceptIds[0] ?? candidate.source.title,
    conceptIds: candidate.conceptIds,
    priority: Math.round(Math.min(1, Math.max(0.1, candidateScore)) * 100) / 100,
    reason:
      contentLanguage === "en"
        ? `Supply is low, so AITimeline is trying this candidate source: ${candidate.reason}`
        : `供给偏低,所以尝试导入这个候选来源:${candidate.reason}`,
    createdAt: now,
    runAfter: now,
    sourceCandidate: candidate
  };
}

export function maybeCreateSupplyDroughtNotification({ persistenceStore, status, contentLanguage, now }) {
  if (!status.drought) {
    return null;
  }

  const snapshot = persistenceStore.getSnapshot();
  const droughtStartAt = getSupplyDroughtStartAt(snapshot, now);
  const existing = snapshot.notifications.find(
    (record) => record.kind === "supply_drought" && record.createdAt >= droughtStartAt
  );

  if (existing) {
    return existing;
  }

  const droughtStartDay = getDayKey(droughtStartAt);
  const notification = {
    id: `notification-${hashText(`supply_drought|${droughtStartDay}`)}`,
    kind: "supply_drought",
    turnId: `supply-drought-${droughtStartDay}`,
    postIds: [],
    body: formatSupplyDroughtNotificationBody(status, contentLanguage),
    createdAt: normalizeIsoDate(now)
  };

  persistenceStore.saveNotifications([notification], now);

  return notification;
}

function getSupplyDroughtStartAt(snapshot, nowValue) {
  const now = nowValue ? new Date(nowValue) : new Date();
  const knowledgePosts = getKnowledgePosts(snapshot.posts)
    .map((post) => new Date(post.createdAt))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  if (knowledgePosts.length >= supplyDroughtNewCardThreshold) {
    const thresholdPost = knowledgePosts[supplyDroughtNewCardThreshold - 1];
    const start = new Date(thresholdPost.getTime() + supplyDroughtWindowHours * 60 * 60 * 1000);

    return (start > now ? now : start).toISOString();
  }

  if (knowledgePosts.length > 0) {
    return knowledgePosts[knowledgePosts.length - 1].toISOString();
  }

  return "1970-01-01T00:00:00.000Z";
}

function formatSupplyDroughtNotificationBody(status, contentLanguage) {
  if (contentLanguage === "en") {
    return `Only ${status.newCards48h} new cards arrived in the last 48h. Candidate pool: ${status.pendingCandidates} pending, ${status.queuedCandidates} queued; subscriptions: ${status.activeSubscriptions}. Add a subscription, refill candidates, or import a link to restart supply.`;
  }

  return `近 48 小时只有 ${status.newCards48h} 张新卡。候选池:${status.pendingCandidates} 条待挖、${status.queuedCandidates} 条已排队;订阅:${status.activeSubscriptions} 条。可以配订阅、挖候选池或导入链接来恢复供给。`;
}

export function createSourceCandidateRecord(body) {
  const now = body.createdAt ?? body.discoveredAt ?? new Date().toISOString();
  const candidate = normalizeSourceCandidate(body.candidate ?? body, now);

  if (body.status !== undefined && body.status !== "pending") {
    throw new HttpError(400, "New source candidates must start with pending status.");
  }

  return {
    id: body.id ?? candidate.id,
    candidate,
    status: "pending",
    intakeKind: isSourceCandidateIntakeKind(body.intakeKind) ? body.intakeKind : "user_paste",
    createdAt: now,
    updatedAt: now,
    userId: typeof body.userId === "string" ? body.userId : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined
  };
}

export function normalizeSourceCandidate(input, now) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HttpError(400, "candidate must be an object.");
  }

  const sourceInput = input.source ?? {};
  const url = sourceInput.url ?? input.url;

  requireString(url, "url");

  const parsedUrl = parseHttpUrl(url);
  const providedType = sourceInput.type ?? input.type;
  const type = providedType === undefined ? inferSourceType(parsedUrl) : providedType;

  if (!isSupportedSourceCandidateType(type)) {
    throw new HttpError(
      400,
      "Source candidate type is not supported. Supported types: article, blog, news, youtube."
    );
  }

  const title = sourceInput.title ?? input.title ?? parsedUrl.hostname;
  const source = {
    id: sourceInput.id ?? buildSourceId(type, parsedUrl),
    title,
    url: parsedUrl.toString(),
    type,
    author: sourceInput.author ?? input.author,
    publishedAt: sourceInput.publishedAt ?? input.publishedAt,
    durationSeconds: sourceInput.durationSeconds ?? input.durationSeconds
  };
  const conceptIds = normalizeStringArray(input.conceptIds);
  const topicId = typeof input.topicId === "string" && input.topicId.trim() ? input.topicId.trim() : conceptIds[0];

  return {
    id: input.id ?? `candidate-${source.id}`,
    source,
    topicId,
    conceptIds,
    relevanceScore: normalizeScore(input.relevanceScore, 0.72),
    noveltyScore: normalizeScore(input.noveltyScore, 0.62),
    qualityScore: normalizeScore(input.qualityScore, 0.74),
    reason: input.reason ?? "Source candidate was saved for future background curation.",
    discoveredAt: input.discoveredAt ?? now
  };
}

export function findMatchingSourceCandidateRecords(snapshot, signal) {
  const signalTopicKey = normalizeConceptKey(signal.topicId);
  const signalConceptKeys = new Set((signal.conceptIds ?? []).map(normalizeConceptKey).filter(Boolean));

  return snapshot.sourceCandidates
    .filter((record) => record.status === "pending")
    .filter((record) => {
      if (record.candidate.topicId && normalizeConceptKey(record.candidate.topicId) === signalTopicKey) {
        return true;
      }

      return record.candidate.conceptIds.some((conceptId) => signalConceptKeys.has(normalizeConceptKey(conceptId)));
    })
    .sort((left, right) => scoreCandidateRecord(right) - scoreCandidateRecord(left))
    .slice(0, 8);
}

export function dedupeSourceCandidates(candidates) {
  const byId = new Map();

  for (const candidate of candidates) {
    byId.set(candidate.id, candidate);
  }

  return Array.from(byId.values());
}

function scoreCandidateRecord(record, hostFailureCounts) {
  const base =
    record.candidate.relevanceScore * 0.45 +
    record.candidate.qualityScore * 0.35 +
    record.candidate.noveltyScore * 0.2;

  if (!hostFailureCounts) {
    return base;
  }

  return getCandidateHostFailures(record, hostFailureCounts) >= candidateHostFailurePenaltyThreshold
    ? base - candidateHostFailurePenalty
    : base;
}
