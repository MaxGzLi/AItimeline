import assert from "node:assert/strict";

const { createBackgroundCurationPlan } = await import("../packages/core/dist/agents/backgroundCuration.js");
const { createPersistentBackgroundCurationJobStore, runDueBackgroundCurationJobs } = await import(
  "../packages/core/dist/agents/backgroundCurationQueue.js"
);
const { createModelKnowledgePostRunner } = await import("../packages/core/dist/harness/modelRunner.js");
const { evaluateInteraction } = await import("../packages/core/dist/harness/feedbackPolicy.js");
const { createOpenAICompatibleModelClient, createOpenAICompatibleModelClientFromEnv } = await import(
  "../packages/core/dist/model/openaiCompatibleClient.js"
);
const { createSourcePostReleasePlan } = await import("../packages/core/dist/ranking/postReleasePlan.js");
const { createOpenAICompatibleSourceImportWorker, createSourceImportWorker } = await import(
  "../packages/core/dist/source/sourceImportWorker.js"
);
const { transformArticleUrl } = await import("../packages/core/dist/transform/articleImport.js");
const { transformMockYouTubeUrl } = await import("../packages/core/dist/transform/mockYoutubeImport.js");
const { transformYouTubeUrl } = await import("../packages/core/dist/transform/youtubeImport.js");

const result = transformMockYouTubeUrl(
  "https://www.youtube.com/watch?v=aitimeline-demo",
  "2026-06-10T00:00:00.000Z"
);

assert.equal(result.harnessRun.status, "succeeded", "harness run should succeed");
assert.equal(result.cards.length, 4, "mock import should produce four cards");
assert.equal(result.sourceRegistry.snapshots.length, 1, "transcript asset should produce one source snapshot");
assert.equal(result.sourceRegistry.chunks.length, 4, "mock transcript should produce four registered chunks");

