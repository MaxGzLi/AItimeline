import { createServer } from "node:http";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyUserMemoryEdits,
  askGrounded,
  advanceReviewState,
  addConceptAliasDecision,
  arrangeTimelineBlocks,
  assignCardBlockTopics,
  buildConceptDigest,
  buildDiscoveryConfirmationQuestions,
  buildSkillTree,
  coalesceInteractionSignals,
  createAutomaticConceptAliases,
  createConceptBriefInputFromCards,
  createAITimelinePersistenceStore,
  createMemoryRevisionedStorageAdapter,
  applyDailyAutoJobBudget,
  settleDailyAutoJobBudget,
  createBackgroundCurationPlan,
  createDeterministicConceptBrief,
  createConceptMergeSuggestion,
  createConnectionNoteForImport,
  createDeepReadArticle,
  createEmptyUserMemory,
  createInitialReviewState,
  createPersistentBackgroundCurationJobStore,
  createSourcePostReleasePlan,
  buildWeeklyRecap,
  buildWeeklyRecapId,
  evaluateMasteryPromotions,
  evaluateInteraction,
  fetchArticle,
  fetchYouTubeTranscript,
  filterTimelineLifecycle,
  getMostRecentCompletedIsoWeekStart,
  getDayKey,
  getHardDismissedPostIds,
  getSoftDismissalReturnAt,
  isTimelineDismissalActive,
  getDueReviewStates,
  getRestingReviewStates,
  isPureExposureSignal,
  mergeSourceRegistries,
  removeConceptAlias,
  parseContentLanguage,
  previewSourceImportApplications,
  rankPersonalizedTimeline,
  readSerializedRevision,
  runConversationTurn,
  runDueBackgroundCurationJobs,
  normalizeConceptKey,
  generateConceptBrief,
  runIdeaObservation,
  shouldRefreshConceptBrief,
  runSourceDiscovery,
  transformArticleUrl,
  transformUserNote,
  transformYouTubeUrl
} from "../../../packages/core/dist/index.js";
import { createEvidenceLedger } from "../../../packages/core/dist/harness/evidenceLedger.js";
import { createGuardedFetch, GuardedFetchError } from "./guardedFetch.mjs";
import {
  catalogSubscriptionBacklog,
  createSubscriptionImportJob,
  createSubscriptionSourceCandidate,
  digestDueSubscriptionBacklogs,
  digestSubscriptionBacklog,
  fetchAndParseSubscriptionFeed,
  fetchUploadsFallbackFeed,
  getSubscriptionBacklogResponse,
  handleCreateSubscription,
  handleUpdateSubscription,
  maxIsoDate,
  normalizeUrlKey,
  pollDueSubscriptions,
  scoreSubscriptionEntryRelevance,
  selectDueSubscriptions,
  selectNewSubscriptionEntries
} from "./domains/subscriptions.mjs";
import {
  createSourceCandidateRecord,
  dedupeSourceCandidates,
  findMatchingSourceCandidateRecords,
  getSupplyStatus,
  maybeCreateSupplyDroughtNotification,
  queueSupplyRefill
} from "./domains/supply.mjs";
import {
  applySourceCandidateOutcome,
  classifyTerminalImportSource,
  collectKnownSourceTitles,
  collectKnownSourceUrls,
  dedupePostsById,
  getKnowledgePosts,
  isNetworkFailureMessage,
  isTranscriptUnavailableMessage,
  sanitizeSourceCandidateRecordForResponse,
  sourceCandidateFailureMessages
} from "./domains/importSettlement.mjs";
import {
  getCaptureContextResponse,
  handleCaptureConversation,
  handleCaptureSource,
  queueDueAgentCaptures
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
  isSupportedSourceCandidateType,
  maybePersistConnectionNote,
  normalizeIsoDate,
  parseHttpUrl,
  persistAutomaticConceptAliases,
  requireString,
  roundScore,
  sanitizeSlug,
  summarizeSnapshot,
  tokenizeText
} from "./domains/shared.mjs";
import {
  discoverSourcesForJob,
  handleAgentAsk,
  handleAgentConfirm,
  handleDiscoveryRun,
  handleIdeaResearchRequest,
  handleResearchIdeaJob,
  handleResearchQuestionJob,
  persistDiscoveredCandidates,
  researchCopy,
  runResearchWithStagedPersistence,
  updateAgentTurn
} from "./domains/research.mjs";
import { handlePostReply, handleUserNote } from "./domains/notes.mjs";
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
  buildLearningGoalTree,
  collectActiveLearningGoalConcepts,
  handleArchiveLearningGoal,
  handleCreateLearningGoal,
  handleListLearningGoals,
  omitSnapshotFromProductionResult,
  queueDailyLearningGoalProductionGuarantee
} from "./domains/learningGoals.mjs";
import {
  handleAsk,
  handleConceptBriefJob,
  handleConceptBriefRequest,
  handleDeepReadArticleJob,
  handleDeepReadRequest
} from "./domains/briefsDeepRead.mjs";
import {
  createConfiguredAskModelClient,
  createConfiguredDeepReadModelClients,
  createConfiguredSearchProvider,
  createConfiguredSourceImportWorker,
  readConfiguredContentLanguage,
  resolveContentLanguage
} from "./domains/config.mjs";

const defaultPort = 8787;
const defaultWorkerIntervalMs = 60000;
const minimumConfiguredWorkerIntervalMs = 5000;
const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(currentDir, "../data/aitimeline.json");
const defaultCurationDataPath = resolve(currentDir, "../data/curation-jobs.json");
const defaultMediaRoot = resolve(currentDir, "../data/media");
const backlogManualBatchLimit = 5;
const defaultCorsOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5198",
  "http://localhost:5198"
];

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
          curationStore
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

