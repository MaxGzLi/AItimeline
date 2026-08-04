// @ts-check

import {
  applyDailyAutoJobBudget,
  transformConversationCapture
} from "../../../../packages/core/dist/index.js";
import {
  HttpError,
  createSingleJobPlan,
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  hashText,
  summarizeSnapshot
} from "./shared.mjs";
import {
  getKnowledgePosts,
  sanitizeSourceCandidateRecordForResponse
} from "./importSettlement.mjs";
import {
  getBudgetRemaining,
  normalizeSourceCandidate
} from "./supply.mjs";
import { normalizeUrlKey } from "./subscriptions.mjs";

const agentCaptureRunLimit = 3;

function createAgentCaptureCandidateRecord(body, now) {
  const capturedText = typeof body.capturedText === "string" && body.capturedText.trim() ? body.capturedText : undefined;
  const candidate = normalizeSourceCandidate(
    {
      url: body.url,
      title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined,
      author: typeof body.author === "string" && body.author.trim() ? body.author.trim() : undefined,
      publishedAt: typeof body.publishedAt === "string" && body.publishedAt.trim() ? body.publishedAt : undefined,
      conceptIds: typeof body.topic === "string" && body.topic.trim() ? [body.topic.trim()] : [],
      relevanceScore: 0.7,
      noveltyScore: 0.6,
      qualityScore: 0.7,
      reason:
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : capturedText
            ? "Captured from the browser."
            : "Captured from a learning conversation."
    },
    now
  );
  const id = `agent-capture-${hashText(normalizeUrlKey(candidate.source.url))}`;

  return {
    id,
    candidate: { ...candidate, id, ...(capturedText ? { capturedText } : {}) },
    status: "pending",
    // browser_share marks captures that arrive from the browser extension with
    // their body text attached; everything else stays on the agent_capture lane.
    intakeKind: body.intakeKind === "browser_share" ? "browser_share" : "agent_capture",
    createdAt: now,
    updatedAt: now,
    notes: typeof body.topic === "string" && body.topic.trim() ? body.topic.trim() : undefined
  };
}

function createAgentCaptureImportJob(record, now, contentLanguage) {
  // Stamp the intake lane onto the embedded candidate so the core import job
  // can tell browser_share (user clipped it by hand; skips the source quality
  // gate) apart from agent_capture (still gated). Reading it off the record
  // here also covers pending records created before the lane was stamped.
  const candidate = { ...record.candidate, intakeKind: record.intakeKind };

  return {
    id: `agent-capture-import-${hashText(candidate.id)}`,
    kind: "import_source",
    // Same fallback as the supply-refill lane: browser captures often arrive
    // without a topic, and a job with an undefined topicId fails queue
    // validation on reload.
    topicId: candidate.topicId ?? candidate.conceptIds[0] ?? candidate.source.title,
    conceptIds: candidate.conceptIds,
    priority: 0.66,
    reason: candidate.capturedText
      ? contentLanguage === "en"
        ? `Browser capture: ${candidate.reason}`
        : `浏览器剪藏的来源:${candidate.reason}`
      : contentLanguage === "en"
        ? `Learning conversation capture: ${candidate.reason}`
        : `学习对话采集的来源:${candidate.reason}`,
    createdAt: now,
    runAfter: now,
    sourceCandidate: candidate
  };
}

// Flip pending agent-capture candidates into queued import jobs within the
// shared daily auto job budget. Relevance filtering is intentionally skipped —
// a capture is an explicit learning intent — while the source quality gate
// still runs inside the import job itself.
function queueAgentCaptureCandidates({ persistenceStore, curationStore, records, now, contentLanguage }) {
  if (!records.length) {
    return { queued: 0, budgetRemaining: getBudgetRemaining(persistenceStore.getSnapshot(), now) };
  }

  const snapshot = persistenceStore.getSnapshot();
  const rawPlan = createSingleJobPlan(
    records.map((record) => createAgentCaptureImportJob(record, now, contentLanguage)),
    now
  );
  const budgetResult = applyDailyAutoJobBudget({
    plan: rawPlan,
    budget: getDailyAutoJobBudgetRecord(snapshot, now),
    limit: getDailyAutoJobBudgetLimit(process.env),
    now
  });
  const acceptedIds = new Set(budgetResult.plan.acceptedSourceCandidateIds);
  const jobRecords = curationStore.enqueuePlan(budgetResult.plan, now);
  let nextSnapshot = persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], now);

  if (jobRecords.length) {
    nextSnapshot = persistenceStore.saveCurationJobRecords(jobRecords, now);
  }

  const queuedRecords = records
    .filter((record) => acceptedIds.has(record.candidate.id))
    .map((record) => ({ ...record, status: "queued", updatedAt: now, lastQueuedAt: now }));

  if (queuedRecords.length) {
    nextSnapshot = persistenceStore.saveSourceCandidateRecords(queuedRecords, now);
  }

  return { queued: queuedRecords.length, budgetRemaining: getBudgetRemaining(nextSnapshot, now) };
}

