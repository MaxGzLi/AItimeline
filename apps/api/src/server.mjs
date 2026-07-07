import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyUserMemoryEdits,
  askGrounded,
  advanceReviewState,
  addConceptAliasDecision,
  buildConceptDigest,
  buildDiscoveryConfirmationQuestions,
  createAutomaticConceptAliases,
  createConceptBriefInputFromCards,
  countSeenReadSignalsByPostId,
  createAITimelinePersistenceStore,
  applyDailyAutoJobBudget,
  createBackgroundCurationPlan,
  createDeterministicConceptBrief,
  DISCOVERY_AGGREGATE_DOMAINS,
  createConceptMergeSuggestion,
  createConnectionNoteForImport,
  createEmptyUserMemory,
  createInitialReviewState,
  createOpenAICompatibleModelClientFromEnv,
  createOpenAICompatibleSourceImportWorker,
  createPersistentBackgroundCurationJobStore,
  createSourceImportWorker,
  createSourcePostReleasePlan,
  createTavilySearchProvider,
  buildWeeklyRecap,
  buildWeeklyRecapId,
  evaluateInteraction,
  fetchArticle,
  fetchYouTubeTranscript,
  filterTimelineLifecycle,
  getMostRecentCompletedIsoWeekStart,
  getHardDismissedPostIds,
  getSoftDismissalReturnAt,
  isTimelineDismissalActive,
  getDueReviewStates,
  getRestingReviewStates,
  isPureExposureSignal,
  mergeSourceRegistries,
  removeConceptAlias,
  parseContentLanguage,
  rankPersonalizedTimeline,
  runConversationTurn,
  runDueBackgroundCurationJobs,
  normalizeSubscriptionFeedUrl,
  parseSubscriptionFeed,
  generateConceptBrief,
  runIdeaObservation,
  shouldRefreshConceptBrief,
  runSourceDiscovery,
  transformArticleUrl,
  transformUserNote,
  transformYouTubeUrl
} from "../../../packages/core/dist/index.js";
import { createEvidenceLedger } from "../../../packages/core/dist/harness/evidenceLedger.js";

const defaultPort = 8787;
const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(currentDir, "../data/aitimeline.json");
const defaultCurationDataPath = resolve(currentDir, "../data/curation-jobs.json");
const defaultMediaRoot = resolve(currentDir, "../data/media");

