import assert from "node:assert/strict";

const { createBackgroundCurationPlan } = await import("../packages/core/dist/agents/backgroundCuration.js");
const { runConversationTurn } = await import("../packages/core/dist/agents/conversationAgent.js");
const { createStaticSearchProvider } = await import("../packages/core/dist/discovery/searchProvider.js");
const { planDiscoveryQueries, runSourceDiscovery } = await import(
  "../packages/core/dist/discovery/sourceDiscovery.js"
);
const { buildKnowledgeBoundary, classifyConceptZone } = await import(
  "../packages/core/dist/graph/knowledgeBoundary.js"
);
const {
  createInMemoryBackgroundCurationJobStore,
  createPersistentBackgroundCurationJobStore,
  runDueBackgroundCurationJobs
} = await import(
  "../packages/core/dist/agents/backgroundCurationQueue.js"
);
const { createEvidenceLedger } = await import("../packages/core/dist/harness/evidenceLedger.js");
const { validateGrounding } = await import("../packages/core/dist/harness/groundingGate.js");
const { validateKnowledgePost } = await import("../packages/core/dist/harness/schema.js");
const { createModelKnowledgePostRunner } = await import("../packages/core/dist/harness/modelRunner.js");
const { evaluateInteraction } = await import("../packages/core/dist/harness/feedbackPolicy.js");
const {
  createFollowupGenerationProtocol,
  createFollowupSourceImportPlan,
  validateFollowupGenerationProtocol
} = await import(
  "../packages/core/dist/harness/followupHarness.js"
);
const { applyUserMemoryEdits, createEmptyUserMemory } = await import(
  "../packages/core/dist/memory/userMemoryControls.js"
);
const { buildCardConnections } = await import("../packages/core/dist/graph/cardConnections.js");
const { buildConceptDigest } = await import("../packages/core/dist/graph/conceptDigest.js");
const { createOpenAICompatibleModelClient, createOpenAICompatibleModelClientFromEnv } = await import(
  "../packages/core/dist/model/openaiCompatibleClient.js"
);
const { createSourcePostReleasePlan } = await import("../packages/core/dist/ranking/postReleasePlan.js");
const { rankPersonalizedTimeline } = await import("../packages/core/dist/ranking/ranker.js");
const { createOpenAICompatibleSourceImportWorker, createSourceImportWorker } = await import(
  "../packages/core/dist/source/sourceImportWorker.js"
);
const { createAITimelinePersistenceStore } = await import("../packages/core/dist/storage/persistenceStore.js");
const { fetchArticle, parseArxivAtom, transformArticleUrl } = await import(
  "../packages/core/dist/transform/articleImport.js"
);
const { transformMockYouTubeUrl } = await import("../packages/core/dist/transform/mockYoutubeImport.js");
const { transformYouTubeUrl } = await import("../packages/core/dist/transform/youtubeImport.js");

const followupInstructionPattern =
  /Seed grounding|User signal reason|must cite this chunk|Deeper angle|Broader angle|Simpler angle|Review angle/i;

function collectStrings(value) {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }

  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }

  return [];
}

function enqueueSingleJob(store, job) {
  return store.enqueuePlan({
    generatedAt: job.createdAt,
    jobs: [job],
    suppressions: [],
    acceptedSourceCandidateIds: [],
    cooledTopicIds: [],
    expansionPlan: {
      generatedAt: job.createdAt,
      jobs: [],
      suppressions: [],
      cooledTopicIds: []
    }
  });
}

const result = transformMockYouTubeUrl(
  "https://www.youtube.com/watch?v=aitimeline-demo",
  "2026-06-10T00:00:00.000Z"
);

assert.equal(result.harnessRun.status, "succeeded", "harness run should succeed");
assert.equal(result.cards.length, 4, "mock import should produce four cards");
assert.equal(result.sourceRegistry.snapshots.length, 1, "transcript asset should produce one source snapshot");
assert.equal(result.sourceRegistry.chunks.length, 4, "mock transcript should produce four registered chunks");

// Cross-card connections turn fragments into a web: a card links to OTHER cards that share its concepts/edges.
const cardConnections = buildCardConnections(result.cards[0], result.cards);
assert.ok(Array.isArray(cardConnections), "card connections should be an array");
assert.ok(cardConnections.length >= 1, "shared concepts across the transcript should connect fragments to other cards");
assert.ok(
  cardConnections.every((connection) => connection.cardId !== result.cards[0].id),
  "a card should never connect to itself"
);
assert.ok(
  cardConnections.every((connection) => result.cards.some((card) => card.id === connection.cardId)),
  "every connection should point at a real card"
);
assert.equal(
  buildCardConnections(result.cards[0], [result.cards[0]]).length,
  0,
  "a card with no peers should have no connections"
);

// A concept digest assembles every fragment touching one concept into one ordered, readable whole.
const digestConcept = result.cards[0].concepts[0];
const conceptDigest = buildConceptDigest(digestConcept, result.cards);
assert.ok(conceptDigest.cardCount >= 1, "the concept's own card should appear in its digest");
assert.equal(conceptDigest.entries.length, conceptDigest.cardCount, "cardCount should match the entry list length");
assert.ok(
  conceptDigest.entries.some((entry) => entry.cardId === result.cards[0].id),
  "the digest should include the card the concept was read from"
);
assert.ok(
  conceptDigest.entries.every((entry) => result.cards.some((card) => card.id === entry.cardId)),
  "every digest entry should point at a real card"
);
const digestRoles = ["foundation", "builds", "applies", "contrast"];
assert.ok(
  conceptDigest.entries.every((entry) => digestRoles.includes(entry.role) && entry.keyTakeaway.length > 0),
  "every entry should carry a valid role and a non-empty takeaway"
);
const roleRank = Object.fromEntries(digestRoles.map((role, index) => [role, index]));
const orderedByRole = conceptDigest.entries.every(
  (entry, index) => index === 0 || roleRank[conceptDigest.entries[index - 1].role] <= roleRank[entry.role]
);
assert.ok(orderedByRole, "digest entries should read foundations -> builds -> applies -> contrasts");
assert.equal(
  buildConceptDigest("a-concept-no-card-mentions", result.cards).cardCount,
  0,
  "an unknown concept should produce an empty digest"
);

