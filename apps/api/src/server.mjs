import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyUserMemoryEdits,
  askGrounded,
  createAITimelinePersistenceStore,
  createBackgroundCurationPlan,
  createEmptyUserMemory,
  createOpenAICompatibleModelClientFromEnv,
  createOpenAICompatibleSourceImportWorker,
  createPersistentBackgroundCurationJobStore,
  createSourceImportWorker,
  createSourcePostReleasePlan,
  createTavilySearchProvider,
  evaluateInteraction,
  fetchArticle,
  fetchYouTubeTranscript,
  mergeSourceRegistries,
  rankPersonalizedTimeline,
  runConversationTurn,
  runDueBackgroundCurationJobs,
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

export function createApiServer(options = {}) {
  const dataPath = options.dataPath ?? process.env.AITIMELINE_DATA_PATH ?? defaultDataPath;
  const curationDataPath =
    options.curationDataPath ?? process.env.AITIMELINE_CURATION_DATA_PATH ?? defaultCurationDataPath;
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

  return createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
        sendHtml(response, fixtureArticleHtml("Background curation can prepare related sources"));
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "aitimeline-api" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/snapshot") {
        sendJson(response, 200, persistenceStore.getSnapshot());
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

      if (request.method === "GET" && url.pathname === "/api/source-candidates") {
        const status = url.searchParams.get("status") ?? undefined;
        const records = persistenceStore
          .getSnapshot()
          .sourceCandidates.filter((record) => !status || record.status === status);

        sendJson(response, 200, { records });
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
        const importResult = await importArticle(body, importRunner);
        const { snapshot, releasePlan } = persistImportAndReleasePlan(persistenceStore, importResult);

        sendJson(response, 200, {
          ...importResult,
          releasePlan,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/import/youtube") {
        const body = await readJsonBody(request);
        const importResult = await importYouTube(body, importRunner);
        const { snapshot, releasePlan } = persistImportAndReleasePlan(persistenceStore, importResult);

        sendJson(response, 200, {
          ...importResult,
          releasePlan,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/ask") {
        const body = await readJsonBody(request);
        const answer = await handleAsk(body, persistenceStore, askModelClient);

        sendJson(response, 200, answer);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/signals") {
        const body = await readJsonBody(request);
        requireInteractionSignal(body.signal);
        const generatedAt = body.generatedAt ?? new Date().toISOString();
        const currentSnapshot = persistenceStore.getSnapshot();
        const persistedCandidates = findMatchingSourceCandidateRecords(currentSnapshot, body.signal);
        const observedTopicState = body.topicState ?? deriveTopicState(body.signal);
        const currentTopicState = currentSnapshot.topicStates.find((record) => record.topicId === observedTopicState.topicId);
        const feedback = evaluateInteraction(body.signal, observedTopicState);
        const topicState = updateTopicStateFromFeedback(
          currentTopicState,
          observedTopicState,
          body.signal,
          feedback,
          generatedAt
        );
        const plan = createBackgroundCurationPlan({
          signals: [body.signal],
          feedback: [feedback],
          topicStates: [topicState],
          sourceCandidates: dedupeSourceCandidates([
            ...(body.sourceCandidates ?? []),
            ...persistedCandidates.map((record) => record.candidate)
          ]),
          generatedAt
        });
        const records = curationStore.enqueuePlan(plan);
        const signalRecord = {
          id: buildInteractionSignalRecordId(body.signal),
          signal: body.signal,
          feedback,
          createdAt: body.signal.createdAt ?? generatedAt
        };
        persistenceStore.saveInteractionSignalRecords([signalRecord], generatedAt);
        persistenceStore.saveTopicStateRecords([topicState], generatedAt);
        let snapshot = persistenceStore.saveCurationJobRecords(records, generatedAt);

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
        const batch = await runDueBackgroundCurationJobs(
          curationStore,
          {
            sourceImportWorker,
            ingestSourceCandidate: (candidate) => ingestSourceCandidate(candidate),
            discoverSources: (job) => discoverSourcesForJob(job, searchProvider, persistenceStore),
            loadSeedPost: (job) => persistenceStore.getSnapshot().posts.find((post) => post.id === job.postId),
            cooldownTopic: (job) => ({
              kind: job.kind,
              message: "Topic cooldown recorded by API worker."
            })
          },
          {
            now: body.now ?? new Date().toISOString(),
            limit: body.limit,
            kinds: body.kinds
          }
        );
        let snapshot = persistenceStore.saveCurationJobRecords(batch.records);

        for (const record of batch.records) {
          if (record.result?.discoveredSourceCandidates?.length) {
            snapshot = persistDiscoveredCandidates(
              persistenceStore,
              record.result.discoveredSourceCandidates,
              record.completedAt ?? batch.completedAt
            );
          }

          if (record.result?.sourceImport) {
            persistenceStore.saveSourceImportResult(record.result.sourceImport);
            snapshot = persistenceStore.saveReleasePlan(
              createSourcePostReleasePlan({ posts: record.result.sourceImport.posts })
            );

            if (record.job.sourceCandidate) {
              const candidateRecord = snapshot.sourceCandidates.find(
                (item) => item.candidate.id === record.job.sourceCandidate.id
              );

              if (candidateRecord) {
                snapshot = persistenceStore.saveSourceCandidateRecords([
                  {
                    ...candidateRecord,
                    status: "imported",
                    updatedAt: record.completedAt ?? batch.completedAt,
                    importedAt: record.completedAt ?? batch.completedAt
                  }
                ]);
              }
            }
          }
        }

        sendJson(response, 200, {
          ...batch,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/agent/ask") {
        const body = await readJsonBody(request);
        requireString(body.question, "question");
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = await handleAgentAsk(body, userId, persistenceStore, askModelClient, searchProvider);

        sendJson(response, 200, result);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/notes") {
        const body = await readJsonBody(request);
        requireString(body.text, "text");
        const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId : "local-user";
        const result = await handleUserNote(body, userId, persistenceStore, askModelClient, searchProvider);

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

  if (!modelName) {
    return createSourceImportWorker();
  }

  const worker = createOpenAICompatibleSourceImportWorker(env);
  console.log(`[aitimeline] source import using model runner (${modelName}).`);

  return worker;
}

function createConfiguredAskModelClient(env) {
  const modelName = env.AITIMELINE_MODEL_NAME ?? env.OPENAI_MODEL;

  return modelName ? createOpenAICompatibleModelClientFromEnv(env) : undefined;
}

async function handleAgentAsk(body, userId, persistenceStore, client, searchProvider) {
  const snapshot = persistenceStore.getSnapshot();
  const now = new Date().toISOString();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const registry = mergeSourceRegistries(...snapshot.sourceRegistries.map((record) => record.registry));
  const turn = await runConversationTurn(
    {
      question: body.question,
      postId: typeof body.postId === "string" ? body.postId : undefined,
      posts: snapshot.posts,
      registry,
      memory,
      userSignals: toUserSignals(snapshot.interactionSignals),
      now
    },
    { client }
  );

  const discoveredCandidates = await executeDiscoveryAction(
    turn,
    snapshot,
    memory,
    searchProvider,
    persistenceStore,
    now
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
        reason: "User asked the agent a question."
      }
    ],
    now
  );

  persistenceStore.saveUserMemory(userId, memoryEditResult.memory, memoryEditResult.events, now);

  const turnRecord = {
    id: `agent-turn-${hashText(`${userId}|${turn.question}|${now}`)}`,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
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

// Execute the discovery proposal inline when a provider is configured;
// otherwise the proposal is returned for the client to display.
async function executeDiscoveryAction(turn, snapshot, memory, searchProvider, persistenceStore, now) {
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
    now
  });

  if (discovery.candidates.length) {
    persistDiscoveredCandidates(persistenceStore, discovery.candidates, now);
  }

  return discovery.candidates;
}

// A user note becomes a first-class post (self-grounded source) and the
// observer replies against the existing library, metered as an agent turn.
async function handleUserNote(body, userId, persistenceStore, client, searchProvider) {
  const snapshot = persistenceStore.getSnapshot();
  const now = typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const libraryPosts = snapshot.posts;
  const libraryConcepts = Array.from(new Set(libraryPosts.flatMap((post) => post.concepts)));
  const note = transformUserNote(body.text, { createdAt: now, libraryConcepts });

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
    { client }
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
            kind: "extension",
            title: replySourceTitle ? `知识观察员 · 来源:${replySourceTitle}` : "知识观察员",
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
    now
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

async function discoverSourcesForJob(job, searchProvider, persistenceStore) {
  if (!searchProvider) {
    return [];
  }

  const snapshot = persistenceStore.getSnapshot();
  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts: job.conceptIds,
    topicId: job.topicId,
    nextAction: job.nextAction,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot)
  });

  return discovery.candidates;
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

  return createTavilySearchProvider({ apiKey, baseUrl: env.AITIMELINE_SEARCH_BASE_URL });
}

async function handleAsk(body, persistenceStore, client) {
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

  return askGrounded({ post, registry, question: body.question }, { client });
}

async function importArticle(body, runner) {
  requireString(body.url, "url");
  const result = await transformArticleUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause,
    runner
  });

  return toSourceImportWorkerResult(result);
}

async function importYouTube(body, runner) {
  requireString(body.url, "url");
  const result = await transformYouTubeUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause,
    runner
  });

  return toSourceImportWorkerResult(result);
}

