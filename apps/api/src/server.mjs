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
  DISCOVERY_AGGREGATE_DOMAINS,
  createCommandModelClientFromEnv,
  createConceptMergeSuggestion,
  createConnectionNoteForImport,
  createDeepReadArticle,
  createEmptyUserMemory,
  createInitialReviewState,
  createModelSourceImportWorker,
  createOpenAICompatibleModelClientFromEnv,
  createOpenAICompatibleSourceImportWorker,
  createPersistentBackgroundCurationJobStore,
  createSourceImportWorker,
  createSourcePostReleasePlan,
  createTavilySearchProvider,
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
  normalizeSubscriptionFeedUrl,
  parseSubscriptionFeed,
  generateConceptBrief,
  runIdeaObservation,
  shouldRefreshConceptBrief,
  runSourceDiscovery,
  fetchChannelUploads,
  transformArticleUrl,
  transformConversationCapture,
  transformUserNote,
  transformYouTubeUrl
} from "../../../packages/core/dist/index.js";
import { createEvidenceLedger } from "../../../packages/core/dist/harness/evidenceLedger.js";
import { createGuardedFetch, GuardedFetchError } from "./guardedFetch.mjs";

const defaultPort = 8787;
const defaultWorkerIntervalMs = 60000;
const minimumConfiguredWorkerIntervalMs = 5000;
const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(currentDir, "../data/aitimeline.json");
const defaultCurationDataPath = resolve(currentDir, "../data/curation-jobs.json");
const defaultMediaRoot = resolve(currentDir, "../data/media");
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
// Terminal failure messages are matched, not just displayed. Keep them here so
// classification and redaction never drift apart.
export const sourceCandidateFailureMessages = {
  unreachable: "Source could not be fetched.",
  transcriptUnavailable: "Source has no usable transcript.",
  importFailed: "Source import failed.",
  unprocessable: "Source candidate could not be processed.",
  fallbackSource: "Candidate did not produce a qualified source; same-source fallback was used.",
  stale: "stale_candidate"
};
const backlogAutoBatchLimit = 3;
const backlogManualBatchLimit = 5;
const backlogDailyLimit = 8;
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

function createConfiguredSourceImportWorker(env) {
  const modelName = env.AITIMELINE_MODEL_NAME ?? env.OPENAI_MODEL;
  const contentLanguage = readConfiguredContentLanguage(env);
  const commandClient = createConfiguredCommandModelClient(env);

  if (commandClient) {
    const commandWorker = createModelSourceImportWorker({
      ...(contentLanguage ? { contentLanguage } : {}),
      client: commandClient
    });
    console.log("[aitimeline] source import using command model runner.");

    return commandWorker;
  }

  if (!modelName) {
    return createSourceImportWorker(contentLanguage ? { contentLanguage } : {});
  }

  const worker = createOpenAICompatibleSourceImportWorker(
    env,
    contentLanguage ? { modelRunner: { contentLanguage } } : {}
  );
  console.log(`[aitimeline] source import using model runner (${modelName}).`);

  return worker;
}

function readConfiguredContentLanguage(env) {
  const value = env.AITIMELINE_CONTENT_LANGUAGE ?? "zh";

  if (value === "none") {
    return undefined;
  }

  const contentLanguage = parseContentLanguage(value);

  if (!contentLanguage) {
    console.warn(`[aitimeline] unsupported AITIMELINE_CONTENT_LANGUAGE "${value}"; defaulting to "zh".`);
    return "zh";
  }

  return contentLanguage;
}

function resolveContentLanguage(persistenceStore, env) {
  return persistenceStore.getSnapshot().userSettings.contentLanguage ?? readConfiguredContentLanguage(env) ?? "zh";
}

