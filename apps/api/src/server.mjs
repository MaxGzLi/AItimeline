import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyUserMemoryEdits,
  askGrounded,
  advanceReviewState,
  addConceptAliasDecision,
  buildConceptDigest,
  buildDiscoveryConfirmationQuestions,
  buildSkillTree,
  createConceptBriefInputFromCards,
  createAITimelinePersistenceStore,
  createMemoryRevisionedStorageAdapter,
  applyDailyAutoJobBudget,
  createBackgroundCurationPlan,
  createDeterministicConceptBrief,
  createConceptMergeSuggestion,
  createDeepReadArticle,
  createEmptyUserMemory,
  createInitialReviewState,
  createPersistentBackgroundCurationJobStore,
  evaluateMasteryPromotions,
  evaluateInteraction,
  getHardDismissedPostIds,
  getDueReviewStates,
  isPureExposureSignal,
  removeConceptAlias,
  parseContentLanguage,
  runConversationTurn,
  normalizeConceptKey,
  generateConceptBrief,
  runIdeaObservation,
  shouldRefreshConceptBrief,
  runSourceDiscovery,
  transformUserNote
} from "../../../packages/core/dist/index.js";
import { createGuardedFetch, GuardedFetchError } from "./guardedFetch.mjs";
import {
  catalogSubscriptionBacklog,
  createSubscriptionImportJob,
  createSubscriptionSourceCandidate,
  digestSubscriptionBacklog,
  fetchAndParseSubscriptionFeed,
  fetchUploadsFallbackFeed,
  getSubscriptionBacklogResponse,
  handleCreateSubscription,
  handleUpdateSubscription,
  maxIsoDate,
  normalizeUrlKey,
  scoreSubscriptionEntryRelevance,
  selectDueSubscriptions,
  selectNewSubscriptionEntries
} from "./domains/subscriptions.mjs";
import {
  createSourceCandidateRecord,
  dedupeSourceCandidates,
  findMatchingSourceCandidateRecords,
  queueSupplyRefill
} from "./domains/supply.mjs";
import {
  collectKnownSourceTitles,
  collectKnownSourceUrls,
  getKnowledgePosts,
  sanitizeSourceCandidateRecordForResponse
} from "./domains/importSettlement.mjs";
import {
  getCaptureContextResponse,
  handleCaptureConversation,
  handleCaptureSource
} from "./domains/capture.mjs";
import {
  HttpError,
  buildInteractionSignalRecordId,
  buildSourceQualityUserContext,
  createSingleJobPlan,
  deriveTopicState,
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  hashText,
  requireString,
  summarizeSnapshot,
  tokenizeText
} from "./domains/shared.mjs";
import {
  handleAgentAsk,
  handleAgentConfirm,
  handleDiscoveryRun,
  handleIdeaResearchRequest
} from "./domains/research.mjs";
import { handlePostReply, handleUserNote } from "./domains/notes.mjs";
import { handlePreferenceChat } from "./domains/preferences.mjs";
import {
  backfillLegacyReviewStates,
  buildReviewCompletionRecordId,
  buildReviewEventRecordId,
  createManualMasteryDemotionEvents,
  createReviewStateForGrade,
  createReviewedInteractionSignal,
  maybeCreateInitialReviewState,
  promoteMasteryAfterReview,
  selectReviewPrompt
} from "./domains/review.mjs";
import {
  handleArchiveLearningGoal,
  handleCreateLearningGoal,
  handleListLearningGoals
} from "./domains/learningGoals.mjs";
import {
  handleAsk,
  handleConceptBriefRequest,
  handleDeepReadRequest
} from "./domains/briefsDeepRead.mjs";
import {
  createConfiguredAskModelClient,
  createConfiguredDeepReadModelClients,
  createConfiguredSearchProvider,
  createConfiguredSourceImportWorker,
  resolveContentLanguage
} from "./domains/config.mjs";
import {
  importArticle,
  importYouTube,
  ingestSourceCandidate,
  persistImportAndReleasePlan,
  reconcileAndMaterializeCurationQueue
} from "./domains/importPipeline.mjs";
import {
  createEmptyCurationPlan,
  createNeutralExposureFeedback,
  createSafeSourceImportWorker,
  executeCurationRun
} from "./domains/curationRun.mjs";
import { getInjectCardsResponse } from "./domains/injectFeed.mjs";
import {
  getDismissedPostsResponse,
  getEvidenceLedgerResponse,
  getNotificationsResponse,
  getSettingsResponse,
  getTimelineResponse,
  getWeeklyRecapResponse,
  markWeeklyRecapSeen,
  parseDismissedPostMode,
  sanitizeCurationRecordForResponse,
  sanitizeNotificationRecordForResponse,
  sanitizePostForResponse,
  sanitizeSnapshotForResponse,
  sanitizeSourceImportResultForResponse,
  sanitizeSubscriptionRecordForResponse,
  upsertDismissedPostRecord
} from "./domains/responses.mjs";
import {
  findCoalescedDailySignal,
  shouldEnqueueCoalescedProduction,
  updateTopicStateFromCoalescedDelta
} from "./domains/signals.mjs";
import { createFileStorageAdapter } from "./lib/fileStorage.mjs";
import { fixtureArticleHtml, fixtureSubscriptionFeedXml } from "./lib/fixtures.mjs";
import {
  createBindingSecurity,
  getRequestOrigin,
  hasValidApiToken,
  readJsonBody,
  rejectOversizedContentLength,
  resolveCorsOrigins,
  safelyDrainRequest,
  sendHtml,
  sendJson,
  sendMediaFile,
  sendXml
} from "./lib/http.mjs";
import {
  parseOptionalIdempotencyKey,
  parseOptionalUserId,
  parseReviewGrade,
  requireInteractionSignal,
  requireIsoDate,
  requireSupportedSourceCandidates,
  requireTopicState
} from "./lib/validate.mjs";

const defaultPort = 8787;
const defaultWorkerIntervalMs = 60000;
const minimumConfiguredWorkerIntervalMs = 5000;
const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(currentDir, "../data/aitimeline.json");
const defaultCurationDataPath = resolve(currentDir, "../data/curation-jobs.json");
const defaultMediaRoot = resolve(currentDir, "../data/media");
const backlogManualBatchLimit = 5;

