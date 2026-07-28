// @ts-check

import {
  createAutomaticConceptAliases,
  createConnectionNoteForImport,
  createEmptyUserMemory,
  getDayKey
} from "../../../../packages/core/dist/index.js";

export function createSingleJobPlan(job, generatedAt) {
  const jobs = Array.isArray(job) ? job : [job];

  return {
    generatedAt,
    jobs,
    suppressions: [],
    acceptedSourceCandidateIds: jobs.flatMap((item) => item.sourceCandidate?.id ?? []),
    cooledTopicIds: [],
    expansionPlan: {
      generatedAt,
      jobs: [],
      suppressions: [],
      cooledTopicIds: []
    }
  };
}

export function tokenizeText(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

export function getDailyAutoJobBudgetLimit(env) {
  const parsed = Number.parseInt(env.AITIMELINE_DAILY_AUTO_JOB_BUDGET ?? "20", 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20;
}

export function getDailyAutoJobBudgetRecord(snapshot, nowValue) {
  const date = getDayKey(nowValue);

  return snapshot.autoJobBudget.find((record) => record.date === date);
}

export function summarizeSnapshot(snapshot) {
  return {
    imports: snapshot.sourceImports.length,
    posts: snapshot.posts.length,
    runs: snapshot.harnessRuns.length,
    curationJobs: snapshot.curationJobs.length,
    memories: snapshot.userMemories.length,
    interactionSignals: snapshot.interactionSignals.length,
    topicStates: snapshot.topicStates.length,
    dismissedPosts: snapshot.dismissedPosts.length,
    reviewStates: snapshot.reviewStates.length,
    sourceCandidates: snapshot.sourceCandidates.length,
    agentTurns: snapshot.agentTurns.length,
    notifications: snapshot.notifications.length,
    conceptAliases: snapshot.conceptAliases.length,
    conceptMergeSuggestions: snapshot.conceptMergeSuggestions.length,
    sourceQualityVerdicts: snapshot.sourceQualityVerdicts.length,
    mergedSources: snapshot.mergedSources.length,
    autoJobBudget: snapshot.autoJobBudget,
    conceptBriefs: snapshot.conceptBriefs.length,
    deepReadArticles: snapshot.deepReadArticles.length,
    weeklyRecaps: snapshot.weeklyRecaps.length,
    subscriptions: snapshot.subscriptions.length,
    learningGoals: snapshot.learningGoals.length
  };
}

export function roundScore(value) {
  return Math.round(value * 100) / 100;
}

export function hashText(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

export class HttpError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.statusCode = statusCode;
  }
}

export function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${fieldName} is required.`);
  }
}

export function parseHttpUrl(url) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new HttpError(400, "URL must use http or https.");
    }

    return parsedUrl;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(400, "Please enter a valid URL.");
  }
}

export function normalizeStringArray(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
    : [];
}

export function normalizeIsoDate(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function normalizeScore(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

export function inferSourceType(url) {
  if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) {
    return "youtube";
  }

  if (url.hostname.includes("github.com")) {
    return "repo";
  }

  return "article";
}

export function buildSourceId(type, url) {
  if (type === "youtube") {
    const videoId = url.hostname.includes("youtu.be")
      ? url.pathname.replace(/^\//, "")
      : url.searchParams.get("v");

    if (videoId) {
      return `youtube-${sanitizeSlug(videoId)}`;
    }
  }

  return `${type}-${sanitizeSlug(`${url.hostname}-${url.pathname}-${url.search}`)}`;
}

export function sanitizeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "source";
}

export function isSupportedSourceCandidateType(value) {
  return value === "article" || value === "blog" || value === "news" || value === "youtube";
}

export function isSourceCandidateIntakeKind(value) {
  return (
    value === "user_paste" ||
    value === "browser_share" ||
    value === "agent_discovery" ||
    value === "manual" ||
    value === "subscription"
  );
}

export function getSnapshotUserMemory(snapshot, userId) {
  return snapshot.userMemories.find((record) => record.userId === userId)?.memory ?? createEmptyUserMemory();
}

export function buildSourceQualityUserContext(snapshot, userId = "local-user") {
  const memory =
    snapshot.userMemories.find((record) => record.userId === userId)?.memory ??
    snapshot.userMemories[0]?.memory;
  const confirmedConcepts = new Set();

  for (const record of snapshot.interactionSignals) {
    const signal = record.signal;

    if (!signal.liked && !signal.saved && !signal.askedQuestion && !signal.reviewed) {
      continue;
    }

    for (const concept of [signal.topicId, ...(signal.conceptIds ?? [])]) {
      if (concept) {
        confirmedConcepts.add(concept);
      }
    }
  }

  const weakConcepts = new Set(memory?.knowledge.weakConcepts ?? []);

  for (const state of snapshot.topicStates) {
    if (state.comprehensionScore < 0.5) {
      weakConcepts.add(state.topicId);
    }
  }

  return {
    memory,
    knownConcepts: uniqueStrings([
      ...(memory?.profile.interests ?? []),
      ...(memory?.knowledge.knownConcepts ?? []),
      ...confirmedConcepts
    ]),
    savedConcepts: uniqueStrings(memory?.knowledge.savedConcepts ?? []),
    weakConcepts: uniqueStrings(Array.from(weakConcepts)),
    topicStates: snapshot.topicStates,
    recentSignals: snapshot.interactionSignals.map((record) => record.signal).slice(-20)
  };
}

export function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => `${value}`.trim()).filter(Boolean)));
}

export function toUserSignals(interactionSignalRecords) {
  return interactionSignalRecords.flatMap((record) => {
    const signals = [];
    const push = (type) =>
      signals.push({
        id: `${record.id}-${type}`,
        cardId: record.signal.postId,
        type,
        createdAt: record.signal.createdAt
      });

    if (record.signal.liked) {
      push("like");
    }

    if (record.signal.saved) {
      push("save");
    }

    if (record.signal.askedQuestion) {
      push("ask");
    }

    if (record.signal.reviewed) {
      push("review");
    }

    return signals;
  });
}

export function persistAutomaticConceptAliases(persistenceStore, snapshot, now) {
  const automaticAliases = createAutomaticConceptAliases(snapshot.posts, snapshot.conceptAliases, now);

  if (!automaticAliases.length) {
    return snapshot;
  }

  return persistenceStore.saveConceptAliases([...snapshot.conceptAliases, ...automaticAliases], now);
}

export function maybePersistConnectionNote(persistenceStore, options) {
  const currentSnapshot = persistenceStore.getSnapshot();
  const note = createConnectionNoteForImport({
    existingPosts: options.beforeImport.posts,
    newPosts: options.newPosts,
    interactionSignals: options.beforeImport.interactionSignals.map((record) => record.signal),
    dismissedPosts: options.beforeImport.dismissedPosts,
    conceptAliases: currentSnapshot.conceptAliases,
    now: options.now,
    contentLanguage: options.contentLanguage
  });

  if (!note) {
    return currentSnapshot;
  }

  return persistenceStore.savePosts([note], options.now);
}

export function deriveTopicState(signal) {
  const positiveSignals = [signal.openedThread, signal.liked, signal.saved, signal.askedQuestion, signal.reviewed].filter(
    Boolean
  ).length;

  return {
    topicId: signal.topicId,
    interestScore: Math.min(1, positiveSignals / 4),
    fatigueScore: signal.skippedQuickly ? 0.85 : 0.15,
    comprehensionScore: signal.askedQuestion ? 0.35 : signal.reviewed || signal.saved ? 0.78 : 0.55
  };
}

export function buildInteractionSignalRecordId(signal) {
  const signature = [
    signal.postId,
    signal.topicId,
    signal.createdAt,
    signal.dwellTimeMs,
    signal.openedThread,
    signal.liked,
    signal.saved,
    signal.askedQuestion,
    signal.reviewed,
    signal.skippedQuickly
  ].join("|");

  return `signal-${sanitizeSlug(signal.postId)}-${hashText(signature)}`;
}