const fakePlayerResponse = {
  videoDetails: {
    title: "Real transcript smoke video",
    author: "AITimeline Test Channel",
    lengthSeconds: "180"
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://youtube.test/api/timedtext?v=real-demo",
          languageCode: "en",
          name: { simpleText: "English" }
        }
      ]
    }
  }
};
const youtubeImport = await transformYouTubeUrl("https://www.youtube.com/watch?v=real-demo", {
  createdAt: "2026-06-10T00:00:00.000Z",
  fetch: async (url) => {
    const requestedUrl = String(url);

    if (requestedUrl.includes("/watch")) {
      return new Response(`<script>var ytInitialPlayerResponse = ${JSON.stringify(fakePlayerResponse)};</script>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }

    if (requestedUrl.includes("/api/timedtext")) {
      return new Response(
        JSON.stringify({
          events: [
            {
              tStartMs: 0,
              dDurationMs: 4200,
              segs: [{ utf8: "AI Agent systems turn source material into durable knowledge with citations." }]
            },
            {
              tStartMs: 4300,
              dDurationMs: 5000,
              segs: [
                {
                  utf8:
                    "The timeline can use Memory and Knowledge Graph signals to recommend review and related ideas."
                }
              ]
            }
          ]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    return new Response("not found", { status: 404 });
  },
  recommendedBecause: "Smoke test real YouTube transcript extraction."
});

assert.equal(youtubeImport.source.title, "Real transcript smoke video", "real YouTube import should read title");
assert.equal(youtubeImport.track.languageCode, "en", "real YouTube import should select transcript language");
assert.equal(youtubeImport.chunks.length, 2, "real YouTube import should create transcript chunks");
assert.equal(youtubeImport.cards.length, 2, "real YouTube import should produce cards from transcript segments");
assert.equal(youtubeImport.importRecord.status, "ready", "real YouTube import should be ready");

const articleImport = await transformArticleUrl("https://example.com/learning-agent-timeline", {
  createdAt: "2026-06-10T00:00:00.000Z",
  fetch: async () =>
    new Response(
      `
        <html>
          <head>
            <meta property="og:title" content="Learning agents need a timeline surface" />
            <meta name="author" content="AITimeline Research" />
            <meta property="article:published_time" content="2026-06-09T00:00:00.000Z" />
          </head>
          <body>
            <article>
              <p>An AI Agent can turn source material into durable knowledge when it keeps citations, extracts concepts, and creates a learning surface that users can revisit.</p>
              <p>A Knowledge Graph helps Memory become useful because saved concepts, weak concepts, and Recommendation signals can point the user toward review at the right time.</p>
            </article>
          </body>
        </html>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    ),
  recommendedBecause: "Smoke test article import."
});

assert.equal(articleImport.source.type, "article", "article import should create an article source");
assert.equal(articleImport.source.title, "Learning agents need a timeline surface", "article import should read title");
assert.equal(articleImport.chunks.length, 2, "article import should create chunks from paragraphs");
assert.equal(articleImport.cards.length, 2, "article import should create cards from chunks");
assert.equal(articleImport.importRecord.status, "ready", "article import should be ready");

const releasePlan = createSourcePostReleasePlan({
  posts: result.cards,
  generatedAt: "2026-06-10T00:00:00.000Z",
  policy: {
    maxImmediatePostsPerSource: 2,
    minutesBetweenQueuedPosts: 30
  }
});

assert.equal(releasePlan.immediatePostIds.length, 2, "release plan should allow only two immediate posts");
assert.equal(releasePlan.queuedPostIds.length, 2, "release plan should queue extra source posts");
assert.equal(
  releasePlan.items.find((item) => item.status === "queued")?.releaseAt,
  "2026-06-10T00:30:00.000Z",
  "release plan should stagger queued posts"
);

for (const validation of result.validation) {
  assert.equal(validation.valid, true, `${validation.postId} should pass harness validation`);
  assert.equal(
    validation.issues.filter((issue) => issue.severity === "error").length,
    0,
    `${validation.postId} should have no validation errors`
  );
  assert.ok(
    (validation.grounding?.checks.length ?? 0) > 0,
    `${validation.postId} should include grounding checks`
  );
}

let repairCalls = 0;
const repairRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 1,
  client: {
    async complete() {
      repairCalls += 1;

      if (repairCalls === 1) {
        return { content: JSON.stringify({ posts: [{ id: "broken-post" }] }) };
      }

      return { content: JSON.stringify({ posts: result.cards }) };
    }
  }
});
const modelResult = await repairRunner.run({
  source: result.source,
  chunks: result.chunks,
  sourceRegistry: result.sourceRegistry,
  createdAt: "2026-06-10T00:00:00.000Z",
  recommendedBecause: "Smoke test repair output."
});

assert.equal(repairCalls, 2, "model runner should repair after invalid output");
assert.equal(modelResult.run.status, "succeeded", "repaired model run should succeed");
assert.equal(modelResult.posts.length, 4, "repaired model run should keep valid posts");

let capturedRequest;
const compatibleClient = createOpenAICompatibleModelClient({
  model: "test-model",
  apiKey: "test-key",
  baseUrl: "https://models.example/v1/",
  fetch: async (url, init) => {
    capturedRequest = {
      url: String(url),
      headers: Object.fromEntries(new Headers(init.headers)),
      body: JSON.parse(String(init.body))
    };

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  }
});
const compatibleCompletion = await compatibleClient.complete({
  messages: [
    { role: "system", content: "Return JSON." },
    { role: "user", content: "Say ok." }
  ],
  responseFormat: "json_object",
  temperature: 0
});

assert.equal(compatibleCompletion.content, JSON.stringify({ ok: true }), "compatible client should return assistant content");
assert.equal(capturedRequest.url, "https://models.example/v1/chat/completions");
assert.equal(capturedRequest.headers.authorization, "Bearer test-key");
assert.equal(capturedRequest.body.model, "test-model");
assert.deepEqual(capturedRequest.body.response_format, { type: "json_object" });
assert.equal(capturedRequest.body.temperature, 0);

