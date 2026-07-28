// @ts-check

import {
  applyDailyAutoJobBudget,
  fetchChannelUploads,
  getDayKey,
  normalizeConceptKey,
  normalizeSubscriptionFeedUrl,
  parseSubscriptionFeed
} from "../../../../packages/core/dist/index.js";
import {
  HttpError,
  buildSourceId,
  createSingleJobPlan,
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  hashText,
  normalizeIsoDate,
  normalizeStringArray,
  parseHttpUrl,
  requireString,
  roundScore,
  summarizeSnapshot,
  tokenizeText
} from "./shared.mjs";
import { collectKnownSourceUrls } from "./importSettlement.mjs";
import { getActiveImportSourceCandidateIds, getBudgetRemaining } from "./supply.mjs";

const backlogAutoBatchLimit = 3;
const backlogDailyLimit = 8;

export async function handleCreateSubscription(body, persistenceStore, fetchImpl) {
  const inputUrl = body.url ?? body.feedUrl;

  requireString(inputUrl, "url");

  if (!fetchImpl) {
    throw new HttpError(500, "Feed fetch is not available.");
  }

  const normalized = await normalizeSubscriptionFeedUrl(inputUrl, { fetch: fetchImpl });
  let parsedFeed;

  try {
    parsedFeed = await fetchAndParseSubscriptionFeed(normalized.feedUrl, fetchImpl);
  } catch {
    // YouTube's RSS endpoint 404s transiently; ride out one blip before
    // failing the whole creation.
    await new Promise((resolve) => setTimeout(resolve, 500));
    parsedFeed = await fetchAndParseSubscriptionFeed(normalized.feedUrl, fetchImpl);
  }

  const now = new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const existing = snapshot.subscriptions.find(
    (record) => normalizeUrlKey(record.feedUrl) === normalizeUrlKey(normalized.feedUrl)
  );
  const record = {
    id: existing?.id ?? `subscription-${hashText(normalized.feedUrl)}`,
    kind: normalized.kind,
    feedUrl: normalized.feedUrl,
    siteUrl: normalized.siteUrl ?? parsedFeed.siteUrl,
    title: normalizeSubscriptionTitle(body.title, parsedFeed.title, normalized.feedUrl),
    filterMode: normalizeSubscriptionFilterModeForApi(body.filterMode, existing?.filterMode ?? "relevant"),
    createdAt: existing?.createdAt ?? now,
    lastPolledAt: existing?.lastPolledAt,
    lastItemPublishedAt: existing?.lastItemPublishedAt,
    lastError: undefined
  };
  const nextSnapshot = persistenceStore.saveSubscriptions([record], now);

  return {
    record: nextSnapshot.subscriptions.find((item) => item.id === record.id) ?? record,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

export function handleUpdateSubscription(subscriptionId, body, persistenceStore) {
  const filterMode = normalizeSubscriptionFilterModeForApi(body.filterMode, undefined, true);
  const snapshot = persistenceStore.getSnapshot();
  const record = snapshot.subscriptions.find((item) => item.id === subscriptionId);

  if (!record) {
    throw new HttpError(404, "Subscription not found.");
  }

  const now = new Date().toISOString();
  const nextRecord = {
    ...record,
    filterMode
  };
  const nextSnapshot = persistenceStore.saveSubscriptions([nextRecord], now);

  return {
    record: nextSnapshot.subscriptions.find((item) => item.id === subscriptionId) ?? nextRecord,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

export async function fetchAndParseSubscriptionFeed(feedUrl, fetchImpl) {
  let response;

  try {
    // Polling runs inside page-driven /api/curation/run; a hanging feed host
    // must not block it until the OS-level TCP timeout.
    response = await fetchImpl(feedUrl, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new HttpError(400, "Feed URL request failed.", { cause: error });
  }

  if (!response.ok) {
    throw new HttpError(400, `Feed URL request failed with ${response.status}.`);
  }

  const xml = await response.text();
  const parsed = parseSubscriptionFeed(xml, feedUrl);

  if (parsed.error) {
    console.error("[aitimeline] subscription feed parsing failed.", parsed.error);
    throw new HttpError(400, "Feed is not valid.");
  }

  return parsed;
}

function getSubscriptionChannelId(subscription) {
  try {
    const channelId = new URL(subscription.feedUrl).searchParams.get("channel_id");

    return channelId && /^UC[A-Za-z0-9_-]{20,}$/.test(channelId) ? channelId : undefined;
  } catch {
    return undefined;
  }
}

function buildYouTubeWatchUrl(videoId) {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);

  return url.toString();
}

export async function fetchUploadsFallbackFeed(subscription, fetchImpl) {
  const channelId = subscription.kind === "youtube_channel" ? getSubscriptionChannelId(subscription) : undefined;

  if (!channelId) {
    return undefined;
  }

  try {
    const uploads = await fetchChannelUploads(channelId, { fetch: fetchImpl, maxPages: 1 });

    return {
      entries: uploads.videos.slice(0, 15).map((video) => ({
        title: video.title,
        link: buildYouTubeWatchUrl(video.videoId),
        publishedAt: undefined,
        summary: undefined,
        kind: "youtube"
      })),
      kind: "youtube"
    };
  } catch (error) {
    console.error(`[aitimeline] uploads fallback poll failed (${subscription.id}).`, error);
    return undefined;
  }
}

function createBacklogSourceCandidate(subscription, video, now) {
  let parsedUrl;

  try {
    parsedUrl = parseHttpUrl(buildYouTubeWatchUrl(video.videoId));
  } catch {
    return null;
  }

  const source = {
    id: buildSourceId("youtube", parsedUrl),
    title: video.title,
    url: parsedUrl.toString(),
    type: "youtube"
  };

  return {
    id: `subscription-${subscription.id}-${hashText(source.url)}`,
    source,
    topicId: subscription.title,
    conceptIds: [subscription.title],
    relevanceScore: 0.55,
    noveltyScore: 0.6,
    qualityScore: 0.7,
    reason: `Channel backlog of "${subscription.title}": ${video.title}`.slice(0, 220),
    discoveredAt: now
  };
}

export async function catalogSubscriptionBacklog({ subscriptionId, persistenceStore, fetchImpl, now }) {
  const snapshot = persistenceStore.getSnapshot();
  const subscription = snapshot.subscriptions.find((record) => record.id === subscriptionId);

  if (!subscription) {
    throw new HttpError(404, "Subscription not found.");
  }

  const channelId = getSubscriptionChannelId(subscription);

  if (subscription.kind !== "youtube_channel" || !channelId) {
    throw new HttpError(400, "Backlog cataloging is only available for YouTube channel subscriptions.");
  }

  if (!fetchImpl) {
    throw new HttpError(500, "Feed fetch is not available.");
  }

  let uploads;

  try {
    uploads = await fetchChannelUploads(channelId, { fetch: fetchImpl });
  } catch (error) {
    console.error(`[aitimeline] channel backlog catalog failed (${subscription.id}).`, error);
    throw new HttpError(400, "Channel uploads could not be fetched.");
  }

  const nowIso = normalizeIsoDate(now);
  const existingById = new Map(snapshot.sourceCandidates.map((record) => [record.id, record]));
  const knownUrlKeys = new Set(collectKnownSourceUrls(snapshot).map(normalizeUrlKey));
  const records = [];
  let created = 0;
  // Uploads arrive newest first; backlogOrder counts from the oldest video so
  // batches digest the channel in course order.
  const orderedOldestFirst = [...uploads.videos].reverse();

  orderedOldestFirst.forEach((video, order) => {
    const candidate = createBacklogSourceCandidate(subscription, video, nowIso);

    if (!candidate) {
      return;
    }

    const existing = existingById.get(candidate.id);

    if (existing) {
      if (existing.subscriptionId !== subscription.id || existing.backlogOrder !== order) {
        records.push({ ...existing, subscriptionId: subscription.id, backlogOrder: order, updatedAt: nowIso });
      }
      return;
    }

    if (knownUrlKeys.has(normalizeUrlKey(candidate.source.url))) {
      return;
    }

    created += 1;
    records.push({
      id: candidate.id,
      candidate,
      status: "pending",
      intakeKind: "subscription",
      createdAt: nowIso,
      updatedAt: nowIso,
      notes: subscription.title,
      subscriptionId: subscription.id,
      backlogOrder: order
    });
  });

  if (records.length) {
    persistenceStore.saveSourceCandidateRecords(records, nowIso);
  }

  const nextRecord = {
    ...subscription,
    backlog: {
      catalogedAt: nowIso,
      videoCount: uploads.videos.length,
      ...(uploads.truncated ? { truncated: true } : {})
    }
  };
  const nextSnapshot = persistenceStore.saveSubscriptions([nextRecord], nowIso);

  return {
    record: nextSnapshot.subscriptions.find((record) => record.id === subscription.id) ?? nextRecord,
    created,
    videoCount: uploads.videos.length,
    truncated: Boolean(uploads.truncated),
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

export function getSubscriptionBacklogResponse(subscriptionId, persistenceStore) {
  const snapshot = persistenceStore.getSnapshot();
  const subscription = snapshot.subscriptions.find((record) => record.id === subscriptionId);

  if (!subscription) {
    throw new HttpError(404, "Subscription not found.");
  }

  const entries = snapshot.sourceCandidates
    .filter((record) => record.subscriptionId === subscriptionId && typeof record.backlogOrder === "number")
    .sort((left, right) => left.backlogOrder - right.backlogOrder)
    .map((record) => ({
      candidateId: record.id,
      title: record.candidate.source.title,
      url: record.candidate.source.url,
      order: record.backlogOrder,
      status: record.status,
      prioritized: Boolean(record.prioritizedAt) && record.status === "pending"
    }));
  const summary = { total: entries.length, imported: 0, queued: 0, pending: 0, skipped: 0, failed: 0 };

  for (const entry of entries) {
    if (entry.status === "imported") summary.imported += 1;
    else if (entry.status === "queued") summary.queued += 1;
    else if (entry.status === "pending") summary.pending += 1;
    else if (entry.status === "skipped") summary.skipped += 1;
    else summary.failed += 1;
  }

  return {
    subscriptionId,
    backlog: subscription.backlog,
    entries,
    summary
  };
}

function compareBacklogRecords(left, right) {
  const leftPrioritized = typeof left.prioritizedAt === "string";
  const rightPrioritized = typeof right.prioritizedAt === "string";

  if (leftPrioritized !== rightPrioritized) {
    return leftPrioritized ? -1 : 1;
  }

  if (leftPrioritized && rightPrioritized && left.prioritizedAt !== right.prioritizedAt) {
    return left.prioritizedAt.localeCompare(right.prioritizedAt);
  }

  return left.backlogOrder - right.backlogOrder;
}

function countBacklogImportJobsForDay(curationStore, nowIso) {
  const dayKey = getDayKey(nowIso, process.env.AITIMELINE_TIMEZONE);

  return curationStore
    .list()
    .filter(
      (record) =>
        record.job.kind === "import_source" &&
        typeof record.job.id === "string" &&
        record.job.id.startsWith("subscription-backlog-import-") &&
        getDayKey(record.job.createdAt, process.env.AITIMELINE_TIMEZONE) === dayKey
    ).length;
}

function createBacklogImportJob(subscription, candidate, now, contentLanguage) {
  return {
    id: `subscription-backlog-import-${hashText(`${subscription.id}|${candidate.id}`)}`,
    kind: "import_source",
    topicId: candidate.topicId ?? subscription.title,
    conceptIds: candidate.conceptIds,
    priority: 0.6,
    reason:
      contentLanguage === "en"
        ? `You asked to learn the backlog of "${subscription.title}", so this video is being imported: ${candidate.source.title}`
        : `你要学习订阅「${subscription.title}」的存量视频,正在导入:${candidate.source.title}`,
    createdAt: now,
    runAfter: now,
    sourceCandidate: candidate
  };
}

export function digestSubscriptionBacklog({ persistenceStore, curationStore, subscription, limit, contentLanguage, now }) {
  const nowIso = normalizeIsoDate(now);
  const snapshot = persistenceStore.getSnapshot();
  const activeCandidateIds = getActiveImportSourceCandidateIds(curationStore);
  const dailyRemaining = Math.max(0, backlogDailyLimit - countBacklogImportJobsForDay(curationStore, nowIso));
  const selectedRecords = snapshot.sourceCandidates
    .filter((record) => record.subscriptionId === subscription.id && typeof record.backlogOrder === "number")
    .filter((record) => record.status === "pending")
    .filter((record) => !activeCandidateIds.has(record.candidate.id))
    .sort(compareBacklogRecords)
    .slice(0, Math.max(0, Math.min(limit, dailyRemaining)));

  if (!selectedRecords.length) {
    return {
      queued: 0,
      skipped: 0,
      budgetRemaining: getBudgetRemaining(snapshot, nowIso),
      dailyRemaining
    };
  }

  const rawPlan = createSingleJobPlan(
    selectedRecords.map((record) => createBacklogImportJob(subscription, record.candidate, nowIso, contentLanguage)),
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
    budgetRemaining: getBudgetRemaining(nextSnapshot, nowIso),
    dailyRemaining: Math.max(0, dailyRemaining - queuedCandidateRecords.length)
  };
}

export function digestDueSubscriptionBacklogs({ persistenceStore, curationStore, contentLanguage, now }) {
  const subscriptions = persistenceStore.getSnapshot().subscriptions.filter((record) => record.backlog);
  let queued = 0;
  let skipped = 0;

  for (const subscription of subscriptions) {
    const result = digestSubscriptionBacklog({
      persistenceStore,
      curationStore,
      subscription,
      limit: backlogAutoBatchLimit,
      contentLanguage,
      now
    });

    queued += result.queued;
    skipped += result.skipped;
  }

  return { queued, skipped };
}

function normalizeSubscriptionTitle(inputTitle, feedTitle, feedUrl) {
  if (typeof inputTitle === "string" && inputTitle.trim()) {
    return inputTitle.trim();
  }

  if (typeof feedTitle === "string" && feedTitle.trim()) {
    return feedTitle.trim();
  }

  try {
    return new URL(feedUrl).hostname;
  } catch {
    return "Subscription";
  }
}

function normalizeSubscriptionFilterModeForApi(value, fallback = "relevant", required = false) {
  if (value === "all" || value === "relevant" || value === "listOnly") {
    return value;
  }

  if (required) {
    throw new HttpError(400, "filterMode must be all, relevant, or listOnly.");
  }

  return fallback;
}

export function selectDueSubscriptions(subscriptions, nowValue, limit) {
  const now = new Date(nowValue);
  const pollIntervalMs = 6 * 60 * 60 * 1000;

  return subscriptions
    .filter((subscription) => {
      if (!subscription.lastPolledAt) {
        return true;
      }

      const lastPolledAt = new Date(subscription.lastPolledAt);

      return Number.isNaN(lastPolledAt.getTime()) || now.getTime() - lastPolledAt.getTime() >= pollIntervalMs;
    })
    .sort((left, right) => {
      const leftTime = left.lastPolledAt ? new Date(left.lastPolledAt).getTime() : 0;
      const rightTime = right.lastPolledAt ? new Date(right.lastPolledAt).getTime() : 0;

      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }

      return left.createdAt.localeCompare(right.createdAt);
    })
    .slice(0, limit);
}

export function selectNewSubscriptionEntries(entries, subscription, knownUrlKeys) {
  const lastItemTime = subscription.lastItemPublishedAt
    ? new Date(subscription.lastItemPublishedAt).getTime()
    : Number.NEGATIVE_INFINITY;

  return entries
    .filter((entry) => entry.link && !knownUrlKeys.has(normalizeUrlKey(entry.link)))
    .filter((entry) => {
      if (!entry.publishedAt) {
        return true;
      }

      const publishedTime = new Date(entry.publishedAt).getTime();

      return Number.isNaN(publishedTime) || publishedTime > lastItemTime;
    })
    .sort((left, right) => {
      const leftTime = left.publishedAt ? new Date(left.publishedAt).getTime() : 0;
      const rightTime = right.publishedAt ? new Date(right.publishedAt).getTime() : 0;

      return rightTime - leftTime;
    });
}

export function maxIsoDate(values) {
  const dates = values
    .filter((value) => typeof value === "string" && value)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  return dates[0]?.toISOString();
}

export function scoreSubscriptionEntryRelevance(entry, confirmedConcepts) {
  if (!confirmedConcepts.length) {
    return { passed: false, score: 0, concepts: [] };
  }

  const text = `${entry.title} ${entry.summary ?? ""}`.toLowerCase();
  const textTokens = tokenizeText(text);
  const scoredConcepts = confirmedConcepts
    .map((concept) => {
      const conceptKey = normalizeConceptKey(concept);
      const conceptTokens = Array.from(tokenizeText(conceptKey));

      if (!conceptKey || conceptTokens.length === 0) {
        return { concept, score: 0 };
      }

      if (text.includes(conceptKey)) {
        return { concept, score: 1 };
      }

      const overlap = conceptTokens.filter((token) => textTokens.has(token)).length;

      return {
        concept,
        score: overlap / conceptTokens.length
      };
    })
    .filter((item) => item.score >= 0.5)
    .sort((left, right) => right.score - left.score);
  const score = scoredConcepts[0]?.score ?? 0;

  return {
    passed: score >= 0.5,
    score: roundScore(score),
    concepts: scoredConcepts.slice(0, 4).map((item) => item.concept)
  };
}

export function createSubscriptionSourceCandidate({ subscription, entry, concepts, now, relevanceScore }) {
  let parsedUrl;

  try {
    parsedUrl = parseHttpUrl(entry.link);
  } catch {
    return null;
  }

  const type = entry.kind === "youtube" ? "youtube" : "article";
  const source = {
    id: buildSourceId(type, parsedUrl),
    title: entry.title || subscription.title,
    url: parsedUrl.toString(),
    type,
    publishedAt: entry.publishedAt
  };
  const conceptIds = normalizeStringArray(concepts);
  const topicId = conceptIds[0] ?? subscription.title;

  return {
    id: `subscription-${subscription.id}-${hashText(source.url)}`,
    source,
    topicId,
    conceptIds,
    relevanceScore: Math.max(0.52, relevanceScore || 0.52),
    noveltyScore: 0.66,
    qualityScore: 0.72,
    reason: entry.summary
      ? `Subscription "${subscription.title}" published this item: ${entry.summary.slice(0, 180)}`
      : `Subscription "${subscription.title}" published this item.`,
    discoveredAt: now
  };
}

export function createSubscriptionImportJob(subscription, candidate, now, contentLanguage) {
  return {
    id: `subscription-import-${hashText(`${subscription.id}|${candidate.id}`)}`,
    kind: "import_source",
    topicId: candidate.topicId ?? subscription.title,
    conceptIds: candidate.conceptIds,
    priority: subscription.filterMode === "all" ? 0.7 : 0.64,
    reason:
      contentLanguage === "en"
        ? `Subscription "${subscription.title}" produced a new source: ${candidate.reason}`
        : `订阅「${subscription.title}」出现了新来源:${candidate.reason}`,
    createdAt: now,
    runAfter: now,
    sourceCandidate: candidate
  };
}

export function normalizeUrlKey(value) {
  try {
    const url = new URL(value);

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    return url.toString().replace(/\/$/, "");
  } catch {
    return typeof value === "string" ? value.trim() : "";
  }
}