// Non-ASCII (Chinese) concepts must slug to distinct, non-empty keys instead of collapsing to "".
const zhCards = [
  {
    id: "zh-1",
    title: "记忆基础",
    summary: "智能体如何记住上下文。",
    keyTakeaway: "智能体需要持久记忆才能跨轮次工作。",
    concepts: ["记忆", "AI 智能体"],
    createdAt: "2026-01-01T00:00:00.000Z",
    difficulty: "beginner"
  },
  {
    id: "zh-2",
    title: "评估方法",
    summary: "如何衡量智能体质量。",
    keyTakeaway: "没有评估就无法迭代。",
    concepts: ["评估"],
    createdAt: "2026-01-02T00:00:00.000Z"
  }
];
const zhMemory = buildConceptDigest("记忆", zhCards);
assert.equal(zhMemory.cardCount, 1, "a Chinese concept should match only its own card, not collapse to every card");
assert.equal(zhMemory.entries[0].cardId, "zh-1", "the Chinese digest should resolve to the matching card");
const zhEval = buildConceptDigest("评估", zhCards);
assert.equal(zhEval.cardCount, 1, "a different Chinese concept should slug to a different, non-empty key");
assert.equal(zhEval.entries[0].cardId, "zh-2", "distinct Chinese concepts must not bleed into each other");

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

const arxivAtomXml = `
  <?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>http://arxiv.org/abs/2512.13564v2</id>
      <updated>2025-12-16T00:00:00Z</updated>
      <published>2025-12-15T00:00:00Z</published>
      <title>Memory &amp; Retrieval for AI Agents</title>
      <summary>
        We study how AI Agent systems combine Memory, RAG, and Knowledge Graph retrieval.
        The abstract explains why citations &amp; durable source chunks keep Recommendation workflows grounded,
        and it normalizes source evidence for Evaluation across agent timelines.
      </summary>
      <author>
        <name>Ada Lovelace</name>
      </author>
      <author>
        <name>Alan Turing</name>
      </author>
    </entry>
  </feed>
`;
const parsedArxiv = parseArxivAtom(arxivAtomXml);

assert.equal(parsedArxiv.title, "Memory & Retrieval for AI Agents", "arXiv parser should decode title entities");
assert.deepEqual(parsedArxiv.authors, ["Ada Lovelace", "Alan Turing"], "arXiv parser should read authors");
assert.equal(parsedArxiv.publishedAt, "2025-12-15T00:00:00Z", "arXiv parser should read published date");
assert.equal(
  parsedArxiv.abstract,
  "We study how AI Agent systems combine Memory, RAG, and Knowledge Graph retrieval. The abstract explains why citations & durable source chunks keep Recommendation workflows grounded, and it normalizes source evidence for Evaluation across agent timelines.",
  "arXiv parser should normalize abstract whitespace and XML entities"
);

let arxivRequestCount = 0;
const fetchArxiv = async (url) => {
  arxivRequestCount += 1;
  assert.equal(
    String(url),
    "https://export.arxiv.org/api/query?id_list=2512.13564v2",
    "arXiv import should call the metadata API with the normalized id"
  );

  return new Response(arxivAtomXml, { status: 200, headers: { "content-type": "application/atom+xml" } });
};
const arxivImport = await transformArticleUrl("https://arxiv.org/abs/2512.13564v2?utm_source=smoke", {
  createdAt: "2026-06-10T00:00:00.000Z",
  fetch: fetchArxiv,
  recommendedBecause: "Smoke test arXiv article import."
});

assert.equal(arxivRequestCount, 1, "arXiv import should make exactly one metadata request");
assert.equal(arxivImport.source.type, "article", "arXiv import should still create an article source");
assert.equal(arxivImport.source.title, parsedArxiv.title, "arXiv import should use the paper title");
assert.equal(
  arxivImport.source.url,
  "https://arxiv.org/abs/2512.13564v2",
  "arXiv import should normalize source URL to the abs page"
);
assert.equal(arxivImport.source.author, "Ada Lovelace, Alan Turing", "arXiv import should join authors");
assert.equal(arxivImport.source.publishedAt, parsedArxiv.publishedAt, "arXiv import should set publishedAt");
assert.equal(arxivImport.chunks.length, 1, "arXiv import should create one abstract chunk");
assert.equal(arxivImport.chunks[0].content, parsedArxiv.abstract, "arXiv chunk should be the paper abstract");
assert.ok(!arxivImport.chunks[0].content.includes("arXivLabs"), "arXiv import should not use page footer text");
assert.equal(arxivImport.importRecord.status, "ready", "arXiv import should be ready");

const arxivPdfFetch = await fetchArticle("https://arxiv.org/pdf/2512.13564v2.pdf", {
  createdAt: "2026-06-10T00:00:00.000Z",
  fetch: fetchArxiv
});
const arxivHtmlFetch = await fetchArticle("https://arxiv.org/html/2512.13564v2", {
  createdAt: "2026-06-10T00:00:00.000Z",
  fetch: fetchArxiv
});

assert.equal(
  arxivPdfFetch.source.id,
  arxivImport.source.id,
  "arXiv pdf and abs links should dedupe to the same source id"
);
assert.equal(
  arxivHtmlFetch.source.id,
  arxivImport.source.id,
  "arXiv html and abs links should dedupe to the same source id"
);
assert.equal(
  arxivPdfFetch.source.url,
  "https://arxiv.org/abs/2512.13564v2",
  "arXiv pdf links should normalize to the abs page"
);

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

const memoryEditResult = applyUserMemoryEdits(
  createEmptyUserMemory(),
  [
    { kind: "add", field: "profile.interests", value: "AI Agents" },
    { kind: "add", field: "knowledge.weakConcepts", value: "RAG" },
    { kind: "add", field: "knowledge.knownConcepts", value: "RAG" },
    { kind: "set", field: "profile.explanationStyle", value: "example-first" },
    { kind: "add", field: "agent.preferredSourceTypes", value: "article" }
  ],
  "2026-06-10T00:00:00.000Z"
);