async function handleCreateSubscription(body, persistenceStore, fetchImpl) {
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

function handleUpdateSubscription(subscriptionId, body, persistenceStore) {
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

async function fetchAndParseSubscriptionFeed(feedUrl, fetchImpl) {
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

async function fetchUploadsFallbackFeed(subscription, fetchImpl) {
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

async function catalogSubscriptionBacklog({ subscriptionId, persistenceStore, fetchImpl, now }) {
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

function getSubscriptionBacklogResponse(subscriptionId, persistenceStore) {
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

function digestSubscriptionBacklog({ persistenceStore, curationStore, subscription, limit, contentLanguage, now }) {
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

function digestDueSubscriptionBacklogs({ persistenceStore, curationStore, contentLanguage, now }) {
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

async function pollDueSubscriptions({ persistenceStore, curationStore, fetchImpl, contentLanguage, now }) {
  if (!fetchImpl) {
    return { checked: 0, skipped: 0, queued: 0, pending: 0, errors: ["Feed fetch is not available."] };
  }

  const snapshot = persistenceStore.getSnapshot();
  const dueSubscriptions = selectDueSubscriptions(snapshot.subscriptions, now, 3);

  if (!dueSubscriptions.length) {
    return { checked: 0, skipped: snapshot.subscriptions.length, queued: 0, pending: 0, errors: [] };
  }

  let workingSnapshot = snapshot;
  const nowIso = normalizeIsoDate(now);
  const confirmedConcepts = collectConfirmedDiscoveryConcepts(workingSnapshot);
  const knownUrlKeys = new Set([
    ...collectKnownSourceUrls(workingSnapshot),
    ...curationStore.list().flatMap((record) => record.job.sourceCandidate?.source.url ?? [])
  ].map(normalizeUrlKey));
  const candidateRecords = [];
  const importJobs = [];
  const subscriptionUpdates = [];
  const errors = [];

  for (const subscription of dueSubscriptions) {
    try {
      let parsedFeed;

      try {
        parsedFeed = await fetchAndParseSubscriptionFeed(subscription.feedUrl, fetchImpl);
      } catch (feedError) {
        // The YouTube feed endpoint intermittently 404s/500s; the uploads
        // playlist page carries the same latest videos, so use it as a
        // fallback poll source before declaring the poll failed.
        parsedFeed = await fetchUploadsFallbackFeed(subscription, fetchImpl);

        if (!parsedFeed) {
          throw feedError;
        }
      }

      const entries = selectNewSubscriptionEntries(parsedFeed.entries, subscription, knownUrlKeys);
      const maxPublishedAt = maxIsoDate([
        subscription.lastItemPublishedAt,
        ...parsedFeed.entries.map((entry) => entry.publishedAt)
      ]);
      let queuedForSource = 0;

      for (const entry of entries) {
        const urlKey = normalizeUrlKey(entry.link);

        if (!urlKey || knownUrlKeys.has(urlKey)) {
          continue;
        }

        const relevance = scoreSubscriptionEntryRelevance(entry, confirmedConcepts);
        const wouldQueue =
          subscription.filterMode === "all" || (subscription.filterMode === "relevant" && relevance.passed);
        const shouldQueue = wouldQueue && queuedForSource < 3;
        const candidate = createSubscriptionSourceCandidate({
          subscription,
          entry,
          concepts: relevance.concepts.length ? relevance.concepts : [subscription.title],
          now: nowIso,
          relevanceScore: relevance.score
        });

        if (!candidate) {
          continue;
        }

        const record = {
          id: candidate.id,
          candidate,
          status: shouldQueue ? "queued" : "pending",
          intakeKind: "subscription",
          createdAt: nowIso,
          updatedAt: nowIso,
          notes: subscription.title
        };

        knownUrlKeys.add(urlKey);
        candidateRecords.push(record);

        if (shouldQueue) {
          queuedForSource += 1;
          importJobs.push(createSubscriptionImportJob(subscription, candidate, nowIso, contentLanguage));
        }
      }

      subscriptionUpdates.push({
        ...subscription,
        title: parsedFeed.title || subscription.title,
        siteUrl: subscription.siteUrl ?? parsedFeed.siteUrl,
        lastPolledAt: nowIso,
        lastItemPublishedAt: maxPublishedAt,
        lastError: undefined
      });
    } catch (error) {
      console.error(`[aitimeline] subscription poll failed (${subscription.id}).`, error);
      const message = "Subscription poll failed.";

      errors.push(`${subscription.title}: ${message}`);
      subscriptionUpdates.push({
        ...subscription,
        lastPolledAt: nowIso,
        lastError: message
      });
    }
  }

  if (candidateRecords.length) {
    workingSnapshot = persistenceStore.saveSourceCandidateRecords(candidateRecords, nowIso);
  }

  let queuedCount = 0;
  let discardedJobIds = [];

  if (importJobs.length) {
    const rawPlan = createSingleJobPlan(importJobs, nowIso);
    const budgetResult = applyDailyAutoJobBudget({
      plan: rawPlan,
      budget: getDailyAutoJobBudgetRecord(workingSnapshot, nowIso),
      limit: getDailyAutoJobBudgetLimit(process.env),
      now: nowIso
    });
    const records = curationStore.enqueuePlan(budgetResult.plan, nowIso);
    const acceptedIds = new Set(budgetResult.plan.acceptedSourceCandidateIds);

    queuedCount = records.length;
    discardedJobIds = budgetResult.discardedJobIds;
    persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], nowIso);
    workingSnapshot = persistenceStore.saveCurationJobRecords(records, nowIso);

    const downgradedRecords = candidateRecords
      .filter((record) => record.status === "queued" && !acceptedIds.has(record.candidate.id))
      .map((record) => ({
        ...record,
        status: "pending",
        updatedAt: nowIso
      }));

    if (downgradedRecords.length) {
      workingSnapshot = persistenceStore.saveSourceCandidateRecords(downgradedRecords, nowIso);
    }
  }

  if (subscriptionUpdates.length) {
    workingSnapshot = persistenceStore.saveSubscriptions(subscriptionUpdates, nowIso);
  }

  return {
    checked: dueSubscriptions.length,
    skipped: Math.max(0, snapshot.subscriptions.length - dueSubscriptions.length),
    queued: queuedCount,
    pending: Math.max(0, candidateRecords.length - queuedCount),
    discardedJobIds,
    errors,
    snapshotSummary: summarizeSnapshot(workingSnapshot)
  };
}

function getSupplyStatus(snapshot, curationStore, nowValue) {
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

function getBudgetRemaining(snapshot, nowValue) {
  const limit = getDailyAutoJobBudgetLimit(process.env);
  const budget = getDailyAutoJobBudgetRecord(snapshot, nowValue);
  const used = budget?.used ?? 0;

  return Math.max(0, limit - used);
}

function queueSupplyRefill({ persistenceStore, curationStore, contentLanguage, now }) {
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

function getActiveImportSourceCandidateIds(curationStore) {
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

function maybeCreateSupplyDroughtNotification({ persistenceStore, status, contentLanguage, now }) {
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

function selectDueSubscriptions(subscriptions, nowValue, limit) {
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

function selectNewSubscriptionEntries(entries, subscription, knownUrlKeys) {
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

function maxIsoDate(values) {
  const dates = values
    .filter((value) => typeof value === "string" && value)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  return dates[0]?.toISOString();
}

function scoreSubscriptionEntryRelevance(entry, confirmedConcepts) {
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

function createSubscriptionSourceCandidate({ subscription, entry, concepts, now, relevanceScore }) {
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

function createSubscriptionImportJob(subscription, candidate, now, contentLanguage) {
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

function normalizeUrlKey(value) {
  try {
    const url = new URL(value);

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    return url.toString().replace(/\/$/, "");
  } catch {
    return typeof value === "string" ? value.trim() : "";
  }
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

// A user-provided CLI command wins over the OpenAI-compatible env: it is the more
// explicit choice, and it lets people without an API key run a local agent CLI.
function createConfiguredCommandModelClient(env) {
  const command = firstNonBlankEnv(env.AITIMELINE_MODEL_COMMAND);

  return command ? createCommandModelClientFromEnv(env, { command }) : undefined;
}

function createConfiguredAskModelClient(env) {
  const commandClient = createConfiguredCommandModelClient(env);

  if (commandClient) {
    return commandClient;
  }

  const modelName = env.AITIMELINE_MODEL_NAME ?? env.OPENAI_MODEL;

  return modelName ? createOpenAICompatibleModelClientFromEnv(env) : undefined;
}

function createConfiguredDeepReadModelClients(env) {
  const modelEnv = {
    ...env,
    AITIMELINE_MODEL_NAME: firstNonBlankEnv(env.AITIMELINE_MODEL_NAME, env.OPENAI_MODEL),
    AITIMELINE_MODEL_API_KEY: firstNonBlankEnv(env.AITIMELINE_MODEL_API_KEY, env.OPENAI_API_KEY),
    AITIMELINE_MODEL_BASE_URL: firstNonBlankEnv(env.AITIMELINE_MODEL_BASE_URL, env.OPENAI_BASE_URL),
    OPENAI_MODEL: firstNonBlankEnv(env.OPENAI_MODEL),
    OPENAI_API_KEY: firstNonBlankEnv(env.OPENAI_API_KEY),
    OPENAI_BASE_URL: firstNonBlankEnv(env.OPENAI_BASE_URL)
  };
  const deepReadModelName = firstNonBlankEnv(env.AITIMELINE_MODEL_DEEPREAD_NAME);
  const defaultModelName = modelEnv.AITIMELINE_MODEL_NAME;
  // Per-request output cap and whole-article token budget are different numbers:
  // passing the 50k-150k article budget as request max_tokens would make every
  // call fail on providers with lower output limits.
  const requestMaxTokens = Number.parseInt(env.AITIMELINE_MODEL_DEEPREAD_MAX_TOKENS ?? "", 10);
  const articleTokenBudget = getDeepReadArticleTokenBudget(env);
  const commandClient = createConfiguredCommandModelClient(env);
  const defaultClient =
    commandClient ?? (defaultModelName ? createOpenAICompatibleModelClientFromEnv(modelEnv) : undefined);
  const deepReadClient = deepReadModelName
    ? createOpenAICompatibleModelClientFromEnv(modelEnv, {
        model: deepReadModelName,
        apiKey: firstNonBlankEnv(
          env.AITIMELINE_MODEL_DEEPREAD_API_KEY,
          modelEnv.AITIMELINE_MODEL_API_KEY,
          modelEnv.OPENAI_API_KEY
        ),
        baseUrl: firstNonBlankEnv(
          env.AITIMELINE_MODEL_DEEPREAD_BASE_URL,
          modelEnv.AITIMELINE_MODEL_BASE_URL,
          modelEnv.OPENAI_BASE_URL
        ),
        ...(Number.isFinite(requestMaxTokens) ? { maxTokens: requestMaxTokens } : {})
      })
    : undefined;

  if (deepReadClient) {
    console.log(`[aitimeline] deep-read articles using model runner (${deepReadModelName}).`);
  } else if (defaultClient) {
    console.log(
      `[aitimeline] deep-read articles falling back to default model runner (${commandClient ? "command" : defaultModelName}).`
    );
  }

  return {
    deepReadClient,
    defaultClient,
    maxTokens: articleTokenBudget
  };
}

function firstNonBlankEnv(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function getDeepReadArticleTokenBudget(env) {
  const parsed = Number.parseInt(env.AITIMELINE_DEEPREAD_ARTICLE_TOKEN_BUDGET ?? "", 10);

  if (!Number.isFinite(parsed)) {
    return 100000;
  }

  return Math.max(50000, Math.min(150000, parsed));
}

async function handleAgentAsk(body, userId, persistenceStore, client, searchProvider, contentLanguage) {
  const snapshot = persistenceStore.getSnapshot();
  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const knowledgePosts = getKnowledgePosts(snapshot.posts);
  const registry = mergeSourceRegistries(...snapshot.sourceRegistries.map((record) => record.registry));
  const threadId =
    typeof body.threadId === "string" && body.threadId.trim()
      ? body.threadId.trim()
      : `agent-thread-${hashText(`${userId}|${body.question}|${now}`)}`;
  const turnRecordId = `agent-turn-${hashText(`${userId}|${threadId}|${body.question}|${now}`)}`;
  let turn = await runConversationTurn(
    {
      question: body.question,
      postId: typeof body.postId === "string" ? body.postId : undefined,
      posts: knowledgePosts,
      registry,
      memory,
      userSignals: toUserSignals(snapshot.interactionSignals),
      previousTurns: getPreviousTurns(snapshot, userId, threadId),
      now
    },
    { client, contentLanguage }
  );

  if (turn.answer) {
    turn = {
      ...turn,
      answer: annotateAnswerWithSourceOrigins(turn.answer, registry, turnRecordId, contentLanguage)
    };
  }

  const hasConfirmAction = turn.actions.some((action) => action.kind === "confirm_discovery");
  const discoveredCandidates = hasConfirmAction
    ? []
    : await executeDiscoveryAction(turn, snapshot, memory, searchProvider, persistenceStore, now, contentLanguage);

  if (turn.signal) {
    persistenceStore.saveInteractionSignalRecords(
      [
        {
          id: buildInteractionSignalRecordId(turn.signal),
          signal: turn.signal,
          feedback: evaluateInteraction(turn.signal, deriveTopicState(turn.signal)),
          createdAt: now
        }
      ],
      now
    );
  }

  const memoryEditResult = applyUserMemoryEdits(
    memory ?? createEmptyUserMemory(),
    [
      {
        kind: "add",
        field: "interaction.recentQuestions",
        value: turn.question,
        reason: "User asked the agent a question."
      }
    ],
    now
  );

  persistenceStore.saveUserMemory(userId, memoryEditResult.memory, memoryEditResult.events, now);

  const turnRecord = {
    id: turnRecordId,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
    status: hasConfirmAction ? "pending_confirmation" : "answered",
    threadId,
    answerCardId: turn.answerCardId,
    createdAt: now
  };
  const finalSnapshot = persistenceStore.saveAgentTurnRecords([turnRecord], now);

  return {
    turn,
    discoveredCandidates,
    turnRecord,
    snapshotSummary: summarizeSnapshot(finalSnapshot)
  };
}

function handleAgentConfirm(body, userId, persistenceStore, curationStore, contentLanguage) {
  requireString(body.turnId, "turnId");
  const choices = normalizeChoiceMap(body.choices);

  if (Object.keys(choices).length === 0) {
    throw new HttpError(400, "choices must include at least one confirmation answer.");
  }

  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const turnRecord = snapshot.agentTurns.find((record) => record.id === body.turnId && record.userId === userId);

  if (!turnRecord) {
    throw new HttpError(404, "Agent turn not found.");
  }

  if (turnRecord.status !== "pending_confirmation" && turnRecord.status !== "researching") {
    throw new HttpError(409, "Agent turn is not waiting for discovery confirmation.");
  }

  const job = createResearchQuestionJob(turnRecord, choices, contentLanguage, now);
  const records = curationStore.enqueuePlan(createSingleJobPlan(job, now), now);
  persistenceStore.saveCurationJobRecords(records, now);

  const nextTurnRecord = {
    ...turnRecord,
    status: "researching"
  };
  const nextSnapshot = persistenceStore.saveAgentTurnRecords([nextTurnRecord], now);

  return {
    accepted: true,
    records,
    turnRecord: nextTurnRecord,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

function handleIdeaResearchRequest(body, userId, persistenceStore, curationStore, contentLanguage) {
  requireString(body.turnId, "turnId");
  requireString(body.question, "question");

  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const turnRecord = snapshot.agentTurns.find((record) => record.id === body.turnId && record.userId === userId);

  if (!turnRecord) {
    throw new HttpError(404, "Agent turn not found.");
  }

  if (turnRecord.intent !== "idea_observation") {
    throw new HttpError(409, "Agent turn is not an idea observation.");
  }

  const job = createResearchIdeaJob(
    turnRecord,
    body.question,
    toTrimmedStrings(body.concepts).slice(0, 5),
    contentLanguage,
    now
  );
  const records = curationStore.enqueuePlan(createSingleJobPlan(job, now), now);
  persistenceStore.saveCurationJobRecords(records, now);

  const nextTurnRecord = {
    ...turnRecord,
    status: "researching"
  };
  const nextSnapshot = persistenceStore.saveAgentTurnRecords([nextTurnRecord], now);

  return {
    accepted: true,
    records,
    turnRecord: nextTurnRecord,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

async function runResearchWithStagedPersistence(initialSnapshot, effectAt, execute) {
  const adapter = createMemoryRevisionedStorageAdapter(JSON.stringify(initialSnapshot));
  const stagedStore = createAITimelinePersistenceStore(adapter);
  const result = await execute(stagedStore);
  const sourceImports = result.sourceImports ?? (result.sourceImport ? [result.sourceImport] : []);
  const preview = previewSourceImportApplications(initialSnapshot, sourceImports, effectAt);
  const stagedSnapshot = stagedStore.getSnapshot();
  const changedById = (next, previous, key = "id") => {
    const previousById = new Map(previous.map((record) => [record[key], record]));
    return next.filter((record) => JSON.stringify(previousById.get(record[key])) !== JSON.stringify(record));
  };
  const previewPostsById = new Map(preview.nextSnapshot.posts.map((post) => [post.id, post]));
  const materializationPlan = {
    version: 1,
    effectAt,
    sourceImports: preview.preparedResults,
    discoveredSourceCandidates: [],
    sourceCandidateRecords: changedById(stagedSnapshot.sourceCandidates, initialSnapshot.sourceCandidates),
    releasePlans: stagedSnapshot.releasePlans.filter(
      (plan) => !initialSnapshot.releasePlans.some((previous) => JSON.stringify(previous) === JSON.stringify(plan))
    ),
    conceptBriefs: changedById(stagedSnapshot.conceptBriefs, initialSnapshot.conceptBriefs),
    deepReadArticles: changedById(stagedSnapshot.deepReadArticles, initialSnapshot.deepReadArticles),
    conceptAliases: changedById(stagedSnapshot.conceptAliases, initialSnapshot.conceptAliases, "canonical"),
    extraPosts: stagedSnapshot.posts.filter(
      (post) => JSON.stringify(previewPostsById.get(post.id)) !== JSON.stringify(post)
    ),
    notifications: changedById(stagedSnapshot.notifications, initialSnapshot.notifications),
    agentTurnRecords: changedById(stagedSnapshot.agentTurns, initialSnapshot.agentTurns),
    agentTurnPatches: []
  };
  return {
    ...result,
    sourceImports: preview.preparedResults,
    materializationPlan
  };
}

async function handleResearchQuestionJob(
  job,
  persistenceStore,
  sourceImportWorker,
  searchProvider,
  askModelClient,
  defaultContentLanguage,
  now,
  ingestSource
) {
  const payload = job.researchQuestion;

  if (!payload) {
    return {
      kind: job.kind,
      message: "Skipped: research_question job is missing its payload."
    };
  }

  const contentLanguage = payload.contentLanguage ?? defaultContentLanguage;

  if (!searchProvider) {
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body: researchCopy(contentLanguage, "unconfigured"),
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      message: "Search provider is not configured; notification was created."
    };
  }

  const snapshot = persistenceStore.getSnapshot();
  const queries = buildResearchQueries(payload.question, payload.choices, contentLanguage);
  const concepts = deriveResearchConcepts(payload.question);
  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts,
    queries,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    maxQueries: 3,
    maxCandidates: 8,
    contentLanguage,
    now
  });
  const rankedCandidates = rankResearchCandidates(discovery.candidates, payload.question);
  const unsupportedCandidateCount = discovery.candidates.length - rankedCandidates.length;
  const importLimit = getResearchImportLimit(payload.choices, contentLanguage);
  const candidatesToImport = rankedCandidates.slice(0, importLimit);
  const remainingCandidates = rankedCandidates.slice(importLimit);

  if (remainingCandidates.length) {
    persistDiscoveredCandidates(persistenceStore, remainingCandidates, now);
  }

  if (!rankedCandidates.length) {
    if (discovery.errors.length) {
      console.error("[aitimeline] research source discovery failed.", discovery.errors);
    }

    if (unsupportedCandidateCount > 0) {
      console.warn(`[aitimeline] research skipped ${unsupportedCandidateCount} unsupported source candidate(s).`);
    }

    const body = discovery.errors.length
      ? researchCopy(contentLanguage, "searchFailed", { detail: "Source discovery failed." })
      : unsupportedCandidateCount > 0
        ? researchCopy(contentLanguage, "importFailed", { detail: "Source candidate type is not supported." })
        : researchCopy(contentLanguage, "empty");
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body,
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      discoveredSourceCandidates: remainingCandidates,
      message: "Research question search produced no importable candidates."
    };
  }

  const origin = {
    turnId: payload.turnId,
    question: payload.question,
    createdAt: now
  };
  const importedResults = [];
  const importFailures = [];

  for (const candidate of candidatesToImport) {
    const candidateWithOrigin = withCandidateOrigin(candidate, origin);

    try {
      const ingested = await ingestSource(candidateWithOrigin);
      const sourceImport = await sourceImportWorker.run({
        source: candidateWithOrigin.source,
        assets: ingested.assets,
        chunks: ingested.chunks,
        sourceRegistry: ingested.sourceRegistry,
        createdAt: now,
        contentLanguage,
        recommendedBecause: researchRecommendedBecause(candidateWithOrigin, contentLanguage),
        userContext: buildSourceQualityUserContext(persistenceStore.getSnapshot(), payload.userId),
        qualityGateConceptHints: candidateWithOrigin.conceptIds,
        sourceQualityVerdicts: persistenceStore.getSnapshot().sourceQualityVerdicts
      });

      const savedSnapshot = persistenceStore.saveSourceImportResult(sourceImport, now);

      if (sourceImport.importRecord.status === "failed") {
        if (sourceImport.errorMessage) {
          console.error("[aitimeline] research source import worker failed.", sourceImport.errorMessage);
        }
        importFailures.push("Source import failed.");
        continue;
      }

      if (sourceImport.posts.length === 0) {
        const mergedPosts = resolveMergedImportPosts(sourceImport, savedSnapshot);

        if (mergedPosts.length) {
          importedResults.push({ ...sourceImport, posts: mergedPosts });
        } else {
          if (sourceImport.errorMessage) {
            console.error("[aitimeline] research source import produced no usable posts.", sourceImport.errorMessage);
          }
          importFailures.push("Source import failed.");
        }
        continue;
      }

      persistenceStore.saveReleasePlan(createSourcePostReleasePlan({ posts: sourceImport.posts, generatedAt: now }), now);
      importedResults.push(sourceImport);
    } catch (error) {
      console.error("[aitimeline] research source import failed.", error);
      importFailures.push("Source import failed.");
    }
  }

  const importedPosts = importedResults.flatMap((result) => result.posts);

  if (!importedPosts.length) {
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body: researchCopy(contentLanguage, "importFailed", {
        detail: importFailures.slice(0, 3).join("; ") || "No imported cards passed validation."
      }),
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      sourceImports: importedResults,
      discoveredSourceCandidates: remainingCandidates,
      message: "Research question imports all failed or were blocked by validation."
    };
  }

  persistAutomaticConceptAliases(persistenceStore, persistenceStore.getSnapshot(), now);
  maybePersistConnectionNote(persistenceStore, {
    beforeImport: snapshot,
    newPosts: importedPosts,
    now,
    contentLanguage
  });

  const answerPost = selectResearchAnswerPost(importedPosts, payload.question);
  const answerRegistry = mergeSourceRegistries(...importedResults.map((result) => result.sourceRegistry));
  const answer = annotateAnswerWithSourceOrigins(
    await askGrounded({ post: answerPost, registry: answerRegistry, question: payload.question }, { client: askModelClient, contentLanguage }),
    answerRegistry,
    payload.turnId,
    contentLanguage
  );
  const notification = createResearchNotification({
    kind: "agent_answer",
    turnId: payload.turnId,
    question: payload.question,
    body: answer.answer,
    postIds: importedPosts.map((post) => post.id),
    citations: answer.citations.map((citation) => ({
      sourceId: citation.sourceId,
      sourceTitle: citation.sourceTitle,
      chunkId: citation.chunkId,
      quote: citation.quote
    })),
    createdAt: now
  });

  persistenceStore.saveNotifications([notification], now);
  updateAgentTurn(persistenceStore, payload.turnId, { status: "answered", answerCardId: answerPost.id }, now);

  return {
    kind: job.kind,
    sourceImports: importedResults,
    discoveredSourceCandidates: remainingCandidates,
    message: `Research question answered with ${importedResults.length} imported sources.`
  };
}

async function handleResearchIdeaJob(
  job,
  persistenceStore,
  sourceImportWorker,
  searchProvider,
  defaultContentLanguage,
  now,
  ingestSource
) {
  const payload = job.researchIdea;

  if (!payload) {
    return {
      kind: job.kind,
      message: "Skipped: research_idea job is missing its payload."
    };
  }

  const contentLanguage = payload.contentLanguage ?? defaultContentLanguage;
  const queryGroups = {
    support: payload.supportQueries ?? [],
    challenge: payload.challengeQueries ?? []
  };

  if (!searchProvider) {
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body: researchCopy(contentLanguage, "unconfigured"),
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      ideaResearchQueries: queryGroups,
      message: "Search provider is not configured; notification was created."
    };
  }

  const beforeImport = persistenceStore.getSnapshot();
  const support = await researchIdeaSide({
    side: "support",
    payload,
    concepts: job.conceptIds,
    queries: queryGroups.support,
    persistenceStore,
    sourceImportWorker,
    searchProvider,
    contentLanguage,
    now,
    ingestSource
  });
  const challenge = await researchIdeaSide({
    side: "challenge",
    payload,
    concepts: job.conceptIds,
    queries: queryGroups.challenge,
    persistenceStore,
    sourceImportWorker,
    searchProvider,
    contentLanguage,
    now,
    ingestSource
  });
  const importedPosts = [...support.posts, ...challenge.posts];

  if (!importedPosts.length) {
    const allErrors = [...support.errors, ...challenge.errors];
    const body = allErrors.length
      ? researchCopy(contentLanguage, "importFailed", {
          detail: allErrors.slice(0, 3).join("; ") || "No imported cards passed validation."
        })
      : researchCopy(contentLanguage, "empty");
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body,
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      ideaResearchQueries: queryGroups,
      sourceImports: [...support.sourceImports, ...challenge.sourceImports],
      discoveredSourceCandidates: [...support.remainingCandidates, ...challenge.remainingCandidates],
      message: "Idea research produced no imported evidence."
    };
  }

  persistAutomaticConceptAliases(persistenceStore, persistenceStore.getSnapshot(), now);
  maybePersistConnectionNote(persistenceStore, {
    beforeImport,
    newPosts: importedPosts,
    now,
    contentLanguage
  });

  const notification = createResearchNotification({
    kind: "agent_answer",
    turnId: payload.turnId,
    question: payload.question,
    body: formatIdeaResearchNotificationBody(support.posts, challenge.posts, contentLanguage),
    postIds: importedPosts.map((post) => post.id),
    citations: buildPostCitations(importedPosts, persistenceStore.getSnapshot()),
    createdAt: now
  });

  persistenceStore.saveNotifications([notification], now);
  updateAgentTurn(persistenceStore, payload.turnId, { status: "answered", answerCardId: importedPosts[0]?.id }, now);

  return {
    kind: job.kind,
    ideaResearchQueries: queryGroups,
    sourceImports: [...support.sourceImports, ...challenge.sourceImports],
    discoveredSourceCandidates: [...support.remainingCandidates, ...challenge.remainingCandidates],
    message: `Idea research imported ${importedPosts.length} sources across both sides.`
  };
}

function createResearchQuestionJob(turnRecord, choices, contentLanguage, now) {
  return {
    id: `research-question-${turnRecord.id}`,
    kind: "research_question",
    postId: turnRecord.answerCardId,
    topicId: `question-${hashText(turnRecord.id)}`,
    conceptIds: [],
    priority: 1,
    reason: "User confirmed a dark-zone question for background research.",
    createdAt: now,
    runAfter: now,
    researchQuestion: {
      turnId: turnRecord.id,
      threadId: turnRecord.threadId,
      userId: turnRecord.userId,
      question: turnRecord.question,
      choices,
      contentLanguage
    }
  };
}

function createResearchIdeaJob(turnRecord, question, concepts, contentLanguage, now) {
  const queryGroups = buildIdeaResearchQueries(question);

  return {
    id: `research-idea-${turnRecord.id}-${hashText(question)}`,
    kind: "research_idea",
    postId: turnRecord.answerCardId,
    topicId: `idea-${hashText(turnRecord.id)}`,
    conceptIds: concepts,
    priority: 1,
    reason: "User asked for supporting and opposing evidence for an idea.",
    createdAt: now,
    runAfter: now,
    researchIdea: {
      turnId: turnRecord.id,
      threadId: turnRecord.threadId,
      userId: turnRecord.userId,
      question,
      ideaPostId: turnRecord.answerCardId,
      supportQueries: queryGroups.support,
      challengeQueries: queryGroups.challenge,
      contentLanguage
    }
  };
}

function createSingleJobPlan(job, generatedAt) {
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

function normalizeChoiceMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, choice]) => typeof key === "string" && key.trim() && typeof choice === "string" && choice.trim())
      .map(([key, choice]) => [key.trim(), choice.trim()])
  );
}

function buildResearchQueries(question, choices, contentLanguage) {
  const selectedOptions = getSelectedConfirmationOptions(choices, contentLanguage);
  const modifiers = selectedOptions.map((option) => option.queryModifier).filter(Boolean);
  const queries = [
    [question, ...modifiers].join(" "),
    [question, modifiers[0]].filter(Boolean).join(" "),
    [question, modifiers[1]].filter(Boolean).join(" ")
  ];

  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean))).slice(0, 3);
}

function buildIdeaResearchQueries(question) {
  const base = question.trim().slice(0, 180);

  return {
    support: [
      `${base} evidence case`,
      `${base} supporting evidence examples`
    ],
    challenge: [
      `${base} criticism limitations counterexample`,
      `${base} contrary evidence limitations`
    ]
  };
}

function getResearchImportLimit(choices, contentLanguage) {
  const depthOption = getSelectedConfirmationOptions(choices, contentLanguage).find(
    (option) => typeof option.importLimit === "number"
  );

  return Math.max(1, Math.min(4, depthOption?.importLimit ?? 2));
}

function getSelectedConfirmationOptions(choices, contentLanguage) {
  const questions = buildDiscoveryConfirmationQuestions(contentLanguage);

  return questions.flatMap((question) => {
    const selectedId = choices[question.id];
    const selected = question.options.find((option) => option.id === selectedId);

    return selected ? [selected] : [];
  });
}

function deriveResearchConcepts(question) {
  return Array.from(tokenizeText(question)).slice(0, 4);
}

function rankResearchCandidates(candidates, question) {
  const questionTokens = tokenizeText(question);

  return candidates
    .filter((candidate) => isSupportedSourceCandidateType(candidate?.source?.type))
    .map((candidate) => {
      const haystack = tokenizeText(
        [candidate.source.title, candidate.reason, candidate.source.url, candidate.conceptIds.join(" ")].join(" ")
      );
      const overlap = questionTokens.size
        ? Array.from(questionTokens).filter((token) => haystack.has(token)).length / questionTokens.size
        : 0;
      const sourceTypeWeight =
        candidate.source.type === "paper" || candidate.source.type === "article" || candidate.source.type === "blog"
          ? 0.08
          : candidate.source.type === "news"
            ? 0.04
            : 0;
      const score =
        candidate.relevanceScore * 0.42 +
        candidate.qualityScore * 0.28 +
        candidate.noveltyScore * 0.12 +
        overlap * 0.1 +
        sourceTypeWeight;

      return { candidate, score };
    })
    .sort((left, right) => right.score - left.score)
    .map((item) => item.candidate);
}

function withCandidateOrigin(candidate, origin) {
  return {
    ...candidate,
    source: {
      ...candidate.source,
      origin
    }
  };
}

function resolveMergedImportPosts(sourceImport, savedSnapshot) {
  const mergedIds = new Set(
    savedSnapshot.mergedSources
      .filter((record) => record.sourceImportId === sourceImport.importRecord.id)
      .map((record) => record.mergedIntoPostId)
  );

  return savedSnapshot.posts.filter((post) => mergedIds.has(post.id));
}

function researchRecommendedBecause(candidate, contentLanguage) {
  if (contentLanguage === "en") {
    return `You asked the agent to research this question, so this source was imported: ${candidate.reason}`;
  }

  return `你委托智能体研究这个问题,所以自动导入这个来源:${candidate.reason}`;
}

function selectResearchAnswerPost(posts, question) {
  const questionTokens = tokenizeText(question);

  return (
    posts
      .map((post) => {
        const haystack = tokenizeText([post.title, post.summary, post.keyTakeaway, post.concepts.join(" ")].join(" "));
        const overlap = questionTokens.size
          ? Array.from(questionTokens).filter((token) => haystack.has(token)).length / questionTokens.size
          : 0;

        return { post, score: overlap };
      })
      .sort((left, right) => right.score - left.score || right.post.createdAt.localeCompare(left.post.createdAt))[0]
      ?.post ?? posts[0]
  );
}

async function researchIdeaSide({
  side,
  payload,
  concepts,
  queries,
  persistenceStore,
  sourceImportWorker,
  searchProvider,
  contentLanguage,
  now,
  ingestSource
}) {
  const snapshot = persistenceStore.getSnapshot();
  const researchConcepts = concepts?.length ? concepts : deriveResearchConcepts(payload.question);
  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts: researchConcepts,
    queries,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    maxQueries: queries.length,
    maxCandidates: 6,
    contentLanguage,
    now
  });
  const rankedCandidates = rankResearchCandidates(discovery.candidates, payload.question);
  const unsupportedCandidateCount = discovery.candidates.length - rankedCandidates.length;
  const candidatesToImport = rankedCandidates.slice(0, 2);
  const remainingCandidates = rankedCandidates.slice(2);
  const importedResults = [];
  const errors = [];

  if (discovery.errors.length) {
    console.error(`[aitimeline] ${side} idea source discovery failed.`, discovery.errors);
    errors.push("Source discovery failed.");
  }

  if (unsupportedCandidateCount > 0) {
    console.warn(`[aitimeline] ${side} idea research skipped ${unsupportedCandidateCount} unsupported candidate(s).`);
    errors.push("Source candidate type is not supported.");
  }

  if (remainingCandidates.length) {
    persistDiscoveredCandidates(persistenceStore, remainingCandidates, now);
  }

  for (const candidate of candidatesToImport) {
    const candidateWithOrigin = withCandidateOrigin(candidate, {
      turnId: payload.turnId,
      question: payload.question,
      createdAt: now
    });

    try {
      const ingested = await ingestSource(candidateWithOrigin);
      const sourceImport = await sourceImportWorker.run({
        source: candidateWithOrigin.source,
        assets: ingested.assets,
        chunks: ingested.chunks,
        sourceRegistry: ingested.sourceRegistry,
        createdAt: now,
        contentLanguage,
        recommendedBecause: ideaResearchRecommendedBecause(candidateWithOrigin, side, contentLanguage),
        userContext: buildSourceQualityUserContext(persistenceStore.getSnapshot(), payload.userId),
        qualityGateConceptHints: candidateWithOrigin.conceptIds,
        sourceQualityVerdicts: persistenceStore.getSnapshot().sourceQualityVerdicts
      });

      const savedSnapshot = persistenceStore.saveSourceImportResult(sourceImport, now);

      if (sourceImport.importRecord.status === "failed") {
        if (sourceImport.errorMessage) {
          console.error(`[aitimeline] ${side} idea source import worker failed.`, sourceImport.errorMessage);
        }
        errors.push("Source import failed.");
        continue;
      }

      if (sourceImport.posts.length === 0) {
        const mergedPosts = resolveMergedImportPosts(sourceImport, savedSnapshot);

        if (mergedPosts.length) {
          importedResults.push({ ...sourceImport, posts: mergedPosts });
        } else {
          if (sourceImport.errorMessage) {
            console.error(`[aitimeline] ${side} idea source import produced no usable posts.`, sourceImport.errorMessage);
          }
          errors.push("Source import failed.");
        }
        continue;
      }

      persistenceStore.saveReleasePlan(createSourcePostReleasePlan({ posts: sourceImport.posts, generatedAt: now }), now);
      importedResults.push(sourceImport);
    } catch (error) {
      console.error(`[aitimeline] ${side} idea source import failed.`, error);
      errors.push("Source import failed.");
    }
  }

  return {
    side,
    sourceImports: importedResults,
    posts: importedResults.flatMap((result) => result.posts),
    remainingCandidates,
    errors
  };
}

function ideaResearchRecommendedBecause(candidate, side, contentLanguage) {
  if (contentLanguage === "en") {
    return side === "support"
      ? `You asked for evidence that may support this idea, so this source was imported: ${candidate.reason}`
      : `You asked for evidence that may challenge this idea, so this source was imported: ${candidate.reason}`;
  }

  return side === "support"
    ? `你要求寻找可能支持这个想法的证据,所以自动导入这个来源:${candidate.reason}`
    : `你要求寻找可能反驳这个想法的证据,所以自动导入这个来源:${candidate.reason}`;
}

function formatIdeaResearchNotificationBody(supportPosts, challengePosts, contentLanguage) {
  const formatPosts = (posts, emptyText) =>
    posts.length
      ? posts.map((post) => {
          const sourceTitle = post.sources[0]?.title;
          const source = sourceTitle
            ? contentLanguage === "en"
              ? ` Source: ${sourceTitle}.`
              : ` 出处:《${sourceTitle}》。`
            : "";

          return `- ${contentLanguage === "en" ? `"${post.title}"` : `《${post.title}》`}.${source} ${post.keyTakeaway}`;
        })
      : [`- ${emptyText}`];

  if (contentLanguage === "en") {
    return [
      "Supporting evidence",
      ...formatPosts(supportPosts, "No reliable source was found for this side."),
      "",
      "Opposing voices",
      ...formatPosts(challengePosts, "No reliable source was found for this side.")
    ].join("\n");
  }

  return [
    "支持的证据",
    ...formatPosts(supportPosts, "没找到这一侧的靠谱来源。"),
    "",
    "相反的声音",
    ...formatPosts(challengePosts, "没找到这一侧的靠谱来源。")
  ].join("\n");
}

function buildPostCitations(posts, snapshot) {
  return posts.flatMap((post) => {
    const citation = post.citations?.[0];
    const source = citation ? post.sources.find((item) => item.id === citation.sourceId) : post.sources[0];
    const registry = source
      ? snapshot.sourceRegistries.find((record) => record.sourceId === source.id)?.registry
      : undefined;
    const chunk = citation?.chunkId
      ? registry?.chunks.find((item) => item.id === citation.chunkId)
      : registry?.chunks[0];

    if (!citation || !source || !chunk) {
      return [];
    }

    return [
      {
        sourceId: source.id,
        sourceTitle: source.title,
        chunkId: citation.chunkId ?? "",
        quote: chunk.content.slice(0, 240)
      }
    ];
  });
}

function createResearchNotification({ kind, turnId, question, body, postIds, citations, createdAt }) {
  return {
    id: `notification-${hashText(`${kind}|${turnId}|${createdAt}|${body}`)}`,
    kind,
    turnId,
    question,
    postIds,
    body,
    citations,
    createdAt
  };
}

function updateAgentTurn(persistenceStore, turnId, patch, now) {
  const snapshot = persistenceStore.getSnapshot();
  const turnRecord = snapshot.agentTurns.find((record) => record.id === turnId);

  if (!turnRecord) {
    return snapshot;
  }

  return persistenceStore.saveAgentTurnRecords([{ ...turnRecord, ...patch }], now);
}

function getPreviousTurns(snapshot, userId, threadId) {
  return snapshot.agentTurns
    .filter((record) => record.userId === userId && record.threadId === threadId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-5);
}

function annotateAnswerWithSourceOrigins(answer, registry, currentTurnId, contentLanguage) {
  const originNotes = [];
  const seen = new Set();

  for (const citation of answer.citations) {
    const origin =
      citation.origin ??
      registry.sources.find((source) => source.id === citation.sourceId)?.origin;

    if (!origin || origin.turnId === currentTurnId || seen.has(origin.turnId)) {
      continue;
    }

    seen.add(origin.turnId);
    originNotes.push(formatOriginNote(origin, contentLanguage));
  }

  if (!originNotes.length) {
    return answer;
  }

  return {
    ...answer,
    answer: `${answer.answer}\n\n${originNotes.join("\n")}`
  };
}

function formatOriginNote(origin, contentLanguage) {
  const date = new Date(origin.createdAt);

  if (contentLanguage === "en") {
    return `This evidence came from your ${date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    })} question "${origin.question}".`;
  }

  return `这条证据来自你 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日的提问『${origin.question}』。`;
}

function researchCopy(contentLanguage, key, vars = {}) {
  const templates =
    contentLanguage === "en"
      ? {
          unconfigured: "Search is not configured. Set AITIMELINE_SEARCH_API_KEY in .env and try again.",
          empty: "I searched for sources but did not find any new importable candidates.",
          searchFailed: "Source search failed before any importable candidate was found: {detail}",
          importFailed: "Research finished, but every imported source failed or was blocked by validation: {detail}"
        }
      : {
          unconfigured: "搜索服务未配置,请在 .env 设置 AITIMELINE_SEARCH_API_KEY 后再试。",
          empty: "已经搜索来源,但没有找到可导入的新候选。",
          searchFailed: "来源搜索失败,还没有找到可导入候选:{detail}",
          importFailed: "研究已完成,但导入的来源都没有通过门禁或导入失败:{detail}"
        };
  const template = templates[key] ?? "";

  return Object.entries(vars).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template
  );
}

function tokenizeText(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

// Execute the discovery proposal inline when a provider is configured;
// otherwise the proposal is returned for the client to display.
async function executeDiscoveryAction(turn, snapshot, memory, searchProvider, persistenceStore, now, contentLanguage) {
  const discoverAction = turn.actions.find((action) => action.kind === "discover_sources");

  if (!discoverAction || !searchProvider) {
    return [];
  }

  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts: discoverAction.concepts,
    queries: discoverAction.queries,
    goals: memory?.profile.goals,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    contentLanguage,
    now
  });
  const candidates = discovery.candidates.filter((candidate) =>
    isSupportedSourceCandidateType(candidate?.source?.type)
  );

  if (candidates.length) {
    persistDiscoveredCandidates(persistenceStore, candidates, now);
  }

  return candidates;
}

// On-demand discovery for the reply chip: the user clicks "为这个问题找来源".
// Without a configured search provider this reports configured=false instead
// of erroring, so the UI can point at manual import.
async function handleDiscoveryRun(body, userId, persistenceStore, searchProvider, contentLanguage) {
  const queries = toTrimmedStrings(body.queries).slice(0, 3);
  const concepts = toTrimmedStrings(body.concepts).slice(0, 5);

  if (!queries.length && !concepts.length) {
    throw new HttpError(400, "discovery needs at least one query or concept.");
  }

  if (!searchProvider) {
    return { configured: false, candidates: [] };
  }

  const snapshot = persistenceStore.getSnapshot();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const now = new Date().toISOString();
  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts,
    queries,
    goals: memory?.profile.goals,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    contentLanguage,
    now
  });
  const candidates = discovery.candidates.filter((candidate) =>
    isSupportedSourceCandidateType(candidate?.source?.type)
  );

  if (candidates.length) {
    persistDiscoveredCandidates(persistenceStore, candidates, now);
  }

  return { configured: true, candidates };
}

function toTrimmedStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

function cloneAnswerCitations(answer) {
  return answer?.citations ? structuredClone(answer.citations) : [];
}

// A user note becomes a first-class post (self-grounded source) and the
// observer replies against the existing library, metered as an agent turn.
async function handleUserNote(body, userId, persistenceStore, client, searchProvider, contentLanguage) {
  if (body.kind === "idea") {
    return handleUserIdeaNote(body, userId, persistenceStore, client, contentLanguage);
  }

  const snapshot = persistenceStore.getSnapshot();
  const now = typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const libraryPosts = getKnowledgePosts(snapshot.posts);
  const libraryConcepts = Array.from(new Set(libraryPosts.flatMap((post) => post.concepts)));
  const note = transformUserNote(body.text, { createdAt: now, libraryConcepts, contentLanguage });

  // Reply from the pre-note library only, so the observer grounds its answer
  // in imported sources instead of echoing the note back.
  const registry = mergeSourceRegistries(...snapshot.sourceRegistries.map((record) => record.registry));
  const turn = await runConversationTurn(
    {
      question: note.post.summary,
      posts: libraryPosts,
      registry,
      memory,
      userSignals: toUserSignals(snapshot.interactionSignals),
      now
    },
    { client, contentLanguage }
  );

  // Persist the observer's reply on the note itself so the thread survives reloads.
  const replyBody = turn.answer ? turn.answer.answer : turn.notes.join(" ");
  const replySourceTitle = turn.answer?.citations?.[0]?.sourceTitle;
  const notePost = {
    ...note.post,
    thread: replyBody
      ? [
          {
            id: `${note.post.id}-agent-reply-1`,
            kind: "agent_reply",
            title:
              contentLanguage === "en"
                ? replySourceTitle
                  ? `Knowledge Observer · Source: ${replySourceTitle}`
                  : "Knowledge Observer"
                : replySourceTitle
                  ? `知识观察员 · 来源:${replySourceTitle}`
                  : "知识观察员",
            body: replyBody,
            citations: cloneAnswerCitations(turn.answer),
            grounded: turn.answer?.grounded ?? false,
            ...(turn.answer?.runnerKind ? { runnerKind: turn.answer.runnerKind } : {})
          }
        ]
      : []
  };

  persistenceStore.saveSourceImportResult(
    {
      importRecord: note.importRecord,
      source: note.source,
      assets: [note.asset],
      chunks: note.chunks,
      sourceRegistry: note.sourceRegistry,
      posts: [notePost]
    },
    now
  );

  const discoveredCandidates = await executeDiscoveryAction(
    turn,
    snapshot,
    memory,
    searchProvider,
    persistenceStore,
    now,
    contentLanguage
  );

  if (turn.signal) {
    persistenceStore.saveInteractionSignalRecords(
      [
        {
          id: buildInteractionSignalRecordId(turn.signal),
          signal: turn.signal,
          feedback: evaluateInteraction(turn.signal, deriveTopicState(turn.signal)),
          createdAt: now
        }
      ],
      now
    );
  }

  const memoryEditResult = applyUserMemoryEdits(
    memory ?? createEmptyUserMemory(),
    [
      {
        kind: "add",
        field: "interaction.recentQuestions",
        value: turn.question,
        reason: "User posted a note to the timeline."
      }
    ],
    now
  );

  persistenceStore.saveUserMemory(userId, memoryEditResult.memory, memoryEditResult.events, now);

  const turnRecord = {
    id: `agent-turn-${hashText(`${userId}|note|${turn.question}|${now}`)}`,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
    status: "answered",
    threadId: `agent-thread-note-${note.post.id}`,
    answerCardId: turn.answerCardId,
    createdAt: now
  };
  const finalSnapshot = persistenceStore.saveAgentTurnRecords([turnRecord], now);

  return {
    post: notePost,
    turn,
    turnRecord,
    discoveredCandidates,
    snapshotSummary: summarizeSnapshot(finalSnapshot)
  };
}

async function handleUserIdeaNote(body, userId, persistenceStore, client, contentLanguage) {
  const snapshot = persistenceStore.getSnapshot();
  const now = typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString();
  const libraryPosts = getKnowledgePosts(snapshot.posts);
  const libraryConcepts = Array.from(new Set(libraryPosts.flatMap((post) => post.concepts)));
  const note = transformUserNote(body.text, {
    createdAt: now,
    kind: "idea",
    libraryConcepts,
    libraryCards: libraryPosts,
    conceptAliases: snapshot.conceptAliases,
    contentLanguage
  });
  const turn = await runIdeaObservation(
    {
      idea: body.text,
      posts: libraryPosts,
      conceptAliases: snapshot.conceptAliases,
      now
    },
    { client, contentLanguage }
  );
  const replyBody = turn.notes.join("\n\n");
  const notePost = {
    ...note.post,
    thread: replyBody
      ? [
          {
            id: `${note.post.id}-agent-reply-1`,
            kind: "agent_reply",
            title: contentLanguage === "en" ? "Knowledge Observer" : "知识观察员",
            body: replyBody,
            citations: [],
            grounded: false
          }
        ]
      : []
  };

  persistenceStore.saveSourceImportResult(
    {
      importRecord: note.importRecord,
      source: note.source,
      assets: [note.asset],
      chunks: note.chunks,
      sourceRegistry: note.sourceRegistry,
      posts: [notePost]
    },
    now
  );

  const turnRecord = {
    id: `agent-turn-${hashText(`${userId}|idea|${turn.question}|${now}`)}`,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
    status: "answered",
    threadId: `agent-thread-idea-${note.post.id}`,
    createdAt: now
  };
  const finalSnapshot = persistenceStore.saveAgentTurnRecords([turnRecord], now);

  return {
    post: notePost,
    turn,
    turnRecord,
    discoveredCandidates: [],
    snapshotSummary: summarizeSnapshot(finalSnapshot)
  };
}

// A comment on a knowledge card becomes a public in-post thread: the user's
// comment and the observer's grounded reply are both appended to the card's
// thread and persisted, and the reply is metered as an agent turn.
async function handlePostReply(postId, body, userId, persistenceStore, client, searchProvider, contentLanguage) {
  const snapshot = persistenceStore.getSnapshot();
  const post = snapshot.posts.find((candidate) => candidate.id === postId);

  if (!post) {
    throw new HttpError(404, `No post found for id ${postId}.`);
  }

  const now = typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const registry = mergeSourceRegistries(...snapshot.sourceRegistries.map((record) => record.registry));
  const commentText = body.text.trim();

  // Ground the reply against this specific card, so the observer answers from
  // the card's own sources instead of routing by concept overlap.
  const turn = await runConversationTurn(
    {
      question: commentText,
      postId,
      posts: getKnowledgePosts(snapshot.posts),
      registry,
      memory,
      userSignals: toUserSignals(snapshot.interactionSignals),
      now
    },
    { client, contentLanguage }
  );

  const replyBody = turn.answer ? turn.answer.answer : turn.notes.join(" ");
  const replySourceTitle = turn.answer?.citations?.[0]?.sourceTitle;
  const commentBlock = {
    id: `${post.id}-user-comment-${randomUUID()}`,
    kind: "user_comment",
    title: contentLanguage === "en" ? "You" : "你",
    body: commentText
  };
  const replyBlock = replyBody
    ? {
        id: `${post.id}-agent-reply-${randomUUID()}`,
        kind: "agent_reply",
        title:
          contentLanguage === "en"
            ? replySourceTitle
              ? `Knowledge Observer · Source: ${replySourceTitle}`
              : "Knowledge Observer"
            : replySourceTitle
              ? `知识观察员 · 来源:${replySourceTitle}`
              : "知识观察员",
        body: replyBody,
        citations: cloneAnswerCitations(turn.answer),
        grounded: turn.answer?.grounded ?? false,
        ...(turn.answer?.runnerKind ? { runnerKind: turn.answer.runnerKind } : {})
      }
    : null;
  const appendedSnapshot = persistenceStore.appendThreadBlocks(
    postId,
    [commentBlock, ...(replyBlock ? [replyBlock] : [])],
    { expectedRevision: snapshot.revision, savedAt: now }
  );
  const appendedPost = appendedSnapshot.posts.find((candidate) => candidate.id === postId);

  const discoveredCandidates = await executeDiscoveryAction(
    turn,
    snapshot,
    memory,
    searchProvider,
    persistenceStore,
    now,
    contentLanguage
  );

  if (turn.signal) {
    persistenceStore.saveInteractionSignalRecords(
      [
        {
          id: buildInteractionSignalRecordId(turn.signal),
          signal: turn.signal,
          feedback: evaluateInteraction(turn.signal, deriveTopicState(turn.signal)),
          createdAt: now
        }
      ],
      now
    );
  }

  const latestMemory = persistenceStore
    .getSnapshot()
    .userMemories.find((record) => record.userId === userId)?.memory;
  const memoryEditResult = applyUserMemoryEdits(
    latestMemory ?? createEmptyUserMemory(),
    [
      {
        kind: "add",
        field: "interaction.recentQuestions",
        value: turn.question,
        reason: "User commented on a knowledge card."
      }
    ],
    now
  );

  persistenceStore.saveUserMemory(userId, memoryEditResult.memory, memoryEditResult.events, now);

  const turnRecord = {
    id: `agent-turn-${hashText(`${userId}|reply|${postId}|${turn.question}|${now}`)}`,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
    status: "answered",
    threadId: `agent-thread-post-${postId}`,
    answerCardId: turn.answerCardId,
    createdAt: now
  };
  const finalSnapshot = persistenceStore.saveAgentTurnRecords([turnRecord], now);

  return {
    post: appendedPost,
    turn,
    turnRecord,
    discoveredCandidates,
    snapshotSummary: summarizeSnapshot(finalSnapshot)
  };
}

async function discoverSourcesForJob(job, searchProvider, persistenceStore, contentLanguage) {
  if (!searchProvider) {
    return [];
  }

  const snapshot = persistenceStore.getSnapshot();
  const concepts = getConfirmedDiscoveryConcepts(snapshot, job.conceptIds);

  if (!concepts.length) {
    return [];
  }

  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts,
    topicId: job.topicId,
    nextAction: job.nextAction,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    contentLanguage
  });

  const supportedCandidates = discovery.candidates.filter((candidate) =>
    isSupportedSourceCandidateType(candidate?.source?.type)
  );

  if (supportedCandidates.length !== discovery.candidates.length) {
    console.warn(
      `[aitimeline] background discovery skipped ${discovery.candidates.length - supportedCandidates.length} unsupported candidate(s).`
    );
  }

  return supportedCandidates;
}

