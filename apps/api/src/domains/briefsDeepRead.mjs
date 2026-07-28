// @ts-check

import {
  applyDailyAutoJobBudget,
  askGrounded,
  buildConceptDigest,
  createConceptBriefInputFromCards,
  createDeepReadArticle,
  createDeterministicConceptBrief,
  generateConceptBrief,
  getDayKey,
  mergeSourceRegistries,
  normalizeConceptKey,
  shouldRefreshConceptBrief
} from "../../../../packages/core/dist/index.js";
import {
  HttpError,
  createSingleJobPlan,
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  getSnapshotUserMemory,
  hashText,
  normalizeIsoDate,
  requireString,
  summarizeSnapshot
} from "./shared.mjs";

export async function handleAsk(body, persistenceStore, client, contentLanguage) {
  requireString(body.postId, "postId");
  requireString(body.question, "question");

  const snapshot = persistenceStore.getSnapshot();
  const post = snapshot.posts.find((candidate) => candidate.id === body.postId);

  if (!post) {
    throw new HttpError(404, `No post found for id ${body.postId}.`);
  }

  const sourceIds = new Set(post.sources.map((source) => source.id));
  const registries = snapshot.sourceRegistries
    .filter((record) => sourceIds.has(record.sourceId))
    .map((record) => record.registry);
  const registry = mergeSourceRegistries(...registries);

  return askGrounded({ post, registry, question: body.question }, { client, contentLanguage });
}