const envClient = createOpenAICompatibleModelClientFromEnv(
  {
    AITIMELINE_MODEL_NAME: "env-model",
    AITIMELINE_MODEL_BASE_URL: "https://env-models.example/v1",
    AITIMELINE_MODEL_API_KEY: "env-key"
  },
  {
    fetch: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ env: true }) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  }
);
const envCompletion = await envClient.complete({
  messages: [{ role: "user", content: "Return JSON." }],
  responseFormat: "json_object"
});

assert.equal(envCompletion.content, JSON.stringify({ env: true }), "env client should read model settings from env map");

const failingClient = createOpenAICompatibleModelClient({
  model: "test-model",
  baseUrl: "https://models.example/v1",
  fetch: async () =>
    new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
      status: 429,
      headers: { "content-type": "application/json" }
    })
});

await assert.rejects(
  () =>
    failingClient.complete({
      messages: [{ role: "user", content: "Return JSON." }],
      responseFormat: "json_object"
    }),
  /quota exceeded/,
  "compatible client should surface provider error messages"
);

const deterministicWorker = createSourceImportWorker();
const deterministicImport = await deterministicWorker.run({
  source: result.source,
  assets: [result.asset],
  chunks: result.chunks,
  createdAt: "2026-06-10T00:00:00.000Z",
  recommendedBecause: "Smoke test deterministic source import worker."
});

assert.equal(deterministicImport.importRecord.status, "ready", "deterministic import should be ready");
assert.equal(deterministicImport.posts.length, 4, "deterministic import should create posts");
assert.equal(deterministicImport.sourceRegistry.assets.length, 1, "deterministic import should preserve assets");
assert.equal(deterministicImport.harnessRun?.runnerKind, "deterministic");

const modelWorker = createOpenAICompatibleSourceImportWorker(
  {
    AITIMELINE_MODEL_NAME: "test-model",
    AITIMELINE_MODEL_BASE_URL: "https://models.example/v1",
    AITIMELINE_MODEL_API_KEY: "test-key"
  },
  {
    modelRunner: { maxRepairAttempts: 0 },
    modelClient: {
      fetch: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ posts: result.cards }) } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    }
  }
);
const modelImport = await modelWorker.run({
  source: result.source,
  assets: [result.asset],
  chunks: result.chunks,
  sourceRegistry: result.sourceRegistry,
  createdAt: "2026-06-10T00:00:00.000Z",
  recommendedBecause: "Smoke test model source import worker."
});

assert.equal(modelImport.importRecord.status, "ready", "model import should be ready");
assert.equal(modelImport.posts.length, 4, "model import should accept grounded posts");
assert.equal(modelImport.harnessRun?.runnerKind, "model");

const failedWorker = createOpenAICompatibleSourceImportWorker(
  {
    AITIMELINE_MODEL_NAME: "test-model",
    AITIMELINE_MODEL_BASE_URL: "https://models.example/v1"
  },
  {
    modelClient: {
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "provider unavailable" } }), {
          status: 503,
          headers: { "content-type": "application/json" }
        })
    }
  }
);
const failedImport = await failedWorker.run({
  source: result.source,
  chunks: result.chunks,
  createdAt: "2026-06-10T00:00:00.000Z"
});

assert.equal(failedImport.importRecord.status, "failed", "worker should return failed import records");
assert.match(failedImport.errorMessage, /provider unavailable/);

const interestSignal = {
  postId: result.cards[2].id,
  topicId: "knowledge-graph",
  conceptIds: ["Knowledge Graph", "Memory", "Recommendation"],
  impression: true,
  dwellTimeMs: 18000,
  openedThread: true,
  liked: true,
  saved: false,
  askedQuestion: false,
  reviewed: false,
  skippedQuickly: false,
  createdAt: "2026-06-10T00:00:00.000Z"
};
const interestedTopicState = {
  topicId: "knowledge-graph",
  interestScore: 0.82,
  fatigueScore: 0.08,
  comprehensionScore: 0.74
};
const interestFeedback = evaluateInteraction(interestSignal, interestedTopicState);
const backgroundPlan = createBackgroundCurationPlan({
  signals: [interestSignal],
  feedback: [interestFeedback],
  topicStates: [interestedTopicState],
  generatedAt: "2026-06-10T00:00:00.000Z",
  sourceCandidates: [
    {
      id: "candidate-knowledge-graph-memory",
      source: {
        id: "article-knowledge-graph-memory",
        title: "How knowledge graphs improve personal memory systems",
        url: "https://example.com/knowledge-graph-memory",
        type: "article",
        author: "AITimeline Research"
      },
      topicId: "knowledge-graph",
      conceptIds: ["Knowledge Graph", "Memory"],
      relevanceScore: 0.92,
      noveltyScore: 0.74,
      qualityScore: 0.86,
      reason: "It connects knowledge graph structure to memory and review.",
      discoveredAt: "2026-06-10T00:00:00.000Z"
    }
  ]
});