function getConfirmedDiscoveryConcepts(snapshot, proposedConcepts) {
  const confirmed = new Set(collectConfirmedDiscoveryConcepts(snapshot).map(normalizeConceptKey));

  return toTrimmedStrings(proposedConcepts).filter((concept) => confirmed.has(normalizeConceptKey(concept)));
}

function collectConfirmedDiscoveryConcepts(snapshot) {
  const confirmed = new Set();

  for (const record of snapshot.topicStates) {
    if (record.topicId) {
      confirmed.add(record.topicId.trim());
    }
  }

  for (const record of snapshot.interactionSignals) {
    const signal = record.signal;
    const confirmedByInteraction = signal.liked || signal.saved || signal.askedQuestion || signal.reviewed;

    if (!confirmedByInteraction) {
      continue;
    }

    for (const concept of [signal.topicId, ...(signal.conceptIds ?? [])]) {
      if (typeof concept === "string" && concept.trim()) {
        confirmed.add(concept.trim());
      }
    }
  }

  for (const memoryRecord of snapshot.userMemories) {
    for (const concept of [
      ...(memoryRecord.memory.profile.interests ?? []),
      ...(memoryRecord.memory.knowledge.knownConcepts ?? []),
      ...(memoryRecord.memory.knowledge.savedConcepts ?? []),
      ...(memoryRecord.memory.knowledge.weakConcepts ?? [])
    ]) {
      if (typeof concept === "string" && concept.trim()) {
        confirmed.add(concept.trim());
      }
    }
  }

  for (const concept of collectActiveLearningGoalConcepts(snapshot, "local-user")) {
    if (typeof concept === "string" && concept.trim()) {
      confirmed.add(concept.trim());
    }
  }

  return Array.from(confirmed);
}