assert.deepEqual(memoryEditResult.memory.profile.interests, ["AI Agents"], "memory edits should add interests");
assert.deepEqual(memoryEditResult.memory.knowledge.knownConcepts, ["RAG"], "memory edits should add known concepts");
assert.deepEqual(
  memoryEditResult.memory.knowledge.weakConcepts,
  [],
  "known concepts should be removed from weak concepts"
);
assert.equal(
  memoryEditResult.memory.profile.explanationStyle,
  "example-first",
  "memory edits should set explanation style"
);
assert.deepEqual(
  memoryEditResult.memory.agent.preferredSourceTypes,
  ["article"],
  "memory edits should set preferred source types"
);
assert.equal(memoryEditResult.events.length, 5, "memory edits should produce audit events");

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

const evidenceLedger = createEvidenceLedger(
  result.cards[0],
  result.sourceRegistry,
  "2026-06-10T00:00:00.000Z"
);

assert.equal(evidenceLedger.postId, result.cards[0].id, "evidence ledger should target the post");
assert.ok(evidenceLedger.summary.totalClaims > 0, "evidence ledger should include grounded claims");
assert.equal(evidenceLedger.summary.failed, 0, "deterministic posts should have no failed source-fact claims");
assert.ok(evidenceLedger.claims[0]?.evidence.length > 0, "evidence ledger claims should resolve source chunks");

// Harness contract: citations must be chunk-level, weight 0 edges are legal, acronym claims still ground.
const contractCard = result.cards[0];
const chunklessCitationCard = {
  ...contractCard,
  citations: contractCard.citations.map(({ chunkId: _chunkId, ...rest }) => rest)
};

assert.equal(
  validateKnowledgePost(chunklessCitationCard).valid,
  false,
  "citations without a chunkId should fail schema validation"
);
assert.equal(
  validateGrounding(chunklessCitationCard, result.sourceRegistry).valid,
  false,
  "grounding gate should reject citations without a chunkId"
);
assert.ok(contractCard.graphEdges.length > 0, "contract card should include graph edges");
assert.equal(
  validateKnowledgePost({
    ...contractCard,
    graphEdges: contractCard.graphEdges.map((edge, index) => (index === 0 ? { ...edge, weight: 0 } : edge))
  }).valid,
  true,
  "graph edges with weight 0 should pass validation (schema minimum is 0)"
);

const acronymSourceCard = result.cards.find((card) =>
  card.citations.some(
    (citation) =>
      result.sourceRegistry.chunks.find((chunk) => chunk.id === citation.chunkId)?.content.includes("RAG")
  )
);

assert.ok(acronymSourceCard, "mock import should include a card grounded in the RAG chunk");

const acronymGrounding = validateGrounding({ ...acronymSourceCard, summary: "RAG" }, result.sourceRegistry);
const acronymSummaryCheck = acronymGrounding.checks.find((check) => check.fieldPath === "$.summary");

assert.equal(
  acronymSummaryCheck?.status,
  "passed",
  "short acronym claims should still ground against cited evidence"
);

// Numeric hard gate: fabricated figures must fail even when lexical overlap stays high.
const fabricatedNumberGrounding = validateGrounding(
  { ...contractCard, summary: `${contractCard.summary} In 2031 this covered 87% of cases.` },
  result.sourceRegistry
);
const fabricatedNumberCheck = fabricatedNumberGrounding.checks.find((check) => check.fieldPath === "$.summary");

assert.equal(fabricatedNumberCheck?.status, "failed", "source facts with fabricated numbers should fail grounding");
assert.match(
  fabricatedNumberCheck?.reason ?? "",
  /2031/,
  "numeric grounding failures should name the ungrounded numbers"
);

const citedChunkContent = result.sourceRegistry.chunks.find(
  (chunk) => chunk.id === contractCard.citations[0]?.chunkId
)?.content;
const evidenceNumber = citedChunkContent?.match(/\d+/)?.[0];