function toSourceImportWorkerResult(result) {
  return {
    importRecord: result.importRecord,
    source: result.source,
    assets: [result.asset],
    chunks: result.chunks,
    sourceRegistry: result.sourceRegistry,
    posts: result.cards,
    validation: result.validation,
    harnessRun: result.harnessRun
  };
}

function persistImportAndReleasePlan(persistenceStore, importResult) {
  persistenceStore.saveSourceImportResult(importResult);
  const releasePlan = createSourcePostReleasePlan({ posts: importResult.posts });
  const snapshot = persistenceStore.saveReleasePlan(releasePlan);

  return { snapshot, releasePlan };
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
  const memoryRecord = snapshot.userMemories.find((record) => record.userId === userId);
  const rankedPosts = rankPersonalizedTimeline({
    cards: posts,
    memory: memoryRecord?.memory,
    topicStates: snapshot.topicStates,
    recentSignals: snapshot.interactionSignals.map((record) => record.signal),
    now
  });

  return {
    posts: rankedPosts,
    sourceImports: snapshot.sourceImports,
    releasePlans,
    topicStates: snapshot.topicStates,
    recommendationSummary: summarizeRecommendation(rankedPosts),
    snapshotSummary: summarizeSnapshot(snapshot)
  };
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
    sourceCandidates: snapshot.sourceCandidates.length,
    agentTurns: snapshot.agentTurns.length
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
  return value === "pending" || value === "queued" || value === "imported" || value === "dismissed";
}

function isSourceCandidateIntakeKind(value) {
  return value === "user_paste" || value === "browser_share" || value === "agent_discovery" || value === "manual";
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
}

function getRequestOrigin(request) {
  return `http://${request.headers.host ?? "127.0.0.1"}`;
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
          <p>An AI Agent can turn source material into durable knowledge when it keeps citations, extracts concepts, and creates a learning surface that users can revisit.</p>
          <p>A Knowledge Graph helps Memory become useful because saved concepts, weak concepts, and Recommendation signals can point the user toward review at the right time.</p>
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? `${defaultPort}`, 10);
  const server = createApiServer();
  const address = await listen(server, port);

  console.log(`AITimeline API listening on http://${address.address}:${address.port}`);
}