// Budget-exhausted captures stay pending; each curation run drains a few of
// them so a capture never gets stranded.
export function queueDueAgentCaptures({ persistenceStore, curationStore, contentLanguage, now }) {
  const snapshot = persistenceStore.getSnapshot();
  const pending = snapshot.sourceCandidates
    .filter(
      (record) =>
        (record.intakeKind === "agent_capture" || record.intakeKind === "browser_share") &&
        record.status === "pending"
    )
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(0, agentCaptureRunLimit);

  return queueAgentCaptureCandidates({ persistenceStore, curationStore, records: pending, now, contentLanguage });
}

export function handleCaptureSource(body, persistenceStore, curationStore, contentLanguage) {
  const now = new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const urlKey = normalizeUrlKey(body.url);

  if (!urlKey) {
    throw new HttpError(400, "url must be a valid URL.");
  }

  const importedPost = snapshot.posts.find((post) =>
    (post.sources ?? []).some((source) => normalizeUrlKey(source.url) === urlKey)
  );

  if (importedPost) {
    return {
      status: "imported",
      alreadyKnown: true,
      postId: importedPost.id,
      queued: 0,
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  const existing = snapshot.sourceCandidates.find(
    (record) => normalizeUrlKey(record.candidate.source.url) === urlKey
  );

  if (existing) {
    return {
      status: existing.status,
      alreadyKnown: true,
      record: sanitizeSourceCandidateRecordForResponse(existing),
      queued: 0,
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  const record = createAgentCaptureCandidateRecord(body, now);

  persistenceStore.saveSourceCandidateRecords([record]);

  const queueResult = queueAgentCaptureCandidates({
    persistenceStore,
    curationStore,
    records: [record],
    now,
    contentLanguage
  });
  const nextSnapshot = persistenceStore.getSnapshot();
  const finalRecord = nextSnapshot.sourceCandidates.find((item) => item.id === record.id);

  return {
    status: finalRecord?.status ?? record.status,
    alreadyKnown: false,
    record: sanitizeSourceCandidateRecordForResponse(finalRecord ?? record),
    queued: queueResult.queued,
    budgetRemaining: queueResult.budgetRemaining,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

export function handleCaptureConversation(body, persistenceStore, curationStore, contentLanguage) {
  const now = new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const libraryPosts = getKnowledgePosts(snapshot.posts);
  const libraryConcepts = Array.from(new Set(libraryPosts.flatMap((post) => post.concepts)));
  let capture;

  try {
    capture = transformConversationCapture(
      { topic: body.topic, excerpt: body.excerpt, agentName: body.agentName },
      {
        capturedAt: now,
        libraryConcepts,
        libraryCards: libraryPosts,
        conceptAliases: snapshot.conceptAliases,
        contentLanguage
      }
    );
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Conversation capture failed.");
  }

  const existingPost = snapshot.posts.find((post) => post.id === capture.post.id);

  if (existingPost) {
    return {
      post: sanitizeCapturePostForResponse(existingPost),
      alreadyCaptured: true,
      sources: [],
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  persistenceStore.saveSourceImportResult(
    {
      importRecord: capture.importRecord,
      source: capture.source,
      assets: [capture.asset],
      chunks: capture.chunks,
      sourceRegistry: capture.sourceRegistry,
      posts: [capture.post]
    },
    now
  );

  const sourceUrls = Array.isArray(body.sourceUrls) ? body.sourceUrls.slice(0, 5) : [];
  const sources = [];

  for (const sourceUrl of sourceUrls) {
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
      continue;
    }

    try {
      const result = handleCaptureSource(
        { url: sourceUrl, topic: body.topic },
        persistenceStore,
        curationStore,
        contentLanguage
      );

      sources.push({ url: sourceUrl, status: result.status, queued: result.queued });
    } catch (error) {
      sources.push({ url: sourceUrl, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    post: sanitizeCapturePostForResponse(capture.post),
    alreadyCaptured: false,
    sources,
    snapshotSummary: summarizeSnapshot(persistenceStore.getSnapshot())
  };
}

function sanitizeCapturePostForResponse(post) {
  return {
    id: post.id,
    title: post.title,
    concepts: post.concepts,
    createdAt: post.createdAt,
    keyTakeaway: post.keyTakeaway
  };
}

export function getCaptureContextResponse(persistenceStore) {
  const snapshot = persistenceStore.getSnapshot();
  const topics = [...snapshot.topicStates]
    .sort((left, right) => (right.interestScore ?? 0) - (left.interestScore ?? 0))
    .slice(0, 8)
    .map((state) => ({
      topicId: state.topicId,
      interestScore: state.interestScore,
      comprehensionScore: state.comprehensionScore
    }));
  const learningGoals = snapshot.learningGoals
    .filter((record) => record.status === "active")
    .slice(0, 8)
    .map((record) => ({ concept: record.concept, status: record.status }));
  const recentCards = [...snapshot.posts]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 5)
    .map((post) => ({ title: post.title, concepts: post.concepts, createdAt: post.createdAt }));

  return { topics, learningGoals, recentCards, cardCount: snapshot.posts.length };
}