assert.ok(
  backgroundPlan.jobs.some((job) => job.kind === "generate_followup"),
  "background curation should continue an interested series"
);
assert.ok(
  backgroundPlan.jobs.some((job) => job.kind === "import_source"),
  "background curation should package matching source candidates"
);
assert.deepEqual(
  backgroundPlan.acceptedSourceCandidateIds,
  ["candidate-knowledge-graph-memory"],
  "background curation should track accepted external sources"
);

const skipSignal = {
  postId: result.cards[0].id,
  topicId: "rag-basics",
  conceptIds: ["RAG"],
  impression: true,
  dwellTimeMs: 700,
  openedThread: false,
  liked: false,
  saved: false,
  askedQuestion: false,
  reviewed: false,
  skippedQuickly: true,
  createdAt: "2026-06-10T00:00:00.000Z"
};
const fatiguedTopicState = {
  topicId: "rag-basics",
  interestScore: 0.2,
  fatigueScore: 0.8,
  comprehensionScore: 0.4
};
const skipFeedback = evaluateInteraction(skipSignal, fatiguedTopicState);
const cooldownPlan = createBackgroundCurationPlan({
  signals: [skipSignal],
  feedback: [skipFeedback],
  topicStates: [fatiguedTopicState],
  generatedAt: "2026-06-10T00:00:00.000Z"
});

assert.ok(
  cooldownPlan.jobs.some((job) => job.kind === "cooldown_topic"),
  "background curation should cool down skipped topics"
);
assert.equal(
  cooldownPlan.jobs.some((job) => job.kind === "import_source"),
  false,
  "background curation should not import sources for skipped topics"
);

let persistedCurationJobs = "";
const curationJobStorage = {
  read: () => persistedCurationJobs,
  write: (serialized) => {
    persistedCurationJobs = serialized;
  }
};
const curationStore = createPersistentBackgroundCurationJobStore(curationJobStorage);
const enqueuedRecords = curationStore.enqueuePlan(backgroundPlan);

assert.equal(enqueuedRecords.length, 2, "background curation store should enqueue plan jobs");
assert.equal(curationStore.getDueJobs("2026-06-10T00:00:00.000Z").length, 2, "queued jobs should be due");
assert.ok(persistedCurationJobs.includes("import_source"), "persistent curation store should serialize jobs");