function persistDiscoveredCandidates(persistenceStore, candidates, now) {
  const snapshot = persistenceStore.getSnapshot();
  const existingIds = new Set(snapshot.sourceCandidates.map((record) => record.id));
  const newRecords = candidates
    .filter((candidate) => {
      if (isSupportedSourceCandidateType(candidate?.source?.type)) {
        return true;
      }

      console.warn(
        `[aitimeline] skipped unsupported discovered source candidate (${candidate?.id ?? "unknown"}); supported types are article, blog, news, and youtube.`
      );
      return false;
    })
    .filter((candidate) => !existingIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      candidate,
      status: "pending",
      intakeKind: "agent_discovery",
      createdAt: now,
      updatedAt: now
    }));

  return newRecords.length ? persistenceStore.saveSourceCandidateRecords(newRecords, now) : snapshot;
}

// One classification for a terminal import_source job drives both halves of the
// bookkeeping: which budget slot the attempt consumed, and where the candidate
// lands in the pool. Splitting them is how candidates used to rot in `queued`.
export function classifyTerminalImportSource({ record, sourceImport, candidateRecord }) {
  if (record.status === "succeeded") {
    const producedCards = sourceImport?.posts?.length ?? 0;
    const gateRejected = sourceImport?.qualityGate?.verdict === "reject";
    const importedDifferentSource = Boolean(
      sourceImport &&
        candidateRecord &&
        sourceImport.source.id !== candidateRecord.candidate.source.id &&
        sourceImport.source.url !== candidateRecord.candidate.source.url
    );
    // A gate-rejected job that still produced a card took the same-source
    // fallback lane: the candidate is retired, but the slot did buy a card.
    // A zero-card success is a dedupe/merge into an existing card, not a loss.
    const settlement = gateRejected && producedCards === 0 ? "gate_rejected" : "produced";

    if (gateRejected || importedDifferentSource) {
      return {
        settlement,
        candidateStatus: "rejected_source",
        qualityGate: sourceImport?.qualityGate,
        rejectionReasons:
          sourceImport?.qualityGate?.reasons ??
          (importedDifferentSource ? [sourceCandidateFailureMessages.fallbackSource] : [])
      };
    }

    return { settlement, candidateStatus: "imported", rejectionReasons: [] };
  }

  if (isTranscriptUnavailableMessage(record.lastError)) {
    return {
      settlement: "import_failed",
      candidateStatus: "skipped",
      rejectionReasons: [sourceCandidateFailureMessages.transcriptUnavailable]
    };
  }

  if (isNetworkFailureMessage(record.lastError)) {
    // Nothing was fetched, so no model was called: give the slot back.
    return {
      settlement: "import_failed_refundable",
      candidateStatus: "unreachable",
      rejectionReasons: [sourceCandidateFailureMessages.unreachable]
    };
  }

  return {
    settlement: "import_failed",
    candidateStatus: "skipped",
    rejectionReasons: [sourceCandidateFailureMessages.importFailed]
  };
}

