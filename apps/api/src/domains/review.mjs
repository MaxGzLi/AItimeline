// @ts-check

import {
  advanceReviewState,
  applyUserMemoryEdits,
  createInitialReviewState,
  evaluateMasteryPromotions,
  normalizeConceptKey
} from "../../../../packages/core/dist/index.js";
import {
  getSnapshotUserMemory,
  hashText,
  normalizeIsoDate,
  sanitizeSlug,
  uniqueStrings
} from "./shared.mjs";
import { markAchievedLearningGoals } from "./learningGoals.mjs";

export function maybeCreateInitialReviewState(snapshot, signal, generatedAt) {
  if (!signal.liked && !signal.saved) {
    return undefined;
  }

  if (snapshot.reviewStates.some((state) => state.postId === signal.postId)) {
    return undefined;
  }

  const post = snapshot.posts.find((candidate) => candidate.id === signal.postId);

  if (!post || post.kind === "connection_note") {
    return undefined;
  }

  return createInitialReviewState(signal.postId, signal.createdAt ?? generatedAt);
}

export function backfillLegacyReviewStates(persistenceStore, savedAt) {
  const snapshot = persistenceStore.getSnapshot();
  const reviewStates = createLegacyReviewBackfillStates(snapshot);

  return reviewStates.length ? persistenceStore.saveReviewStates(reviewStates, savedAt) : snapshot;
}

function createLegacyReviewBackfillStates(snapshot, limit = 50) {
  const existingPostIds = new Set(snapshot.reviewStates.map((state) => state.postId));
  const postById = new Map(snapshot.posts.map((post) => [post.id, post]));
  const reviewStates = [];

  for (const record of snapshot.interactionSignals) {
    const signal = record.signal;

    if (reviewStates.length >= limit) {
      break;
    }

    if (!signal.liked && !signal.saved) {
      continue;
    }

    if (existingPostIds.has(signal.postId)) {
      continue;
    }

    const post = postById.get(signal.postId);

    if (!post || post.kind === "connection_note") {
      continue;
    }

    reviewStates.push(createInitialReviewState(signal.postId, signal.createdAt ?? record.createdAt));
    existingPostIds.add(signal.postId);
  }

  return reviewStates;
}

export function selectReviewPrompt(post, intervalDays) {
  const prompts = Array.isArray(post?.reviewPrompts)
    ? post.reviewPrompts.filter(
        (prompt) =>
          prompt &&
          typeof prompt.id === "string" &&
          typeof prompt.prompt === "string" &&
          typeof prompt.answerHint === "string"
      )
    : [];

  if (!prompts.length) {
    if (!post) {
      return null;
    }

    return {
      id: `${post.id}-review-fallback`,
      prompt: post.title,
      answerHint: post.keyTakeaway ?? post.summary ?? post.shortBody ?? post.title
    };
  }

  const exact = prompts.find((prompt) => prompt.dueInDays === intervalDays);
  const previous = prompts
    .filter((prompt) => Number.isFinite(prompt.dueInDays) && prompt.dueInDays <= intervalDays)
    .sort((left, right) => right.dueInDays - left.dueInDays)[0];
  const earliest = [...prompts]
    .filter((prompt) => Number.isFinite(prompt.dueInDays))
    .sort((left, right) => left.dueInDays - right.dueInDays)[0];
  const selected = exact ?? previous ?? earliest ?? prompts[0];

  return {
    id: selected.id,
    prompt: selected.prompt,
    answerHint: selected.answerHint
  };
}

export function createReviewStateForGrade(reviewState, reviewedAt, grade) {
  if (grade === "remembered") {
    return advanceReviewState(reviewState, reviewedAt);
  }

  if (grade === "forgot") {
    return {
      ...createInitialReviewState(reviewState.postId, reviewedAt),
      lastReviewedAt: reviewedAt
    };
  }

  return {
    ...reviewState,
    dueAt: addDaysIso(reviewedAt, reviewState.intervalDays),
    lastReviewedAt: reviewedAt
  };
}