const rehydratedCurationStore = createPersistentBackgroundCurationJobStore(curationJobStorage);
const importBatch = await runDueBackgroundCurationJobs(
  rehydratedCurationStore,
  {
    sourceImportWorker: deterministicWorker,
    ingestSourceCandidate: (candidate) => ({
      assets: [
        {
          id: `${candidate.source.id}-text`,
          sourceId: candidate.source.id,
          kind: "text",
          content:
            "Knowledge graphs can connect concepts to memory. Memory systems use those links to support recommendation and review.",
          createdAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      chunks: [
        {
          id: `${candidate.source.id}-chunk-1`,
          sourceId: candidate.source.id,
          content:
            "Knowledge graphs can connect concepts to memory. Memory systems use those links to support recommendation and review.",
          conceptHints: ["Knowledge Graph", "Memory", "Recommendation"]
        }
      ]
    })
  },
  {
    now: "2026-06-10T00:00:00.000Z",
    kinds: ["import_source"]
  }
);
const importedJobRecord = importBatch.records[0];
const finalCurationStore = createPersistentBackgroundCurationJobStore(curationJobStorage);

assert.equal(importBatch.records.length, 1, "executor should run one import job");
assert.equal(importedJobRecord.status, "succeeded", "import job should succeed");
assert.equal(
  importedJobRecord.result?.sourceImport?.importRecord.status,
  "ready",
  "import job should produce a ready source import"
);
assert.equal(
  finalCurationStore.list("queued").some((record) => record.job.kind === "generate_followup"),
  true,
  "executor should leave unrelated job kinds queued when filtered"
);
assert.equal(
  finalCurationStore.get(importedJobRecord.id)?.status,
  "succeeded",
  "persistent curation store should rehydrate executed job status"
);

const discoveryPlan = createBackgroundCurationPlan({
  signals: [interestSignal],
  feedback: [interestFeedback],
  topicStates: [interestedTopicState],
  generatedAt: "2026-06-10T00:00:00.000Z"
});
let persistedDiscoveryJobs = "";
const discoveryStore = createPersistentBackgroundCurationJobStore({
  read: () => persistedDiscoveryJobs,
  write: (serialized) => {
    persistedDiscoveryJobs = serialized;
  }
});

discoveryStore.enqueuePlan(discoveryPlan);

const discoveryBatch = await runDueBackgroundCurationJobs(
  discoveryStore,
  {
    discoverSources: (job) => [
      {
        id: `${job.topicId}-discovered-source`,
        source: {
          id: `${job.topicId}-article`,
          title: "Discovered background source",
          url: "https://example.com/discovered-background-source",
          type: "article"
        },
        topicId: job.topicId,
        conceptIds: job.conceptIds,
        relevanceScore: 0.8,
        noveltyScore: 0.7,
        qualityScore: 0.9,
        reason: "Discovery handler found a relevant article for the interested topic.",
        discoveredAt: "2026-06-10T00:00:00.000Z"
      }
    ]
  },
  {
    now: "2026-06-10T00:20:00.000Z",
    kinds: ["discover_sources"]
  }
);
const discoveryJobRecord = discoveryBatch.records[0];

assert.equal(discoveryJobRecord.status, "succeeded", "discovery job should succeed");
assert.equal(
  discoveryJobRecord.result?.discoveredSourceCandidates?.length,
  1,
  "discovery job should record discovered source candidates"
);

console.log(
  JSON.stringify(
    {
      status: result.harnessRun.status,
      cards: result.cards.length,
      snapshots: result.sourceRegistry.snapshots.length,
      chunks: result.sourceRegistry.chunks.length,
      modelRunnerRepairCalls: repairCalls,
      compatibleModelClient: {
        url: capturedRequest.url,
        responseFormat: capturedRequest.body.response_format.type
      },
      sourceImportWorker: {
        deterministicStatus: deterministicImport.importRecord.status,
        modelStatus: modelImport.importRecord.status,
        failureStatus: failedImport.importRecord.status
      },
      youtubeImport: {
        title: youtubeImport.source.title,
        chunks: youtubeImport.chunks.length,
        cards: youtubeImport.cards.length,
        track: youtubeImport.track.languageCode
      },
      articleImport: {
        title: articleImport.source.title,
        chunks: articleImport.chunks.length,
        cards: articleImport.cards.length
      },
      releasePlan: {
        immediate: releasePlan.immediatePostIds.length,
        queued: releasePlan.queuedPostIds.length
      },
      backgroundCuration: {
        interestedJobs: backgroundPlan.jobs.map((job) => job.kind),
        cooldownJobs: cooldownPlan.jobs.map((job) => job.kind),
        executedImportStatus: importedJobRecord.status,
        executedDiscoveryStatus: discoveryJobRecord.status
      },
      validation: result.validation.map((validation) => ({
        postId: validation.postId,
        valid: validation.valid,
        warnings: validation.issues.filter((issue) => issue.severity === "warning").length,
        groundingChecks: validation.grounding?.checks.length ?? 0
      }))
    },
    null,
    2
  )
);