function applySourceCandidateOutcome(candidateRecord, outcome, now) {
  return {
    ...candidateRecord,
    status: outcome.candidateStatus,
    updatedAt: now,
    ...(outcome.candidateStatus === "imported" ? { importedAt: now } : {}),
    ...(outcome.candidateStatus === "rejected_source" ? { rejectedAt: now } : {}),
    ...(outcome.qualityGate ? { qualityGate: outcome.qualityGate } : {}),
    ...(outcome.rejectionReasons?.length
      ? {
          rejectionReasons: mergeCandidateRejectionReasons(
            candidateRecord.rejectionReasons,
            outcome.rejectionReasons
          )
        }
      : {})
  };
}

function mergeCandidateRejectionReasons(previous, next) {
  const merged = [...(previous ?? [])];

  for (const reason of next) {
    if (!merged.includes(reason)) {
      merged.push(reason);
    }
  }

  return merged;
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

function isTranscriptUnavailableMessage(message) {
  if (typeof message !== "string" || !message.trim()) {
    return false;
  }

  return /does not expose transcript tracks|did not contain any readable segments|transcript track is missing|no usable transcript/i.test(
    message
  );
}

function isNetworkFailureMessage(message) {
  if (typeof message !== "string" || !message.trim()) {
    return false;
  }

  return /(?:fetch failed|could not be fetched|could not be resolved|did not resolve|dns|network|timeout|timed out|abort|aborted|econnrefused|econnreset|enotfound|etimedout|eai_again|und_err_connect_timeout|socket|request failed with \d{3}|http status \d{3})/i.test(
    message
  );
}

function collectKnownSourceUrls(snapshot) {
  return [
    ...snapshot.posts.flatMap((post) => post.sources.map((source) => source.url)),
    ...snapshot.sourceRegistries.flatMap((record) => record.registry.sources.map((source) => source.url)),
    ...snapshot.sourceCandidates.map((record) => record.candidate.source.url)
  ];
}

function collectKnownSourceTitles(snapshot) {
  return [
    ...snapshot.posts.map((post) => post.title),
    ...snapshot.sourceCandidates.map((record) => record.candidate.source.title)
  ];
}

function dedupePostsById(posts) {
  const byId = new Map();

  for (const post of posts) {
    byId.set(post.id, post);
  }

  return Array.from(byId.values());
}

function getKnowledgePosts(posts) {
  return posts.filter((post) => post.kind !== "connection_note");
}

function maybeCreateInitialReviewState(snapshot, signal, generatedAt) {
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

function backfillLegacyReviewStates(persistenceStore, savedAt) {
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

function selectReviewPrompt(post, intervalDays) {
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

function createReviewStateForGrade(reviewState, reviewedAt, grade) {
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

function buildReviewEventRecordId(postId, reviewEventId) {
  return `review-event-${sanitizeSlug(postId)}-${hashText(`${postId}|${reviewEventId}`)}`;
}

function buildReviewCompletionRecordId(postId, reviewedAt) {
  return `review-complete-${sanitizeSlug(postId)}-${hashText(`${postId}|${reviewedAt}`)}`;
}

function promoteMasteryAfterReview({ persistenceStore, snapshot, post, userId, reviewedAt, contentLanguage }) {
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

function getSnapshotUserMemory(snapshot, userId) {
  return snapshot.userMemories.find((record) => record.userId === userId)?.memory ?? createEmptyUserMemory();
}

function handleListLearningGoals({ persistenceStore, curationStore, userId, contentLanguage, now }) {
  let snapshot = persistenceStore.getSnapshot();
  const achievementResult = markAchievedLearningGoals({
    persistenceStore,
    snapshot,
    userId,
    contentLanguage,
    now
  });

  snapshot = achievementResult.snapshot;

  const activeTrees = snapshot.learningGoals
    .filter((record) => record.status === "active")
    .flatMap((record) => {
      const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);

      return treeResult.tree ? [treeResult.tree] : [];
    });
  const productionResult = queueGapConceptBriefsForSkillTrees({
    trees: activeTrees,
    persistenceStore,
    curationStore,
    snapshot,
    contentLanguage,
    now,
    limit: 3
  });

  snapshot = productionResult.snapshot;

  return {
    records: snapshot.learningGoals.map((record) => decorateLearningGoalRecord(record, snapshot, userId)),
    achieved: achievementResult.achievedGoals,
    gapProduction: omitSnapshotFromProductionResult(productionResult),
    snapshotSummary: summarizeSnapshot(snapshot)
  };
}

function handleCreateLearningGoal({ body, persistenceStore, curationStore, userId, contentLanguage }) {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be an object.");
  }

  requireString(body.concept, "concept");
  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  let snapshot = markAchievedLearningGoals({
    persistenceStore,
    snapshot: persistenceStore.getSnapshot(),
    userId,
    contentLanguage,
    now
  }).snapshot;
  const treeResult = buildLearningGoalTree(snapshot, body.concept, userId);

  if (!treeResult.tree) {
    throw new HttpError(400, "Learning goal concept must exist in the knowledge graph.");
  }

  const goalKey = treeResult.tree.goalId;
  const existingActive = snapshot.learningGoals.find(
    (record) =>
      record.status === "active" &&
      buildLearningGoalTree(snapshot, record.concept, userId).tree?.goalId === goalKey
  );

  if (existingActive) {
    const productionResult = queueGapConceptBriefsForSkillTrees({
      trees: [treeResult.tree],
      persistenceStore,
      curationStore,
      snapshot,
      contentLanguage,
      now,
      limit: 3
    });

    snapshot = productionResult.snapshot;

    return {
      record: decorateLearningGoalRecord(existingActive, snapshot, userId),
      records: snapshot.learningGoals.map((record) => decorateLearningGoalRecord(record, snapshot, userId)),
      gapProduction: omitSnapshotFromProductionResult(productionResult),
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  if (snapshot.learningGoals.filter((record) => record.status === "active").length >= 3) {
    throw new HttpError(400, "At most 3 active learning goals are allowed.");
  }

  const record = {
    id: `learning-goal-${hashText(`${goalKey}|${now}`)}`,
    concept: treeResult.tree.goalConcept,
    createdAt: now,
    status: "active"
  };

  snapshot = persistenceStore.saveLearningGoals([record], now);
  const achievementResult = markAchievedLearningGoals({
    persistenceStore,
    snapshot,
    userId,
    contentLanguage,
    now
  });

  snapshot = achievementResult.snapshot;

  const savedRecord = snapshot.learningGoals.find((item) => item.id === record.id) ?? record;
  const savedTreeResult = buildLearningGoalTree(snapshot, savedRecord.concept, userId);
  const productionResult =
    savedRecord.status === "active" && savedTreeResult.tree
      ? queueGapConceptBriefsForSkillTrees({
          trees: [savedTreeResult.tree],
          persistenceStore,
          curationStore,
          snapshot,
          contentLanguage,
          now,
          limit: 3
        })
      : { snapshot, queued: false, records: [], budget: undefined, discardedJobIds: [], skippedConcepts: [] };

  snapshot = productionResult.snapshot;

  return {
    record: decorateLearningGoalRecord(savedRecord, snapshot, userId),
    records: snapshot.learningGoals.map((item) => decorateLearningGoalRecord(item, snapshot, userId)),
    achieved: achievementResult.achievedGoals,
    gapProduction: omitSnapshotFromProductionResult(productionResult),
    snapshotSummary: summarizeSnapshot(snapshot)
  };
}

function handleArchiveLearningGoal(goalId, body, persistenceStore) {
  if (!body || typeof body !== "object" || body.status !== "archived") {
    throw new HttpError(400, "Only status \"archived\" is supported.");
  }

  const snapshot = persistenceStore.getSnapshot();
  const record = snapshot.learningGoals.find((item) => item.id === goalId);

  if (!record) {
    throw new HttpError(404, "Learning goal not found.");
  }

  const now = new Date().toISOString();
  const nextRecord = { ...record, status: "archived" };
  const nextSnapshot = persistenceStore.saveLearningGoals([nextRecord], now);

  return {
    record: nextSnapshot.learningGoals.find((item) => item.id === goalId) ?? nextRecord,
    records: nextSnapshot.learningGoals,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

function decorateLearningGoalRecord(record, snapshot, userId) {
  if (record.status !== "active") {
    return record;
  }

  const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);

  return {
    ...record,
    tree: treeResult.tree,
    treeReason: treeResult.reason
  };
}

function buildLearningGoalTree(snapshot, concept, userId = "local-user") {
  const memory = getSnapshotUserMemory(snapshot, userId);

  return buildSkillTree({
    goalConcept: concept,
    cards: snapshot.posts,
    conceptAliases: snapshot.conceptAliases,
    knownConcepts: memory.knowledge.knownConcepts
  });
}

function markAchievedLearningGoals({ persistenceStore, snapshot, userId, contentLanguage, now }) {
  const achievedAt = normalizeIsoDate(now);
  const achievedGoals = [];
  const updates = [];

  for (const record of snapshot.learningGoals) {
    if (record.status !== "active") {
      continue;
    }

    const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);
    const goalNode = treeResult.tree?.nodes.find((node) => node.id === treeResult.tree?.goalId);

    if (!goalNode?.mastered) {
      continue;
    }

    const nextRecord = {
      ...record,
      status: "achieved",
      achievedAt
    };

    updates.push(nextRecord);
    achievedGoals.push(nextRecord);
  }

  if (!updates.length) {
    return { snapshot, achievedGoals: [] };
  }

  let nextSnapshot = persistenceStore.saveLearningGoals(updates, achievedAt);

  nextSnapshot = persistenceStore.saveNotifications(
    updates.map((record) => createLearningGoalAchievedNotification(record, snapshot, userId, contentLanguage, achievedAt)),
    achievedAt
  );

  return { snapshot: nextSnapshot, achievedGoals: updates };
}

function createLearningGoalAchievedNotification(record, snapshot, userId, contentLanguage, createdAt) {
  const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);
  const goalNode = treeResult.tree?.nodes.find((node) => node.id === treeResult.tree?.goalId);
  const body =
    contentLanguage === "en"
      ? `#${record.concept} learning goal achieved. The path is now complete.`
      : `#${record.concept} 学习目标已达成,这条路径已完成。`;

  return {
    id: `notification-${hashText(`learning_goal_achieved|${record.id}`)}`,
    kind: "learning_goal_achieved",
    turnId: `learning-goal-${hashText(record.id)}`,
    postIds: goalNode?.postIds ?? [],
    body,
    createdAt
  };
}

function queueGapConceptBriefsForSkillTrees({
  trees,
  persistenceStore,
  curationStore,
  snapshot,
  contentLanguage,
  now,
  limit
}) {
  const nowIso = normalizeIsoDate(now);
  const existingBriefKeys = new Set(snapshot.conceptBriefs.map((brief) => normalizeConceptKey(brief.concept)));
  const existingJobKeys = new Set(
    curationStore
      .list()
      .filter((record) => record.job.kind === "concept_brief" && record.status !== "failed")
      .map((record) => normalizeConceptKey(record.job.topicId))
  );
  const selectedConcepts = [];
  const selectedKeys = new Set();

  for (const tree of trees) {
    for (const node of tree.nodes) {
      const key = normalizeConceptKey(node.concept);

      if (
        !node.gap ||
        node.mastered ||
        !key ||
        selectedKeys.has(key) ||
        existingBriefKeys.has(key) ||
        existingJobKeys.has(key)
      ) {
        continue;
      }

      selectedKeys.add(key);
      selectedConcepts.push(node.concept);

      if (selectedConcepts.length >= limit) {
        break;
      }
    }

    if (selectedConcepts.length >= limit) {
      break;
    }
  }

  if (!selectedConcepts.length) {
    return {
      snapshot,
      queued: false,
      records: [],
      budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
      discardedJobIds: [],
      skippedConcepts: []
    };
  }

  const jobs = selectedConcepts.map((concept) => {
    const input = buildConceptBriefInput(snapshot, concept, contentLanguage, nowIso);

    return createConceptBriefJob(input.concept, input.cards.length, nowIso);
  });
  const rawPlan = createSingleJobPlan(jobs, nowIso);
  const budgetResult = applyDailyAutoJobBudget({
    plan: rawPlan,
    budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
    limit: getDailyAutoJobBudgetLimit(process.env),
    now: nowIso
  });
  const records = curationStore.enqueuePlan(budgetResult.plan, nowIso);
  let nextSnapshot = persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], nowIso);

  if (records.length) {
    nextSnapshot = persistenceStore.saveCurationJobRecords(records, nowIso);
  }

  return {
    snapshot: nextSnapshot,
    queued: records.length > 0,
    records,
    budget: budgetResult.budget,
    discardedJobIds: budgetResult.discardedJobIds,
    skippedConcepts: selectedConcepts.filter(
      (concept) => !records.some((record) => normalizeConceptKey(record.job.topicId) === normalizeConceptKey(concept))
    )
  };
}

function queueDailyLearningGoalProductionGuarantee({
  persistenceStore,
  curationStore,
  userId,
  contentLanguage,
  now
}) {
  const nowIso = normalizeIsoDate(now);
  const date = getDayKey(nowIso);
  const snapshot = persistenceStore.getSnapshot();
  const jobs = [];
  // Goals with overlapping closures must not pick the same demand twice in one
  // run, or one piece of work would consume two budget slots.
  const selectedBriefKeys = new Set();
  const selectedFollowupKeys = new Set();

  for (const goal of snapshot.learningGoals.filter((record) => record.status === "active")) {
    const treeResult = buildLearningGoalTree(snapshot, goal.concept, userId);
    const tree = treeResult.tree;

    if (!tree || hasGoalProductionForDate({ snapshot, curationStore, tree, date })) {
      continue;
    }

    const closureKeys = createTreeConceptKeySet(tree);

    if (jobs.some((job) => jobOverlapsTree(job, closureKeys))) {
      continue;
    }

    const demand =
      selectGoalGapConceptBriefDemand({ snapshot, curationStore, tree, contentLanguage, now: nowIso, selectedBriefKeys }) ??
      selectGoalFollowupDemand({ snapshot, curationStore, tree, goal, now: nowIso, date, selectedFollowupKeys });

    if (demand) {
      if (demand.kind === "concept_brief") {
        selectedBriefKeys.add(normalizeConceptKey(demand.topicId));
      } else {
        selectedFollowupKeys.add(`${demand.postId}|${demand.nextAction}`);
      }

      jobs.push(demand);
    }
  }

  if (!jobs.length) {
    return {
      snapshot,
      queued: false,
      records: [],
      budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
      discardedJobIds: [],
      skippedConcepts: []
    };
  }

  const rawPlan = createSingleJobPlan(jobs, nowIso);
  const budgetResult = applyDailyAutoJobBudget({
    plan: rawPlan,
    budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
    limit: getDailyAutoJobBudgetLimit(process.env),
    now: nowIso
  });
  const records = curationStore.enqueuePlan(budgetResult.plan, nowIso);
  const queuedJobIds = new Set(records.map((record) => record.job.id));
  let nextSnapshot = persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], nowIso);

  if (records.length) {
    nextSnapshot = persistenceStore.saveCurationJobRecords(records, nowIso);
  }

  return {
    snapshot: nextSnapshot,
    queued: records.length > 0,
    records,
    budget: budgetResult.budget,
    discardedJobIds: budgetResult.discardedJobIds,
    skippedConcepts: jobs.filter((job) => !queuedJobIds.has(job.id)).map((job) => job.topicId)
  };
}

function hasGoalProductionForDate({ snapshot, curationStore, tree, date }) {
  const closureKeys = createTreeConceptKeySet(tree);

  if (
    snapshot.conceptBriefs.some(
      (brief) =>
        brief.generatedAt &&
        getDayKey(brief.generatedAt) === date &&
        closureKeys.has(normalizeConceptKey(brief.concept))
    )
  ) {
    return true;
  }

  return curationStore
    .list()
    .some(
      (record) =>
        record.status !== "failed" &&
        [record.createdAt, record.completedAt, record.updatedAt].some(
          (value) => value && getDayKey(value) === date
        ) &&
        isLearningGoalProductionJob(record.job) &&
        jobOverlapsTree(record.job, closureKeys)
    );
}

function selectGoalGapConceptBriefDemand({ snapshot, curationStore, tree, contentLanguage, now, selectedBriefKeys }) {
  const existingBriefKeys = new Set(snapshot.conceptBriefs.map((brief) => normalizeConceptKey(brief.concept)));
  const existingJobKeys = new Set(
    curationStore
      .list()
      .filter((record) => record.job.kind === "concept_brief" && record.status !== "failed")
      .map((record) => normalizeConceptKey(record.job.topicId))
  );

  for (const node of tree.nodes) {
    const key = normalizeConceptKey(node.concept);

    if (
      !node.gap ||
      node.mastered ||
      !key ||
      existingBriefKeys.has(key) ||
      existingJobKeys.has(key) ||
      selectedBriefKeys?.has(key)
    ) {
      continue;
    }

    const input = buildConceptBriefInput(snapshot, node.concept, contentLanguage, now);

    return createConceptBriefJob(input.concept, input.cards.length, now);
  }

  return null;
}

function selectGoalFollowupDemand({ snapshot, curationStore, tree, goal, now, date, selectedFollowupKeys }) {
  const closureKeys = createTreeConceptKeySet(tree);
  const existingFollowupKeys = new Set(
    curationStore
      .list()
      .filter((record) => record.job.kind === "generate_followup" && record.status !== "failed")
      .map((record) => `${record.job.postId ?? ""}|${record.job.nextAction ?? ""}`)
  );

  for (const key of selectedFollowupKeys ?? []) {
    existingFollowupKeys.add(key);
  }
  const candidates = snapshot.posts
    .filter((post) => post.kind !== "connection_note")
    .map((post) => {
      const overlap = post.concepts.filter((concept) => closureKeys.has(normalizeConceptKey(concept)));
      const nextAction = selectFollowupNextAction(post.nextActions ?? []);

      return { post, overlap, nextAction };
    })
    .filter(({ post, overlap, nextAction }) => {
      if (!overlap.length || !nextAction) {
        return false;
      }

      return !existingFollowupKeys.has(`${post.id}|${nextAction}`);
    })
    .sort(
      (left, right) =>
        right.overlap.length - left.overlap.length ||
        right.post.createdAt.localeCompare(left.post.createdAt) ||
        left.post.id.localeCompare(right.post.id)
    );
  const selected = candidates[0];

  if (!selected) {
    return null;
  }

  return {
    id: `daily-goal-followup-${hashText(`${goal.id}|${selected.post.id}|${selected.nextAction}|${date}`)}`,
    kind: "generate_followup",
    postId: selected.post.id,
    topicId: tree.goalConcept,
    conceptIds: Array.from(new Set([...selected.overlap, tree.goalConcept])),
    nextAction: selected.nextAction,
    priority: 0.62,
    reason: `Reserve one daily production slot for the active learning goal ${tree.goalConcept}.`,
    createdAt: now,
    runAfter: now
  };
}

function selectFollowupNextAction(nextActions) {
  for (const action of ["continue_deeper", "expand_broader", "reframe_simpler"]) {
    if (nextActions.includes(action)) {
      return action;
    }
  }

  return null;
}

function isLearningGoalProductionJob(job) {
  return job.kind === "concept_brief" || job.kind === "generate_followup";
}

function jobOverlapsTree(job, closureKeys) {
  return [job.topicId, ...(job.conceptIds ?? [])].some((concept) => closureKeys.has(normalizeConceptKey(concept)));
}

function createTreeConceptKeySet(tree) {
  return new Set(tree.nodes.map((node) => normalizeConceptKey(node.concept)).filter(Boolean));
}

function omitSnapshotFromProductionResult(result) {
  return {
    queued: result.queued,
    records: result.records.map((record) => ({ id: record.id, status: record.status, job: record.job })),
    budget: result.budget,
    discardedJobIds: result.discardedJobIds,
    skippedConcepts: result.skippedConcepts
  };
}

function collectActiveLearningGoalConcepts(snapshot, userId = "local-user") {
  const concepts = [];

  for (const record of snapshot.learningGoals) {
    if (record.status !== "active") {
      continue;
    }

    const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);

    for (const node of treeResult.tree?.nodes ?? []) {
      if (!node.mastered) {
        concepts.push(node.concept);
      }
    }
  }

  return uniqueStrings(concepts);
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

function createManualMasteryDemotionEvents(snapshot, userId, previousMemory, nextMemory, createdAt) {
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

function createReviewedInteractionSignal(post, reviewedAt) {
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

function getDailyAutoJobBudgetLimit(env) {
  const parsed = Number.parseInt(env.AITIMELINE_DAILY_AUTO_JOB_BUDGET ?? "20", 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20;
}

function getDailyAutoJobBudgetRecord(snapshot, nowValue) {
  const date = getDayKey(nowValue);

  return snapshot.autoJobBudget.find((record) => record.date === date);
}

function buildSourceQualityUserContext(snapshot, userId = "local-user") {
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

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => `${value}`.trim()).filter(Boolean)));
}

function toUserSignals(interactionSignalRecords) {
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

function createConfiguredSearchProvider(env) {
  const apiKey = env.AITIMELINE_SEARCH_API_KEY;

  if (!apiKey) {
    return undefined;
  }

  const provider = env.AITIMELINE_SEARCH_PROVIDER ?? "tavily";

  if (provider !== "tavily") {
    console.warn(`[aitimeline] unsupported search provider "${provider}"; source discovery stays disabled.`);
    return undefined;
  }

  console.log("[aitimeline] source discovery using tavily search.");

  return createTavilySearchProvider({
    apiKey,
    baseUrl: env.AITIMELINE_SEARCH_BASE_URL,
    excludeDomains: DISCOVERY_AGGREGATE_DOMAINS
  });
}

async function handleAsk(body, persistenceStore, client, contentLanguage) {
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

function handleConceptBriefRequest(concept, body, persistenceStore, curationStore, contentLanguage) {
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

function handleDeepReadRequest({ body, persistenceStore, curationStore, contentLanguage, now }) {
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

async function handleDeepReadArticleJob(job, persistenceStore, modelClients, contentLanguage, now) {
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

async function handleConceptBriefJob(job, persistenceStore, client, contentLanguage, now) {
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

function buildConceptBriefInput(snapshot, concept, contentLanguage, now) {
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

function createConceptBriefJob(concept, cardCount, now) {
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

function persistAutomaticConceptAliases(persistenceStore, snapshot, now) {
  const automaticAliases = createAutomaticConceptAliases(snapshot.posts, snapshot.conceptAliases, now);

  if (!automaticAliases.length) {
    return snapshot;
  }

  return persistenceStore.saveConceptAliases([...snapshot.conceptAliases, ...automaticAliases], now);
}

function maybePersistConnectionNote(persistenceStore, options) {
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

function sanitizeSourceCandidateRecordForResponse(record) {
  if (!record?.rejectionReasons?.length || record.qualityGate) {
    return record;
  }

  const stableReasons = new Set(Object.values(sourceCandidateFailureMessages));

  if (record.rejectionReasons.every((reason) => stableReasons.has(reason))) {
    return record;
  }

  return {
    ...record,
    rejectionReasons: [
      record.status === "unreachable"
        ? sourceCandidateFailureMessages.unreachable
        : sourceCandidateFailureMessages.unprocessable
    ]
  };
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

const agentCaptureRunLimit = 3;

function createAgentCaptureCandidateRecord(body, now) {
  const candidate = normalizeSourceCandidate(
    {
      url: body.url,
      conceptIds: typeof body.topic === "string" && body.topic.trim() ? [body.topic.trim()] : [],
      relevanceScore: 0.7,
      noveltyScore: 0.6,
      qualityScore: 0.7,
      reason:
        typeof body.reason === "string" && body.reason.trim()
          ? body.reason.trim()
          : "Captured from a learning conversation."
    },
    now
  );
  const id = `agent-capture-${hashText(normalizeUrlKey(candidate.source.url))}`;

  return {
    id,
    candidate: { ...candidate, id },
    status: "pending",
    intakeKind: "agent_capture",
    createdAt: now,
    updatedAt: now,
    notes: typeof body.topic === "string" && body.topic.trim() ? body.topic.trim() : undefined
  };
}

function createAgentCaptureImportJob(candidate, now, contentLanguage) {
  return {
    id: `agent-capture-import-${hashText(candidate.id)}`,
    kind: "import_source",
    topicId: candidate.topicId ?? candidate.conceptIds[0],
    conceptIds: candidate.conceptIds,
    priority: 0.66,
    reason:
      contentLanguage === "en"
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
    records.map((record) => createAgentCaptureImportJob(record.candidate, now, contentLanguage)),
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
function queueDueAgentCaptures({ persistenceStore, curationStore, contentLanguage, now }) {
  const snapshot = persistenceStore.getSnapshot();
  const pending = snapshot.sourceCandidates
    .filter((record) => record.intakeKind === "agent_capture" && record.status === "pending")
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(0, agentCaptureRunLimit);

  return queueAgentCaptureCandidates({ persistenceStore, curationStore, records: pending, now, contentLanguage });
}

function handleCaptureSource(body, persistenceStore, curationStore, contentLanguage) {
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

function handleCaptureConversation(body, persistenceStore, curationStore, contentLanguage) {
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

function getCaptureContextResponse(persistenceStore) {
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

function createSourceCandidateRecord(body) {
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

function normalizeSourceCandidate(input, now) {
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

function findMatchingSourceCandidateRecords(snapshot, signal) {
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

function dedupeSourceCandidates(candidates) {
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

function summarizeSnapshot(snapshot) {
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

function deriveTopicState(signal) {
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

function buildInteractionSignalRecordId(signal) {
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

function roundScore(value) {
  return Math.round(value * 100) / 100;
}

function hashText(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
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

class HttpError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.statusCode = statusCode;
  }
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

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${fieldName} is required.`);
  }
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

function parseHttpUrl(url) {
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

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
    : [];
}

function normalizeIsoDate(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeScore(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function inferSourceType(url) {
  if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) {
    return "youtube";
  }

  if (url.hostname.includes("github.com")) {
    return "repo";
  }

  return "article";
}

function buildSourceId(type, url) {
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

function sanitizeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "source";
}

function isSupportedSourceCandidateType(value) {
  return value === "article" || value === "blog" || value === "news" || value === "youtube";
}

function isSourceCandidateIntakeKind(value) {
  return (
    value === "user_paste" ||
    value === "browser_share" ||
    value === "agent_discovery" ||
    value === "manual" ||
    value === "subscription"
  );
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