if (evidenceNumber) {
  const groundedNumberGrounding = validateGrounding(
    { ...contractCard, summary: `${contractCard.summary} The source mentions ${evidenceNumber}.` },
    result.sourceRegistry
  );
  const groundedNumberCheck = groundedNumberGrounding.checks.find((check) => check.fieldPath === "$.summary");

  assert.equal(groundedNumberCheck?.status, "passed", "numbers present in cited evidence should pass grounding");
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
const personalizedRanking = rankPersonalizedTimeline({
  cards: result.cards,
  memory: memoryEditResult.memory,
  topicStates: [interestedTopicState],
  recentSignals: [interestSignal],
  now: "2026-06-10T00:00:00.000Z"
});

assert.ok(personalizedRanking[0].scoreReasons.length > 0, "personalized ranking should explain scores");
assert.ok(
  personalizedRanking.some((card) => card.id === interestSignal.postId && card.recommendationIntent !== "explore"),
  "personalized ranking should react to recent interaction signals"
);

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
const followupJob = backgroundPlan.jobs.find((job) => job.kind === "generate_followup");
const followupSeedPost = result.cards.find((card) => card.id === interestSignal.postId);

assert.ok(followupJob, "background curation should include a follow-up generation job");
assert.ok(followupSeedPost, "follow-up smoke should have a seed post");
assert.equal(followupJob.postId, interestSignal.postId, "follow-up job should retain the seed post id");
assert.equal(followupJob.nextAction, "expand_broader", "follow-up job should retain the learning intent");

const followupProtocol = createFollowupGenerationProtocol({
  job: followupJob,
  seedPost: followupSeedPost,
  createdAt: "2026-06-10T00:00:00.000Z"
});
const followupProtocolValidation = validateFollowupGenerationProtocol(followupProtocol);
const followupSourcePlan = createFollowupSourceImportPlan({
  job: followupJob,
  seedPost: followupSeedPost,
  createdAt: "2026-06-10T00:00:00.000Z"
});
const followupChunkContent = followupSourcePlan.input.chunks[0]?.content ?? "";
const seedPostText = collectStrings(followupSeedPost)
  .map((value) => value.replace(/\s+/g, " ").trim())
  .join("\n\n");

assert.equal(followupProtocol.intent, "expand_broader", "follow-up protocol should encode broaden intent");
assert.equal(followupProtocolValidation.valid, true, "follow-up protocol should validate");
assert.doesNotMatch(followupChunkContent, followupInstructionPattern, "follow-up chunks should not contain instructions");
assert.equal(
  followupChunkContent.includes(followupJob.reason),
  false,
  "follow-up chunks should not contain the user signal reason"
);
assert.equal(
  followupChunkContent.includes(followupProtocol.learningGoal),
  false,
  "follow-up chunks should not contain the learning goal"
);
assert.ok(followupChunkContent.includes(followupSeedPost.title), "follow-up chunk should include seed title text");
assert.ok(followupChunkContent.includes(followupSeedPost.thesis), "follow-up chunk should include seed thesis text");
assert.ok(followupChunkContent.includes(followupSeedPost.keyTakeaway), "follow-up chunk should include seed takeaway text");

for (const segment of followupChunkContent.split(/\n\n+/).filter(Boolean)) {
  assert.ok(seedPostText.includes(segment), `follow-up chunk segment should come from seed post text: ${segment}`);
}

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

const secondSkipSignal = {
  ...skipSignal,
  postId: result.cards[1].id,
  topicId: "vector-db-basics",
  conceptIds: ["Vector DB"]
};
const secondFatiguedTopicState = { ...fatiguedTopicState, topicId: "vector-db-basics" };
const concurrencyPlan = createBackgroundCurationPlan({
  signals: [skipSignal, secondSkipSignal],
  feedback: [skipFeedback, evaluateInteraction(secondSkipSignal, secondFatiguedTopicState)],
  topicStates: [fatiguedTopicState, secondFatiguedTopicState],
  generatedAt: "2026-06-10T00:00:00.000Z"
});

assert.equal(
  concurrencyPlan.jobs.filter((job) => job.kind === "cooldown_topic").length,
  2,
  "concurrency fixture should queue two cooldown jobs"
);

let persistedConcurrencyJobs = "";
const concurrencyStore = createPersistentBackgroundCurationJobStore({
  read: () => persistedConcurrencyJobs,
  write: (serialized) => {
    persistedConcurrencyJobs = serialized;
  }
});

concurrencyStore.enqueuePlan(concurrencyPlan);

const cooldownExecutionsByTopic = new Map();
const concurrencyHandlers = {
  cooldownTopic: async (job) => {
    cooldownExecutionsByTopic.set(job.topicId, (cooldownExecutionsByTopic.get(job.topicId) ?? 0) + 1);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));

    return { kind: job.kind, message: "Topic cooldown recorded." };
  }
};
// Cooldown jobs get a runAfter ~36h out, so run once both are due.
const concurrentBatches = await Promise.all([
  runDueBackgroundCurationJobs(concurrencyStore, concurrencyHandlers, {
    now: "2026-06-12T00:00:00.000Z",
    kinds: ["cooldown_topic"]
  }),
  runDueBackgroundCurationJobs(concurrencyStore, concurrencyHandlers, {
    now: "2026-06-12T00:00:00.000Z",
    kinds: ["cooldown_topic"]
  })
]);

assert.equal(
  concurrentBatches.flatMap((batch) => batch.records).length,
  2,
  "concurrent curation runs should execute each job exactly once"
);
assert.ok(
  Array.from(cooldownExecutionsByTopic.values()).every((count) => count === 1),
  "concurrent curation runs should never execute the same job twice"
);

// --- Source discovery: query planning, candidate gate, provider failure isolation ---
const discoveryQueries = planDiscoveryQueries({
  concepts: ["Knowledge Graph"],
  nextAction: "expand_broader",
  goals: ["ship an agent product"]
});

assert.equal(
  discoveryQueries[0],
  "Knowledge Graph applications and comparisons",
  "broaden intent should shape the discovery query"
);
assert.ok(
  discoveryQueries.some((query) => query.includes("ship an agent product")),
  "user goals should add a goal-flavored discovery query"
);

const staticProvider = createStaticSearchProvider({}, [
  {
    url: "https://example.com/kg-guide?utm_source=feed#intro",
    title: "Knowledge Graph guide for memory systems",
    snippet: "A long-form guide about how knowledge graph structure supports memory, review and recommendation."
  },
  {
    url: "https://example.com/kg-guide",
    title: "Knowledge Graph guide for memory systems",
    snippet: "Duplicate of the same page after URL normalization."
  },
  {
    url: result.source.url,
    title: "Already imported source",
    snippet: "Should be filtered out as a known URL."
  }
]);
const discoveryRun = await runSourceDiscovery({
  provider: staticProvider,
  concepts: ["Knowledge Graph"],
  nextAction: "expand_broader",
  existingUrls: [result.source.url],
  maxQueries: 1,
  now: "2026-06-10T00:30:00.000Z"
});

assert.equal(discoveryRun.queries.length, 1, "discovery should respect the query cap");
assert.equal(
  discoveryRun.candidates.length,
  1,
  "the candidate gate should dedupe normalized URLs and drop known sources"
);
assert.equal(
  discoveryRun.candidates[0].source.url.includes("utm_source"),
  false,
  "discovered URLs should be normalized"
);
assert.ok(discoveryRun.candidates[0].relevanceScore > 0.5, "matching concepts should score relevant");
assert.ok(discoveryRun.candidates[0].id.startsWith("candidate-article-"), "candidates should carry stable ids");

const flakyRun = await runSourceDiscovery({
  provider: {
    id: "flaky",
    async search() {
      throw new Error("provider offline");
    }
  },
  concepts: ["Knowledge Graph"]
});

assert.equal(flakyRun.candidates.length, 0, "a failing provider should yield no candidates");
assert.ok(flakyRun.errors.length > 0, "provider failures should be recorded, not fatal");