export function createApiServer(options = {}) {
  const bindingHost = options.host ?? process.env.AITIMELINE_HOST ?? "127.0.0.1";
  const authToken = options.authToken ?? process.env.AITIMELINE_AUTH_TOKEN;
  const security = createBindingSecurity(bindingHost, authToken);
  const corsOrigins = resolveCorsOrigins(options.corsOrigins, process.env.AITIMELINE_CORS_ORIGINS);
  const guardedFetchImpl = options.guardedFetch ?? createGuardedFetch(options.guardedFetchOptions);
  const ingestSource = (candidate) => ingestSourceCandidate(candidate, guardedFetchImpl);
  const dataPath = options.dataPath ?? process.env.AITIMELINE_DATA_PATH ?? defaultDataPath;
  const curationDataPath =
    options.curationDataPath ?? process.env.AITIMELINE_CURATION_DATA_PATH ?? defaultCurationDataPath;
  const mediaRootDir = resolve(options.mediaRootDir ?? process.env.AITIMELINE_MEDIA_ROOT ?? defaultMediaRoot);
  const enableFixtures = options.enableFixtures ?? process.env.AITIMELINE_ENABLE_FIXTURES === "1";
  const ownerId = options.ownerId ?? randomUUID();
  const workerId = `${hostname()}:${process.pid}:${ownerId}`;
  const resources = [];
  let persistenceStore;
  let curationStore;
  try {
    const persistenceAdapter = createFileStorageAdapter(dataPath, { ownerId, backupCount: 3 });
    resources.push(persistenceAdapter);
    const curationAdapter = createFileStorageAdapter(curationDataPath, { ownerId, backupCount: 3 });
    resources.push(curationAdapter);
    persistenceStore = createAITimelinePersistenceStore(persistenceAdapter, undefined, {
      onLoadIssue: (issue) => console.warn("[aitimeline] persistence load issue", issue)
    });
    resources.push(persistenceStore);
    const queueSeedRecords = curationAdapter.read() ? [] : persistenceStore.getSnapshot().curationJobs;
    curationStore = createPersistentBackgroundCurationJobStore(curationAdapter, queueSeedRecords, {
      now: options.now,
      timeZone: process.env.AITIMELINE_TIMEZONE,
      onLoadIssue: (issue) => console.warn("[aitimeline] curation queue load issue", issue)
    });
    resources.push(curationStore);
    persistenceStore.flushMigration();
    curationStore.flushMigration?.();
    curationStore.recoverExpiredLeases(options.now ?? new Date());
  } catch (error) {
    for (const resource of resources.reverse()) {
      try { resource.close?.(); } catch { /* preserve original initialization error */ }
    }
    throw error;
  }
  const sourceImportWorker = createSafeSourceImportWorker(createConfiguredSourceImportWorker(process.env));
  const importRunner = sourceImportWorker.runner;
  const askModelClient = createConfiguredAskModelClient(process.env);
  const deepReadModelClients = createConfiguredDeepReadModelClients(process.env);
  const searchProvider = options.searchProvider ?? createConfiguredSearchProvider(process.env);
  const feedFetch = options.feedFetch ?? guardedFetchImpl;
  const workerIntervalMs = normalizeWorkerIntervalMs(options.workerIntervalMs);
  let workerEnabled = options.worker === true;
  let workerInterval = null;
  let workerLastRunAt;
  let workerLastRunSummary;
  // /api/curation/run executes synchronously and can take minutes, while the
  // manual endpoint and the timer can otherwise stack work on the same queue.
  let curationRunInFlightSince = null;
  const curationRunDeps = {
    persistenceStore,
    curationStore,
    feedFetch,
    sourceImportWorker,
    ingestSource,
    searchProvider,
    askModelClient,
    deepReadModelClients,
    workerId,
    env: process.env
  };
  const getWorkerStatus = () => ({
    enabled: workerEnabled,
    running: Boolean(curationRunInFlightSince),
    intervalMs: workerIntervalMs,
    ...(workerLastRunAt ? { lastRunAt: workerLastRunAt } : {}),
    ...(workerLastRunSummary ? { lastRunSummary: workerLastRunSummary } : {})
  });
  const runCurationWithGuard = async (runOptions) => {
    if (curationRunInFlightSince) {
      return { alreadyRunning: true, startedAt: curationRunInFlightSince };
    }

    curationRunInFlightSince = new Date().toISOString();

    try {
      const result = await executeCurationRun(curationRunDeps, runOptions);
      workerLastRunAt = result.completedAt;
      workerLastRunSummary = {
        processedJobs: result.records.length,
        refillQueued: result.supplyRefill.queued,
        subscriptionsChecked: result.subscriptionPolling.checked
      };
      return result;
    } finally {
      curationRunInFlightSince = null;
    }
  };
  const runWorkerTick = async () => {
    if (!workerEnabled || curationRunInFlightSince) {
      return;
    }

    try {
      await runCurationWithGuard({ limit: 4 });
    } catch (error) {
      console.error("[aitimeline] curation worker tick failed.", error);
    }
  };
  const stopWorkerInterval = () => {
    if (!workerInterval) return;
    clearInterval(workerInterval);
    workerInterval = null;
  };
  const startWorkerInterval = () => {
    if (!workerEnabled || workerInterval) return;
    workerInterval = setInterval(() => {
      void runWorkerTick();
    }, workerIntervalMs);
  };
  const setWorkerEnabled = (enabled) => {
    workerEnabled = enabled;

    if (enabled) {
      startWorkerInterval();
    } else {
      stopWorkerInterval();
    }
  };
  reconcileAndMaterializeCurationQueue(
    persistenceStore,
    curationStore,
    resolveContentLanguage(persistenceStore, process.env)
  );

  const server = createServer(async (request, response) => {
    const requestOrigin = request.headers.origin;
    if (typeof requestOrigin === "string" && corsOrigins.has(requestOrigin)) {
      response.setHeader("Access-Control-Allow-Origin", requestOrigin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type,authorization,x-aitimeline-token");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (rejectOversizedContentLength(request, response)) {
      return;
    }

    try {
      const url = new URL(request.url ?? "/", getRequestOrigin(request));

      if (url.pathname.startsWith("/api/") && security.requireAuth && !hasValidApiToken(request, security.authToken)) {
        sendJson(response, 401, { error: "API authentication is required.", code: "AUTH_REQUIRED" });
        return;
      }

      if (enableFixtures && request.method === "GET" && url.pathname === "/fixtures/article") {
        sendHtml(response, fixtureArticleHtml("Learning agents need a timeline surface"));
        return;
      }

      if (enableFixtures && request.method === "GET" && url.pathname === "/fixtures/article-background") {
        const query = url.searchParams.get("query");
        sendHtml(
          response,
          fixtureArticleHtml(query ? `Background source for ${query}` : "Background curation can prepare related sources")
        );
        return;
      }

      if (enableFixtures && request.method === "GET" && url.pathname === "/fixtures/subscription-feed") {
        sendXml(response, fixtureSubscriptionFeedXml(url.searchParams.get("variant") ?? "default"));
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "aitimeline-api" });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/media/")) {
        sendMediaFile(response, mediaRootDir, url.pathname);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/snapshot") {
        sendJson(response, 200, sanitizeSnapshotForResponse(persistenceStore.getSnapshot()));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/notifications") {
        sendJson(response, 200, getNotificationsResponse(persistenceStore.getSnapshot()));
        return;
      }

      if (request.method === "POST" && /^\/api\/notifications\/[^/]+\/read$/.test(url.pathname)) {
        const notificationId = decodeURIComponent(
          url.pathname.replace(/^\/api\/notifications\//, "").replace(/\/read$/, "")
        );
        const snapshot = persistenceStore.getSnapshot();
        const notification = snapshot.notifications.find((record) => record.id === notificationId);

        if (!notification) {
          sendJson(response, 404, { error: "Notification not found." });
          return;
        }

        const readAt = new Date().toISOString();
        const nextNotification = { ...notification, readAt };
        const nextSnapshot = persistenceStore.saveNotifications([nextNotification], readAt);

        sendJson(response, 200, {
          record: sanitizeNotificationRecordForResponse(nextNotification),
          snapshotSummary: summarizeSnapshot(nextSnapshot)
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/goals") {
        const userId = url.searchParams.get("userId") ?? "local-user";
        const result = handleListLearningGoals({
          persistenceStore,
          curationStore,
          userId,
          contentLanguage: resolveContentLanguage(persistenceStore, process.env),
          now: url.searchParams.get("now") ?? new Date().toISOString()
        });

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/goals") {
        const body = await readJsonBody(request);
        const result = handleCreateLearningGoal({
          body,
          persistenceStore,
          curationStore,
          userId:
            body && typeof body === "object" && typeof body.userId === "string" && body.userId.trim()
              ? body.userId.trim()
              : "local-user",
          contentLanguage: resolveContentLanguage(persistenceStore, process.env)
        });

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && /^\/api\/goals\/[^/]+$/.test(url.pathname)) {
        const goalId = decodeURIComponent(url.pathname.replace(/^\/api\/goals\//, ""));
        const body = await readJsonBody(request);
        const result = handleArchiveLearningGoal(goalId, body, persistenceStore);

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "DELETE" && /^\/api\/goals\/[^/]+$/.test(url.pathname)) {
        const goalId = decodeURIComponent(url.pathname.replace(/^\/api\/goals\//, ""));
        const snapshot = persistenceStore.getSnapshot();

        if (!snapshot.learningGoals.some((record) => record.id === goalId)) {
          sendJson(response, 404, { error: "Learning goal not found." });
          return;
        }

        const nextSnapshot = persistenceStore.deleteLearningGoal(goalId, new Date().toISOString());

        sendJson(response, 200, {
          deleted: true,
          id: goalId,
          snapshotSummary: summarizeSnapshot(nextSnapshot)
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/deepread") {
        const snapshot = persistenceStore.getSnapshot();
        const topic = url.searchParams.get("topic");
        const topicKey = topic ? normalizeConceptKey(topic) : "";
        const goalId = url.searchParams.get("goalId");
        const records = snapshot.deepReadArticles
          .filter(
            (record) =>
              !topicKey ||
              normalizeConceptKey(record.topic) === topicKey ||
              normalizeConceptKey(record.topicKey ?? "") === topicKey
          )
          .filter((record) => !goalId || record.goalId === goalId);

        sendJson(response, 200, { records });
        return;
      }

      if (request.method === "GET" && /^\/api\/deepread\/[^/]+$/.test(url.pathname)) {
        const articleId = decodeURIComponent(url.pathname.replace(/^\/api\/deepread\//, ""));
        const record = persistenceStore.getSnapshot().deepReadArticles.find((item) => item.id === articleId);

        if (!record) {
          sendJson(response, 404, { error: "Deep-read article not found." });
          return;
        }

        sendJson(response, 200, { record });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/deepread") {
        const body = await readJsonBody(request);
        const result = handleDeepReadRequest({
          body,
          persistenceStore,
          curationStore,
          contentLanguage: resolveContentLanguage(persistenceStore, process.env),
          now: typeof body.now === "string" ? body.now : new Date().toISOString()
        });

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/settings") {
        sendJson(response, 200, getSettingsResponse(persistenceStore, process.env));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/settings") {
        const body = await readJsonBody(request);
        const contentLanguage = parseContentLanguage(
          body && typeof body === "object" ? body.contentLanguage ?? body.userSettings?.contentLanguage : undefined
        );

        if (!contentLanguage) {
          throw new HttpError(400, "settings.contentLanguage must be \"zh\" or \"en\".");
        }

        const snapshot = persistenceStore.saveUserSettings({
          ...persistenceStore.getSnapshot().userSettings,
          contentLanguage
        });

        sendJson(response, 200, getSettingsResponse(persistenceStore, process.env, snapshot));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/recap/weekly") {
        sendJson(
          response,
          200,
          getWeeklyRecapResponse(
            persistenceStore,
            url.searchParams.get("now"),
            resolveContentLanguage(persistenceStore, process.env)
          )
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/recap/weekly/seen") {
        const body = await readJsonBody(request);
        const result = markWeeklyRecapSeen(persistenceStore, body);

        if (!result) {
          sendJson(response, 404, { error: "Weekly recap not found." });
          return;
        }

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/concept-merge-suggestions") {
        const body = await readJsonBody(request);
        requireString(body.left, "left");
        requireString(body.right, "right");
        const now = typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString();
        const suggestion = createConceptMergeSuggestion({
          left: body.left,
          right: body.right,
          leftExcerpt: typeof body.leftExcerpt === "string" ? body.leftExcerpt : undefined,
          rightExcerpt: typeof body.rightExcerpt === "string" ? body.rightExcerpt : undefined,
          createdAt: now
        });
        const snapshot = persistenceStore.getSnapshot();
        const existing = snapshot.conceptMergeSuggestions.find((record) => record.id === suggestion.id);
        const nextSnapshot = existing
          ? snapshot
          : persistenceStore.saveConceptMergeSuggestions([...snapshot.conceptMergeSuggestions, suggestion], now);

        sendJson(response, 200, {
          suggestion: existing ?? suggestion,
          snapshotSummary: summarizeSnapshot(nextSnapshot)
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/concept-merge-suggestions\/[^/]+\/resolve$/.test(url.pathname)) {
        const suggestionId = decodeURIComponent(
          url.pathname.replace(/^\/api\/concept-merge-suggestions\//, "").replace(/\/resolve$/, "")
        );
        const body = await readJsonBody(request);
        const decision = body.decision === "merge" || body.decision === "separate" ? body.decision : undefined;

        if (!decision) {
          throw new HttpError(400, "decision must be \"merge\" or \"separate\".");
        }

        const now = typeof body.decidedAt === "string" ? body.decidedAt : new Date().toISOString();
        let snapshot = persistenceStore.getSnapshot();
        const suggestion = snapshot.conceptMergeSuggestions.find((record) => record.id === suggestionId);

        if (!suggestion) {
          sendJson(response, 404, { error: "Concept merge suggestion not found." });
          return;
        }

        const canonical = typeof body.canonical === "string" && body.canonical.trim() ? body.canonical.trim() : suggestion.left;
        const alias = canonical === suggestion.right ? suggestion.left : suggestion.right;
        const resolvedSuggestion = {
          ...suggestion,
          status: decision === "merge" ? "merged" : "separate",
          decidedBy: "user",
          decidedAt: now
        };

        if (decision === "merge") {
          snapshot = persistenceStore.saveConceptAliases(
            addConceptAliasDecision(snapshot.conceptAliases, {
              canonical,
              aliases: [alias],
              decidedBy: "user",
              decidedAt: now
            }),
            now
          );
        }

        snapshot = persistenceStore.saveConceptMergeSuggestions(
          [
            ...snapshot.conceptMergeSuggestions.filter((record) => record.id !== suggestionId),
            resolvedSuggestion
          ],
          now
        );

        sendJson(response, 200, {
          suggestion: resolvedSuggestion,
          conceptAliases: snapshot.conceptAliases,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/concept-aliases/unmerge") {
        const body = await readJsonBody(request);
        requireString(body.canonical, "canonical");
        requireString(body.alias, "alias");
        const now = new Date().toISOString();
        const snapshot = persistenceStore.getSnapshot();
        const nextSnapshot = persistenceStore.saveConceptAliases(
          removeConceptAlias(snapshot.conceptAliases, body.canonical, body.alias),
          now
        );

        sendJson(response, 200, {
          conceptAliases: nextSnapshot.conceptAliases,
          snapshotSummary: summarizeSnapshot(nextSnapshot)
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/timeline") {
        const timeline = getTimelineResponse(
          persistenceStore.getSnapshot(),
          url.searchParams.get("now"),
          url.searchParams.get("userId") ?? "local-user",
          resolveContentLanguage(persistenceStore, process.env),
          curationStore,
          url.searchParams.get("seed") ?? undefined
        );

        sendJson(
          response,
          200,
          {
            ...timeline,
            workerStatus: getWorkerStatus()
          }
        );
        return;
      }

      // 注入面(浏览器插件)拉卡:复习到期优先、时间线排名补位的精简卡列表。纯读。
      if (request.method === "GET" && url.pathname === "/api/inject/cards") {
        sendJson(
          response,
          200,
          getInjectCardsResponse(
            persistenceStore.getSnapshot(),
            url.searchParams.get("now"),
            url.searchParams.get("userId") ?? "local-user",
            resolveContentLanguage(persistenceStore, process.env),
            url.searchParams.get("limit")
          )
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/worker") {
        const body = await readJsonBody(request);

        if (typeof body.enabled !== "boolean") {
          throw new HttpError(400, "enabled must be a boolean.");
        }

        setWorkerEnabled(body.enabled);
        sendJson(response, 200, { workerStatus: getWorkerStatus() });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/dismissed") {
        sendJson(response, 200, getDismissedPostsResponse(persistenceStore.getSnapshot(), url.searchParams.get("now")));
        return;
      }

      if (request.method === "POST" && /^\/api\/posts\/[^/]+\/dismiss$/.test(url.pathname)) {
        const postId = decodeURIComponent(
          url.pathname.replace(/^\/api\/posts\//, "").replace(/\/dismiss$/, "")
        );
        const body = await readJsonBody(request);
        const now = new Date().toISOString();
        const snapshot = persistenceStore.getSnapshot();
        const mode = parseDismissedPostMode(body && typeof body === "object" ? body.mode : undefined);
        const record = {
          postId,
          dismissedAt: now,
          mode
        };
        const nextDismissedPosts = upsertDismissedPostRecord(snapshot.dismissedPosts, record);

        persistenceStore.saveDismissedPosts(nextDismissedPosts, now);
        sendJson(response, 200, { dismissed: true, record });
        return;
      }

      if (request.method === "DELETE" && /^\/api\/posts\/[^/]+\/dismiss$/.test(url.pathname)) {
        const postId = decodeURIComponent(
          url.pathname.replace(/^\/api\/posts\//, "").replace(/\/dismiss$/, "")
        );
        const now = new Date().toISOString();
        const snapshot = persistenceStore.getSnapshot();
        const nextDismissedPosts = snapshot.dismissedPosts.filter((record) => record.postId !== postId);

        persistenceStore.saveDismissedPosts(nextDismissedPosts, now);
        sendJson(response, 200, { dismissed: false, restored: true, postId });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/review/due") {
        const now = url.searchParams.get("now") ?? new Date().toISOString();
        const snapshot = backfillLegacyReviewStates(persistenceStore, now);
        const hardDismissedPostIds = getHardDismissedPostIds(snapshot.dismissedPosts);
        const postById = new Map(snapshot.posts.map((post) => [post.id, post]));
        const due = getDueReviewStates(snapshot.reviewStates, now)
          .filter((state) => !hardDismissedPostIds.has(state.postId))
          .filter((state) => postById.has(state.postId))
          .map(({ postId, intervalDays, dueAt }) => ({
            postId,
            intervalDays,
            dueAt,
            reviewPrompt: selectReviewPrompt(postById.get(postId), intervalDays)
          }));

        sendJson(response, 200, { due });
        return;
      }

      if (request.method === "POST" && /^\/api\/review\/[^/]+\/complete$/.test(url.pathname)) {
        const postId = decodeURIComponent(
          url.pathname.replace(/^\/api\/review\//, "").replace(/\/complete$/, "")
        );
        const body = await readJsonBody(request);
        const userId = parseOptionalUserId(body.userId);
        const grade = parseReviewGrade(body.grade);
        const reviewEventId = parseOptionalIdempotencyKey(body.reviewEventId, "reviewEventId");
        const snapshot = persistenceStore.getSnapshot();
        const reviewState = snapshot.reviewStates.find((state) => state.postId === postId);

        if (!reviewState) {
          sendJson(response, 404, { error: "Review state not found." });
          return;
        }

        const post = snapshot.posts.find((candidate) => candidate.id === postId);

        if (!post) {
          sendJson(response, 404, { error: "Post not found for review state." });
          return;
        }

        const reviewedAt = requireIsoDate(body.reviewedAt ?? body.now ?? new Date().toISOString(), "reviewedAt");
        const reviewedSignal = createReviewedInteractionSignal(post, reviewedAt);
        const signalRecordId = reviewEventId
          ? buildReviewEventRecordId(postId, reviewEventId)
          : buildReviewCompletionRecordId(postId, reviewedAt);
        const existingEvent = snapshot.interactionSignals.find((record) => record.id === signalRecordId);

        if (existingEvent) {
          const existingResult = existingEvent.reviewResult;
          const currentReviewState = persistenceStore
            .getSnapshot()
            .reviewStates.find((state) => state.postId === postId) ?? reviewState;

          sendJson(response, 200, {
            reviewState: existingResult?.reviewState ?? currentReviewState,
            nextDueAt: existingResult?.reviewState?.dueAt ?? currentReviewState.dueAt,
            masteryPromotions: existingResult?.masteryPromotions ?? [],
            learningGoalAchievements: existingResult?.learningGoalAchievements ?? [],
            idempotentReplay: true,
            snapshotSummary: summarizeSnapshot(persistenceStore.getSnapshot())
          });
          return;
        }

        const nextReviewState = createReviewStateForGrade(reviewState, reviewedAt, grade);
        const historicalSignalRecords = snapshot.interactionSignals;
        const pendingReviewedRecord = {
          id: signalRecordId,
          signal: reviewedSignal,
          createdAt: reviewedSignal.createdAt
        };
        const previousEffectiveSignal = findCoalescedDailySignal(historicalSignalRecords, reviewedSignal);
        const effectiveSignal =
          findCoalescedDailySignal([...historicalSignalRecords, pendingReviewedRecord], reviewedSignal) ?? reviewedSignal;
        const observedTopicState = deriveTopicState(effectiveSignal);
        const currentTopicState = snapshot.topicStates.find((record) => record.topicId === observedTopicState.topicId);
        const feedback = evaluateInteraction(effectiveSignal, observedTopicState);
        const topicUpdate = updateTopicStateFromCoalescedDelta({
          currentTopicState,
          observedTopicState,
          previousSignal: previousEffectiveSignal,
          nextSignal: effectiveSignal,
          updatedAt: reviewedAt
        });
        const topicState = topicUpdate.topicState;
        const signalRecord = {
          id: signalRecordId,
          signal: reviewedSignal,
          feedback,
          createdAt: reviewedSignal.createdAt,
          reviewEventId,
          reviewGrade: grade
        };

        let nextSnapshot = persistenceStore.saveReviewStates([nextReviewState], reviewedAt);
        nextSnapshot = persistenceStore.saveInteractionSignalRecords([signalRecord], reviewedAt);
        if (topicUpdate.changed) {
          nextSnapshot = persistenceStore.saveTopicStateRecords([topicState], reviewedAt);
        }
        const masteryResult =
          grade === "forgot"
            ? { snapshot: nextSnapshot, promotions: [], learningGoalAchievements: [] }
            : promoteMasteryAfterReview({
                persistenceStore,
                snapshot: nextSnapshot,
                post,
                userId,
                reviewedAt,
                contentLanguage: resolveContentLanguage(persistenceStore, process.env)
              });
        const reviewResult = {
          reviewState: nextReviewState,
          masteryPromotions: masteryResult.promotions,
          learningGoalAchievements: masteryResult.learningGoalAchievements ?? []
        };

        const finalSnapshot = persistenceStore.saveInteractionSignalRecords(
          [{ ...signalRecord, reviewResult }],
          reviewedAt
        );

        sendJson(response, 200, {
          ...reviewResult,
          nextDueAt: nextReviewState.dueAt,
          idempotentReplay: false,
          snapshotSummary: summarizeSnapshot(finalSnapshot)
        });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/evidence/")) {
        const postId = decodeURIComponent(url.pathname.replace(/^\/api\/evidence\//, ""));
        const ledgerResponse = getEvidenceLedgerResponse(persistenceStore.getSnapshot(), postId);

        if (!ledgerResponse) {
          sendJson(response, 404, { error: "Evidence ledger not found for this post." });
          return;
        }

        sendJson(response, 200, ledgerResponse);
        return;
      }

      if (request.method === "POST" && /^\/api\/concepts\/[^/]+\/brief$/.test(url.pathname)) {
        const concept = decodeURIComponent(
          url.pathname.replace(/^\/api\/concepts\//, "").replace(/\/brief$/, "")
        );
        const body = await readJsonBody(request);
        const result = handleConceptBriefRequest(
          concept,
          body,
          persistenceStore,
          curationStore,
          resolveContentLanguage(persistenceStore, process.env)
        );

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/source-candidates") {
        const status = url.searchParams.get("status") ?? undefined;
        const records = persistenceStore
          .getSnapshot()
          .sourceCandidates.filter((record) => !status || record.status === status)
          .map(sanitizeSourceCandidateRecordForResponse);

        sendJson(response, 200, { records });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/subscriptions") {
        sendJson(response, 200, {
          records: persistenceStore.getSnapshot().subscriptions.map(sanitizeSubscriptionRecordForResponse)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/supply/refill") {
        const body = await readJsonBody(request);
        const now = typeof body.now === "string" ? body.now : new Date().toISOString();
        const result = queueSupplyRefill({
          persistenceStore,
          curationStore,
          contentLanguage: resolveContentLanguage(persistenceStore, process.env),
          now
        });

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/subscriptions") {
        const body = await readJsonBody(request);
        const result = await handleCreateSubscription(body, persistenceStore, feedFetch);

        sendJson(response, 200, {
          ...result,
          record: sanitizeSubscriptionRecordForResponse(result.record)
        });
        return;
      }

      if (request.method === "DELETE" && /^\/api\/subscriptions\/[^/]+$/.test(url.pathname)) {
        const subscriptionId = decodeURIComponent(url.pathname.replace(/^\/api\/subscriptions\//, ""));
        const snapshot = persistenceStore.getSnapshot();

        if (!snapshot.subscriptions.some((record) => record.id === subscriptionId)) {
          sendJson(response, 404, { error: "Subscription not found." });
          return;
        }

        const nextSnapshot = persistenceStore.deleteSubscription(subscriptionId);

        sendJson(response, 200, {
          deleted: true,
          id: subscriptionId,
          snapshotSummary: summarizeSnapshot(nextSnapshot)
        });
        return;
      }

      if (request.method === "GET" && /^\/api\/subscriptions\/[^/]+\/backlog$/.test(url.pathname)) {
        const subscriptionId = decodeURIComponent(
          url.pathname.replace(/^\/api\/subscriptions\//, "").replace(/\/backlog$/, "")
        );

        sendJson(response, 200, getSubscriptionBacklogResponse(subscriptionId, persistenceStore));
        return;
      }

      if (request.method === "POST" && /^\/api\/subscriptions\/[^/]+\/backlog$/.test(url.pathname)) {
        const subscriptionId = decodeURIComponent(
          url.pathname.replace(/^\/api\/subscriptions\//, "").replace(/\/backlog$/, "")
        );
        const body = await readJsonBody(request);
        const now = typeof body.now === "string" ? body.now : new Date().toISOString();
        const result = await catalogSubscriptionBacklog({
          subscriptionId,
          persistenceStore,
          fetchImpl: feedFetch,
          now
        });

        sendJson(response, 200, {
          ...result,
          record: sanitizeSubscriptionRecordForResponse(result.record)
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/subscriptions\/[^/]+\/backlog\/digest$/.test(url.pathname)) {
        const subscriptionId = decodeURIComponent(
          url.pathname.replace(/^\/api\/subscriptions\//, "").replace(/\/backlog\/digest$/, "")
        );
        const body = await readJsonBody(request);
        const now = typeof body.now === "string" ? body.now : new Date().toISOString();
        const snapshot = persistenceStore.getSnapshot();
        const subscription = snapshot.subscriptions.find((record) => record.id === subscriptionId);

        if (!subscription) {
          sendJson(response, 404, { error: "Subscription not found." });
          return;
        }

        const result = digestSubscriptionBacklog({
          persistenceStore,
          curationStore,
          subscription,
          limit: backlogManualBatchLimit,
          contentLanguage: resolveContentLanguage(persistenceStore, process.env),
          now
        });

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/source-candidates/prioritize") {
        const body = await readJsonBody(request);
        requireString(body.id, "id");
        const record = persistenceStore.getSnapshot().sourceCandidates.find((item) => item.id === body.id);

        if (!record) {
          sendJson(response, 404, { error: "Source candidate not found." });
          return;
        }

        const now = new Date().toISOString();
        const snapshot = persistenceStore.saveSourceCandidateRecords([
          {
            ...record,
            prioritizedAt: now,
            updatedAt: now
          }
        ]);

        sendJson(response, 200, {
          record: sanitizeSourceCandidateRecordForResponse(
            snapshot.sourceCandidates.find((item) => item.id === body.id)
          ),
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && /^\/api\/subscriptions\/[^/]+$/.test(url.pathname)) {
        const subscriptionId = decodeURIComponent(url.pathname.replace(/^\/api\/subscriptions\//, ""));
        const body = await readJsonBody(request);
        const result = handleUpdateSubscription(subscriptionId, body, persistenceStore);

        sendJson(response, 200, {
          ...result,
          record: sanitizeSubscriptionRecordForResponse(result.record)
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/curation/jobs") {
        const status = url.searchParams.get("status") ?? undefined;
        sendJson(response, 200, {
          jobs: curationStore.list(status).map((record) => sanitizeCurationRecordForResponse(record, false))
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/source-candidates") {
        const body = await readJsonBody(request);
        const record = createSourceCandidateRecord(body);
        const snapshot = persistenceStore.saveSourceCandidateRecords([record]);

        sendJson(response, 200, {
          record,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/source-candidates/dismiss") {
        const body = await readJsonBody(request);
        requireString(body.id, "id");
        const record = persistenceStore.getSnapshot().sourceCandidates.find((item) => item.id === body.id);

        if (!record) {
          sendJson(response, 404, { error: "Source candidate not found." });
          return;
        }

        const now = new Date().toISOString();
        const snapshot = persistenceStore.saveSourceCandidateRecords([
          {
            ...record,
            status: "dismissed",
            updatedAt: now,
            dismissedAt: now
          }
        ]);

        sendJson(response, 200, {
          record: sanitizeSourceCandidateRecordForResponse(
            snapshot.sourceCandidates.find((item) => item.id === body.id)
          ),
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/captures/source") {
        const body = await readJsonBody(request);

        requireString(body.url, "url");

        const contentLanguage = resolveContentLanguage(persistenceStore, process.env);

        sendJson(response, 200, handleCaptureSource(body, persistenceStore, curationStore, contentLanguage));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/captures/conversation") {
        const body = await readJsonBody(request);

        requireString(body.topic, "topic");
        requireString(body.excerpt, "excerpt");

        const contentLanguage = resolveContentLanguage(persistenceStore, process.env);

        sendJson(response, 200, handleCaptureConversation(body, persistenceStore, curationStore, contentLanguage));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/captures/context") {
        sendJson(response, 200, getCaptureContextResponse(persistenceStore));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/import/article") {
        const body = await readJsonBody(request);
        const contentLanguage = resolveContentLanguage(persistenceStore, process.env);
        const importResult = await importArticle(
          body,
          importRunner,
          mediaRootDir,
          contentLanguage,
          buildSourceQualityUserContext(persistenceStore.getSnapshot()),
          guardedFetchImpl
        );
        const { snapshot, releasePlan } = persistImportAndReleasePlan(persistenceStore, importResult, {
          contentLanguage
        });

        sendJson(response, 200, {
          ...sanitizeSourceImportResultForResponse(importResult),
          releasePlan,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/import/youtube") {
        const body = await readJsonBody(request);
        const contentLanguage = resolveContentLanguage(persistenceStore, process.env);
        const importResult = await importYouTube(
          body,
          importRunner,
          mediaRootDir,
          contentLanguage,
          buildSourceQualityUserContext(persistenceStore.getSnapshot()),
          guardedFetchImpl
        );
        const { snapshot, releasePlan } = persistImportAndReleasePlan(persistenceStore, importResult, {
          contentLanguage
        });

        sendJson(response, 200, {
          ...sanitizeSourceImportResultForResponse(importResult),
          releasePlan,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/ask") {
        const body = await readJsonBody(request);
        const answer = await handleAsk(body, persistenceStore, askModelClient, resolveContentLanguage(persistenceStore, process.env));

        sendJson(response, 200, answer);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/signals") {
        const body = await readJsonBody(request);
        const currentSnapshot = persistenceStore.getSnapshot();
        const signal = requireInteractionSignal(body.signal, currentSnapshot);
        const generatedAt = requireIsoDate(body.generatedAt ?? new Date().toISOString(), "generatedAt");
        const signalRecordId = buildInteractionSignalRecordId(signal);
        const existingRecord = currentSnapshot.interactionSignals.find((record) => record.id === signalRecordId);
        const observedTopicState = body.topicState
          ? requireTopicState(body.topicState, signal.topicId)
          : deriveTopicState(signal);
        const currentTopicState = currentSnapshot.topicStates.find((record) => record.topicId === observedTopicState.topicId);

        if (existingRecord) {
          const existingResult = existingRecord.signalResult;

          sendJson(response, 200, {
            feedback: existingRecord.feedback,
            topicState: existingResult?.topicState ?? currentTopicState ?? null,
            plan: existingResult?.plan ?? createEmptyCurationPlan(generatedAt),
            records: existingResult?.records ?? [],
            idempotentReplay: true,
            snapshotSummary: summarizeSnapshot(currentSnapshot)
          });
          return;
        }

        if (isPureExposureSignal(signal)) {
          const feedback = createNeutralExposureFeedback(signal);
          const plan = createEmptyCurationPlan(generatedAt);
          const signalResult = {
            topicState: currentTopicState ?? null,
            plan,
            records: []
          };
          const signalRecord = {
            id: signalRecordId,
            signal,
            feedback,
            createdAt: signal.createdAt,
            signalResult
          };
          const snapshot = persistenceStore.saveInteractionSignalRecords([signalRecord], generatedAt);

          sendJson(response, 200, {
            feedback,
            ...signalResult,
            idempotentReplay: false,
            snapshotSummary: summarizeSnapshot(snapshot)
          });
          return;
        }

        const requestCandidates = body.sourceCandidates ?? [];

        if (!Array.isArray(requestCandidates)) {
          throw new HttpError(400, "sourceCandidates must be an array.");
        }

        requireSupportedSourceCandidates(requestCandidates);

        const pendingSignalRecord = {
          id: signalRecordId,
          signal,
          createdAt: signal.createdAt
        };
        const historicalSignalRecords = currentSnapshot.interactionSignals;
        const previousEffectiveSignal = findCoalescedDailySignal(historicalSignalRecords, signal);
        const nextSignalRecords = [...historicalSignalRecords, pendingSignalRecord];
        const effectiveSignal = findCoalescedDailySignal(nextSignalRecords, signal) ?? signal;
        const effectiveObservedTopicState = body.topicState
          ? requireTopicState(body.topicState, effectiveSignal.topicId)
          : deriveTopicState(effectiveSignal);
        const feedback = evaluateInteraction(effectiveSignal, effectiveObservedTopicState);
        const contentLanguage = resolveContentLanguage(persistenceStore, process.env);
        const topicUpdate = updateTopicStateFromCoalescedDelta({
          currentTopicState,
          observedTopicState: effectiveObservedTopicState,
          previousSignal: previousEffectiveSignal,
          nextSignal: effectiveSignal,
          updatedAt: generatedAt
        });
        const shouldUpdateTopicState = topicUpdate.changed;
        const topicState = topicUpdate.topicState;
        const shouldEnqueueProduction = shouldEnqueueCoalescedProduction(
          previousEffectiveSignal,
          effectiveSignal
        );

        if (!shouldUpdateTopicState && !shouldEnqueueProduction) {
          const plan = createEmptyCurationPlan(generatedAt);
          const signalResult = { topicState, plan, records: [] };
          const signalRecord = {
            ...pendingSignalRecord,
            feedback,
            signalResult
          };
          const snapshot = persistenceStore.saveInteractionSignalRecords([signalRecord], generatedAt);

          sendJson(response, 200, {
            feedback,
            ...signalResult,
            coalescedReplay: true,
            idempotentReplay: false,
            snapshotSummary: summarizeSnapshot(snapshot)
          });
          return;
        }

        if (!shouldEnqueueProduction) {
          const plan = createEmptyCurationPlan(generatedAt);
          const signalResult = { topicState, plan, records: [] };
          const signalRecord = {
            ...pendingSignalRecord,
            feedback,
            signalResult
          };
          persistenceStore.saveInteractionSignalRecords([signalRecord], generatedAt);
          const snapshot = shouldUpdateTopicState
            ? persistenceStore.saveTopicStateRecords([topicState], generatedAt)
            : persistenceStore.getSnapshot();

          sendJson(response, 200, {
            feedback,
            ...signalResult,
            coalescedReplay: true,
            idempotentReplay: false,
            snapshotSummary: summarizeSnapshot(snapshot)
          });
          return;
        }

        const persistedCandidates = findMatchingSourceCandidateRecords(currentSnapshot, effectiveSignal);
        const planningFeedback = evaluateInteraction(signal, observedTopicState);
        const rawPlan = createBackgroundCurationPlan({
          signals: [signal],
          feedback: [planningFeedback],
          topicStates: [topicState],
          sourceCandidates: dedupeSourceCandidates([
            ...requestCandidates,
            ...persistedCandidates.map((record) => record.candidate)
          ]),
          contentLanguage,
          generatedAt
        });
        const budgetResult = applyDailyAutoJobBudget({
          plan: rawPlan,
          budget: getDailyAutoJobBudgetRecord(currentSnapshot, generatedAt),
          limit: getDailyAutoJobBudgetLimit(process.env),
          now: generatedAt
        });
        const plan = budgetResult.plan;
        const records = curationStore.enqueuePlan(plan);
        const signalResult = { topicState, plan, records };
        const signalRecord = {
          id: signalRecordId,
          signal,
          feedback,
          createdAt: signal.createdAt,
          signalResult
        };
        persistenceStore.saveInteractionSignalRecords([signalRecord], generatedAt);
        persistenceStore.saveTopicStateRecords([topicState], generatedAt);
        persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], generatedAt);
        let snapshot = persistenceStore.saveCurationJobRecords(records, generatedAt);
        const initialReviewState = maybeCreateInitialReviewState(snapshot, effectiveSignal, generatedAt);

        if (initialReviewState) {
          snapshot = persistenceStore.saveReviewStates([initialReviewState], generatedAt);
        }

        if (plan.acceptedSourceCandidateIds.length) {
          const acceptedIds = new Set(plan.acceptedSourceCandidateIds);
          const now = plan.generatedAt;

          snapshot = persistenceStore.saveSourceCandidateRecords(
            persistedCandidates
              .filter((record) => acceptedIds.has(record.candidate.id))
              .map((record) => ({
                ...record,
                status: "queued",
                updatedAt: now,
                lastQueuedAt: now
              }))
          );
        }

        sendJson(response, 200, {
          feedback,
          ...signalResult,
          idempotentReplay: false,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/curation/run") {
        const body = await readJsonBody(request);
        const result = await runCurationWithGuard(body);

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/agent/ask") {
        const body = await readJsonBody(request);
        requireString(body.question, "question");
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = await handleAgentAsk(
          body,
          userId,
          persistenceStore,
          askModelClient,
          searchProvider,
          resolveContentLanguage(persistenceStore, process.env)
        );

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/agent/confirm") {
        const body = await readJsonBody(request);
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = handleAgentConfirm(
          body,
          userId,
          persistenceStore,
          curationStore,
          resolveContentLanguage(persistenceStore, process.env)
        );

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/agent/preferences") {
        const body = await readJsonBody(request);
        requireString(body.text, "text");
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = handlePreferenceChat(
          body,
          userId,
          persistenceStore,
          curationStore,
          resolveContentLanguage(persistenceStore, process.env)
        );

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/agent/research-idea") {
        const body = await readJsonBody(request);
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = handleIdeaResearchRequest(
          body,
          userId,
          persistenceStore,
          curationStore,
          resolveContentLanguage(persistenceStore, process.env)
        );

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/discovery/run") {
        const body = await readJsonBody(request);
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = await handleDiscoveryRun(
          body,
          userId,
          persistenceStore,
          searchProvider,
          resolveContentLanguage(persistenceStore, process.env)
        );

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/notes") {
        const body = await readJsonBody(request);
        requireString(body.text, "text");
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = await handleUserNote(
          body,
          userId,
          persistenceStore,
          askModelClient,
          searchProvider,
          resolveContentLanguage(persistenceStore, process.env)
        );

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && /^\/api\/posts\/[^/]+\/replies$/.test(url.pathname)) {
        const postId = decodeURIComponent(
          url.pathname.replace(/^\/api\/posts\//, "").replace(/\/replies$/, "")
        );
        const body = await readJsonBody(request);
        requireString(body.text, "text");
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = await handlePostReply(
          postId,
          body,
          userId,
          persistenceStore,
          askModelClient,
          searchProvider,
          resolveContentLanguage(persistenceStore, process.env)
        );

        sendJson(response, 200, { ...result, post: sanitizePostForResponse(result.post) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/memory") {
        const body = await readJsonBody(request);
        const userId = parseOptionalUserId(body.userId);
        const currentSnapshot = persistenceStore.getSnapshot();
        const currentMemory =
          currentSnapshot.userMemories.find((record) => record.userId === userId)?.memory ??
          createEmptyUserMemory();
        const edits = body.edits === undefined ? [] : body.edits;

        if (!Array.isArray(edits)) {
          throw new HttpError(400, "edits must be an array.");
        }

        if (edits.length === 0) {
          sendJson(response, 200, {
            memory: currentMemory,
            events: [],
            snapshotSummary: summarizeSnapshot(currentSnapshot)
          });
          return;
        }

        const now = new Date().toISOString();
        let editResult;

        try {
          editResult = applyUserMemoryEdits(currentMemory, edits, now);
        } catch (error) {
          console.error("[aitimeline] rejected invalid memory edits.", error);
          throw new HttpError(400, "Memory edits are invalid.");
        }
        const blacklistEvents = createManualMasteryDemotionEvents(
          currentSnapshot,
          userId,
          currentMemory,
          editResult.memory,
          now
        );
        const snapshot = persistenceStore.saveUserMemory(
          userId,
          editResult.memory,
          [...editResult.events, ...blacklistEvents],
          now
        );

        sendJson(response, 200, {
          ...editResult,
          events: [...editResult.events, ...blacklistEvents],
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (response.headersSent) {
        console.error(`[aitimeline] API request failed after headers were sent (${request.method} ${request.url}).`, error);

        if (!response.writableEnded) {
          response.end();
        }

        return;
      }

      const guardedFetchError = error instanceof GuardedFetchError ? error : undefined;
      const statusCode = guardedFetchError ? 400 : error instanceof HttpError ? error.statusCode : 500;
      const safeMessage = guardedFetchError
        ? "Remote source fetch was blocked."
        : error instanceof HttpError && statusCode < 500 ? error.message : "Internal server error.";

      if (!(error instanceof HttpError) || statusCode >= 500 || error.cause) {
        console.error(`[aitimeline] API request failed (${request.method} ${request.url}).`, error);
      }

      if (statusCode === 413) {
        response.setHeader("Connection", "close");
        response.shouldKeepAlive = false;
      }

      sendJson(response, statusCode, {
        error: safeMessage,
        ...(guardedFetchError ? { code: guardedFetchError.code } : {})
      });

      if (statusCode === 413) {
        safelyDrainRequest(request);
      }
    }
  });
  let storesClosed = false;
  const closeStores = () => {
    stopWorkerInterval();
    if (storesClosed) return;
    storesClosed = true;
    for (const resource of resources.reverse()) resource.close?.();
  };
  server.once("close", closeStores);
  server.aitimeline = {
    persistenceStore,
    curationStore,
    workerId,
    closeStores,
    security,
    configureBinding(host) {
      Object.assign(security, createBindingSecurity(host, authToken));
    }
  };
  startWorkerInterval();
  return server;
}












function normalizeWorkerIntervalMs(value, minimumMs = 1) {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(typeof value === "string" ? value : "", 10);

  if (!Number.isFinite(parsed)) {
    return defaultWorkerIntervalMs;
  }

  return Math.max(minimumMs, Math.floor(parsed));
}

export function listen(server, port = defaultPort, host = "127.0.0.1") {
  try {
    server.aitimeline?.configureBinding(host);
  } catch (error) {
    server.aitimeline?.closeStores();
    throw error;
  }
  return new Promise((resolveListen) => {
    server.listen(port, host, () => {
      resolveListen(server.address());
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? `${defaultPort}`, 10);
  // Default to loopback. Set AITIMELINE_HOST=0.0.0.0 to expose the API on the
  // local network so a phone (Expo Go) can reach it — trusted LANs only.
  const host = process.env.AITIMELINE_HOST ?? "127.0.0.1";
  const workerIntervalMs = normalizeWorkerIntervalMs(
    process.env.AITIMELINE_WORKER_INTERVAL_MS,
    minimumConfiguredWorkerIntervalMs
  );
  const server = createApiServer({
    host,
    worker: process.env.AITIMELINE_WORKER !== "0",
    workerIntervalMs
  });
  const address = await listen(server, port, host);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log(`AITimeline API listening on http://${address.address}:${address.port}`);
}

// 兼容外部 import:这些符号已搬进域模块,server.mjs 仍按原名对外暴露。
export {
  ensureMaterializationPlan,
  filterDuplicateFollowupCurationRecords,
  materializeCurationJobRecords,
  normalizeFollowupDedupeTitle
} from "./domains/importPipeline.mjs";
export { createFileStorageAdapter } from "./lib/fileStorage.mjs";