export function createApiServer(options = {}) {
  const dataPath = options.dataPath ?? process.env.AITIMELINE_DATA_PATH ?? defaultDataPath;
  const curationDataPath =
    options.curationDataPath ?? process.env.AITIMELINE_CURATION_DATA_PATH ?? defaultCurationDataPath;
  const mediaRootDir = resolve(options.mediaRootDir ?? process.env.AITIMELINE_MEDIA_ROOT ?? defaultMediaRoot);
  const enableFixtures = options.enableFixtures ?? process.env.AITIMELINE_ENABLE_FIXTURES === "1";
  const persistenceStore = createStoreWithRecovery(
    () => createAITimelinePersistenceStore(createFileStorageAdapter(dataPath)),
    dataPath
  );
  const curationStore = createStoreWithRecovery(
    () => createPersistentBackgroundCurationJobStore(createFileStorageAdapter(curationDataPath)),
    curationDataPath
  );
  const sourceImportWorker = createConfiguredSourceImportWorker(process.env);
  const importRunner = sourceImportWorker.runner;
  const askModelClient = createConfiguredAskModelClient(process.env);
  const searchProvider = options.searchProvider ?? createConfiguredSearchProvider(process.env);
  const feedFetch = options.feedFetch ?? globalThis.fetch;

  return createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "content-type");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", getRequestOrigin(request));

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
        sendJson(response, 200, persistenceStore.getSnapshot());
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
          record: nextNotification,
          snapshotSummary: summarizeSnapshot(nextSnapshot)
        });
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
        sendJson(
          response,
          200,
          getTimelineResponse(
            persistenceStore.getSnapshot(),
            url.searchParams.get("now"),
            url.searchParams.get("userId") ?? "local-user"
          )
        );
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
        const snapshot = persistenceStore.getSnapshot();
        const hardDismissedPostIds = getHardDismissedPostIds(snapshot.dismissedPosts);
        const due = getDueReviewStates(snapshot.reviewStates, url.searchParams.get("now") ?? new Date())
          .filter((state) => !hardDismissedPostIds.has(state.postId))
          .map(({ postId, intervalDays, dueAt }) => ({ postId, intervalDays, dueAt }));

        sendJson(response, 200, { due });
        return;
      }

      if (request.method === "POST" && /^\/api\/review\/[^/]+\/complete$/.test(url.pathname)) {
        const postId = decodeURIComponent(
          url.pathname.replace(/^\/api\/review\//, "").replace(/\/complete$/, "")
        );
        const body = await readJsonBody(request);
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

        const reviewedAt = body.reviewedAt ?? body.now ?? new Date().toISOString();
        const nextReviewState = advanceReviewState(reviewState, reviewedAt);
        const reviewedSignal = createReviewedInteractionSignal(post, reviewedAt);
        const observedTopicState = deriveTopicState(reviewedSignal);
        const currentTopicState = snapshot.topicStates.find((record) => record.topicId === observedTopicState.topicId);
        const feedback = evaluateInteraction(reviewedSignal, observedTopicState);
        const topicState = updateTopicStateFromFeedback(
          currentTopicState,
          observedTopicState,
          reviewedSignal,
          feedback,
          reviewedAt
        );
        const signalRecord = {
          id: buildInteractionSignalRecordId(reviewedSignal),
          signal: reviewedSignal,
          feedback,
          createdAt: reviewedSignal.createdAt
        };

        persistenceStore.saveReviewStates([nextReviewState], reviewedAt);
        persistenceStore.saveInteractionSignalRecords([signalRecord], reviewedAt);
        persistenceStore.saveTopicStateRecords([topicState], reviewedAt);
        sendJson(response, 200, { reviewState: nextReviewState });
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
          .sourceCandidates.filter((record) => !status || record.status === status);

        sendJson(response, 200, { records });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/subscriptions") {
        sendJson(response, 200, { records: persistenceStore.getSnapshot().subscriptions });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/subscriptions") {
        const body = await readJsonBody(request);
        const result = await handleCreateSubscription(body, persistenceStore, feedFetch);

        sendJson(response, 200, result);
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

      if (request.method === "POST" && /^\/api\/subscriptions\/[^/]+$/.test(url.pathname)) {
        const subscriptionId = decodeURIComponent(url.pathname.replace(/^\/api\/subscriptions\//, ""));
        const body = await readJsonBody(request);
        const result = handleUpdateSubscription(subscriptionId, body, persistenceStore);

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/curation/jobs") {
        const status = url.searchParams.get("status") ?? undefined;
        sendJson(response, 200, { jobs: curationStore.list(status) });
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
          record: snapshot.sourceCandidates.find((item) => item.id === body.id),
          snapshotSummary: summarizeSnapshot(snapshot)
        });
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
          buildSourceQualityUserContext(persistenceStore.getSnapshot())
        );
        const { snapshot, releasePlan } = persistImportAndReleasePlan(persistenceStore, importResult, {
          contentLanguage
        });

        sendJson(response, 200, {
          ...importResult,
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
          buildSourceQualityUserContext(persistenceStore.getSnapshot())
        );
        const { snapshot, releasePlan } = persistImportAndReleasePlan(persistenceStore, importResult, {
          contentLanguage
        });

        sendJson(response, 200, {
          ...importResult,
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
        requireInteractionSignal(body.signal);
        const generatedAt = body.generatedAt ?? new Date().toISOString();
        const currentSnapshot = persistenceStore.getSnapshot();
        const observedTopicState = body.topicState ?? deriveTopicState(body.signal);
        const currentTopicState = currentSnapshot.topicStates.find((record) => record.topicId === observedTopicState.topicId);

        if (isPureExposureSignal(body.signal)) {
          const feedback = createNeutralExposureFeedback(body.signal);
          const signalRecord = {
            id: buildInteractionSignalRecordId(body.signal),
            signal: body.signal,
            feedback,
            createdAt: body.signal.createdAt ?? generatedAt
          };
          const snapshot = persistenceStore.saveInteractionSignalRecords([signalRecord], generatedAt);
          const plan = createEmptyCurationPlan(generatedAt);

          sendJson(response, 200, {
            feedback,
            topicState: currentTopicState ?? null,
            plan,
            records: [],
            snapshotSummary: summarizeSnapshot(snapshot)
          });
          return;
        }

        const persistedCandidates = findMatchingSourceCandidateRecords(currentSnapshot, body.signal);
        const feedback = evaluateInteraction(body.signal, observedTopicState);
        const contentLanguage = resolveContentLanguage(persistenceStore, process.env);
        const topicState = updateTopicStateFromFeedback(
          currentTopicState,
          observedTopicState,
          body.signal,
          feedback,
          generatedAt
        );
        const rawPlan = createBackgroundCurationPlan({
          signals: [body.signal],
          feedback: [feedback],
          topicStates: [topicState],
          sourceCandidates: dedupeSourceCandidates([
            ...(body.sourceCandidates ?? []),
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
        const signalRecord = {
          id: buildInteractionSignalRecordId(body.signal),
          signal: body.signal,
          feedback,
          createdAt: body.signal.createdAt ?? generatedAt
        };
        persistenceStore.saveInteractionSignalRecords([signalRecord], generatedAt);
        persistenceStore.saveTopicStateRecords([topicState], generatedAt);
        persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], generatedAt);
        let snapshot = persistenceStore.saveCurationJobRecords(records, generatedAt);
        const initialReviewState = maybeCreateInitialReviewState(snapshot, body.signal, generatedAt);

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
          topicState,
          plan,
          records,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/curation/run") {
        const body = await readJsonBody(request);
        const contentLanguage = resolveContentLanguage(persistenceStore, process.env);
        const runNow = body.now ?? new Date().toISOString();
        const subscriptionPolling = await pollDueSubscriptions({
          persistenceStore,
          curationStore,
          fetchImpl: feedFetch,
          contentLanguage,
          now: runNow
        });
        const batch = await runDueBackgroundCurationJobs(
          curationStore,
          {
            contentLanguage,
            sourceImportWorker,
            ingestSourceCandidate: (candidate) => ingestSourceCandidate(candidate),
            discoverSources: (job) => discoverSourcesForJob(job, searchProvider, persistenceStore, contentLanguage),
            loadSeedPost: (job) => persistenceStore.getSnapshot().posts.find((post) => post.id === job.postId),
            loadSourceQualityVerdicts: () => persistenceStore.getSnapshot().sourceQualityVerdicts,
            loadSourceQualityUserContext: () => buildSourceQualityUserContext(persistenceStore.getSnapshot()),
            researchQuestion: (job) =>
              handleResearchQuestionJob(
                job,
                persistenceStore,
                sourceImportWorker,
                searchProvider,
                askModelClient,
                contentLanguage,
                runNow
              ),
            researchIdea: (job) =>
              handleResearchIdeaJob(
                job,
                persistenceStore,
                sourceImportWorker,
                searchProvider,
                contentLanguage,
                runNow
              ),
            conceptBrief: (job) =>
              handleConceptBriefJob(
                job,
                persistenceStore,
                askModelClient,
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
            limit: body.limit,
            kinds: body.kinds
          }
        );
        const records = filterDuplicateFollowupCurationRecords(
          batch.records,
          persistenceStore.getSnapshot().posts
        );

        records.forEach((record, index) => {
          if (record !== batch.records[index]) {
            curationStore.update(record);
          }
        });

        const filteredBatch = { ...batch, records };
        let snapshot = persistenceStore.saveCurationJobRecords(filteredBatch.records);
        const beforeCurationImportSnapshot = snapshot;
        const curationImportedPosts = [];

        for (const record of filteredBatch.records) {
          if (record.result?.discoveredSourceCandidates?.length) {
            snapshot = persistDiscoveredCandidates(
              persistenceStore,
              record.result.discoveredSourceCandidates,
              record.completedAt ?? filteredBatch.completedAt
            );
          }

          if (record.result?.sourceImport) {
            const completedAt = record.completedAt ?? filteredBatch.completedAt;
            const sourceImport = record.result.sourceImport;

            persistenceStore.saveSourceImportResult(sourceImport, completedAt);

            if (record.job.sourceCandidate) {
              snapshot = updateSourceCandidateAfterImport(
                persistenceStore,
                persistenceStore.getSnapshot(),
                record.job.sourceCandidate.id,
                sourceImport,
                completedAt
              );
            } else {
              snapshot = persistenceStore.getSnapshot();
            }

            if (sourceImport.posts.length) {
              curationImportedPosts.push(...sourceImport.posts);
              snapshot = persistenceStore.saveReleasePlan(
                createSourcePostReleasePlan({ posts: sourceImport.posts }),
                completedAt
              );
            }
          }

          if (record.result?.conceptBrief) {
            const completedAt = record.completedAt ?? filteredBatch.completedAt;
            snapshot = persistenceStore.saveConceptBriefs([record.result.conceptBrief], completedAt);
          }
        }

        if (curationImportedPosts.length) {
          const now = filteredBatch.completedAt ?? runNow;
          snapshot = persistAutomaticConceptAliases(persistenceStore, persistenceStore.getSnapshot(), now);
          snapshot = maybePersistConnectionNote(persistenceStore, {
            beforeImport: beforeCurationImportSnapshot,
            newPosts: curationImportedPosts,
            now,
            contentLanguage
          });
        }

        sendJson(response, 200, {
          ...filteredBatch,
          subscriptionPolling,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
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

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/memory") {
        const body = await readJsonBody(request);
        const userId = body.userId ?? "local-user";
        const currentMemory =
          persistenceStore.getSnapshot().userMemories.find((record) => record.userId === userId)?.memory ??
          createEmptyUserMemory();
        const editResult = applyUserMemoryEdits(body.memory ?? currentMemory, body.edits ?? []);
        const snapshot = persistenceStore.saveUserMemory(userId, editResult.memory, editResult.events);

        sendJson(response, 200, {
          ...editResult,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }

      sendJson(response, error instanceof HttpError ? error.statusCode : 500, {
        error: error instanceof Error ? error.message : "Unknown API error."
      });
    }
  });
}

function createConfiguredSourceImportWorker(env) {
  const modelName = env.AITIMELINE_MODEL_NAME ?? env.OPENAI_MODEL;
  const contentLanguage = readConfiguredContentLanguage(env);

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
  const parsedFeed = await fetchAndParseSubscriptionFeed(normalized.feedUrl, fetchImpl);
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
    throw new HttpError(400, error instanceof Error ? error.message : "Feed URL request failed.");
  }

  if (!response.ok) {
    throw new HttpError(400, `Feed URL request failed with ${response.status}.`);
  }

  const xml = await response.text();
  const parsed = parseSubscriptionFeed(xml, feedUrl);

  if (parsed.error) {
    throw new HttpError(400, parsed.error);
  }

  return parsed;
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
      const parsedFeed = await fetchAndParseSubscriptionFeed(subscription.feedUrl, fetchImpl);
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
      const message = error instanceof Error ? error.message : "Subscription poll failed.";

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
      interactionSignals: snapshot.interactionSignals.map((record) => record.signal),
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

function createConfiguredAskModelClient(env) {
  const modelName = env.AITIMELINE_MODEL_NAME ?? env.OPENAI_MODEL;

  return modelName ? createOpenAICompatibleModelClientFromEnv(env) : undefined;
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

async function handleResearchQuestionJob(
  job,
  persistenceStore,
  sourceImportWorker,
  searchProvider,
  askModelClient,
  defaultContentLanguage,
  now
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
  const importLimit = getResearchImportLimit(payload.choices, contentLanguage);
  const candidatesToImport = rankedCandidates.slice(0, importLimit);
  const remainingCandidates = rankedCandidates.slice(importLimit);

  if (remainingCandidates.length) {
    persistDiscoveredCandidates(persistenceStore, remainingCandidates, now);
  }

  if (!rankedCandidates.length) {
    const body = discovery.errors.length
      ? researchCopy(contentLanguage, "searchFailed", { detail: discovery.errors.join("; ") })
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
      const ingested = await ingestSourceCandidate(candidateWithOrigin);
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
        importFailures.push(sourceImport.errorMessage ?? "Source import worker failed.");
        continue;
      }

      if (sourceImport.posts.length === 0) {
        const mergedPosts = resolveMergedImportPosts(sourceImport, savedSnapshot);

        if (mergedPosts.length) {
          importedResults.push({ ...sourceImport, posts: mergedPosts });
        } else {
          importFailures.push(sourceImport.errorMessage ?? "Source import worker failed.");
        }
        continue;
      }

      persistenceStore.saveReleasePlan(createSourcePostReleasePlan({ posts: sourceImport.posts }), now);
      importedResults.push(sourceImport);
    } catch (error) {
      importFailures.push(error instanceof Error ? error.message : "Unknown research source import error.");
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
  now
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
    now
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
    now
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
  now
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
  const candidatesToImport = rankedCandidates.slice(0, 2);
  const remainingCandidates = rankedCandidates.slice(2);
  const importedResults = [];
  const errors = [...discovery.errors];

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
      const ingested = await ingestSourceCandidate(candidateWithOrigin);
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
        errors.push(sourceImport.errorMessage ?? "Source import worker failed.");
        continue;
      }

      if (sourceImport.posts.length === 0) {
        const mergedPosts = resolveMergedImportPosts(sourceImport, savedSnapshot);

        if (mergedPosts.length) {
          importedResults.push({ ...sourceImport, posts: mergedPosts });
        } else {
          errors.push(sourceImport.errorMessage ?? "Source import worker failed.");
        }
        continue;
      }

      persistenceStore.saveReleasePlan(createSourcePostReleasePlan({ posts: sourceImport.posts }), now);
      importedResults.push(sourceImport);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unknown idea research source import error.");
    }
  }

  return {
    side,
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

  if (discovery.candidates.length) {
    persistDiscoveredCandidates(persistenceStore, discovery.candidates, now);
  }

  return discovery.candidates;
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

  if (discovery.candidates.length) {
    persistDiscoveredCandidates(persistenceStore, discovery.candidates, now);
  }

  return { configured: true, candidates: discovery.candidates };
}

function toTrimmedStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
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
            body: replyBody
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
            body: replyBody
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
    id: `${post.id}-user-comment-${hashText(`${commentText}|${now}`)}`,
    kind: "user_comment",
    title: contentLanguage === "en" ? "You" : "你",
    body: commentText
  };
  const replyBlock = replyBody
    ? {
        id: `${post.id}-agent-reply-${hashText(`${replyBody}|${now}`)}`,
        kind: "agent_reply",
        title:
          contentLanguage === "en"
            ? replySourceTitle
              ? `Knowledge Observer · Source: ${replySourceTitle}`
              : "Knowledge Observer"
            : replySourceTitle
              ? `知识观察员 · 来源:${replySourceTitle}`
              : "知识观察员",
        body: replyBody
      }
    : null;
  const updatedPost = {
    ...post,
    thread: [...post.thread, commentBlock, ...(replyBlock ? [replyBlock] : [])]
  };

  persistenceStore.savePosts([updatedPost], now);

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
    post: updatedPost,
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

  return discovery.candidates;
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

  return Array.from(confirmed);
}

function persistDiscoveredCandidates(persistenceStore, candidates, now) {
  const snapshot = persistenceStore.getSnapshot();
  const existingIds = new Set(snapshot.sourceCandidates.map((record) => record.id));
  const newRecords = candidates
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

function updateSourceCandidateAfterImport(persistenceStore, snapshot, candidateId, sourceImport, now) {
  const candidateRecord = snapshot.sourceCandidates.find((item) => item.candidate.id === candidateId);

  if (!candidateRecord) {
    return snapshot;
  }

  const importedDifferentSource =
    sourceImport.source.id !== candidateRecord.candidate.source.id &&
    sourceImport.source.url !== candidateRecord.candidate.source.url;

  if (sourceImport.qualityGate?.verdict === "reject" || importedDifferentSource) {
    const rejectionReasons =
      sourceImport.qualityGate?.reasons ??
      (importedDifferentSource ? ["Candidate did not produce a qualified source; same-source fallback was used."] : []);

    return persistenceStore.saveSourceCandidateRecords([
      {
        ...candidateRecord,
        status: "rejected_source",
        updatedAt: now,
        rejectedAt: now,
        qualityGate: sourceImport.qualityGate,
        rejectionReasons
      }
    ]);
  }

  return persistenceStore.saveSourceCandidateRecords([
    {
      ...candidateRecord,
      status: "imported",
      updatedAt: now,
      importedAt: now
    }
  ]);
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
  const date = new Date(nowValue).toISOString().slice(0, 10);

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
    id: `concept-brief-${hashText(`${normalizeConceptKey(concept)}|${cardCount}|${now.slice(0, 10)}`)}`,
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

async function importArticle(body, runner, mediaRootDir, contentLanguage, userContext) {
  requireString(body.url, "url");
  const result = await transformArticleUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause,
    runner,
    mediaRootDir,
    contentLanguage,
    userContext
  });

  return toSourceImportWorkerResult(result);
}

async function importYouTube(body, runner, contentLanguage, userContext) {
  requireString(body.url, "url");
  const result = await transformYouTubeUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause,
    runner,
    contentLanguage,
    userContext
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
  const releasePlan = createSourcePostReleasePlan({ posts: importResult.posts });
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

function createSourceCandidateRecord(body) {
  const now = body.createdAt ?? body.discoveredAt ?? new Date().toISOString();
  const candidate = normalizeSourceCandidate(body.candidate ?? body, now);

  return {
    id: body.id ?? candidate.id,
    candidate,
    status: isSourceCandidateStatus(body.status) ? body.status : "pending",
    intakeKind: isSourceCandidateIntakeKind(body.intakeKind) ? body.intakeKind : "user_paste",
    createdAt: now,
    updatedAt: now,
    userId: typeof body.userId === "string" ? body.userId : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined
  };
}

function normalizeSourceCandidate(input, now) {
  const sourceInput = input.source ?? {};
  const url = sourceInput.url ?? input.url;

  requireString(url, "url");

  const parsedUrl = parseHttpUrl(url);
  const type = isSourceType(sourceInput.type ?? input.type)
    ? sourceInput.type ?? input.type
    : inferSourceType(parsedUrl);
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
  const signalConcepts = new Set(signal.conceptIds ?? []);

  return snapshot.sourceCandidates
    .filter((record) => record.status === "pending")
    .filter((record) => {
      if (record.candidate.topicId && record.candidate.topicId === signal.topicId) {
        return true;
      }

      return record.candidate.conceptIds.some((conceptId) => signalConcepts.has(conceptId));
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

function scoreCandidateRecord(record) {
  return (
    record.candidate.relevanceScore * 0.45 +
    record.candidate.qualityScore * 0.35 +
    record.candidate.noveltyScore * 0.2
  );
}

async function ingestSourceCandidate(candidate) {
  if (candidate.source.type === "article" || candidate.source.type === "blog" || candidate.source.type === "news") {
    const fetched = await fetchArticle(candidate.source.url);

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
    const fetched = await fetchYouTubeTranscript(candidate.source.url);

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

function getTimelineResponse(snapshot, nowValue, userId = "local-user") {
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
  const interactionSignals = snapshot.interactionSignals.map((record) => record.signal);
  const lifecyclePosts = filterTimelineLifecycle({
    posts: candidatePosts,
    interactionSignals,
    dismissedPosts: snapshot.dismissedPosts,
    dueReviewPostIds,
    restingReviewPostIds: getRestingReviewStates(snapshot.reviewStates, now).map((state) => state.postId),
    now
  });
  const memoryRecord = snapshot.userMemories.find((record) => record.userId === userId);
  const rankedPosts = rankPersonalizedTimeline({
    cards: lifecyclePosts,
    memory: memoryRecord?.memory,
    topicStates: snapshot.topicStates,
    recentSignals: interactionSignals,
    seenReadCounts: countSeenReadSignalsByPostId(interactionSignals),
    dueReviewPostIds,
    conceptAliases: snapshot.conceptAliases,
    now
  }).map((post) => {
    const dueReviewState = dueReviewStateByPostId.get(post.id);

    return dueReviewState ? { ...post, reviewDueAt: dueReviewState.dueAt } : post;
  });

  return {
    posts: enrichPostsMedia(snapshot, rankedPosts),
    sourceImports: snapshot.sourceImports,
    releasePlans,
    topicStates: snapshot.topicStates,
    recommendationSummary: summarizeRecommendation(rankedPosts),
    snapshotSummary: summarizeSnapshot(snapshot)
  };
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
        ...notification,
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
    weeklyRecaps: snapshot.weeklyRecaps.length,
    subscriptions: snapshot.subscriptions.length
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
  const strength = Math.max(-5, Math.min(20, feedback.signalStrength)) / 20;

  if (feedback.inferredState === "interested") {
    interestScore += 0.12 + Math.max(0, strength) * 0.18;
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

function createStoreWithRecovery(createStore, filePath) {
  try {
    return createStore();
  } catch (error) {
    if (!existsSync(filePath)) {
      throw error;
    }

    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    renameSync(filePath, backupPath);
    console.warn(
      `[aitimeline] data file was invalid; moved it to ${backupPath} and starting fresh (${
        error instanceof Error ? error.message : "unknown error"
      }).`
    );

    return createStore();
  }
}

function createFileStorageAdapter(filePath) {
  return {
    read() {
      return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    },
    write(serialized) {
      mkdirSync(dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.tmp`;
      writeFileSync(tempPath, `${serialized}\n`, "utf8");
      renameSync(tempPath, filePath);
    }
  };
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const maxJsonBodyBytes = 1024 * 1024;

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;

    if (totalBytes > maxJsonBodyBytes) {
      request.destroy();
      throw new HttpError(413, "Request body is too large.");
    }

    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${fieldName} is required.`);
  }
}

function requireInteractionSignal(signal) {
  if (typeof signal !== "object" || signal === null) {
    throw new HttpError(400, "signal is required.");
  }

  requireString(signal.postId, "signal.postId");
  requireString(signal.topicId, "signal.topicId");
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

function normalizeConceptKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

function isSourceType(value) {
  return (
    value === "youtube" ||
    value === "article" ||
    value === "paper" ||
    value === "blog" ||
    value === "news" ||
    value === "repo" ||
    value === "pdf" ||
    value === "audio" ||
    value === "manual" ||
    value === "user_note"
  );
}

function isSourceCandidateStatus(value) {
  return value === "pending" || value === "queued" || value === "imported" || value === "dismissed" || value === "rejected_source";
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

export function listen(server, port = defaultPort, host = "127.0.0.1") {
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
  const server = createApiServer();
  const address = await listen(server, port, host);

  console.log(`AITimeline API listening on http://${address.address}:${address.port}`);
}