// --- Knowledge boundary + conversation agent ---
const allConcepts = Array.from(new Set(result.cards.flatMap((card) => card.concepts)));
const knownConcept = allConcepts[0];
const weakConcept = allConcepts.find((concept) => concept !== knownConcept) ?? knownConcept;
const boundaryMemory = applyUserMemoryEdits(
  createEmptyUserMemory(),
  [
    { kind: "add", field: "knowledge.knownConcepts", value: knownConcept },
    { kind: "add", field: "knowledge.weakConcepts", value: weakConcept }
  ],
  "2026-06-10T00:00:00.000Z"
).memory;
const likedCard = result.cards[result.cards.length - 1];
const boundarySignals = [
  { id: "boundary-like", cardId: likedCard.id, type: "like", createdAt: "2026-06-10T00:00:00.000Z" }
];
const boundaryView = buildKnowledgeBoundary({
  cards: result.cards,
  signals: boundarySignals,
  memory: boundaryMemory
});

assert.equal(classifyConceptZone(boundaryView, knownConcept), "inside", "known concepts should be inside");
assert.equal(classifyConceptZone(boundaryView, weakConcept), "learning", "weak concepts should be learning");
assert.equal(
  classifyConceptZone(boundaryView, "Quantum Chromodynamics"),
  "dark",
  "unseen concepts should be dark"
);

const frontierConcept = allConcepts.find(
  (concept) => concept !== knownConcept && concept !== weakConcept && !likedCard.concepts.includes(concept)
);

if (frontierConcept) {
  assert.equal(
    classifyConceptZone(boundaryView, frontierConcept),
    "frontier",
    "library concepts without signals should be frontier"
  );
}

const conversationTurn = await runConversationTurn({
  question: `How does ${weakConcept} relate to what I already know?`,
  posts: result.cards,
  registry: result.sourceRegistry,
  memory: boundaryMemory,
  userSignals: boundarySignals,
  now: "2026-06-10T00:30:00.000Z"
});

assert.equal(conversationTurn.intent, "grounded_qa", "questions covered by the library should get grounded answers");
assert.equal(conversationTurn.answer?.grounded, true, "conversation answers should be grounded");
assert.equal(conversationTurn.answer?.runnerKind, "deterministic", "without a model the agent stays deterministic");
assert.ok(conversationTurn.matchedConcepts.includes(weakConcept), "the turn should report matched concepts");
assert.notEqual(conversationTurn.zone, "dark", "matched concepts should place the turn on the boundary");
assert.equal(conversationTurn.signal?.askedQuestion, true, "grounded turns should emit an ask signal");
assert.ok(conversationTurn.actions.length > 0, "turns should propose next actions");

const darkTurn = await runConversationTurn({
  question: "What is quantum chromodynamics?",
  posts: result.cards,
  registry: result.sourceRegistry,
  memory: boundaryMemory,
  now: "2026-06-10T00:31:00.000Z"
});

assert.equal(darkTurn.zone, "dark", "questions outside the library should be dark");
assert.equal(darkTurn.intent, "discovery_proposal", "dark questions should propose discovery instead of answering");
assert.equal(darkTurn.answer, null, "the agent must not answer dark questions from model memory");
assert.equal(darkTurn.actions[0]?.kind, "discover_sources", "dark turns should propose source discovery");
assert.ok(darkTurn.actions[0]?.queries?.length, "dark turns should carry discovery queries");

const scopedTurn = await runConversationTurn({
  question: "What is the key claim here?",
  postId: result.cards[0].id,
  posts: result.cards,
  registry: result.sourceRegistry,
  now: "2026-06-10T00:32:00.000Z"
});

assert.equal(scopedTurn.intent, "grounded_qa", "card-scoped questions should answer from that card");
assert.equal(scopedTurn.answerCardId, result.cards[0].id, "card-scoped turns should target the given card");
assert.ok(scopedTurn.answer?.citations.length, "card-scoped answers should cite source chunks");

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

const duplicateBackgroundPlan = createBackgroundCurationPlan({
  signals: [interestSignal],
  feedback: [interestFeedback],
  topicStates: [interestedTopicState],
  generatedAt: "2026-06-10T00:01:00.000Z",
  sourceCandidates: backgroundPlan.jobs
    .flatMap((job) => (job.sourceCandidate ? [job.sourceCandidate] : []))
});
const duplicateRecords = curationStore.enqueuePlan(duplicateBackgroundPlan);

assert.deepEqual(
  duplicateRecords.map((record) => record.id).sort(),
  enqueuedRecords.map((record) => record.id).sort(),
  "background curation store should return existing active equivalent jobs"
);
assert.equal(
  curationStore.getDueJobs("2026-06-10T00:01:00.000Z").length,
  2,
  "semantic duplicate curation jobs should not inflate the queue"
);

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

const followupBatch = await runDueBackgroundCurationJobs(
  finalCurationStore,
  {
    sourceImportWorker: deterministicWorker,
    loadSeedPost: (job) => result.cards.find((card) => card.id === job.postId)
  },
  {
    now: "2026-06-10T00:00:00.000Z",
    kinds: ["generate_followup"]
  }
);
const followupJobRecord = followupBatch.records[0];
const followupImport = followupJobRecord.result?.sourceImport;

assert.equal(followupBatch.records.length, 1, "executor should run one follow-up job");
assert.equal(followupJobRecord.status, "succeeded", "follow-up job should succeed");
assert.ok(followupImport, "follow-up job should include a source import result");
assert.equal(
  followupImport?.importRecord.status,
  "ready",
  "follow-up job should produce a ready source import"
);
assert.equal(
  followupJobRecord.result?.followupProtocol?.intent,
  "expand_broader",
  "follow-up job should preserve the protocol intent"
);
assert.ok(followupImport?.posts.length, "follow-up job should produce a generated post when seed exists");
assert.ok(
  followupImport.chunks.every((chunk) => !followupInstructionPattern.test(chunk.content)),
  "executed follow-up chunks should not contain internal instructions"
);

