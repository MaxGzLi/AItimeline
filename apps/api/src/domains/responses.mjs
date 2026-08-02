// @ts-check

import {
  arrangeTimelineBlocks,
  assignCardBlockTopics,
  buildWeeklyRecap,
  buildWeeklyRecapId,
  coalesceInteractionSignals,
  filterTimelineLifecycle,
  getDayKey,
  getDueReviewStates,
  getHardDismissedPostIds,
  getMostRecentCompletedIsoWeekStart,
  getRestingReviewStates,
  getSoftDismissalReturnAt,
  isTimelineDismissalActive,
  mergeSourceRegistries,
  rankPersonalizedTimeline
} from "../../../../packages/core/dist/index.js";
import { createEvidenceLedger } from "../../../../packages/core/dist/harness/evidenceLedger.js";
import { readConfiguredContentLanguage } from "./config.mjs";
import { dedupePostsById, sanitizeSourceCandidateRecordForResponse } from "./importSettlement.mjs";
import { sanitizeFailedCurationRecord } from "./importPipeline.mjs";
import { buildLearningGoalTree, collectActiveLearningGoalConcepts } from "./learningGoals.mjs";
import { researchCopy } from "./research.mjs";
import { HttpError, normalizeIsoDate, summarizeSnapshot } from "./shared.mjs";
import { getSupplyStatus } from "./supply.mjs";
import { parseOptionalDate } from "../lib/validate.mjs";

export function getSettingsResponse(persistenceStore, env, snapshot = persistenceStore.getSnapshot()) {
  const environmentContentLanguage = readConfiguredContentLanguage(env);
  const contentLanguage = snapshot.userSettings.contentLanguage ?? environmentContentLanguage ?? "zh";

  return {
    contentLanguage,
    userSettings: snapshot.userSettings,
    environmentContentLanguage: environmentContentLanguage ?? null
  };
}