async function executeCurationRun(
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

function createSafeSourceImportWorker(worker) {
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


function getSettingsResponse(persistenceStore, env, snapshot = persistenceStore.getSnapshot()) {
  const environmentContentLanguage = readConfiguredContentLanguage(env);
  const contentLanguage = snapshot.userSettings.contentLanguage ?? environmentContentLanguage ?? "zh";

  return {
    contentLanguage,
    userSettings: snapshot.userSettings,
    environmentContentLanguage: environmentContentLanguage ?? null
  };
}

function getWeeklyRecapResponse(persistenceStore, nowValue, contentLanguage) {
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

function markWeeklyRecapSeen(persistenceStore, body) {
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

function parseOptionalDate(value) {
  if (typeof value !== "string") {
    return new Date();
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : new Date();
}





// Terminal write-back for import_source jobs; every lane funnels through here.
function settleTerminalImportSource(persistenceStore, record, sourceImport, now) {
  const candidateId = record.job.sourceCandidate?.id;
  const snapshot = persistenceStore.getSnapshot();
  const candidateRecord = candidateId
    ? snapshot.sourceCandidates.find((item) => item.candidate.id === candidateId)
    : undefined;
  const outcome = classifyTerminalImportSource({ record, sourceImport, candidateRecord });

  if (candidateRecord) {
    persistenceStore.saveSourceCandidateRecords([applySourceCandidateOutcome(candidateRecord, outcome, now)], now);
  }

  persistenceStore.saveDailyAutoJobBudgetRecords(
    [
      settleDailyAutoJobBudget({
        budget: getDailyAutoJobBudgetRecord(persistenceStore.getSnapshot(), now),
        outcome: outcome.settlement,
        limit: getDailyAutoJobBudgetLimit(process.env),
        now
      })
    ],
    now
  );

  return outcome;
}

function createNeutralExposureFeedback(signal) {
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

function createEmptyCurationPlan(generatedAt) {
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


async function importArticle(body, runner, mediaRootDir, contentLanguage, userContext, fetchImpl) {
  requireString(body.url, "url");
  const result = await transformArticleUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause,
    runner,
    mediaRootDir,
    contentLanguage,
    userContext,
    fetch: fetchImpl
  });

  return toSourceImportWorkerResult(result);
}

async function importYouTube(body, runner, contentLanguage, userContext, fetchImpl) {
  requireString(body.url, "url");
  const result = await transformYouTubeUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause,
    runner,
    contentLanguage,
    userContext,
    fetch: fetchImpl
  });

  return toSourceImportWorkerResult(result);
}

function toSourceImportWorkerResult(result) {
  return {
    importRecord: result.importRecord,
    source: result.source,
    assets: result.assets ?? [result.asset],
    chunks: result.chunks,
    sourceRegistry: result.sourceRegistry,
    posts: result.cards,
    validation: result.validation,
    harnessRun: result.harnessRun
  };
}

function persistImportAndReleasePlan(persistenceStore, importResult, options = {}) {
  const beforeImport = persistenceStore.getSnapshot();
  const savedAt = options.savedAt ?? new Date().toISOString();
  persistenceStore.saveSourceImportResult(importResult, savedAt);
  let snapshot = persistenceStore.getSnapshot();
  snapshot = persistAutomaticConceptAliases(persistenceStore, snapshot, savedAt);
  snapshot = maybePersistConnectionNote(persistenceStore, {
    beforeImport,
    newPosts: importResult.posts,
    now: savedAt,
    contentLanguage: options.contentLanguage
  });
  const releasePlan = createSourcePostReleasePlan({ posts: importResult.posts, generatedAt: savedAt });
  snapshot = persistenceStore.saveReleasePlan(releasePlan, savedAt);

  return { snapshot, releasePlan };
}

export function ensureMaterializationPlan(curationStore, record, snapshot, contentLanguage) {
  if (record.result?.materializationPlan) return record;
  const effectAt = record.completedAt ?? record.updatedAt;
  const sourceImports = record.result?.sourceImports ?? (record.result?.sourceImport ? [record.result.sourceImport] : []);
  const preview = previewSourceImportApplications(snapshot, sourceImports, effectAt);
  const releasePlans = preview.preparedResults
    .filter((result) => result.posts.length > 0)
    .map((result) => createSourcePostReleasePlan({ posts: result.posts, generatedAt: effectAt }));
  const conceptAliases = createAutomaticConceptAliases(
    preview.nextSnapshot.posts,
    preview.nextSnapshot.conceptAliases,
    effectAt
  );
  const connectionNote = preview.effectivePosts.length
    ? createConnectionNoteForImport({
        existingPosts: snapshot.posts,
        newPosts: preview.effectivePosts,
        interactionSignals: snapshot.interactionSignals.map((item) => item.signal),
        dismissedPosts: snapshot.dismissedPosts,
        conceptAliases: [...preview.nextSnapshot.conceptAliases, ...conceptAliases],
        now: effectAt,
        contentLanguage
      })
    : undefined;
  const materializationPlan = {
    version: 1,
    effectAt,
    sourceImports: preview.preparedResults,
    discoveredSourceCandidates: record.result?.discoveredSourceCandidates ?? [],
    releasePlans,
    conceptBriefs: record.result?.conceptBrief ? [record.result.conceptBrief] : [],
    deepReadArticles: record.result?.deepReadArticle ? [record.result.deepReadArticle] : [],
    conceptAliases,
    connectionNote,
    notifications: [],
    agentTurnPatches: []
  };
  return curationStore.updateTerminalResult(record.id, {
    ...(record.result ?? { kind: record.job.kind }),
    sourceImports: preview.preparedResults,
    materializationPlan
  });
}

export function materializeCurationJobRecords(
  persistenceStore,
  curationStore,
  records,
  { appliedAt, contentLanguage }
) {
  const plannedRecords = records.map((record) =>
    ensureMaterializationPlan(curationStore, curationStore.get(record.id) ?? record, persistenceStore.getSnapshot(), contentLanguage)
  );

  for (const record of plannedRecords) {
    const plan = record.result?.materializationPlan;
    if (!plan) throw new Error(`Terminal curation record is missing a materialization plan: ${record.id}`);
    const effectAt = plan.effectAt ?? record.completedAt ?? appliedAt;
    for (const candidate of plan.discoveredSourceCandidates ?? []) {
      persistDiscoveredCandidates(persistenceStore, [candidate], effectAt);
    }
    if (plan.sourceCandidateRecords?.length) {
      persistenceStore.saveSourceCandidateRecords(plan.sourceCandidateRecords, effectAt);
    }
    for (const sourceImport of plan.sourceImports ?? []) {
      persistenceStore.saveSourceImportResult(sourceImport, effectAt);
    }
    if (record.job.kind === "import_source") {
      settleTerminalImportSource(persistenceStore, record, plan.sourceImports?.[0], effectAt);
    }
    for (const releasePlan of plan.releasePlans ?? []) persistenceStore.saveReleasePlan(releasePlan, effectAt);
    if (plan.conceptBriefs?.length) persistenceStore.saveConceptBriefs(plan.conceptBriefs, effectAt);
    if (plan.deepReadArticles?.length) persistenceStore.saveDeepReadArticles(plan.deepReadArticles, effectAt);
    if (plan.conceptAliases?.length) {
      const snapshot = persistenceStore.getSnapshot();
      persistenceStore.saveConceptAliases([...snapshot.conceptAliases, ...plan.conceptAliases], effectAt);
    }
    if (plan.connectionNote) persistenceStore.savePosts([plan.connectionNote], effectAt);
    if (plan.extraPosts?.length) persistenceStore.savePosts(plan.extraPosts, effectAt);
    if (plan.notifications?.length) persistenceStore.saveNotifications(plan.notifications, effectAt);
    if (plan.agentTurnRecords?.length) persistenceStore.saveAgentTurnRecords(plan.agentTurnRecords, effectAt);
    for (const turnPatch of plan.agentTurnPatches ?? []) {
      updateAgentTurn(persistenceStore, turnPatch.id, turnPatch.patch, effectAt);
    }
  }

  const marked = curationStore.markMaterialized(
    plannedRecords.map((record) => record.id),
    appliedAt
  );
  persistenceStore.replaceCurationJobRecords(curationStore.list(), appliedAt);
  return marked;
}

function reconcileAndMaterializeCurationQueue(persistenceStore, curationStore, contentLanguage) {
  const startupAt = new Date().toISOString();
  persistenceStore.replaceCurationJobRecords(curationStore.list(), startupAt);
  const pending = curationStore.list().filter(
    (record) => ["succeeded", "failed", "skipped"].includes(record.status) && !record.materializedAt
  );
  const replayable = [];
  const alreadyApplied = [];
  const snapshot = persistenceStore.getSnapshot();
  for (const record of pending) {
    if (record.result?.materializationPlan || record.result?.sourceImport || record.result?.sourceImports?.length) {
      replayable.push(record);
      continue;
    }
    if (record.job.kind === "research_question" || record.job.kind === "research_idea") {
      const turnId = record.job.researchQuestion?.turnId ?? record.job.researchIdea?.turnId;
      const hasEvidence = snapshot.notifications.some((notification) => notification.turnId === turnId) &&
        snapshot.agentTurns.some((turn) => turn.id === turnId && turn.status !== "researching");
      if (!hasEvidence) {
        console.warn(`[aitimeline] legacy research job ${record.id} has no replayable manifest; compensation retry is required.`);
        continue;
      }
    }
    alreadyApplied.push(record.id);
  }
  if (alreadyApplied.length) curationStore.markMaterialized(alreadyApplied, startupAt);
  if (replayable.length) {
    materializeCurationJobRecords(persistenceStore, curationStore, replayable, {
      appliedAt: startupAt,
      contentLanguage
    });
  } else {
    persistenceStore.replaceCurationJobRecords(curationStore.list(), startupAt);
  }
}

export function normalizeFollowupDedupeTitle(title) {
  return typeof title === "string" ? title.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

export function filterDuplicateFollowupCurationRecords(records, existingPosts, warn = console.warn) {
  const knownTitles = new Set(
    existingPosts.map((post) => normalizeFollowupDedupeTitle(post.title)).filter(Boolean)
  );

  return records.map((record) => {
    if (record.job.kind !== "generate_followup" || !record.result?.sourceImport) {
      return record;
    }

    const sourceImport = filterDuplicateFollowupSourceImport(record.result.sourceImport, knownTitles, warn);

    if (sourceImport === record.result.sourceImport) {
      return record;
    }

    return {
      ...record,
      result: {
        ...record.result,
        sourceImport
      }
    };
  });
}

function sanitizeFailedCurationRecord(record, logCause = true) {
  if (record.status !== "failed" || typeof record.lastError !== "string" || !record.lastError.trim()) {
    return record;
  }

  if (logCause) {
    console.error(`[aitimeline] background curation job failed (${record.job.id}).`, record.lastError);
  }

  const lastError =
    record.job.kind === "import_source"
      ? isNetworkFailureMessage(record.lastError)
        ? sourceCandidateFailureMessages.unreachable
        : sourceCandidateFailureMessages.importFailed
      : "Background job failed.";

  return { ...record, lastError };
}

function sanitizeSourceImportRecordForResponse(record) {
  return record?.errorMessage ? { ...record, errorMessage: "Source import failed." } : record;
}

function sanitizeSourceImportResultForResponse(result) {
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

function sanitizePostForResponse(post) {
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

function sanitizeCurationRecordForResponse(record, logCause = true) {
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

function sanitizeSubscriptionRecordForResponse(record) {
  return record?.lastError ? { ...record, lastError: "Subscription poll failed." } : record;
}

function filterDuplicateFollowupSourceImport(sourceImport, knownTitles, warn) {
  const skippedPostIds = new Set();
  const posts = [];

  for (const post of sourceImport.posts) {
    const normalizedTitle = normalizeFollowupDedupeTitle(post.title);

    if (normalizedTitle && knownTitles.has(normalizedTitle)) {
      skippedPostIds.add(post.id);
      warn(
        `[aitimeline] skipped duplicate follow-up post "${post.title}" (${post.id}); normalized title already exists in the snapshot.`
      );
      continue;
    }

    posts.push(post);

    if (normalizedTitle) {
      knownTitles.add(normalizedTitle);
    }
  }

  if (!skippedPostIds.size) {
    return sourceImport;
  }

  const validation = sourceImport.validation.filter(
    (result) => !result.postId || !skippedPostIds.has(result.postId)
  );
  const harnessRun = sourceImport.harnessRun
    ? {
        ...sourceImport.harnessRun,
        outputPostIds: sourceImport.harnessRun.outputPostIds.filter((postId) => !skippedPostIds.has(postId)),
        validation: sourceImport.harnessRun.validation.filter(
          (result) => !result.postId || !skippedPostIds.has(result.postId)
        )
      }
    : undefined;

  return {
    ...sourceImport,
    posts,
    validation,
    harnessRun
  };
}

async function ingestSourceCandidate(candidate, fetchImpl) {
  if (candidate.source.type === "article" || candidate.source.type === "blog" || candidate.source.type === "news") {
    const fetched = await fetchArticle(candidate.source.url, { fetch: fetchImpl });

    return {
      assets: [
        {
          ...fetched.asset,
          id: `${candidate.source.id}-text`,
          sourceId: candidate.source.id
        }
      ],
      chunks: fetched.paragraphs.map((paragraph, index) => ({
        id: `${candidate.source.id}-chunk-${index + 1}`,
        sourceId: candidate.source.id,
        content: paragraph,
        conceptHints: candidate.conceptIds
      })),
      recommendedBecause: `Background curation selected this source: ${candidate.reason}`
    };
  }

  if (candidate.source.type === "youtube") {
    const fetched = await fetchYouTubeTranscript(candidate.source.url, { fetch: fetchImpl });

    return {
      assets: [
        {
          ...fetched.asset,
          id: `${candidate.source.id}-transcript`,
          sourceId: candidate.source.id
        }
      ],
      chunks: fetched.segments.map((segment, index) => ({
        id: `${candidate.source.id}-chunk-${index + 1}`,
        sourceId: candidate.source.id,
        content: segment.text,
        startTimeSeconds: segment.startTimeSeconds,
        endTimeSeconds: segment.endTimeSeconds,
        conceptHints: candidate.conceptIds
      })),
      recommendedBecause: `Background curation selected this source: ${candidate.reason}`
    };
  }

  throw new Error(`Background source ingestion does not support ${candidate.source.type} yet.`);
}

async function ingestSourceCandidateForBackground(candidate, ingestSource) {
  try {
    return await ingestSource(candidate);
  } catch (error) {
    console.error("[aitimeline] background source ingestion failed.", error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      isTranscriptUnavailableMessage(message)
        ? sourceCandidateFailureMessages.transcriptUnavailable
        : isNetworkFailureMessage(message)
          ? sourceCandidateFailureMessages.unreachable
          : sourceCandidateFailureMessages.unprocessable
    );
  }
}

function getTimelineResponse(snapshot, nowValue, userId = "local-user", contentLanguage = "zh", curationStore) {
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
    now
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

function getDismissedPostsResponse(snapshot, nowValue) {
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

function getNotificationsResponse(snapshot) {
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

function sanitizeNotificationRecordForResponse(notification) {
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

function parseDismissedPostMode(value) {
  if (value === undefined) {
    return "soft";
  }

  if (value === "soft" || value === "hard") {
    return value;
  }

  throw new HttpError(400, "dismiss mode must be \"soft\" or \"hard\".");
}

function upsertDismissedPostRecord(records, nextRecord) {
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

function getEvidenceLedgerResponse(snapshot, postId) {
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

function sanitizeSnapshotForResponse(snapshot) {
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

function findCoalescedDailySignal(records, targetSignal) {
  const targetDayKey = getDayKey(targetSignal.createdAt);

  return coalesceInteractionSignals(records).find(
    (signal) =>
      !isPureExposureSignal(signal) &&
      signal.postId === targetSignal.postId &&
      getDayKey(signal.createdAt) === targetDayKey
  );
}

const coalescedActionFields = ["openedThread", "liked", "saved", "askedQuestion", "reviewed", "skippedQuickly"];

function shouldEnqueueCoalescedProduction(previousSignal, nextSignal) {
  if (!previousSignal) {
    return true;
  }

  if (getNewCoalescedActionFields(previousSignal, nextSignal).length > 0) {
    return true;
  }

  return !isProductionQualifiedSignal(previousSignal) && isProductionQualifiedSignal(nextSignal);
}

function updateTopicStateFromCoalescedDelta({
  currentTopicState,
  observedTopicState,
  previousSignal,
  nextSignal,
  updatedAt
}) {
  if (!currentTopicState || !previousSignal) {
    const feedback = evaluateInteraction(nextSignal, observedTopicState);

    return {
      changed: true,
      topicState: updateTopicStateFromFeedback(
        currentTopicState,
        observedTopicState,
        nextSignal,
        feedback,
        updatedAt
      )
    };
  }

  let topicState = currentTopicState;
  let changed = false;
  const newActionFields = getNewCoalescedActionFields(previousSignal, nextSignal);

  if (newActionFields.length > 0) {
    const actionSignal = {
      ...nextSignal,
      impression: false,
      dwellTimeMs: 0
    };

    for (const field of coalescedActionFields) {
      actionSignal[field] = newActionFields.includes(field);
    }

    const actionFeedback = evaluateInteraction(actionSignal, observedTopicState);
    topicState = updateTopicStateFromFeedback(
      topicState,
      observedTopicState,
      actionSignal,
      actionFeedback,
      updatedAt
    );
    changed = true;
  }

  const previousDwellOnCurrentActions = {
    ...nextSignal,
    dwellTimeMs: previousSignal.dwellTimeMs
  };
  const previousDwellFeedback = evaluateInteraction(previousDwellOnCurrentActions, observedTopicState);
  const nextDwellFeedback = evaluateInteraction(nextSignal, observedTopicState);
  const previousReadBonus = previousSignal.dwellTimeMs >= 12000 ? 0.08 : 0;
  const nextReadBonus = nextSignal.dwellTimeMs >= 12000 ? 0.08 : 0;
  let interestDelta = nextReadBonus - previousReadBonus;
  let fatigueDelta = 0;

  if (
    previousDwellFeedback.inferredState === "interested" &&
    nextDwellFeedback.inferredState === "interested"
  ) {
    interestDelta +=
      getInterestedStrengthContribution(nextDwellFeedback) -
      getInterestedStrengthContribution(previousDwellFeedback);
  }

  if (
    previousDwellFeedback.inferredState === "not_relevant" &&
    nextDwellFeedback.inferredState === "not_relevant"
  ) {
    const previousPenalty = previousSignal.dwellTimeMs < 2500 ? 0.16 : 0.06;
    const nextPenalty = nextSignal.dwellTimeMs < 2500 ? 0.16 : 0.06;
    fatigueDelta = nextPenalty - previousPenalty;
  }

  if (interestDelta !== 0 || fatigueDelta !== 0) {
    topicState = {
      ...topicState,
      interestScore: roundScore(clampScore(topicState.interestScore + interestDelta)),
      fatigueScore: roundScore(clampScore(topicState.fatigueScore + fatigueDelta)),
      updatedAt: new Date(updatedAt).toISOString()
    };
    changed = true;
  }

  return { changed, topicState };
}

function getNewCoalescedActionFields(previousSignal, nextSignal) {
  return coalescedActionFields.filter((field) => nextSignal[field] && !previousSignal[field]);
}

function isProductionQualifiedSignal(signal) {
  return signal.dwellTimeMs >= 9000 || coalescedActionFields.some((field) => signal[field]);
}

function updateTopicStateFromFeedback(currentState, observedState, signal, feedback, nowValue) {
  const now = new Date(nowValue);
  let interestScore = blendScores(currentState?.interestScore, observedState.interestScore, 0.45);
  let fatigueScore = blendScores(currentState?.fatigueScore, observedState.fatigueScore, 0.55);
  let comprehensionScore = blendScores(currentState?.comprehensionScore, observedState.comprehensionScore, 0.35);

  if (feedback.inferredState === "interested") {
    interestScore += 0.12 + getInterestedStrengthContribution(feedback);
    fatigueScore *= 0.55;
  }

  if (feedback.inferredState === "confused") {
    interestScore += 0.08;
    comprehensionScore -= 0.16;
    fatigueScore *= 0.7;
  }

  if (feedback.inferredState === "needs_review") {
    interestScore += 0.1;
    comprehensionScore += 0.08;
    fatigueScore *= 0.7;
  }

  if (feedback.inferredState === "fatigued") {
    interestScore *= 0.82;
    fatigueScore += 0.28;
  }

  if (feedback.inferredState === "not_relevant") {
    interestScore *= 0.88;
    fatigueScore += signal.dwellTimeMs < 2500 ? 0.16 : 0.06;
  }

  if (signal.dwellTimeMs >= 12000) {
    interestScore += 0.08;
  }

  if (signal.liked || signal.saved) {
    interestScore += 0.08;
  }

  if (signal.reviewed) {
    comprehensionScore += 0.08;
  }

  let cooldownUntil = currentState?.cooldownUntil;

  if (feedback.nextAction === "cooldown_topic") {
    cooldownUntil = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString();
  } else if (cooldownUntil && new Date(cooldownUntil) <= now) {
    cooldownUntil = undefined;
  }

  return {
    topicId: observedState.topicId,
    interestScore: roundScore(clampScore(interestScore)),
    fatigueScore: roundScore(clampScore(fatigueScore)),
    comprehensionScore: roundScore(clampScore(comprehensionScore)),
    cooldownUntil,
    updatedAt: now.toISOString()
  };
}

function getInterestedStrengthContribution(feedback) {
  const strength = Math.max(0, Math.min(20, feedback.signalStrength)) / 20;

  // Topic scores are persisted at two decimals. Quantize this replaceable
  // component at the same boundary so cumulative dwell updates converge with
  // a single report containing the final daily max.
  return roundScore(strength * 0.18);
}

function blendScores(currentValue, observedValue, observedWeight) {
  if (typeof currentValue !== "number") {
    return observedValue;
  }

  return currentValue * (1 - observedWeight) + observedValue * observedWeight;
}

function clampScore(value) {
  return Math.max(0, Math.min(1, value));
}


export function createFileStorageAdapter(filePath, { ownerId, backupCount = 3 }) {
  if (!ownerId) throw new Error("File storage adapter requires ownerId.");
  const targetPath = resolve(filePath);
  const lockPath = `${targetPath}.lock`;
  const localHostname = hostname();
  const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
  const lockOwner = {
    format: 1,
    targetPath,
    pid: process.pid,
    hostname: localHostname,
    ownerId,
    processStartedAt,
    acquiredAt: new Date().toISOString()
  };
  let closed = false;
  let counter = 0;
  mkdirSync(dirname(targetPath), { recursive: true });
  acquireWriterLock(lockPath, lockOwner);

  const adapter = {
    read() {
      return existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
    },
    compareAndSwap(expectedRevision, serialized) {
      if (closed) throw new Error(`Storage adapter is closed: ${targetPath}`);
      const tempPath = `${targetPath}.tmp-${process.pid}-${ownerId}-${++counter}`;
      try {
        writeAndSyncFile(tempPath, `${serialized}\n`);
        const current = adapter.read();
        const actualRevision = readSerializedRevision(current);
        if (actualRevision !== expectedRevision) return false;
        if (current) createRollingBackup(targetPath, current, backupCount, ownerId, ++counter);
        renameSync(tempPath, targetPath);
        fsyncDirectory(dirname(targetPath));
        return true;
      } finally {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        const current = JSON.parse(readFileSync(lockPath, "utf8"));
        if (current.ownerId === ownerId && current.targetPath === targetPath) unlinkSync(lockPath);
      } catch (error) {
        if (existsSync(lockPath) && error?.code !== "ENOENT") throw error;
      }
    }
  };
  return adapter;
}

function acquireWriterLock(lockPath, owner) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeSync(fd, `${JSON.stringify(owner)}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      fsyncDirectory(dirname(lockPath));
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    let existing;
    try {
      existing = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      throw writerLockError(lockPath, "malformed lock; manual cleanup required");
    }
    if (!existing || existing.format !== 1 || typeof existing.pid !== "number" || typeof existing.hostname !== "string" || typeof existing.ownerId !== "string" || typeof existing.targetPath !== "string") {
      throw writerLockError(lockPath, "malformed lock; manual cleanup required");
    }
    if (existing.hostname !== owner.hostname) {
      throw writerLockError(lockPath, `lock belongs to foreign host ${existing.hostname}; manual verification required`);
    }
    try {
      process.kill(existing.pid, 0);
      throw writerLockError(lockPath, `live writer pid ${existing.pid} (${existing.ownerId})`);
    } catch (error) {
      if (error?.code === "EPERM") throw writerLockError(lockPath, `live writer pid ${existing.pid} cannot be probed`);
      if (error?.code !== "ESRCH") throw error;
    }

    const reapPath = `${lockPath}.reap-${process.pid}-${owner.ownerId}-${attempt}`;
    try {
      linkSync(lockPath, reapPath);
      const currentStat = lstatSync(lockPath);
      const reapStat = lstatSync(reapPath);
      if (currentStat.dev !== reapStat.dev || currentStat.ino !== reapStat.ino) {
        throw writerLockError(lockPath, "lock changed during stale-owner recovery");
      }
      unlinkSync(lockPath);
    } finally {
      if (existsSync(reapPath)) unlinkSync(reapPath);
    }
  }
  throw writerLockError(lockPath, "could not acquire lock after stale-owner recovery");
}

function writerLockError(lockPath, detail) {
  const error = new Error(`Writer lock rejected for ${lockPath}: ${detail}`);
  error.code = "AITIMELINE_WRITER_LOCKED";
  return error;
}

function createRollingBackup(targetPath, current, backupCount, ownerId, counter) {
  const backupTemp = `${targetPath}.bak.tmp-${process.pid}-${ownerId}-${counter}`;
  try {
    writeAndSyncFile(backupTemp, current.endsWith("\n") ? current : `${current}\n`);
    for (let index = backupCount; index >= 2; index -= 1) {
      const older = `${targetPath}.bak.${index - 1}`;
      const destination = `${targetPath}.bak.${index}`;
      if (existsSync(destination)) unlinkSync(destination);
      if (existsSync(older)) renameSync(older, destination);
    }
    if (existsSync(`${targetPath}.bak.1`)) unlinkSync(`${targetPath}.bak.1`);
    renameSync(backupTemp, `${targetPath}.bak.1`);
    fsyncDirectory(dirname(targetPath));
  } finally {
    if (existsSync(backupTemp)) unlinkSync(backupTemp);
  }
}

function writeAndSyncFile(path, contents) {
  const fd = openSync(path, "wx");
  try {
    writeSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(path) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}


const maxJsonBodyBytes = 1024 * 1024;

function rejectOversizedContentLength(request, response) {
  const header = request.headers?.["content-length"];
  const value = Array.isArray(header) ? header[0] : header;

  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return false;
  }

  const contentLength = Number(value);

  if (Number.isSafeInteger(contentLength) && contentLength <= maxJsonBodyBytes) {
    return false;
  }

  response.setHeader("Connection", "close");
  response.shouldKeepAlive = false;
  sendJson(response, 413, { error: "Request body is too large." });
  safelyDrainRequest(request);
  return true;
}

function safelyDrainRequest(request) {
  if (typeof request.resume === "function" && !request.destroyed && !request.complete) {
    request.resume();
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;
  const iterator =
    typeof request.iterator === "function"
      ? request.iterator({ destroyOnReturn: false })
      : request[Symbol.asyncIterator]();
  const iterable = { [Symbol.asyncIterator]: () => iterator };

  for await (const input of iterable) {
    const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
    totalBytes += chunk.byteLength;

    if (totalBytes > maxJsonBodyBytes) {
      chunks.length = 0;
      throw new HttpError(413, "Request body is too large.");
    }

    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  let parsedBody;

  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }

  return requireObjectBody(parsedBody);
}

function requireObjectBody(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be an object.");
  }

  return value;
}


function requireIsoDate(value, fieldName) {
  if (typeof value !== "string" || !isValidIsoDateString(value.trim())) {
    throw new HttpError(400, `${fieldName} must be a valid ISO date.`);
  }

  try {
    return normalizeIsoDate(value.trim());
  } catch {
    throw new HttpError(400, `${fieldName} must be a valid ISO date.`);
  }
}

function isValidIsoDateString(value) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/
  );

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(new Date(value).getTime())
  );
}

function requireInteractionSignal(signal, snapshot) {
  if (typeof signal !== "object" || signal === null || Array.isArray(signal)) {
    throw new HttpError(400, "signal is required.");
  }

  requireString(signal.postId, "signal.postId");
  requireString(signal.topicId, "signal.topicId");

  if (
    !Array.isArray(signal.conceptIds) ||
    signal.conceptIds.some((conceptId) => typeof conceptId !== "string" || !conceptId.trim())
  ) {
    throw new HttpError(400, "signal.conceptIds must be an array of non-empty strings.");
  }

  const booleanFields = [
    "impression",
    "openedThread",
    "liked",
    "saved",
    "askedQuestion",
    "reviewed",
    "skippedQuickly"
  ];

  for (const field of booleanFields) {
    if (typeof signal[field] !== "boolean") {
      throw new HttpError(400, `signal.${field} must be a boolean.`);
    }
  }

  const dwellTimeMs =
    signal.dwellTimeMs === undefined && signal.dwellSeconds !== undefined
      ? signal.dwellSeconds * 1000
      : signal.dwellTimeMs;

  if (typeof dwellTimeMs !== "number" || !Number.isFinite(dwellTimeMs) || dwellTimeMs < 0) {
    throw new HttpError(400, "signal.dwellTimeMs must be a finite non-negative number.");
  }

  if (
    signal.dwellSeconds !== undefined &&
    (typeof signal.dwellSeconds !== "number" || !Number.isFinite(signal.dwellSeconds) || signal.dwellSeconds < 0)
  ) {
    throw new HttpError(400, "signal.dwellSeconds must be a finite non-negative number.");
  }

  const postId = signal.postId.trim();

  if (!snapshot.posts.some((post) => post.id === postId)) {
    throw new HttpError(400, "signal.postId does not reference a known post.");
  }

  return {
    ...signal,
    postId,
    topicId: signal.topicId.trim(),
    conceptIds: signal.conceptIds.map((conceptId) => conceptId.trim()),
    dwellTimeMs,
    createdAt: requireIsoDate(signal.createdAt, "signal.createdAt")
  };
}

function requireTopicState(topicState, signalTopicId) {
  if (typeof topicState !== "object" || topicState === null || Array.isArray(topicState)) {
    throw new HttpError(400, "topicState must be an object.");
  }

  requireString(topicState.topicId, "topicState.topicId");

  if (topicState.topicId.trim() !== signalTopicId) {
    throw new HttpError(400, "topicState.topicId must match signal.topicId.");
  }

  for (const field of ["interestScore", "fatigueScore", "comprehensionScore"]) {
    if (typeof topicState[field] !== "number" || !Number.isFinite(topicState[field])) {
      throw new HttpError(400, `topicState.${field} must be a finite number.`);
    }
  }

  return {
    ...topicState,
    topicId: topicState.topicId.trim(),
    ...(topicState.cooldownUntil
      ? { cooldownUntil: requireIsoDate(topicState.cooldownUntil, "topicState.cooldownUntil") }
      : {})
  };
}

function requireSupportedSourceCandidates(candidates) {
  for (const candidate of candidates) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof candidate.source !== "object" ||
      candidate.source === null ||
      Array.isArray(candidate.source) ||
      !isSupportedSourceCandidateType(candidate.source.type)
    ) {
      throw new HttpError(
        400,
        "Source candidate type is not supported. Supported types: article, blog, news, youtube."
      );
    }

    requireString(candidate.id, "sourceCandidates[].id");
    requireString(candidate.source.id, "sourceCandidates[].source.id");
    requireString(candidate.source.title, "sourceCandidates[].source.title");
    requireString(candidate.source.url, "sourceCandidates[].source.url");
    parseHttpUrl(candidate.source.url);

    if (
      !Array.isArray(candidate.conceptIds) ||
      candidate.conceptIds.some((conceptId) => typeof conceptId !== "string" || !conceptId.trim())
    ) {
      throw new HttpError(400, "sourceCandidates[].conceptIds must be an array of non-empty strings.");
    }

    for (const field of ["relevanceScore", "noveltyScore", "qualityScore"]) {
      if (
        typeof candidate[field] !== "number" ||
        !Number.isFinite(candidate[field]) ||
        candidate[field] < 0 ||
        candidate[field] > 1
      ) {
        throw new HttpError(400, `sourceCandidates[].${field} must be a number between 0 and 1.`);
      }
    }
  }
}

function parseReviewGrade(value) {
  if (value === undefined) {
    return "remembered";
  }

  if (value !== "remembered" && value !== "fuzzy" && value !== "forgot") {
    throw new HttpError(400, "grade must be remembered, fuzzy, or forgot.");
  }

  return value;
}

function parseOptionalIdempotencyKey(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function parseOptionalUserId(value) {
  if (value === undefined) {
    return "local-user";
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "userId must be a non-empty string.");
  }

  return value.trim();
}


function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendMediaFile(response, mediaRootDir, pathname) {
  let relativePath = "";

  try {
    relativePath = decodeURIComponent(pathname.replace(/^\/media\//, ""));
  } catch {
    sendJson(response, 400, { error: "Media path is not valid." });
    return;
  }

  if (!relativePath || relativePath.includes("\0")) {
    sendJson(response, 404, { error: "Media not found." });
    return;
  }

  const filePath = resolve(mediaRootDir, relativePath);
  const safeRelativePath = relative(mediaRootDir, filePath);

  if (safeRelativePath.startsWith("..") || isAbsolute(safeRelativePath)) {
    sendJson(response, 404, { error: "Media not found." });
    return;
  }

  if (!existsSync(filePath)) {
    sendJson(response, 404, { error: "Media not found." });
    return;
  }

  const contentType = getMediaContentType(filePath);

  if (!contentType) {
    sendJson(response, 404, { error: "Media not found." });
    return;
  }

  try {
    const bytes = readFileSync(filePath);

    response.writeHead(200, { "content-type": contentType });
    response.end(bytes);
  } catch {
    sendJson(response, 404, { error: "Media not found." });
  }
}

function getMediaContentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return undefined;
  }
}

function sendHtml(response, html) {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
}

function sendXml(response, xml) {
  response.writeHead(200, { "content-type": "application/rss+xml" });
  response.end(xml);
}

function getRequestOrigin(request) {
  return `http://${request.headers.host ?? "127.0.0.1"}`;
}

function createBindingSecurity(host, tokenValue) {
  const authToken = typeof tokenValue === "string" ? tokenValue.trim() : "";
  if (!isLoopbackHost(host) && !authToken) {
    throw new Error(
      `Refusing to bind AITimeline API to non-loopback host "${host}" without authentication. ` +
      "Set AITIMELINE_AUTH_TOKEN to a non-empty secret before starting the server."
    );
  }
  // A configured token is enforced even on loopback: setting a secret and
  // having it silently ignored would be worse than requiring the header.
  return { host, requireAuth: Boolean(authToken), authToken };
}

function isLoopbackHost(hostValue) {
  const host = String(hostValue).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function hasValidApiToken(request, expectedToken) {
  const authorization = request.headers.authorization;
  const bearer = typeof authorization === "string" && /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  const alternate = request.headers["x-aitimeline-token"];
  return bearer === expectedToken || alternate === expectedToken;
}

function resolveCorsOrigins(optionValue, environmentValue) {
  const configured = optionValue ?? environmentValue;
  const values = configured === undefined
    ? defaultCorsOrigins
    : Array.isArray(configured) ? configured : String(configured).split(",");
  return new Set(values.map((value) => String(value).trim()).filter(Boolean));
}

function fixtureSubscriptionFeedXml(variant) {
  const safeVariant = sanitizeSlug(variant);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>AITimeline Subscription Fixture ${safeVariant}</title>
    <link>https://fixtures.local/subscription/${safeVariant}</link>
    <description>Local subscription fixture for RSS polling smoke checks.</description>
    <item>
      <title><![CDATA[RAG retrieval architecture ${safeVariant} 4]]></title>
      <link>https://fixtures.local/subscription/${safeVariant}/rag-4</link>
      <pubDate>Tue, 07 Jul 2026 04:00:00 GMT</pubDate>
      <description><![CDATA[<p>RAG retrieval architecture and grounded evaluation notes.</p>]]></description>
    </item>
    <item>
      <title>RAG retrieval architecture ${safeVariant} 3</title>
      <link>https://fixtures.local/subscription/${safeVariant}/rag-3</link>
      <pubDate>Tue, 07 Jul 2026 03:00:00 GMT</pubDate>
      <description>RAG retrieval quality improves with grounded evaluation.</description>
    </item>
    <item>
      <title>RAG retrieval architecture ${safeVariant} 2</title>
      <link>https://fixtures.local/subscription/${safeVariant}/rag-2</link>
      <pubDate>Tue, 07 Jul 2026 02:00:00 GMT</pubDate>
      <description>RAG system design and indexing trade-offs.</description>
    </item>
    <item>
      <title>RAG retrieval architecture ${safeVariant} 1</title>
      <link>https://fixtures.local/subscription/${safeVariant}/rag-1</link>
      <pubDate>Tue, 07 Jul 2026 01:00:00 GMT</pubDate>
      <description>RAG notes beyond the single-source import cap.</description>
    </item>
    <item>
      <title>Gardening calendar ${safeVariant}</title>
      <link>https://fixtures.local/subscription/${safeVariant}/garden</link>
      <pubDate>Tue, 07 Jul 2026 00:00:00 GMT</pubDate>
      <description>Tomato watering schedule with no relevant AI concepts.</description>
    </item>
  </channel>
</rss>`;
}

function fixtureArticleHtml(title) {
  return `
    <html>
      <head>
        <meta property="og:title" content="${title}" />
        <meta name="author" content="AITimeline API Smoke" />
        <meta property="article:published_time" content="2026-06-10T00:00:00.000Z" />
      </head>
      <body>
        <article>
          <p>${title} describes how an AI Agent can turn source material into durable knowledge when it keeps citations, extracts concepts, and creates a learning surface that users can revisit.</p>
          <p>For ${title}, the Knowledge Graph keeps Memory useful because saved concepts, weak concepts, and Recommendation signals point the user toward review at the right time.</p>
          <p>In the ${title} smoke architecture, each imported paragraph becomes a registered chunk, every generated card must cite a chunk id, and the evidence ledger rejects unsupported numeric claims before the card reaches the timeline.</p>
          <p>The ${title} background worker uses interaction signals to choose between three actions: import a matching source, discover a new source, or create a same-source follow-up when no better source is available.</p>
          <p>The operational trade-off in ${title} is budget control. A daily counter caps automatic discover, import, and follow-up jobs so passive reading cannot create an unbounded queue of model and search calls.</p>
        </article>
      </body>
    </html>
  `;
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