for (const post of followupImport.posts) {
  assert.doesNotMatch(
    collectStrings(post).join("\n"),
    followupInstructionPattern,
    "generated follow-up post text should not contain internal instructions"
  );
  assert.ok(post.citations.every((citation) => citation.chunkId), "follow-up posts should cite chunk-level evidence");
}

for (const validation of followupImport.validation) {
  assert.equal(validation.valid, true, `${validation.postId} follow-up validation should pass`);
  assert.equal(validation.grounding?.valid, true, `${validation.postId} follow-up grounding should be valid`);
  assert.ok(
    validation.grounding?.checks.every((check) => check.evidenceChunkIds.length > 0),
    `${validation.postId} follow-up grounding should resolve cited chunks`
  );
}

const missingSeedFollowupJob = {
  id: "missing-seed-followup",
  kind: "generate_followup",
  postId: "missing-seed-post",
  topicId: "latent-memory",
  conceptIds: ["Latent Memory", "Source Discovery"],
  nextAction: "continue_deeper",
  priority: 0.86,
  reason: "The original post is no longer available, so a new source is required.",
  createdAt: "2026-06-10T00:00:00.000Z"
};
const missingSeedStore = createInMemoryBackgroundCurationJobStore();

enqueueSingleJob(missingSeedStore, missingSeedFollowupJob);

const missingSeedBatch = await runDueBackgroundCurationJobs(
  missingSeedStore,
  {
    discoverSources: (job) => [
      {
        id: `${job.topicId}-needed-source`,
        source: {
          id: `${job.topicId}-article`,
          title: "Latent memory source candidate",
          url: "https://example.com/latent-memory-source",
          type: "article"
        },
        topicId: job.topicId,
        conceptIds: job.conceptIds,
        relevanceScore: 0.82,
        noveltyScore: 0.76,
        qualityScore: 0.88,
        reason: `A new source is needed for ${job.conceptIds[0]}.`,
        discoveredAt: "2026-06-10T00:00:00.000Z"
      },
      {
        id: `${job.topicId}-extra-source`,
        source: {
          id: `${job.topicId}-extra-article`,
          title: "Extra source candidate",
          url: "https://example.com/latent-memory-extra",
          type: "article"
        },
        topicId: job.topicId,
        conceptIds: job.conceptIds,
        relevanceScore: 0.72,
        noveltyScore: 0.7,
        qualityScore: 0.8,
        reason: "This extra candidate should not be emitted by the missing-seed follow-up branch.",
        discoveredAt: "2026-06-10T00:00:00.000Z"
      }
    ]
  },
  {
    now: "2026-06-10T00:00:00.000Z",
    kinds: ["generate_followup"]
  }
);
const missingSeedRecord = missingSeedBatch.records[0];

assert.equal(missingSeedBatch.records.length, 1, "missing-seed follow-up should complete one job");
assert.equal(missingSeedRecord.status, "succeeded", "missing-seed follow-up should succeed when discovery is available");
assert.equal(
  missingSeedRecord.result?.discoveredSourceCandidates?.length,
  1,
  "missing-seed follow-up should emit exactly one source discovery candidate"
);
assert.equal(
  missingSeedRecord.result?.sourceImport,
  undefined,
  "missing-seed follow-up should not generate or import a card"
);
assert.equal(
  missingSeedRecord.result?.discoveredSourceCandidates?.[0]?.reason.includes("Latent Memory"),
  true,
  "missing-seed follow-up candidate should explain the concept that needs a source"
);

const missingSeedSkipStore = createInMemoryBackgroundCurationJobStore();

enqueueSingleJob(missingSeedSkipStore, {
  ...missingSeedFollowupJob,
  id: "missing-seed-followup-skip"
});

const missingSeedSkipBatch = await runDueBackgroundCurationJobs(
  missingSeedSkipStore,
  {},
  {
    now: "2026-06-10T00:00:00.000Z",
    kinds: ["generate_followup"]
  }
);
const missingSeedSkipRecord = missingSeedSkipBatch.records[0];