export function getWeeklyRecapResponse(persistenceStore, nowValue, contentLanguage) {
  const now = parseOptionalDate(nowValue);
  const weekStart = getMostRecentCompletedIsoWeekStart(now);
  const recapId = buildWeeklyRecapId(weekStart);
  let snapshot = persistenceStore.getSnapshot();
  const existing = snapshot.weeklyRecaps.find((record) => record.id === recapId);

  if (existing) {
    return {
      recap: existing,
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  const recap = buildWeeklyRecap(
    {
      posts: snapshot.posts,
      reviewStates: snapshot.reviewStates,
      interactionSignals: snapshot.interactionSignals,
      topicStates: snapshot.topicStates,
      contentLanguage
    },
    weekStart
  );

  if (!recap) {
    return {
      recap: null,
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  snapshot = persistenceStore.saveWeeklyRecaps([recap], now);

  return {
    recap: snapshot.weeklyRecaps.find((record) => record.id === recap.id) ?? recap,
    snapshotSummary: summarizeSnapshot(snapshot)
  };
}

export function markWeeklyRecapSeen(persistenceStore, body) {
  const now = typeof body.seenAt === "string" ? body.seenAt : new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const id =
    typeof body.id === "string" && body.id.trim()
      ? body.id.trim()
      : buildWeeklyRecapId(getMostRecentCompletedIsoWeekStart(typeof body.now === "string" ? body.now : now));
  const existing = snapshot.weeklyRecaps.find((record) => record.id === id);

  if (!existing) {
    return null;
  }

  const nextRecord = {
    ...existing,
    seenAt: existing.seenAt ?? now,
    dismissedAt: body.dismissed ? existing.dismissedAt ?? now : existing.dismissedAt
  };
  const nextSnapshot = persistenceStore.saveWeeklyRecaps([nextRecord], now);

  return {
    recap: nextSnapshot.weeklyRecaps.find((record) => record.id === id) ?? nextRecord,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

function sanitizeSourceImportRecordForResponse(record) {
  return record?.errorMessage ? { ...record, errorMessage: "Source import failed." } : record;
}

export function sanitizeSourceImportResultForResponse(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  return {
    ...result,
    ...(Array.isArray(result.posts) ? { posts: result.posts.map(sanitizePostForResponse) } : {}),
    ...(result.errorMessage ? { errorMessage: "Source import failed." } : {}),
    ...(result.importRecord
      ? { importRecord: sanitizeSourceImportRecordForResponse(result.importRecord) }
      : {})
  };
}

export function sanitizePostForResponse(post) {
  if (!post || typeof post.recommendedBecause !== "string") {
    return post;
  }

  // Legacy records predate the beyond-source marker, so match with it stripped.
  const unmarkedReason = post.recommendedBecause.replace(/^\s*\[(?:beyond source|超出来源)\]\s*/i, "");

  if (unmarkedReason.startsWith("No better source was found, so this same-source follow-up was generated after")) {
    return {
      ...post,
      recommendedBecause: "[beyond source] No better source was found, so this same-source follow-up was generated."
    };
  }

  if (unmarkedReason.startsWith("没找到更好的来源,所以先基于《")) {
    return {
      ...post,
      recommendedBecause: "[超出来源] 没找到可用的新来源,所以生成了同源跟进卡。"
    };
  }

  return post;
}

export function sanitizeCurationRecordForResponse(record, logCause = true) {
  const { workerId: _workerId, ...publicRecord } = record;
  const sanitizedRecord = sanitizeFailedCurationRecord(publicRecord, logCause);

  if (!sanitizedRecord.result?.sourceImport) {
    return sanitizedRecord;
  }

  return {
    ...sanitizedRecord,
    result: {
      ...sanitizedRecord.result,
      sourceImport: sanitizeSourceImportResultForResponse(sanitizedRecord.result.sourceImport)
    }
  };
}

export function sanitizeSubscriptionRecordForResponse(record) {
  return record?.lastError ? { ...record, lastError: "Subscription poll failed." } : record;
}

/**
 * Per-page-load rotation seed. Anything longer than 64 characters or outside
 * `[A-Za-z0-9_-]` is dropped rather than rejected, so a stale or hand-edited
 * query string still returns the plain deterministic timeline.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function parseOptionalSessionSeed(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    return undefined;
  }

  return value;
}

/**
 * @param {import("../../../../packages/core/dist/index.js").ContentLanguage} contentLanguage
 * @param {unknown} [sessionSeedValue]
 */
export function getTimelineResponse(
  snapshot,
  nowValue,
  userId = "local-user",
  contentLanguage = "zh",
  curationStore,
  sessionSeedValue
) {
  const now = nowValue ? new Date(nowValue) : new Date();
  const releasePlans = snapshot.releasePlans;
  const releaseItems = releasePlans.flatMap((plan) => plan.items);
  const releasedPostIds = new Set(
    releaseItems
      .filter((item) => item.status === "ready_now" || (item.status === "queued" && item.releaseAt && new Date(item.releaseAt) <= now))
      .map((item) => item.postId)
  );
  const plannedPostIds = new Set(releaseItems.map((item) => item.postId));
  const posts = releaseItems.length
    ? snapshot.posts.filter((post) => releasedPostIds.has(post.id) || !plannedPostIds.has(post.id))
    : snapshot.posts;
  const hardDismissedPostIds = getHardDismissedPostIds(snapshot.dismissedPosts);
  const dueReviewStates = getDueReviewStates(snapshot.reviewStates, now).filter(
    (state) => !hardDismissedPostIds.has(state.postId)
  );
  const dueReviewStateByPostId = new Map(dueReviewStates.map((state) => [state.postId, state]));
  const dueReviewPostIds = dueReviewStates.map((state) => state.postId);
  const dueReviewPostIdSet = new Set(dueReviewPostIds);
  const reviewPosts = snapshot.posts.filter((post) => dueReviewPostIdSet.has(post.id));
  const candidatePosts = dedupePostsById([...posts, ...reviewPosts]);
  const interactionSignals = snapshot.interactionSignals;
  const lifecyclePosts = filterTimelineLifecycle({
    posts: candidatePosts,
    interactionSignals,
    dismissedPosts: snapshot.dismissedPosts,
    dueReviewPostIds,
    restingReviewPostIds: getRestingReviewStates(snapshot.reviewStates, now).map((state) => state.postId),
    now
  });
  const memoryRecord = snapshot.userMemories.find((record) => record.userId === userId);
  const activeGoalBlockTopics = collectActiveLearningGoalBlockTopics(snapshot, userId);
  const rankedPosts = rankPersonalizedTimeline({
    cards: lifecyclePosts,
    memory: memoryRecord?.memory,
    topicStates: snapshot.topicStates,
    recentSignals: interactionSignals,
    dueReviewPostIds,
    conceptAliases: snapshot.conceptAliases,
    learningGoalConcepts: collectActiveLearningGoalConcepts(snapshot, userId),
    contentLanguage,
    now,
    sessionSeed: parseOptionalSessionSeed(sessionSeedValue)
  }).map((post) => {
    const dueReviewState = dueReviewStateByPostId.get(post.id);

    return dueReviewState ? { ...post, reviewDueAt: dueReviewState.dueAt } : post;
  });
  const blockTopicsByPostId = assignCardBlockTopics(rankedPosts, activeGoalBlockTopics, snapshot.conceptAliases);
  const topicDwellMs = aggregateTodayDwellMsByBlockTopic({
    snapshot,
    now,
    activeGoalBlockTopics
  });
  const timelineArrangement = arrangeTimelineBlocks({
    cards: rankedPosts,
    blockTopicsByPostId,
    topicDwellMs,
    interleavedPostIds: dueReviewPostIds
  });
  const arrangedPosts = flattenTimelineArrangement(timelineArrangement);

  return {
    posts: enrichPostsMedia(snapshot, arrangedPosts).map(sanitizePostForResponse),
    timelineBlocks: timelineArrangement.blocks.map((block) => ({
      id: block.id,
      topic: block.topic,
      divider: block.divider,
      postIds: block.postIds,
      score: block.score,
      highestScore: block.highestScore,
      dwellBoost: block.dwellBoost
    })),
    sourceImports: snapshot.sourceImports.map(sanitizeSourceImportRecordForResponse),
    releasePlans,
    topicStates: snapshot.topicStates,
    supplyStatus: curationStore ? getSupplyStatus(snapshot, curationStore, now) : undefined,
    recommendationSummary: summarizeRecommendation(rankedPosts),
    snapshotSummary: summarizeSnapshot(snapshot)
  };
}

function collectActiveLearningGoalBlockTopics(snapshot, userId = "local-user") {
  return snapshot.learningGoals
    .filter((record) => record.status === "active")
    .flatMap((record) => {
      const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);

      if (!treeResult.tree) {
        return [];
      }

      return [
        {
          id: record.id,
          label: treeResult.tree.goalConcept || record.concept,
          conceptIds: treeResult.tree.nodes.map((node) => node.concept),
          progressPercent: treeResult.tree.progress.percent,
          createdAt: record.createdAt
        }
      ];
    });
}

function aggregateTodayDwellMsByBlockTopic({ snapshot, now, activeGoalBlockTopics }) {
  const date = getDayKey(normalizeIsoDate(now));
  const postById = new Map(snapshot.posts.map((post) => [post.id, post]));
  const dwellByPost = new Map();

  for (const signal of coalesceInteractionSignals(snapshot.interactionSignals)) {
    const createdAt = signal.createdAt;

    if (!createdAt || getDayKey(createdAt) !== date) {
      continue;
    }

    const dwellTimeMs = Number.isFinite(signal.dwellTimeMs)
      ? Math.min(120000, Math.max(0, signal.dwellTimeMs))
      : 0;

    if (dwellTimeMs <= 0) {
      continue;
    }

    dwellByPost.set(signal.postId, { dwellTimeMs, fallbackTopicId: signal.topicId || "general" });
  }

  /** @type {Record<string, number>} */
  const dwellMsByTopic = {};

  for (const [postId, { dwellTimeMs, fallbackTopicId }] of dwellByPost) {
    const post = postById.get(postId);
    const topic = post
      ? assignCardBlockTopics([post], activeGoalBlockTopics, snapshot.conceptAliases)[post.id]
      : {
          id: fallbackTopicId,
          label: fallbackTopicId,
          source: "card_topic"
        };

    dwellMsByTopic[topic.id] = (dwellMsByTopic[topic.id] ?? 0) + dwellTimeMs;
  }

  return dwellMsByTopic;
}

function flattenTimelineArrangement(arrangement) {
  return arrangement.items.flatMap((item) => {
    if (item.kind === "card") {
      return [
        {
          ...item.card,
          blockTopic: item.blockTopic
        }
      ];
    }

    return item.block.cards.map((card, index) => ({
      ...card,
      blockTopic: item.block.topic,
      timelineBlockId: item.block.id,
      timelineDivider: index === 0 ? item.block.divider : undefined
    }));
  });
}

export function getDismissedPostsResponse(snapshot, nowValue) {
  const now = nowValue ? new Date(nowValue) : new Date();

  return {
    records: snapshot.dismissedPosts
      .map((record) => {
        const post = snapshot.posts.find((candidate) => candidate.id === record.postId);
        const autoReturnAt = record.mode === "soft" ? getSoftDismissalReturnAt(record).toISOString() : null;
        const daysUntilReturn = autoReturnAt
          ? Math.max(0, Math.ceil((new Date(autoReturnAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
          : null;

        return {
          id: record.postId,
          postId: record.postId,
          title: post?.title ?? record.postId,
          mode: record.mode,
          dismissedAt: record.dismissedAt,
          autoReturnAt,
          daysUntilReturn,
          isActive: isTimelineDismissalActive(record, now)
        };
      })
      .sort((a, b) => b.dismissedAt.localeCompare(a.dismissedAt))
  };
}

export function getNotificationsResponse(snapshot) {
  const dismissedPostIds = new Set(snapshot.dismissedPosts.map((record) => record.postId));

  return {
    records: [...snapshot.notifications]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((notification) => ({
        ...sanitizeNotificationRecordForResponse(notification),
        supportPosts: notification.postIds.map((postId) => {
          const post = snapshot.posts.find((candidate) => candidate.id === postId);

          return {
            id: postId,
            title: post?.title ?? postId,
            dismissed: dismissedPostIds.has(postId),
            missing: !post
          };
        })
      }))
  };
}

export function sanitizeNotificationRecordForResponse(notification) {
  if (notification?.kind !== "research_progress" || typeof notification.body !== "string") {
    return notification;
  }

  const failureTemplates = [
    {
      prefix: "Source search failed before any importable candidate was found:",
      body: researchCopy("en", "searchFailed", { detail: "Source discovery failed." })
    },
    {
      prefix: "Research finished, but every imported source failed or was blocked by validation:",
      body: researchCopy("en", "importFailed", { detail: "Source import failed." })
    },
    {
      prefix: "来源搜索失败,还没有找到可导入候选:",
      body: researchCopy("zh", "searchFailed", { detail: "Source discovery failed." })
    },
    {
      prefix: "研究已完成,但导入的来源都没有通过门禁或导入失败:",
      body: researchCopy("zh", "importFailed", { detail: "Source import failed." })
    }
  ];
  const safeFailure = failureTemplates.find(({ prefix }) => notification.body.startsWith(prefix));

  return safeFailure ? { ...notification, body: safeFailure.body } : notification;
}

export function parseDismissedPostMode(value) {
  if (value === undefined) {
    return "soft";
  }

  if (value === "soft" || value === "hard") {
    return value;
  }

  throw new HttpError(400, "dismiss mode must be \"soft\" or \"hard\".");
}

export function upsertDismissedPostRecord(records, nextRecord) {
  const byPostId = new Map(records.map((record) => [record.postId, record]));

  byPostId.set(nextRecord.postId, nextRecord);

  return Array.from(byPostId.values());
}

// 卡片的 media 只存 assetId;对外返回时补上 registry 里图片资产的 url 和图号,前端才能直接渲染。
function enrichPostsMedia(snapshot, posts) {
  const imageAssetsById = new Map();

  for (const record of snapshot.sourceRegistries) {
    for (const asset of record.registry?.assets ?? []) {
      if (asset.kind === "image") {
        imageAssetsById.set(asset.id, asset);
      }
    }
  }

  if (!imageAssetsById.size) {
    return posts;
  }

  return posts.map((post) => {
    if (!Array.isArray(post.media) || !post.media.length) {
      return post;
    }

    return {
      ...post,
      media: post.media.map((item) => {
        const asset = imageAssetsById.get(item.assetId);

        return asset ? { ...item, url: asset.url, figureLabel: asset.figureLabel } : item;
      })
    };
  });
}

export function getEvidenceLedgerResponse(snapshot, postId) {
  const post = snapshot.posts.find((item) => item.id === postId);

  if (!post) {
    return undefined;
  }

  const registry = findSourceRegistryForPost(snapshot, post);

  if (!registry) {
    return undefined;
  }

  return {
    ledger: createEvidenceLedger(post, registry),
    validation: snapshot.validation.find((record) => record.postId === post.id)?.result
  };
}

function findSourceRegistryForPost(snapshot, post) {
  const sourceIds = new Set(post.sources.map((source) => source.id));
  const registries = snapshot.sourceRegistries
    .filter(
      (record) =>
        sourceIds.has(record.sourceId) || record.registry.sources.some((source) => sourceIds.has(source.id))
    )
    .map((record) => record.registry);

  if (registries.length === 0) {
    return undefined;
  }

  return registries.length === 1 ? registries[0] : mergeSourceRegistries(...registries);
}

export function sanitizeSnapshotForResponse(snapshot) {
  return {
    ...snapshot,
    posts: snapshot.posts.map(sanitizePostForResponse),
    sourceImports: snapshot.sourceImports.map(sanitizeSourceImportRecordForResponse),
    curationJobs: snapshot.curationJobs.map((record) => sanitizeCurationRecordForResponse(record, false)),
    subscriptions: snapshot.subscriptions.map(sanitizeSubscriptionRecordForResponse),
    sourceCandidates: snapshot.sourceCandidates.map(sanitizeSourceCandidateRecordForResponse),
    notifications: snapshot.notifications.map(sanitizeNotificationRecordForResponse)
  };
}


function summarizeRecommendation(posts) {
  const byIntent = {};

  for (const post of posts) {
    const intent = post.recommendationIntent ?? "explore";
    byIntent[intent] = (byIntent[intent] ?? 0) + 1;
  }

  return {
    total: posts.length,
    byIntent,
    topReasons: posts.flatMap((post) => post.scoreReasons ?? []).slice(0, 6)
  };
}