function addDaysIso(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function buildReviewEventRecordId(postId, reviewEventId) {
  return `review-event-${sanitizeSlug(postId)}-${hashText(`${postId}|${reviewEventId}`)}`;
}

export function buildReviewCompletionRecordId(postId, reviewedAt) {
  return `review-complete-${sanitizeSlug(postId)}-${hashText(`${postId}|${reviewedAt}`)}`;
}

export function promoteMasteryAfterReview({ persistenceStore, snapshot, post, userId, reviewedAt, contentLanguage }) {
  const memory = getSnapshotUserMemory(snapshot, userId);
  const promotions = evaluateMasteryPromotions({
    concepts: post.concepts,
    cards: snapshot.posts,
    reviewStates: snapshot.reviewStates,
    topicStates: snapshot.topicStates,
    knownConcepts: memory.knowledge.knownConcepts,
    promotionBlacklist: collectMasteryPromotionBlacklist(snapshot, userId)
  });

  if (!promotions.length) {
    return { snapshot, promotions: [] };
  }

  const editResult = applyUserMemoryEdits(
    memory,
    promotions.map((promotion) => ({
      id: `memory-edit-auto-mastery-promotion-${hashText(`${userId}|${promotion.concept}|${reviewedAt}`)}`,
      kind: "auto_mastery_promotion",
      field: "knowledge.knownConcepts",
      value: promotion.concept,
      createdAt: reviewedAt,
      reason: buildAutoMasteryPromotionReason(promotion)
    })),
    reviewedAt
  );
  let nextSnapshot = persistenceStore.saveUserMemory(userId, editResult.memory, editResult.events, reviewedAt);

  nextSnapshot = persistenceStore.saveNotifications(
    promotions.map((promotion) => createMasteryPromotionNotification(promotion, contentLanguage, reviewedAt)),
    reviewedAt
  );

  const achievementResult = markAchievedLearningGoals({
    persistenceStore,
    snapshot: nextSnapshot,
    userId,
    contentLanguage,
    now: reviewedAt
  });

  return { snapshot: achievementResult.snapshot, promotions, learningGoalAchievements: achievementResult.achievedGoals };
}

function buildAutoMasteryPromotionReason(promotion) {
  return [
    "auto_mastery_promotion",
    `concept=${promotion.concept}`,
    `cards=${promotion.qualifyingCardCount}/${promotion.cardCount}`,
    `intervals=${promotion.intervalDays.join(",")}`,
    `score=${promotion.comprehensionScore.toFixed(2)}`
  ].join("; ");
}

function createMasteryPromotionNotification(promotion, contentLanguage, createdAt) {
  const body =
    contentLanguage === "en"
      ? `#${promotion.concept} is now mastered: you reviewed it ${promotion.estimatedReviewCount} times across ${promotion.maxIntervalDays} days.`
      : `#${promotion.concept} 已进入已掌握:你复习了 ${promotion.estimatedReviewCount} 次、跨 ${promotion.maxIntervalDays} 天。`;

  return {
    id: `notification-${hashText(`mastery_promotion|${promotion.concept}|${createdAt}|${promotion.postIds.join("|")}`)}`,
    kind: "mastery_promotion",
    turnId: `mastery-${hashText(`${promotion.concept}|${createdAt}`)}`,
    postIds: promotion.postIds,
    body,
    createdAt
  };
}

export function createManualMasteryDemotionEvents(snapshot, userId, previousMemory, nextMemory, createdAt) {
  const autoPromotedKeys = collectAutoMasteryPromotionKeys(snapshot, userId);
  const blacklistKeys = new Set(collectMasteryPromotionBlacklist(snapshot, userId).map(normalizeConceptKey));
  const nextKnownKeys = new Set(nextMemory.knowledge.knownConcepts.map(normalizeConceptKey));
  const removedConcepts = previousMemory.knowledge.knownConcepts.filter((concept) => {
    const conceptKey = normalizeConceptKey(concept);

    return conceptKey && !nextKnownKeys.has(conceptKey);
  });

  return removedConcepts.flatMap((concept) => {
    const conceptKey = normalizeConceptKey(concept);

    if (!autoPromotedKeys.has(conceptKey) || blacklistKeys.has(conceptKey)) {
      return [];
    }

    return [
      {
        id: `memory-edit-knowledge-knownConcepts-auto-mastery-blacklist-${hashText(`${userId}|${conceptKey}|${createdAt}`)}`,
        kind: "auto_mastery_blacklist",
        field: "knowledge.knownConcepts",
        // Single-concept diff on purpose: the blacklist is re-derived from
        // previousValue/nextValue, so a batch removal must not drag
        // manually-added concepts deleted in the same edit into it.
        previousValue: [concept],
        nextValue: [],
        createdAt,
        reason: `auto_mastery_blacklist; concept=${concept}`
      }
    ];
  });
}

function collectAutoMasteryPromotionKeys(snapshot, userId) {
  const keys = new Set();

  for (const record of snapshot.memoryEvents) {
    if (record.userId !== userId || record.event.field !== "knowledge.knownConcepts") {
      continue;
    }

    if (record.event.kind !== "auto_mastery_promotion") {
      continue;
    }

    for (const concept of getAddedMemoryConcepts(record.event)) {
      const conceptKey = normalizeConceptKey(concept);

      if (conceptKey) {
        keys.add(conceptKey);
      }
    }
  }

  return keys;
}

function collectMasteryPromotionBlacklist(snapshot, userId) {
  const concepts = [];

  for (const record of snapshot.memoryEvents) {
    if (record.userId !== userId || record.event.field !== "knowledge.knownConcepts") {
      continue;
    }

    if (record.event.kind !== "auto_mastery_blacklist") {
      continue;
    }

    concepts.push(...getRemovedMemoryConcepts(record.event));
  }

  return uniqueStrings(concepts);
}

function getAddedMemoryConcepts(event) {
  const previousKeys = new Set(toMemoryConceptArray(event.previousValue).map(normalizeConceptKey));

  return toMemoryConceptArray(event.nextValue).filter((concept) => !previousKeys.has(normalizeConceptKey(concept)));
}

function getRemovedMemoryConcepts(event) {
  const nextKeys = new Set(toMemoryConceptArray(event.nextValue).map(normalizeConceptKey));

  return toMemoryConceptArray(event.previousValue).filter((concept) => !nextKeys.has(normalizeConceptKey(concept)));
}

function toMemoryConceptArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" && item.trim());
  }

  return typeof value === "string" && value.trim() ? [value] : [];
}

export function createReviewedInteractionSignal(post, reviewedAt) {
  return {
    postId: post.id,
    topicId: getPostTopicId(post),
    conceptIds: post.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: true,
    skippedQuickly: false,
    createdAt: normalizeIsoDate(reviewedAt)
  };
}

function getPostTopicId(post) {
  return post.concepts[0] ?? post.id;
}