assert.equal(missingSeedSkipRecord.status, "skipped", "missing-seed follow-up should skip without discovery");
assert.match(
  missingSeedSkipRecord.result?.message ?? "",
  /seed post|source discovery handler/i,
  "missing-seed skipped job should explain why it did not generate a card"
);
assert.equal(
  missingSeedSkipRecord.result?.sourceImport,
  undefined,
  "missing-seed skipped job should not generate or import a card"
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

let persistedAppSnapshot = "";
const appPersistence = createAITimelinePersistenceStore({
  read: () => persistedAppSnapshot,
  write: (serialized) => {
    persistedAppSnapshot = serialized;
  }
});

appPersistence.saveSourceImportResult(deterministicImport, "2026-06-10T00:00:00.000Z");
appPersistence.saveCurationJobRecords(
  [...importBatch.records, ...followupBatch.records, ...discoveryBatch.records],
  "2026-06-10T00:20:00.000Z"
);
appPersistence.saveReleasePlan(releasePlan, "2026-06-10T00:20:00.000Z");
appPersistence.saveSourceCandidateRecords(
  [
    {
      id: "smoke-candidate",
      candidate: {
        id: "smoke-candidate",
        source: {
          id: "smoke-candidate-source",
          title: "Source candidate persistence smoke",
          url: "https://example.com/source-candidate",
          type: "article"
        },
        topicId: "ai-agent",
        conceptIds: ["AI Agent"],
        relevanceScore: 0.8,
        noveltyScore: 0.7,
        qualityScore: 0.9,
        reason: "Smoke test candidate persistence.",
        discoveredAt: "2026-06-10T00:00:00.000Z"
      },
      status: "pending",
      intakeKind: "agent_discovery",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z"
    }
  ],
  "2026-06-10T00:20:00.000Z"
);
appPersistence.saveInteractionSignalRecords(
  [
    {
      id: "smoke-interest-signal",
      signal: interestSignal,
      feedback: interestFeedback,
      createdAt: interestSignal.createdAt
    }
  ],
  "2026-06-10T00:20:00.000Z"
);
appPersistence.saveTopicStateRecords(
  [
    {
      ...interestedTopicState,
      updatedAt: "2026-06-10T00:20:00.000Z"
    }
  ],
  "2026-06-10T00:20:00.000Z"
);
appPersistence.saveUserMemory(
  "user-smoke",
  memoryEditResult.memory,
  memoryEditResult.events,
  "2026-06-10T00:20:00.000Z"
);

const rehydratedPersistence = createAITimelinePersistenceStore({
  read: () => persistedAppSnapshot,
  write: (serialized) => {
    persistedAppSnapshot = serialized;
  }
});
const appSnapshot = rehydratedPersistence.getSnapshot();

assert.equal(appSnapshot.sourceImports.length, 1, "persistence should store source imports");
assert.equal(appSnapshot.sourceRegistries.length, 1, "persistence should store source registries");
assert.equal(appSnapshot.posts.length, 4, "persistence should store generated posts");
assert.equal(appSnapshot.harnessRuns.length, 1, "persistence should store harness runs");
assert.equal(appSnapshot.curationJobs.length, 3, "persistence should store curation job records");
assert.equal(appSnapshot.releasePlans.length, 1, "persistence should store release plans");
assert.equal(appSnapshot.userMemories[0]?.userId, "user-smoke", "persistence should store user memory");
assert.equal(appSnapshot.memoryEvents.length, 5, "persistence should store memory edit events");
assert.equal(appSnapshot.interactionSignals.length, 1, "persistence should store interaction signals");
assert.equal(appSnapshot.topicStates.length, 1, "persistence should store topic states");
assert.equal(appSnapshot.sourceCandidates.length, 1, "persistence should store source candidates");
assert.equal(appSnapshot.sourceCandidates[0]?.status, "pending", "source candidates should preserve status");

// --- User notes: self-grounded source + post ---
const { transformUserNote } = await import("../packages/core/dist/transform/noteImport.js");
const noteResult = transformUserNote("RAG depends on retrieval quality.\n后半句是我的想法。", {
  createdAt: "2026-06-10T00:00:00.000Z",
  libraryConcepts: ["RAG", "Evaluation"]
});

assert.equal(noteResult.source.type, "user_note", "notes should become user_note sources");
assert.equal(noteResult.post.citations?.[0]?.chunkId, noteResult.chunks[0].id, "note posts must cite their own chunk");
assert.equal(
  noteResult.sourceRegistry.chunks.some((chunk) => chunk.id === noteResult.chunks[0].id),
  true,
  "the note chunk must land in the source registry"
);
assert.deepEqual(noteResult.post.concepts, ["RAG"], "notes should only tag concepts they actually mention");
assert.equal(noteResult.importRecord.status, "ready", "note imports are ready immediately");
assert.throws(() => transformUserNote("   "), /needs some text/, "empty notes should be rejected");

// --- Obsidian-style wikilinks: parse, resolve, backlinks, linked graph ---
const { parseWikilinks, resolveWikilink, buildBacklinkIndex, buildLinkedKnowledgeGraph } = await import(
  "../packages/core/dist/graph/wikilinks.js"
);

const parsedPlain = parseWikilinks("see [[RAG]] first");
assert.equal(parsedPlain.length, 1, "a plain wikilink should parse");
assert.equal(parsedPlain[0].target, "RAG", "the target should be extracted");
assert.equal("see [[RAG]] first".slice(parsedPlain[0].start, parsedPlain[0].end), "[[RAG]]", "start/end should bracket the token");

assert.equal(parseWikilinks("聊聊 [[ 检索增强 ]] 吧").length, 1, "a Chinese wikilink should parse");
assert.equal(parseWikilinks("聊聊 [[ 检索增强 ]] 吧")[0].target, "检索增强", "wikilink targets are trimmed");

const parsedMany = parseWikilinks("[[A]] 和 [[B]],还有句中的 [[C]] 概念");
assert.equal(parsedMany.length, 3, "multiple inline wikilinks should all parse");
assert.deepEqual(parsedMany.map((link) => link.target), ["A", "B", "C"], "inline wikilinks keep source order");

assert.equal(parseWikilinks("this [[is unclosed").length, 0, "an unclosed wikilink must not match");
assert.equal(parseWikilinks("empty [[]] token").length, 0, "an empty target must not match");

const wikiCards = [
  {
    id: "card-rag",
    title: "RAG 入门",
    summary: "检索增强生成的基础。",
    keyTakeaway: "先检索再生成。",
    concepts: ["RAG", "检索"],
    sources: [{ id: "s-rag", title: "RAG 来源", url: "https://example.com/rag", type: "article" }],
    createdAt: "2026-01-01T00:00:00.000Z"
  },
  {
    id: "card-eval",
    title: "评估方法",
    summary: "如何衡量质量。",
    keyTakeaway: "没有评估就无法迭代。",
    concepts: ["评估"],
    sources: [{ id: "s-eval", title: "评估来源", url: "https://example.com/eval", type: "article" }],
    createdAt: "2026-01-02T00:00:00.000Z"
  }
];

// Resolve precedence: a concept wins over a same-named card title; ghost is the fallback.
assert.equal(resolveWikilink("rag", { cards: wikiCards }).kind, "concept", "a known concept resolves to a concept (case-insensitive)");
assert.equal(resolveWikilink("rag", { cards: wikiCards }).label, "RAG", "the concept keeps its library spelling");
assert.equal(resolveWikilink("评估方法", { cards: wikiCards }).kind, "card", "an exact card title resolves to a card");
assert.equal(resolveWikilink("评估方法", { cards: wikiCards }).targetId, "card-eval", "a card link targets the card id");
assert.equal(resolveWikilink("不存在的东西", { cards: wikiCards }).kind, "ghost", "an unmatched target is a ghost");

const conceptVsCardCards = [
  { id: "c-hub", title: "记忆", summary: "s", keyTakeaway: "k", concepts: ["记忆"], sources: [], createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "c-other", title: "别的", summary: "s", keyTakeaway: "k", concepts: ["记忆"], sources: [], createdAt: "2026-01-02T00:00:00.000Z" }
];
assert.equal(resolveWikilink("记忆", { cards: conceptVsCardCards }).kind, "concept", "concept precedence beats a card whose title equals the concept");

// Backlinks: note bodies and public comments both count; the snippet frames the link.
const backlinkCards = [
  {
    id: "note-1",
    title: "我的笔记",
    summary: "今天在读 [[RAG]],它依赖检索质量。",
    keyTakeaway: "k",
    concepts: [],
    sources: [{ id: "s-note", title: "我的笔记", url: "local://notes/1", type: "user_note" }],
    createdAt: "2026-01-03T00:00:00.000Z",
    thread: []
  },
  {
    id: "card-rag",
    title: "RAG 入门",
    summary: "检索增强生成的基础。",
    keyTakeaway: "先检索再生成。",
    concepts: ["RAG"],
    sources: [{ id: "s-rag", title: "RAG 来源", url: "https://example.com/rag", type: "article" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    thread: [
      { id: "b1", kind: "user_comment", title: "你", body: "对比一下 [[评估方法]] 会更清楚。" },
      { id: "b2", kind: "agent_reply", title: "AI", body: "同意 [[RAG]] 的看法。" }
    ]
  },
  {
    id: "card-eval",
    title: "评估方法",
    summary: "如何衡量质量。",
    keyTakeaway: "没有评估就无法迭代。",
    concepts: ["评估"],
    sources: [{ id: "s-eval", title: "评估来源", url: "https://example.com/eval", type: "article" }],
    createdAt: "2026-01-02T00:00:00.000Z",
    thread: []
  }
];
const backlinkIndex = buildBacklinkIndex(backlinkCards);
const ragBacklinks = backlinkIndex.get("rag") ?? [];
assert.equal(ragBacklinks.length, 1, "only user-authored text (note body) backlinks the concept, not the agent reply");
assert.equal(ragBacklinks[0].fromPostId, "note-1", "the backlink points at the authoring post");
assert.ok(ragBacklinks[0].snippet.includes("[[RAG]]"), "the snippet frames the raw link");
assert.equal(backlinkIndex.get("card-eval")?.[0].fromPostId, "card-rag", "a public comment backlinks the card it links to");
assert.equal(backlinkIndex.get("card-eval")?.[0].kind, "card", "the backlink records the resolved kind");

// Linked graph: nodes/edges, dedupe, and stable ordering.
const linkedSignals = [{ id: "sig-1", cardId: "card-rag", type: "save", createdAt: "2026-01-04T00:00:00.000Z" }];
const linked = buildLinkedKnowledgeGraph({ cards: backlinkCards, signals: linkedSignals });
assert.ok(linked.nodes.some((node) => node.id === "note-1" && node.kind === "note"), "a user note becomes a note node");
assert.ok(linked.nodes.some((node) => node.id === "card-rag" && node.kind === "card"), "an imported card becomes a card node");
assert.ok(linked.nodes.some((node) => node.id === "rag" && node.kind === "concept"), "an interacted concept becomes a concept hub node");
assert.ok(
  linked.edges.some((edge) => edge.source === "note-1" && edge.target === "rag" && edge.kind === "wikilink"),
  "a note's wikilink becomes a wikilink edge"
);
assert.ok(
  linked.edges.some((edge) => edge.source === "card-rag" && edge.target === "rag" && edge.kind === "mentions"),
  "a card mentioning a hub concept gets a mentions edge"
);
const linkedAgain = buildLinkedKnowledgeGraph({ cards: backlinkCards, signals: linkedSignals });
assert.deepEqual(
  linkedAgain.nodes.map((node) => node.id),
  linked.nodes.map((node) => node.id),
  "node order is deterministic across runs"
);
assert.deepEqual(
  linkedAgain.edges.map((edge) => edge.id),
  linked.edges.map((edge) => edge.id),
  "edge order is deterministic across runs"
);
assert.equal(new Set(linked.edges.map((edge) => edge.id)).size, linked.edges.length, "edges are de-duplicated by id");

const ghostCards = [
  {
    id: "note-ghost",
    title: "带幽灵链接的笔记",
    summary: "想了解 [[还没有的概念]]。",
    keyTakeaway: "k",
    concepts: [],
    sources: [{ id: "s-g", title: "n", url: "local://notes/g", type: "user_note" }],
    createdAt: "2026-01-05T00:00:00.000Z",
    thread: []
  }
];
const ghostGraph = buildLinkedKnowledgeGraph({ cards: ghostCards, signals: [] });
assert.ok(ghostGraph.nodes.some((node) => node.kind === "ghost"), "an unresolved wikilink target becomes a ghost node");

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
      memoryControls: {
        interests: memoryEditResult.memory.profile.interests.length,
        knownConcepts: memoryEditResult.memory.knowledge.knownConcepts.length,
        events: memoryEditResult.events.length
      },
      persistence: {
        imports: appSnapshot.sourceImports.length,
        posts: appSnapshot.posts.length,
        memories: appSnapshot.userMemories.length,
        curationJobs: appSnapshot.curationJobs.length,
        interactionSignals: appSnapshot.interactionSignals.length,
        topicStates: appSnapshot.topicStates.length,
        sourceCandidates: appSnapshot.sourceCandidates.length
      },
      ranking: {
        topScore: personalizedRanking[0].score,
        topIntent: personalizedRanking[0].recommendationIntent,
        reasons: personalizedRanking[0].scoreReasons
      },
      evidenceLedger: {
        claims: evidenceLedger.summary.totalClaims,
        passed: evidenceLedger.summary.passed,
        warnings: evidenceLedger.summary.warnings,
        failed: evidenceLedger.summary.failed
      },
      backgroundCuration: {
        interestedJobs: backgroundPlan.jobs.map((job) => job.kind),
        cooldownJobs: cooldownPlan.jobs.map((job) => job.kind),
        executedImportStatus: importedJobRecord.status,
        executedFollowupStatus: followupJobRecord.status,
        followupIntent: followupJobRecord.result?.followupProtocol?.intent,
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
