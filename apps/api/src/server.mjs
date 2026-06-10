import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyUserMemoryEdits,
  createAITimelinePersistenceStore,
  createBackgroundCurationPlan,
  createEmptyUserMemory,
  createPersistentBackgroundCurationJobStore,
  createSourceImportWorker,
  createSourcePostReleasePlan,
  evaluateInteraction,
  fetchArticle,
  fetchYouTubeTranscript,
  runDueBackgroundCurationJobs,
  transformArticleUrl,
  transformYouTubeUrl
} from "../../../packages/core/dist/index.js";

const defaultPort = 8787;
const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(currentDir, "../data/aitimeline.json");
const defaultCurationDataPath = resolve(currentDir, "../data/curation-jobs.json");

export function createApiServer(options = {}) {
  const dataPath = options.dataPath ?? process.env.AITIMELINE_DATA_PATH ?? defaultDataPath;
  const curationDataPath =
    options.curationDataPath ?? process.env.AITIMELINE_CURATION_DATA_PATH ?? defaultCurationDataPath;
  const enableFixtures = options.enableFixtures ?? process.env.AITIMELINE_ENABLE_FIXTURES === "1";
  const persistenceStore = createAITimelinePersistenceStore(createFileStorageAdapter(dataPath));
  const curationStore = createPersistentBackgroundCurationJobStore(createFileStorageAdapter(curationDataPath));
  const sourceImportWorker = createSourceImportWorker();

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
        sendJson(response, 200, getTimelineResponse(persistenceStore.getSnapshot(), url.searchParams.get("now")));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/curation/jobs") {
        const status = url.searchParams.get("status") ?? undefined;
        sendJson(response, 200, { jobs: curationStore.list(status) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/import/article") {
        const body = await readJsonBody(request);
        const importResult = await importArticle(body);
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
        const importResult = await importYouTube(body);
        const { snapshot, releasePlan } = persistImportAndReleasePlan(persistenceStore, importResult);

        sendJson(response, 200, {
          ...importResult,
          releasePlan,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/signals") {
        const body = await readJsonBody(request);
        const feedback = evaluateInteraction(body.signal, body.topicState ?? deriveTopicState(body.signal));
        const plan = createBackgroundCurationPlan({
          signals: [body.signal],
          feedback: [feedback],
          topicStates: [body.topicState ?? deriveTopicState(body.signal)],
          sourceCandidates: body.sourceCandidates ?? [],
          generatedAt: body.generatedAt ?? new Date().toISOString()
        });
        const records = curationStore.enqueuePlan(plan);
        const snapshot = persistenceStore.saveCurationJobRecords(records);

        sendJson(response, 200, {
          feedback,
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
            discoverSources: () => [],
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
          if (record.result?.sourceImport) {
            persistenceStore.saveSourceImportResult(record.result.sourceImport);
            snapshot = persistenceStore.saveReleasePlan(
              createSourcePostReleasePlan({ posts: record.result.sourceImport.posts })
            );
          }
        }

        sendJson(response, 200, {
          ...batch,
          snapshotSummary: summarizeSnapshot(snapshot)
        });
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
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown API error."
      });
    }
  });
}

async function importArticle(body) {
  requireString(body.url, "url");
  const result = await transformArticleUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause
  });

  return toSourceImportWorkerResult(result);
}

async function importYouTube(body) {
  requireString(body.url, "url");
  const result = await transformYouTubeUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause
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

function getTimelineResponse(snapshot, nowValue) {
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

  return {
    posts,
    sourceImports: snapshot.sourceImports,
    releasePlans,
    snapshotSummary: summarizeSnapshot(snapshot)
  };
}

function summarizeSnapshot(snapshot) {
  return {
    imports: snapshot.sourceImports.length,
    posts: snapshot.posts.length,
    runs: snapshot.harnessRuns.length,
    curationJobs: snapshot.curationJobs.length,
    memories: snapshot.userMemories.length
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

function createFileStorageAdapter(filePath) {
  return {
    read() {
      return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    },
    write(serialized) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${serialized}\n`, "utf8");
    }
  };
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  return rawBody ? JSON.parse(rawBody) : {};
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required.`);
  }
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