export function handleConceptBriefRequest(concept, body, persistenceStore, curationStore, contentLanguage) {
  requireString(concept, "concept");
  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const input = buildConceptBriefInput(snapshot, concept, contentLanguage, now);

  if (input.cards.length === 0) {
    throw new HttpError(404, "Concept has no cards.");
  }

  const existingBrief = findConceptBrief(snapshot, input.concept);
  const needsRefresh = shouldRefreshConceptBrief(existingBrief, input.cards.length);
  const brief = needsRefresh ? createDeterministicConceptBrief(input) : existingBrief;

  if (!needsRefresh && brief) {
    return {
      brief,
      queued: false,
      records: [],
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  const activeJob = curationStore.list().find(
    (record) =>
      (record.status === "queued" || record.status === "running") &&
      record.job.kind === "concept_brief" &&
      normalizeConceptKey(record.job.topicId) === normalizeConceptKey(input.concept)
  );

  if (activeJob) {
    return {
      brief,
      queued: true,
      records: [activeJob],
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  const rawPlan = createSingleJobPlan(createConceptBriefJob(input.concept, input.cards.length, now), now);
  const budgetResult = applyDailyAutoJobBudget({
    plan: rawPlan,
    budget: getDailyAutoJobBudgetRecord(snapshot, now),
    limit: getDailyAutoJobBudgetLimit(process.env),
    now
  });
  const records = curationStore.enqueuePlan(budgetResult.plan, now);
  persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], now);
  const nextSnapshot = persistenceStore.saveCurationJobRecords(records, now);

  return {
    brief,
    queued: records.length > 0,
    records,
    budget: budgetResult.budget,
    discardedJobIds: budgetResult.discardedJobIds,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

export function handleDeepReadRequest({ body, persistenceStore, curationStore, contentLanguage, now }) {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be an object.");
  }

  const snapshot = persistenceStore.getSnapshot();
  const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : "local-user";
  const goalId = typeof body.goalId === "string" && body.goalId.trim() ? body.goalId.trim() : undefined;
  const goal = goalId ? snapshot.learningGoals.find((record) => record.id === goalId) : undefined;
  const topic = normalizeDeepReadTopic(typeof body.topic === "string" ? body.topic : goal?.concept);

  if (!topic) {
    throw new HttpError(400, "topic or goalId is required.");
  }

  if (goalId && !goal) {
    throw new HttpError(404, "Learning goal not found.");
  }

  const nowIso = normalizeIsoDate(now);
  const date = getDayKey(nowIso);
  const existingForDay = findDeepReadForDay(snapshot, curationStore, userId, date);

  if (existingForDay) {
    throw new HttpError(429, "Deep-read article generation is limited to one article per day.");
  }

  const activeJob = curationStore
    .list()
    .find(
      (record) =>
        (record.status === "queued" || record.status === "running") &&
        record.job.kind === "deep_read_article" &&
        normalizeConceptKey(record.job.topicId) === normalizeConceptKey(topic)
    );

  if (activeJob) {
    return {
      queued: true,
      records: [activeJob],
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  const latestFailed = curationStore
    .list()
    .filter(
      (record) =>
        record.job.kind === "deep_read_article" &&
        record.status === "failed" &&
        record.job.deepReadArticle?.userId === userId &&
        normalizeConceptKey(record.job.topicId) === normalizeConceptKey(topic) &&
        [record.createdAt, record.updatedAt, record.completedAt].some(
          (value) => value && getDayKey(value) === date
        )
    )
    .sort((left, right) => right.attempt - left.attempt || right.updatedAt.localeCompare(left.updatedAt))[0];
  const records = latestFailed
    ? [curationStore.enqueueRetry(latestFailed.id, nowIso)]
    : curationStore.enqueuePlan(
        createSingleJobPlan(createDeepReadArticleJob({ topic, goalId, userId, contentLanguage, now: nowIso }), nowIso),
        nowIso
      );
  const nextSnapshot = persistenceStore.saveCurationJobRecords(records, nowIso);

  return {
    queued: records.some((record) => record.status === "queued"),
    records,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

export async function handleDeepReadArticleJob(job, persistenceStore, modelClients, contentLanguage, now) {
  const snapshot = persistenceStore.getSnapshot();
  const userId = job.deepReadArticle?.userId ?? "local-user";
  const memory = getSnapshotUserMemory(snapshot, userId);
  const topic = normalizeDeepReadTopic(job.topicId || job.conceptIds?.[0]);

  if (!topic) {
    return {
      kind: job.kind,
      message: "Skipped: deep-read article job is missing a topic."
    };
  }

  const article = await createDeepReadArticle(
    {
      topic,
      goalId: job.deepReadArticle?.goalId,
      userId,
      cards: snapshot.posts,
      sourceRegistries: snapshot.sourceRegistries,
      conceptAliases: snapshot.conceptAliases,
      sourceQualityVerdicts: snapshot.sourceQualityVerdicts,
      knownConcepts: memory.knowledge.knownConcepts,
      libraryVersion: snapshot.updatedAt,
      contentLanguage: job.deepReadArticle?.contentLanguage ?? contentLanguage,
      maxTokens: modelClients.maxTokens
    },
    {
      deepReadClient: modelClients.deepReadClient,
      defaultClient: modelClients.defaultClient,
      now
    }
  );

  return {
    kind: job.kind,
    deepReadArticle: article,
    message: `Generated deep-read article for ${article.topic}.`
  };
}

function createDeepReadArticleJob({ topic, goalId, userId, contentLanguage, now }) {
  const date = getDayKey(now);

  return {
    id: `deep-read-${hashText(`${userId}|${normalizeConceptKey(topic)}|${date}`)}`,
    kind: "deep_read_article",
    topicId: topic,
    conceptIds: [topic],
    priority: 0.7,
    reason: `Generate a sourced deep-read article for ${topic}.`,
    createdAt: now,
    runAfter: now,
    deepReadArticle: {
      userId,
      goalId,
      contentLanguage
    }
  };
}

function findDeepReadForDay(snapshot, curationStore, userId, date) {
  if (
    snapshot.deepReadArticles.some(
      (record) => record.userId === userId && getDayKey(record.createdAt) === date
    )
  ) {
    return true;
  }

  return curationStore
    .list()
    .some(
      (record) =>
        record.job.kind === "deep_read_article" &&
        record.status !== "failed" &&
        record.job.deepReadArticle?.userId === userId &&
        [record.createdAt, record.updatedAt, record.completedAt].some(
          (value) => value && getDayKey(value) === date
        )
    );
}

function normalizeDeepReadTopic(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function handleConceptBriefJob(job, persistenceStore, client, contentLanguage, now) {
  const concept = job.conceptIds[0] ?? job.topicId;
  const snapshot = persistenceStore.getSnapshot();
  const input = buildConceptBriefInput(snapshot, concept, contentLanguage, now);

  if (input.cards.length === 0) {
    return {
      kind: job.kind,
      message: "Skipped: concept brief job has no matching cards."
    };
  }

  const brief = await generateConceptBrief(input, { client });

  return {
    kind: job.kind,
    conceptBrief: brief,
    message: `Generated concept brief for ${input.concept}.`
  };
}

export function buildConceptBriefInput(snapshot, concept, contentLanguage, now) {
  const digest = buildConceptDigest(concept, snapshot.posts, { conceptAliases: snapshot.conceptAliases });
  const cardIds = new Set(digest.entries.map((entry) => entry.cardId));
  const cards = snapshot.posts.filter((post) => cardIds.has(post.id) && post.kind !== "connection_note");

  return createConceptBriefInputFromCards({
    concept: digest.concept || concept,
    cards,
    reviewCount: countConceptReviews(snapshot, cardIds),
    contentLanguage,
    createdAt: now
  });
}

export function createConceptBriefJob(concept, cardCount, now) {
  return {
    id: `concept-brief-${hashText(`${normalizeConceptKey(concept)}|${cardCount}|${getDayKey(now)}`)}`,
    kind: "concept_brief",
    topicId: concept,
    conceptIds: [concept],
    priority: 0.64,
    reason: `Generate a sourced concept brief for ${concept}.`,
    createdAt: now,
    runAfter: now
  };
}

function findConceptBrief(snapshot, concept) {
  const conceptKey = normalizeConceptKey(concept);

  return snapshot.conceptBriefs
    .filter((brief) => normalizeConceptKey(brief.concept) === conceptKey)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
}

function countConceptReviews(snapshot, cardIds) {
  const reviewedSignals = snapshot.interactionSignals.filter(
    (record) => cardIds.has(record.signal.postId) && record.signal.reviewed
  ).length;
  const reviewedStates = snapshot.reviewStates.filter(
    (state) => cardIds.has(state.postId) && state.lastReviewedAt
  ).length;

  return reviewedSignals + reviewedStates;
}
