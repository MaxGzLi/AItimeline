import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { applyDailyAutoJobBudget, createBackgroundCurationPlan } = await import("../packages/core/dist/agents/backgroundCuration.js");
const { runConversationTurn } = await import("../packages/core/dist/agents/conversationAgent.js");
const { runIdeaObservation } = await import("../packages/core/dist/agents/ideaFlow.js");
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
const { getAskSystemPrompt } = await import("../packages/core/dist/harness/askGrounded.js");
const {
  calculateCjkRatio,
  validateKnowledgePostContentLanguage
} = await import("../packages/core/dist/harness/contentLanguage.js");
const { validateGrounding } = await import("../packages/core/dist/harness/groundingGate.js");
const { validateKnowledgePost } = await import("../packages/core/dist/harness/schema.js");
const { createAgentHarnessConfig, defaultAgentHarnessConfig, validateHarnessPosts } = await import(
  "../packages/core/dist/harness/runner.js"
);
const { createModelKnowledgePostRunner } = await import("../packages/core/dist/harness/modelRunner.js");
const { evaluateInteraction, scoreInteraction } = await import("../packages/core/dist/harness/feedbackPolicy.js");
const {
  createFollowupGenerationProtocol,
  createFollowupSourceImportPlan,
  getFollowupHarnessSystemPrompt,
  isFollowupPost,
  isFollowupPostId,
  isFollowupSource,
  validateFollowupGenerationProtocol
} = await import(
  "../packages/core/dist/harness/followupHarness.js"
);
const { getAgentHarnessSystemPrompt } = await import("../packages/core/dist/harness/systemPrompt.js");
const { applyUserMemoryEdits, createEmptyUserMemory } = await import(
  "../packages/core/dist/memory/userMemoryControls.js"
);
const { buildCardConnections } = await import("../packages/core/dist/graph/cardConnections.js");
const {
  createAutomaticConceptAliases,
  resolveConcept
} = await import("../packages/core/dist/graph/conceptAliases.js");
const {
  buildConnectionNoteBody,
  createConnectionNoteForImport,
  evaluateConnectionNoteCandidates
} = await import("../packages/core/dist/graph/connectionNotes.js");
const { buildConceptDigest } = await import("../packages/core/dist/graph/conceptDigest.js");
const { buildKnowledgeGraph } = await import("../packages/core/dist/graph/knowledgeGraph.js");
const { createOpenAICompatibleModelClient, createOpenAICompatibleModelClientFromEnv } = await import(
  "../packages/core/dist/model/openaiCompatibleClient.js"
);
const { createSourcePostReleasePlan } = await import("../packages/core/dist/ranking/postReleasePlan.js");
const {
  countSeenReadSignalsByPostId,
  filterTimelineLifecycle,
  isPureExposureSignal
} = await import("../packages/core/dist/ranking/lifecycle.js");
const { rankPersonalizedTimeline } = await import("../packages/core/dist/ranking/ranker.js");
const { advanceReviewState, createInitialReviewState, getRestingReviewStates } = await import(
  "../packages/core/dist/review/reviewState.js"
);
const { createOpenAICompatibleSourceImportWorker, createSourceImportWorker } = await import(
  "../packages/core/dist/source/sourceImportWorker.js"
);
const { evaluateSourceQualityDeterministic } = await import("../packages/core/dist/source/sourceQualityGate.js");
const { createAITimelinePersistenceStore } = await import("../packages/core/dist/storage/persistenceStore.js");
const { fetchArticle, parseArxivAtom, transformArticleUrl } = await import(
  "../packages/core/dist/transform/articleImport.js"
);
const { transformUserNote } = await import("../packages/core/dist/transform/noteImport.js");
const { parseArxivHtmlDecomposition } = await import("../packages/core/dist/transform/arxivHtmlImport.js");
const { transformMockYouTubeUrl } = await import("../packages/core/dist/transform/mockYoutubeImport.js");
const { transformYouTubeUrl } = await import("../packages/core/dist/transform/youtubeImport.js");
const { seoWaterSourceFixture, technicalSourceFixture } = await import("../packages/core/dist/fixtures.js");

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

function makeSmokePost({
  id,
  title,
  concepts,
  createdAt = "2026-06-01T00:00:00.000Z",
  graphEdges
}) {
  const edges =
    graphEdges ??
    concepts.slice(0, -1).map((concept, index) => ({
      id: `${id}-edge-${index + 1}`,
      sourceConcept: concept,
      relation: "extends",
      targetConcept: concepts[index + 1],
      evidence: `${title} links ${concept} to ${concepts[index + 1]}.`,
      weight: 0.72
    }));

  return {
    id,
    title,
    hook: title,
    thesis: title,
    shortBody: title,
    summary: title,
    keyTakeaway: title,
    concepts,
    sources: [],
    citations: [],
    recommendedBecause: "Smoke fixture.",
    trustState: "supported",
    createdAt,
    estimatedReadMinutes: 1,
    difficulty: "beginner",
    confidence: "high",
    thread: [],
    graphEdges: edges,
    reviewPrompts: [],
    nextActions: [],
    harnessVersion: "smoke"
  };
}

function makeSourceQualityInput(fixture, sourceId, url, concepts) {
  return {
    source: {
      id: sourceId,
      title: fixture.title,
      url,
      type: "article"
    },
    chunks: [
      {
        id: `${sourceId}-chunk-1`,
        sourceId,
        content: fixture.body,
        conceptHints: concepts
      }
    ],
    userContext: {
      topicStates: concepts.map((topicId) => ({
        topicId,
        interestScore: 0.8,
        fatigueScore: 0.1,
        comprehensionScore: 0.7
      }))
    },
    createdAt: "2026-06-10T00:00:00.000Z"
  };
}

const seoGateVerdict = evaluateSourceQualityDeterministic(
  makeSourceQualityInput(seoWaterSourceFixture, "seo-water-source", "https://example.com/grok-advanced-guide", [
    "Speculative Decoding",
    "RAG Evaluation"
  ])
);
const technicalGateVerdict = evaluateSourceQualityDeterministic(
  makeSourceQualityInput(
    technicalSourceFixture,
    "technical-source",
    "https://example.com/speculative-decoding-latency",
    ["Speculative Decoding", "LLM serving"]
  )
);

assert.equal(seoGateVerdict.verdict, "reject", "deterministic source gate should reject SEO water");
assert.ok(seoGateVerdict.reasons.length > 0, "rejected sources should include reasons");
assert.equal(technicalGateVerdict.verdict, "accept", "deterministic source gate should accept a normal technical article");

function makeDuplicateImport({ importId, sourceId, postId, url, title }) {
  const source = {
    id: sourceId,
    title,
    url,
    type: "article"
  };
  const post = {
    ...makeSmokePost({
      id: postId,
      title: "Speculative decoding cuts serving latency",
      concepts: ["Speculative Decoding", "LLM serving"]
    }),
    summary: "Speculative decoding uses a small draft model and a target model verification pass to reduce LLM serving latency.",
    keyTakeaway: "A draft model can cut serving latency when token acceptance stays high.",
    sources: [source],
    citations: [{ sourceId, url }]
  };

  return {
    importRecord: {
      id: importId,
      source,
      status: "ready",
      createdAt: "2026-06-10T00:00:00.000Z"
    },
    source,
    assets: [],
    chunks: [],
    sourceRegistry: {
      sources: [source],
      assets: [],
      snapshots: [],
      chunks: [],
      chunkVersions: []
    },
    posts: [post],
    validation: []
  };
}

let duplicateSnapshotJson = "";
const duplicatePersistence = createAITimelinePersistenceStore({
  read: () => duplicateSnapshotJson,
  write: (serialized) => {
    duplicateSnapshotJson = serialized;
  }
});
duplicatePersistence.saveSourceImportResult(
  makeDuplicateImport({
    importId: "duplicate-import-1",
    sourceId: "duplicate-source-1",
    postId: "duplicate-post-1",
    url: "https://example.com/speculative-decoding-a",
    title: "Speculative decoding source A"
  }),
  "2026-06-10T00:00:00.000Z"
);
duplicatePersistence.saveSourceImportResult(
  makeDuplicateImport({
    importId: "duplicate-import-2",
    sourceId: "duplicate-source-2",
    postId: "duplicate-post-2",
    url: "https://example.com/speculative-decoding-b",
    title: "Speculative decoding source B"
  }),
  "2026-06-10T00:01:00.000Z"
);
const duplicateSnapshot = duplicatePersistence.getSnapshot();

assert.equal(duplicateSnapshot.posts.length, 1, "near-duplicate imports should persist only one card");
assert.equal(duplicateSnapshot.posts[0].sources.length, 2, "near-duplicate source should be merged into the existing card");
assert.equal(duplicateSnapshot.mergedSources.length, 1, "near-duplicate merge should be recorded for inspection");

const budgetPlan = {
  generatedAt: "2026-06-10T00:00:00.000Z",
  jobs: [
    {
      id: "budget-discover-1",
      kind: "discover_sources",
      topicId: "budget-topic",
      conceptIds: ["Budget"],
      priority: 0.9,
      reason: "budget smoke",
      createdAt: "2026-06-10T00:00:00.000Z"
    },
    {
      id: "budget-import-2",
      kind: "import_source",
      topicId: "budget-topic",
      conceptIds: ["Budget"],
      priority: 0.8,
      reason: "budget smoke",
      createdAt: "2026-06-10T00:00:00.000Z"
    }
  ],
  suppressions: [],
  acceptedSourceCandidateIds: [],
  cooledTopicIds: [],
  expansionPlan: {
    generatedAt: "2026-06-10T00:00:00.000Z",
    jobs: [],
    suppressions: [],
    cooledTopicIds: []
  }
};
const budgetResult = applyDailyAutoJobBudget({
  plan: budgetPlan,
  limit: 1,
  now: "2026-06-10T00:00:00.000Z"
});

assert.equal(budgetResult.plan.jobs.length, 1, "daily auto job budget should keep only the first metered job");
assert.equal(budgetResult.budget.used, 1, "daily auto job budget should count accepted automatic jobs");
assert.equal(budgetResult.budget.discarded, 1, "daily auto job budget should count discarded automatic jobs");

const result = transformMockYouTubeUrl(
  "https://www.youtube.com/watch?v=aitimeline-demo",
  "2026-06-10T00:00:00.000Z"
);
const englishResult = transformMockYouTubeUrl(
  "https://www.youtube.com/watch?v=aitimeline-en-demo",
  "2026-06-10T00:00:00.000Z",
  "en"
);

assert.equal(defaultAgentHarnessConfig.maxPostsPerRun, 4, "default harness should limit one run to four posts");
assert.equal(createAgentHarnessConfig().maxPostsPerRun, 4, "model harness config should inherit the four-post default");
assert.equal(calculateCjkRatio("All English text"), 0, "all-English text should have a 0 CJK ratio");
assert.ok(
  calculateCjkRatio("AI Agent 让知识卡片更有用") >= 0.3,
  "Chinese text with retained English terms should pass the default threshold"
);
assert.equal(calculateCjkRatio("纯中文内容"), 1, "pure Chinese text should have a 1 CJK ratio");
assert.ok(
  calculateCjkRatio("Agent Memory 的三种形式:token、parametric、latent") >= 0.3,
  "term-heavy Chinese (CJK chars vs Latin words) should still pass the threshold"
);
assert.equal(calculateCjkRatio(""), 0, "empty text should have a 0 CJK ratio");
assert.equal(calculateCjkRatio("12345"), 0, "text without CJK or Latin letters should have a 0 CJK ratio");
assert.deepEqual(
  validateKnowledgePostContentLanguage(englishResult.cards[0], "en"),
  [],
  "English mode language gate should accept English knowledge cards"
);
const chineseLanguageCard = {
  ...englishResult.cards[0],
  title: "中文标题",
  hook: "这个问题需要中文说明。",
  thesis: "智能体需要持久记忆。",
  shortBody: "这是一段中文正文,用于验证英文模式的门禁。",
  keyTakeaway: "核心结论是新内容必须按英文输出。",
  summary: "中文摘要会被英文模式拒绝。",
  recommendedBecause: "中文推荐理由。",
  thread: englishResult.cards[0].thread.map((block) => ({
    ...block,
    body: "中文线程内容用于验证英文门禁。"
  })),
  reviewPrompts: englishResult.cards[0].reviewPrompts.map((prompt) => ({
    ...prompt,
    prompt: "中文复习题会被英文模式拒绝。"
  }))
};
const englishGateIssues = validateKnowledgePostContentLanguage(chineseLanguageCard, "en");

assert.ok(englishGateIssues.length > 0, "English mode language gate should reject Chinese knowledge cards");
assert.ok(
  englishGateIssues.every((issue) => issue.message.includes("English")),
  "English mode language gate should explain repairs in English"
);
assert.ok(
  getAgentHarnessSystemPrompt("en").includes("natural English"),
  "model harness should select the English prompt block"
);
assert.ok(
  getFollowupHarnessSystemPrompt("en").includes("natural English"),
  "follow-up harness should select the English prompt block"
);
assert.ok(
  getAskSystemPrompt("en").includes("natural English"),
  "grounded ask harness should select the English prompt block"
);
assert.match(
  englishResult.cards[0].recommendedBecause,
  /You imported this YouTube video/i,
  "English mode deterministic import fallback should explain recommendations in English"
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

const aliasCards = [
  makeSmokePost({
    id: "alias-1",
    title: "Speculative Decoding A",
    concepts: [" Speculative Decoding "]
  }),
  makeSmokePost({
    id: "alias-2",
    title: "Speculative Decoding B",
    concepts: ["speculative decoding"]
  }),
  makeSmokePost({
    id: "alias-3",
    title: "Speculative Decoding C",
    concepts: ["Ｓｐｅｃｕｌａｔｉｖｅ　Ｄｅｃｏｄｉｎｇ"]
  })
];
const aliasCardTextBefore = JSON.stringify(aliasCards.map((card) => card.concepts));
const automaticAliases = createAutomaticConceptAliases(aliasCards, [], "2026-07-06T00:00:00.000Z");
const aliasGraph = buildKnowledgeGraph(
  aliasCards,
  aliasCards.map((card) => ({
    id: `signal-${card.id}`,
    cardId: card.id,
    type: "save",
    createdAt: card.createdAt
  })),
  { conceptAliases: automaticAliases }
);

assert.equal(aliasGraph.nodes.length, 1, "mechanical concept aliases should collapse graph nodes");
assert.equal(
  JSON.stringify(aliasCards.map((card) => card.concepts)),
  aliasCardTextBefore,
  "mechanical concept aliases must not mutate stored card concept text"
);
assert.equal(
  resolveConcept(resolveConcept(" speculative decoding ", automaticAliases), automaticAliases),
  resolveConcept("speculative decoding", automaticAliases),
  "resolveConcept should be idempotent"
);

const chainedAliases = [
  { canonical: "Alpha", aliases: ["Beta"], decidedBy: "user", decidedAt: "2026-07-06T00:00:00.000Z" },
  { canonical: "Beta", aliases: ["Gamma"], decidedBy: "user", decidedAt: "2026-07-06T01:00:00.000Z" }
];

for (const orderedAliases of [chainedAliases, [...chainedAliases].reverse()]) {
  assert.equal(
    resolveConcept("Beta", orderedAliases),
    "Alpha",
    "chained merges (Beta->Alpha, Gamma->Beta) should resolve the middle concept to the root"
  );
  assert.equal(
    resolveConcept("Gamma", orderedAliases),
    "Alpha",
    "chained merges should resolve transitively to the root regardless of record order"
  );
}

const userAliasGraph = buildKnowledgeGraph(
  [
    makeSmokePost({ id: "alias-user-1", title: "English label", concepts: ["Speculative Decoding"] }),
    makeSmokePost({ id: "alias-user-2", title: "Chinese label", concepts: ["投机解码"] })
  ],
  [
    { id: "signal-alias-user-1", cardId: "alias-user-1", type: "save", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "signal-alias-user-2", cardId: "alias-user-2", type: "save", createdAt: "2026-07-01T00:00:00.000Z" }
  ],
  {
    conceptAliases: [
      {
        canonical: "Speculative Decoding",
        aliases: ["投机解码"],
        decidedBy: "user",
        decidedAt: "2026-07-06T00:00:00.000Z"
      }
    ]
  }
);

assert.equal(userAliasGraph.nodes.length, 1, "existing alias table entries should resolve matching concepts");

const ideaAliasPosts = [
  makeSmokePost({ id: "idea-alias-card", title: "Speculative Decoding source card", concepts: ["Speculative Decoding"] })
];
const ideaAliasRecords = [
  {
    canonical: "Speculative Decoding",
    aliases: ["投机解码"],
    decidedBy: "user",
    decidedAt: "2026-07-06T00:00:00.000Z"
  }
];
const ideaObservation = await runIdeaObservation({
  idea: "投机解码可能适合低延迟推理产品。",
  posts: ideaAliasPosts,
  conceptAliases: ideaAliasRecords,
  now: "2026-07-06T02:00:00.000Z"
});

assert.equal(ideaObservation.intent, "idea_observation", "idea posts should produce an idea observation turn");
assert.ok(
  ideaObservation.matchedConcepts.includes("Speculative Decoding"),
  "idea library overlap should resolve aliases before scoring concepts"
);
assert.ok(
  ideaObservation.nearestPosts.some((post) => post.postId === "idea-alias-card"),
  "idea observations should link related in-library cards"
);
assert.ok(
  ideaObservation.actions.some((action) => action.kind === "idea_probe"),
  "idea observations should include probe actions"
);
assert.ok(
  ideaObservation.actions.some((action) => action.kind === "research_idea" && action.question),
  "idea observations should include testable research actions"
);
assert.match(ideaObservation.notes.join("\n"), /库内关联/, "idea observations should render the deterministic triad");

const connectionOldPosts = [
  makeSmokePost({
    id: "old-kg",
    title: "Old Knowledge Graph card",
    concepts: ["Knowledge Graph", "Memory"],
    createdAt: "2026-06-01T00:00:00.000Z"
  }),
  makeSmokePost({
    id: "old-memory",
    title: "Old Memory card",
    concepts: ["Memory", "RAG"],
    createdAt: "2026-06-02T00:00:00.000Z"
  }),
  makeSmokePost({
    id: "old-rag",
    title: "Old RAG card",
    concepts: ["RAG", "Evaluation"],
    createdAt: "2026-06-03T00:00:00.000Z"
  })
];
const connectionNewPost = makeSmokePost({
  id: "new-kg-eval",
  title: "New evaluation import",
  concepts: ["Knowledge Graph", "Evaluation"],
  graphEdges: [
    {
      id: "edge-kg-eval",
      sourceConcept: "Knowledge Graph",
      relation: "evaluates",
      targetConcept: "Evaluation",
      evidence: "Knowledge Graph evaluation evidence from the imported source.",
      weight: 0.9
    }
  ],
  createdAt: "2026-07-06T00:00:00.000Z"
});
const distantCandidates = evaluateConnectionNoteCandidates({
  existingPosts: connectionOldPosts,
  newPosts: [connectionNewPost],
  now: "2026-07-06T00:00:00.000Z"
});

assert.ok(
  distantCandidates.some((candidate) => candidate.reason === "distant_cluster"),
  "a >=3-hop old path should create a distant-cluster candidate"
);

const wakeCandidates = evaluateConnectionNoteCandidates({
  existingPosts: [
    makeSmokePost({
      id: "old-notebooklm",
      title: "Old NotebookLM card",
      concepts: ["NotebookLM", "YouTube"],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeSmokePost({ id: "old-wake-hub-rag", title: "Wake hub RAG", concepts: ["Memory", "RAG"] }),
    makeSmokePost({
      id: "old-wake-hub-rec",
      title: "Wake hub Recommendation",
      concepts: ["Memory", "Recommendation"]
    }),
    makeSmokePost({
      id: "old-wake-hub-eval",
      title: "Wake hub Evaluation",
      concepts: ["Memory", "Evaluation"]
    })
  ],
  newPosts: [
    makeSmokePost({
      id: "new-notebooklm",
      title: "New NotebookLM import",
      concepts: ["NotebookLM", "YouTube"],
      graphEdges: [
        {
          id: "edge-notebooklm-youtube",
          sourceConcept: "NotebookLM",
          relation: "applies",
          targetConcept: "YouTube",
          evidence: "NotebookLM applies source grounding to YouTube notes.",
          weight: 0.8
        }
      ],
      createdAt: "2026-07-06T00:00:00.000Z"
    })
  ],
  now: "2026-07-06T00:00:00.000Z"
});

assert.equal(wakeCandidates[0]?.reason, "wake_dormant", "a 14-day dormant concept should create a wake candidate");

const hubVetoCandidates = evaluateConnectionNoteCandidates({
  existingPosts: connectionOldPosts,
  newPosts: [
    makeSmokePost({
      id: "new-memory-eval",
      title: "Hub edge import",
      concepts: ["Memory", "Evaluation"],
      graphEdges: [
        {
          id: "edge-memory-eval",
          sourceConcept: "Memory",
          relation: "evaluates",
          targetConcept: "Evaluation",
          evidence: "Memory evaluation evidence should be vetoed by the hub rule.",
          weight: 0.9
        }
      ],
      createdAt: "2026-07-06T00:00:00.000Z"
    })
  ],
  now: "2026-07-06T00:00:00.000Z"
});

assert.equal(hubVetoCandidates.length, 0, "a top-decile hub endpoint should veto connection-note candidates");

const batchNote = createConnectionNoteForImport({
  existingPosts: connectionOldPosts,
  newPosts: [
    connectionNewPost,
    makeSmokePost({
      id: "new-kg-eval-2",
      title: "Second new evaluation import",
      concepts: ["Knowledge Graph", "Evaluation"],
      graphEdges: [
        {
          id: "edge-kg-eval-2",
          sourceConcept: "Knowledge Graph",
          relation: "evaluates",
          targetConcept: "Evaluation",
          evidence: "Second Knowledge Graph evaluation evidence.",
          weight: 0.9
        }
      ],
      createdAt: "2026-07-06T00:00:00.000Z"
    })
  ],
  now: "2026-07-06T00:00:00.000Z"
});

assert.ok(batchNote, "a qualifying import batch should create one connection note");
assert.equal(batchNote.kind, "connection_note", "connection-note cards should carry the connection_note kind");
assert.equal(batchNote.connectionNote.newPostId, "new-kg-eval", "a batch should keep only the highest-ranked note");
assert.equal(batchNote.reviewPrompts.length, 0, "connection notes should not enter review");
assert.ok(batchNote.summary.includes(batchNote.connectionNote.oldPostTitle), "connection note body should cite the old card title");
assert.ok(batchNote.summary.includes(batchNote.connectionNote.newPostTitle), "connection note body should cite the new card title");
assert.ok(batchNote.summary.includes(batchNote.connectionNote.evidence), "connection note body should include graph edge evidence");
assert.ok(
  buildConnectionNoteBody(batchNote.connectionNote).includes(batchNote.connectionNote.evidence),
  "connection note template should preserve existing evidence text"
);

const limitedNote = createConnectionNoteForImport({
  existingPosts: [
    ...connectionOldPosts,
    batchNote,
    { ...batchNote, id: "connection-note-second", createdAt: "2026-07-06T12:00:00.000Z" }
  ],
  newPosts: [connectionNewPost],
  now: "2026-07-06T13:00:00.000Z"
});

assert.equal(limitedNote, null, "daily connection-note limit should drop notes after two in a day");

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

const placeholderArxivHtml = "<html><body><h1>arXiv HTML unavailable</h1><p>arXivLabs placeholder.</p></body></html>";
assert.equal(
  parseArxivHtmlDecomposition(placeholderArxivHtml, "https://arxiv.org/html/2512.13564v2"),
  undefined,
  "arXiv placeholder pages without LaTeXML structure should report no full text"
);

const sampleLatexmlHtml = `
  <html>
    <head>
      <base href="/html/2603.07670v1/"/>
    </head>
    <body>
      <main class="ltx_page_main">
        <h1 class="ltx_title">Memory Graphs for AI Agents</h1>
        <blockquote class="ltx_abstract">
          <p class="ltx_p">We introduce a memory graph that keeps agent retrieval grounded and inspectable.</p>
        </blockquote>
        <section class="ltx_section">
          <h2 class="ltx_title">1 Introduction</h2>
          <p class="ltx_para">AI Agent memory needs durable source chunks, citation trails, and motivating user problems.</p>
        </section>
        <section class="ltx_section">
          <h2 class="ltx_title">2 Method and Architecture</h2>
          <p class="ltx_para">Our method builds a graph-backed memory system with retrieval nodes, summary edges, and evaluation hooks.</p>
          <figure class="ltx_figure">
            <img src="figures/architecture.png" />
            <figcaption><span class="ltx_tag ltx_tag_figure">Figure 1:</span> Architecture overview &amp; memory graph.</figcaption>
            <figure class="ltx_figure">
              <img src="figures/architecture.png" />
              <figcaption>(a) Duplicate subfigure that must be deduplicated.</figcaption>
            </figure>
          </figure>
          <figure class="ltx_figure">
            <img src="data:image/png;base64,iVBORw0KGgo=" />
            <figcaption>Table 1: Representative memory systems and retrieval affordances.</figcaption>
          </figure>
        </section>
        <section class="ltx_section">
          <h2 class="ltx_title">3 Infrastructures</h2>
          <p class="ltx_para">The cluster infrastructure coordinates storage, scheduling, and communication paths for reliable large-scale runs.</p>
        </section>
        <section class="ltx_section">
          <h2 class="ltx_title">4 Pre-Training</h2>
          <p class="ltx_para">Pre-Training scales data mixtures and optimizer schedules before the instruction tuning stage.</p>
        </section>
        <section class="ltx_section">
          <h2 class="ltx_title">5 Core Memory Mechanisms</h2>
          <p class="ltx_para">Retrieval-augmented stores and reflective loops manage what the agent keeps.</p>
        </section>
        <section class="ltx_section">
          <h2 class="ltx_title">9 Open Challenges</h2>
          <p class="ltx_para">Principled consolidation and learning to forget remain unsolved.</p>
        </section>
        <section class="ltx_section">
          <h2 class="ltx_title">Acknowledgments</h2>
          <p class="ltx_para">We thank the AITimeline boilerplate reviewers for feedback.</p>
        </section>
      </main>
    </body>
  </html>
`;
const parsedLatexml = parseArxivHtmlDecomposition(sampleLatexmlHtml, "https://arxiv.org/html/2603.07670");

assert.ok(parsedLatexml, "LaTeXML HTML should decompose into a full-text payload");
assert.equal(parsedLatexml.title, "Memory Graphs for AI Agents", "LaTeXML title should be extracted");
assert.ok(
  parsedLatexml.buckets.some(
    (bucket) => bucket.kind === "motivation" && bucket.chunks.join(" ").includes("durable source chunks")
  ),
  "abstract and introduction should map to the motivation bucket"
);
assert.ok(
  parsedLatexml.buckets.some(
    (bucket) => bucket.kind === "method" && bucket.chunks.join(" ").includes("graph-backed memory system")
  ),
  "method and architecture sections should map to the method bucket"
);
assert.ok(
  parsedLatexml.buckets.some(
    (bucket) => bucket.kind === "method" && bucket.chunks.join(" ").includes("cluster infrastructure")
  ),
  "infrastructure sections should map to the method bucket"
);
assert.ok(
  parsedLatexml.buckets.some(
    (bucket) => bucket.kind === "experiment" && bucket.chunks.join(" ").includes("optimizer schedules")
  ),
  "pre-training sections should map to the experiment bucket"
);
assert.ok(
  parsedLatexml.buckets.some(
    (bucket) => bucket.kind === "method" && bucket.chunks.join(" ").includes("reflective loops")
  ),
  "survey-style mechanism sections should map to the method bucket"
);
assert.ok(
  parsedLatexml.buckets.some(
    (bucket) => bucket.kind === "conclusion" && bucket.chunks.join(" ").includes("learning to forget")
  ),
  "open-challenges sections should map to the conclusion bucket"
);
assert.ok(
  parsedLatexml.buckets.every((bucket) => !bucket.chunks.join(" ").includes("boilerplate reviewers")),
  "acknowledgment sections should not produce chunks"
);
assert.equal(parsedLatexml.figures.length, 2, "LaTeXML figures should be extracted and deduplicated by image");
assert.equal(
  parsedLatexml.figures[0].imageRef,
  "https://arxiv.org/html/2603.07670v1/figures/architecture.png",
  "relative arXiv images should resolve against the document base href"
);
assert.equal(parsedLatexml.figures[1].figureLabel, "Table 1", "table labels should be read from captions");

const makeBalancedParagraphs = (label) =>
  Array.from({ length: 30 }, (_, index) => {
    const token = `${label}-chunk-${String(index + 1).padStart(2, "0")}`;
    return `<p class="ltx_para">${`${token} carries distinct source evidence for balanced truncation. `.repeat(15)}</p>`;
  }).join("\n");
const balancedLatexmlHtml = `
  <html>
    <body>
      <main class="ltx_page_main">
        <h1 class="ltx_title">Balanced Bucket Budget Smoke</h1>
        <section class="ltx_section">
          <h2 class="ltx_title">2 Method</h2>
          ${makeBalancedParagraphs("method")}
        </section>
        <section class="ltx_section">
          <h2 class="ltx_title">4 Pre-Training</h2>
          ${makeBalancedParagraphs("experiment")}
        </section>
      </main>
    </body>
  </html>
`;
const balancedLatexml = parseArxivHtmlDecomposition(balancedLatexmlHtml, "https://arxiv.org/html/2603.07670");

assert.ok(balancedLatexml, "balanced LaTeXML fixture should parse");
assert.equal(balancedLatexml.truncated, true, "balanced fixture should be truncated at the global chunk budget");
assert.ok(
  balancedLatexml.buckets.reduce((total, bucket) => total + bucket.chunks.length, 0) <= 40,
  "balanced truncation should keep the total chunk count within the global budget"
);

const balancedMethodBucket = balancedLatexml.buckets.find((bucket) => bucket.kind === "method");
const balancedExperimentBucket = balancedLatexml.buckets.find((bucket) => bucket.kind === "experiment");

assert.ok(balancedMethodBucket, "balanced fixture should keep method chunks");
assert.ok(balancedExperimentBucket, "balanced fixture should keep experiment chunks");
assert.ok(
  balancedMethodBucket.chunks.length >= 15,
  "balanced truncation should leave a meaningful method allocation"
);
assert.ok(
  balancedExperimentBucket.chunks.length >= 15,
  "balanced truncation should leave a meaningful experiment allocation"
);
assert.match(balancedMethodBucket.chunks[0], /method-chunk-01/, "method chunks should keep original order");
assert.match(balancedMethodBucket.chunks[1], /method-chunk-02/, "method chunks should keep original order");
assert.match(
  balancedExperimentBucket.chunks[0],
  /experiment-chunk-01/,
  "experiment chunks should keep original order"
);
assert.match(
  balancedExperimentBucket.chunks[1],
  /experiment-chunk-02/,
  "experiment chunks should keep original order"
);

const mediaTempDir = await mkdtemp(join(tmpdir(), "aitimeline-arxiv-media-"));

try {
  const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const fetchArxivFullHtml = async (url) => {
    const requestedUrl = String(url);

    if (requestedUrl === "https://arxiv.org/html/2603.07670") {
      return new Response(sampleLatexmlHtml, { status: 200, headers: { "content-type": "text/html" } });
    }

    if (requestedUrl === "https://arxiv.org/html/2603.07670v1/figures/architecture.png") {
      return new Response(fakePng, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(fakePng.byteLength)
        }
      });
    }

    return new Response("not found", { status: 404 });
  };
  const fullArxivImport = await transformArticleUrl("https://arxiv.org/abs/2603.07670", {
    createdAt: "2026-06-10T00:00:00.000Z",
    fetch: fetchArxivFullHtml,
    mediaRootDir: mediaTempDir,
    recommendedBecause: "Smoke test arXiv LaTeXML import."
  });
  const imageAssets = fullArxivImport.assets.filter((asset) => asset.kind === "image");

  assert.equal(fullArxivImport.source.title, "Memory Graphs for AI Agents", "full HTML import should use the paper title");
  assert.equal(imageAssets.length, 2, "full HTML import should cache both relative and data URI images");
  assert.ok(
    imageAssets.every((asset) => asset.url.startsWith(`/media/${fullArxivImport.source.id}/`)),
    "cached image assets should expose /media URLs"
  );
  await stat(join(mediaTempDir, fullArxivImport.source.id, "1.png"));
  await stat(join(mediaTempDir, fullArxivImport.source.id, "2.png"));
  assert.ok(
    fullArxivImport.chunks.some((chunk) => chunk.content.includes("Figure 1: Architecture overview")),
    "figure captions should be registered as source chunks"
  );
  assert.ok(
    fullArxivImport.chunks.some((chunk) => chunk.content.includes("Table 1: Representative memory systems")),
    "table captions should be registered as source chunks"
  );
  assert.ok(fullArxivImport.cards.length >= 3, "full arXiv HTML fallback should produce multiple section cards");
  const cachedImageAssetIds = new Set(imageAssets.map((asset) => asset.id));
  const arxivCardsWithMedia = fullArxivImport.cards.filter((card) => card.media?.length);

  assert.ok(arxivCardsWithMedia.length >= 1, "deterministic paper section cards should attach matching media");
  assert.ok(
    arxivCardsWithMedia.some((card) => cachedImageAssetIds.has(card.media[0].assetId)),
    "deterministic media should point to a cached arXiv image asset"
  );
  assert.ok(
    arxivCardsWithMedia.some((card) => /Architecture overview/i.test(card.media[0].caption)),
    "method-oriented paper card should attach the architecture figure"
  );
  assert.equal(fullArxivImport.importRecord.status, "ready", "full arXiv HTML import should remain ready");
} finally {
  await rm(mediaTempDir, { recursive: true, force: true });
}

const arxivRequestLog = [];
const fetchArxiv = async (url) => {
  const requestedUrl = String(url);

  arxivRequestLog.push(requestedUrl);

  if (requestedUrl === "https://arxiv.org/html/2512.13564v2") {
    return new Response(placeholderArxivHtml, { status: 200, headers: { "content-type": "text/html" } });
  }

  assert.equal(
    requestedUrl,
    "https://export.arxiv.org/api/query?id_list=2512.13564v2",
    "arXiv fallback should call the metadata API with the normalized id"
  );

  return new Response(arxivAtomXml, { status: 200, headers: { "content-type": "application/atom+xml" } });
};
const arxivImport = await transformArticleUrl("https://arxiv.org/abs/2512.13564v2?utm_source=smoke", {
  createdAt: "2026-06-10T00:00:00.000Z",
  fetch: fetchArxiv,
  recommendedBecause: "Smoke test arXiv article import."
});

assert.deepEqual(
  arxivRequestLog.slice(0, 2),
  ["https://arxiv.org/html/2512.13564v2", "https://export.arxiv.org/api/query?id_list=2512.13564v2"],
  "arXiv import should try HTML before falling back to the Atom metadata API"
);
assert.equal(arxivImport.source.type, "article", "arXiv import should still create an article source");
assert.equal(arxivImport.source.title, parsedArxiv.title, "arXiv import should use the paper title");
assert.equal(
  arxivImport.source.url,
  "https://arxiv.org/abs/2512.13564v2",
  "arXiv import should normalize source URL to the abs page"
);
assert.equal(arxivImport.source.author, "Ada Lovelace, Alan Turing", "arXiv import should join authors");
assert.equal(arxivImport.source.publishedAt, parsedArxiv.publishedAt, "arXiv import should set publishedAt");
assert.equal(arxivImport.assets.length, 1, "placeholder fallback should preserve the single text asset behavior");
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

const defaultReleasePlan = createSourcePostReleasePlan({
  posts: result.cards,
  generatedAt: "2026-06-10T00:00:00.000Z"
});

assert.equal(
  defaultReleasePlan.immediatePostIds.length,
  result.cards.length,
  "default policy should release a full 4-card paper batch immediately"
);
assert.equal(defaultReleasePlan.queuedPostIds.length, 0, "default policy should not queue paper section cards");

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

const smokeImageAsset = {
  id: `${result.source.id}-image-smoke`,
  sourceId: result.source.id,
  kind: "image",
  url: `/media/${result.source.id}/smoke.png`,
  caption: "Figure 1: Smoke media asset.",
  figureLabel: "Figure 1",
  createdAt: "2026-06-10T00:00:00.000Z"
};
const registryWithSmokeImage = {
  ...result.sourceRegistry,
  assets: [...result.sourceRegistry.assets, smokeImageAsset]
};
const validMediaCard = {
  ...contractCard,
  media: [{ assetId: smokeImageAsset.id, caption: smokeImageAsset.caption, origin: "paper" }]
};
const invalidMediaCard = {
  ...contractCard,
  id: `${contractCard.id}-invalid-media`,
  media: [{ assetId: "missing-image-asset", caption: "Missing figure.", origin: "paper" }]
};
const nonImageMediaCard = {
  ...contractCard,
  id: `${contractCard.id}-non-image-media`,
  media: [{ assetId: result.asset.id, caption: "Text asset is not media.", origin: "paper" }]
};

assert.equal(validateKnowledgePost(validMediaCard).valid, true, "valid media shape should pass schema validation");
assert.equal(
  validateHarnessPosts([validMediaCard], defaultAgentHarnessConfig, registryWithSmokeImage)[0].valid,
  true,
  "media should pass when assetId points to a registered image asset"
);
assert.equal(
  validateHarnessPosts([invalidMediaCard], defaultAgentHarnessConfig, registryWithSmokeImage)[0].valid,
  false,
  "media should fail when assetId is not registered"
);
assert.equal(
  validateHarnessPosts([nonImageMediaCard], defaultAgentHarnessConfig, registryWithSmokeImage)[0].valid,
  false,
  "media should fail when assetId points to a non-image asset"
);
assert.equal(
  validateHarnessPosts([contractCard], defaultAgentHarnessConfig, registryWithSmokeImage)[0].valid,
  true,
  "cards without media should remain valid"
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
let repairPrompt = "";
const repairRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 1,
  client: {
    async complete(request) {
      repairCalls += 1;

      if (repairCalls === 1) {
        return { content: '{"posts":[{"id":"broken-post"}' };
      }

      repairPrompt = request.messages.at(-1)?.content ?? "";
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
assert.match(repairPrompt, /previous output was truncated/i, "JSON parse repair should warn about truncation");
assert.match(repairPrompt, /Reduce the number of cards/i, "JSON parse repair should ask for fewer cards");
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

let capturedEnvRequest;
const envClient = createOpenAICompatibleModelClientFromEnv(
  {
    AITIMELINE_MODEL_NAME: "env-model",
    AITIMELINE_MODEL_BASE_URL: "https://env-models.example/v1",
    AITIMELINE_MODEL_API_KEY: "env-key",
    AITIMELINE_MODEL_MAX_TOKENS: "4096"
  },
  {
    fetch: async (url, init) => {
      capturedEnvRequest = {
        url: String(url),
        body: JSON.parse(String(init.body))
      };

      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ env: true }) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  }
);
const envCompletion = await envClient.complete({
  messages: [{ role: "user", content: "Return JSON." }],
  responseFormat: "json_object"
});

assert.equal(envCompletion.content, JSON.stringify({ env: true }), "env client should read model settings from env map");
assert.equal(capturedEnvRequest.url, "https://env-models.example/v1/chat/completions");
assert.equal(capturedEnvRequest.body.max_tokens, 4096, "env client should pass configured max_tokens");

let capturedDefaultEnvRequest;
const defaultEnvClient = createOpenAICompatibleModelClientFromEnv(
  {
    AITIMELINE_MODEL_NAME: "default-env-model",
    AITIMELINE_MODEL_BASE_URL: "https://default-env-models.example/v1"
  },
  {
    fetch: async (_url, init) => {
      capturedDefaultEnvRequest = {
        body: JSON.parse(String(init.body))
      };

      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ defaultEnv: true }) } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  }
);
const defaultEnvCompletion = await defaultEnvClient.complete({
  messages: [{ role: "user", content: "Return JSON." }],
  responseFormat: "json_object"
});

assert.equal(
  defaultEnvCompletion.content,
  JSON.stringify({ defaultEnv: true }),
  "env client should work without an explicit max token env"
);
assert.equal(capturedDefaultEnvRequest.body.max_tokens, 8192, "env client should default max_tokens to 8192");

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

const seoImportInput = {
  source: {
    id: "seo-water-import-source",
    title: seoWaterSourceFixture.title,
    url: "https://example.com/grok-advanced-guide?utm_source=smoke#intro",
    type: "article"
  },
  assets: [],
  chunks: [
    {
      id: "seo-water-import-chunk-1",
      sourceId: "seo-water-import-source",
      content: seoWaterSourceFixture.body,
      conceptHints: ["Speculative Decoding", "RAG Evaluation"]
    }
  ],
  createdAt: "2026-06-10T00:00:00.000Z",
  recommendedBecause: "Smoke test quality gate pipeline integration."
};
const gateRejectedImport = await deterministicWorker.run(seoImportInput);

assert.equal(gateRejectedImport.qualityGate?.verdict, "reject", "import pipeline should reject SEO water at the quality gate");
assert.equal(gateRejectedImport.importRecord.status, "failed", "gate-rejected imports should be recorded as failed");
assert.equal(gateRejectedImport.posts.length, 0, "gate-rejected imports should not generate posts");
assert.ok(gateRejectedImport.errorMessage?.includes("quality gate"), "gate-rejected imports should explain the rejection");

const gateCachedImport = await deterministicWorker.run({
  ...seoImportInput,
  source: { ...seoImportInput.source, url: "https://EXAMPLE.com/grok-advanced-guide/" },
  createdAt: "2026-06-11T00:00:00.000Z",
  sourceQualityVerdicts: [gateRejectedImport.qualityGate]
});

assert.equal(gateCachedImport.qualityGate?.verdict, "reject", "normalized URL variants should reuse the cached verdict");
assert.equal(
  gateCachedImport.qualityGate?.evaluatedAt,
  gateRejectedImport.qualityGate?.evaluatedAt,
  "cached verdicts should be reused without re-evaluation"
);

const gateBypassedImport = await deterministicWorker.run({ ...seoImportInput, skipQualityGate: true });

assert.equal(gateBypassedImport.qualityGate, undefined, "skipQualityGate should bypass the gate entirely");
assert.equal(gateBypassedImport.importRecord.status, "ready", "gate-bypassed imports should proceed to generation");

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

const makeLifecycleCard = (id, overrides = {}) => ({
  id,
  title: `Lifecycle ${id}`,
  summary: `Lifecycle summary for ${id}.`,
  keyTakeaway: `Lifecycle takeaway for ${id}.`,
  concepts: ["Lifecycle"],
  sources: [{ id: `source-${id}`, title: `Source ${id}`, url: `local://${id}`, type: "manual" }],
  recommendedBecause: "Lifecycle smoke fixture.",
  trustState: "emerging",
  createdAt: "2026-07-09T00:00:00.000Z",
  estimatedReadMinutes: 1,
  ...overrides
});
const readDecayCards = [
  makeLifecycleCard("read-heavy", {
    trustState: "supported",
    createdAt: "2026-07-10T00:00:00.000Z"
  }),
  makeLifecycleCard("fresh-peer", {
    createdAt: "2026-07-09T00:00:00.000Z"
  })
];
const readDecayBaseline = rankPersonalizedTimeline({
  cards: readDecayCards,
  now: "2026-07-10T00:00:00.000Z"
});
const readDecayRanking = rankPersonalizedTimeline({
  cards: readDecayCards,
  seenReadCounts: { "read-heavy": 3 },
  now: "2026-07-10T00:00:00.000Z"
});

assert.equal(readDecayBaseline[0].id, "read-heavy", "supported read fixture should start above its peer");
assert.equal(readDecayRanking[0].id, "fresh-peer", "seen-read decay should let fresh cards outrank repeats");
assert.ok(
  readDecayRanking
    .find((card) => card.id === "read-heavy")
    ?.scoreReasons.some((reason) => /Already read/i.test(reason)),
  "seen-read decay should explain why the repeated card was lowered"
);

const pureExposureSignal = {
  postId: "ignored-exposures",
  topicId: "lifecycle",
  conceptIds: ["Lifecycle"],
  impression: true,
  dwellTimeMs: 0,
  openedThread: false,
  liked: false,
  saved: false,
  askedQuestion: false,
  reviewed: false,
  skippedQuickly: false,
  createdAt: "2026-07-10T00:00:00.000Z"
};
const lifecycleSignals = [
  ...Array.from({ length: 5 }, (_, index) => ({
    ...pureExposureSignal,
    createdAt: `2026-07-0${index + 1}T00:00:00.000Z`
  })),
  {
    ...pureExposureSignal,
    postId: "note-exposures",
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  {
    ...pureExposureSignal,
    postId: "note-exposures",
    createdAt: "2026-07-02T00:00:00.000Z"
  },
  {
    ...pureExposureSignal,
    postId: "note-exposures",
    createdAt: "2026-07-03T00:00:00.000Z"
  },
  {
    ...pureExposureSignal,
    postId: "note-exposures",
    createdAt: "2026-07-04T00:00:00.000Z"
  },
  {
    ...pureExposureSignal,
    postId: "note-exposures",
    createdAt: "2026-07-05T00:00:00.000Z"
  },
  {
    ...pureExposureSignal,
    postId: "stale-read",
    dwellTimeMs: 15000,
    createdAt: "2026-05-20T00:00:00.000Z"
  },
  {
    ...pureExposureSignal,
    postId: "due-stale",
    dwellTimeMs: 15000,
    createdAt: "2026-05-20T00:00:00.000Z"
  }
];
const lifecycleFilteredPosts = filterTimelineLifecycle({
  posts: [
    makeLifecycleCard("dismissed"),
    makeLifecycleCard("soft-dismissed"),
    makeLifecycleCard("soft-expired"),
    makeLifecycleCard("ignored-exposures"),
    makeLifecycleCard("stale-read"),
    makeLifecycleCard("due-stale"),
    makeLifecycleCard("fresh-lifecycle"),
    makeLifecycleCard("resting-review"),
    makeLifecycleCard("note-exposures", {
      sources: [{ id: "source-note", title: "Note", url: "local://note", type: "user_note" }]
    })
  ],
  interactionSignals: lifecycleSignals,
  dismissedPosts: [
    { postId: "dismissed", dismissedAt: "2026-07-01T00:00:00.000Z", mode: "hard" },
    { postId: "soft-dismissed", dismissedAt: "2026-07-01T00:00:00.000Z", mode: "soft" },
    { postId: "soft-expired", dismissedAt: "2026-06-01T00:00:00.000Z", mode: "soft" }
  ],
  dueReviewPostIds: ["due-stale"],
  restingReviewPostIds: ["resting-review"],
  now: "2026-07-10T00:00:00.000Z"
});
const lifecycleIds = lifecycleFilteredPosts.map((post) => post.id);

assert.deepEqual(
  lifecycleIds.sort(),
  ["due-stale", "fresh-lifecycle", "note-exposures", "soft-expired"].sort(),
  "lifecycle filtering should retire hard dismissed, active soft dismissed, ignored, stale-read and resting-review posts while keeping expired soft dismissals, notes and due reviews"
);
assert.deepEqual(
  getRestingReviewStates(
    [
      { postId: "resting", intervalDays: 3, dueAt: "2026-07-12T00:00:00.000Z", lastReviewedAt: "2026-07-09T00:00:00.000Z" },
      { postId: "due-now", intervalDays: 1, dueAt: "2026-07-10T00:00:00.000Z", lastReviewedAt: "2026-07-09T00:00:00.000Z" },
      { postId: "liked-never-reviewed", intervalDays: 1, dueAt: "2026-07-12T00:00:00.000Z" }
    ],
    "2026-07-10T00:00:00.000Z"
  ).map((state) => state.postId),
  ["resting"],
  "resting review states are reviewed at least once and not yet due; liked-but-unreviewed cards stay in the feed"
);
assert.deepEqual(
  countSeenReadSignalsByPostId(lifecycleSignals),
  { "stale-read": 1, "due-stale": 1 },
  "seen read counts should use dwell >=12s or opened threads"
);
assert.equal(isPureExposureSignal(pureExposureSignal), true, "pure exposure fixture should match the lifecycle definition");
assert.equal(scoreInteraction(pureExposureSignal), 0, "pure exposure should be neutral for topic-state scoring");

const reviewIntervals = [];
let reviewState = createInitialReviewState("review-post", "2026-07-01T00:00:00.000Z");
reviewIntervals.push(reviewState.intervalDays);

for (let index = 0; index < 5; index += 1) {
  reviewState = advanceReviewState(reviewState, `2026-07-0${index + 2}T00:00:00.000Z`);
  reviewIntervals.push(reviewState.intervalDays);
}

assert.deepEqual(
  reviewIntervals,
  [1, 3, 7, 14, 30, 30],
  "persistent review intervals should progress 1 -> 3 -> 7 -> 14 -> 30 and cap"
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
const deepDiveSignal = {
  ...interestSignal,
  postId: result.cards[0].id,
  topicId: "ai-agent-memory",
  conceptIds: ["AI Agent", "Memory"],
  liked: false,
  openedThread: true,
  dwellTimeMs: 18000,
  createdAt: "2026-06-10T00:02:00.000Z"
};
const deepDiveTopicState = {
  topicId: "ai-agent-memory",
  interestScore: 0.8,
  fatigueScore: 0.08,
  comprehensionScore: 0.42
};
const deepDivePlan = createBackgroundCurationPlan({
  signals: [deepDiveSignal],
  feedback: [evaluateInteraction(deepDiveSignal, deepDiveTopicState)],
  topicStates: [deepDiveTopicState],
  generatedAt: "2026-06-10T00:02:00.000Z"
});
const deepDiveDiscoverJob = deepDivePlan.jobs.find((job) => job.kind === "discover_sources");

assert.ok(deepDiveDiscoverJob, "continue_deeper should queue source discovery instead of same-source follow-up");
assert.equal(
  deepDivePlan.jobs.some((job) => job.kind === "generate_followup"),
  false,
  "continue_deeper should not immediately queue a same-source follow-up job"
);

const deepDiveFallbackStore = createInMemoryBackgroundCurationJobStore();
enqueueSingleJob(deepDiveFallbackStore, deepDiveDiscoverJob);

const deepDiveFallbackBatch = await runDueBackgroundCurationJobs(
  deepDiveFallbackStore,
  {
    sourceImportWorker: deterministicWorker,
    loadSeedPost: (job) => result.cards.find((card) => card.id === job.postId),
    discoverSources: () => []
  },
  {
    now: "2026-06-10T00:22:00.000Z",
    kinds: ["discover_sources"]
  }
);
const deepDiveFallbackRecord = deepDiveFallbackBatch.records[0];

assert.equal(deepDiveFallbackRecord.status, "succeeded", "deep-dive discovery should fall back cleanly with no candidates");
assert.ok(
  deepDiveFallbackRecord.result?.sourceImport?.posts.length,
  "deep-dive fallback should generate a same-source follow-up card"
);
assert.ok(
  deepDiveFallbackRecord.result?.followupProtocol,
  "deep-dive fallback should retain the follow-up protocol for inspection"
);

const deepDiveImportStore = createInMemoryBackgroundCurationJobStore();
enqueueSingleJob(deepDiveImportStore, deepDiveDiscoverJob);

const deepDiveCandidate = {
  id: "deep-dive-candidate-1",
  source: {
    id: "deep-dive-source-1",
    title: technicalSourceFixture.title,
    url: "https://arxiv.org/abs/2401.00001",
    type: "paper"
  },
  conceptIds: ["Speculative Decoding"],
  relevanceScore: 0.9,
  noveltyScore: 0.7,
  qualityScore: 0.8,
  reason: "Deep-dive smoke candidate.",
  discoveredAt: "2026-06-10T00:20:00.000Z"
};
const deepDiveImportBatch = await runDueBackgroundCurationJobs(
  deepDiveImportStore,
  {
    sourceImportWorker: deterministicWorker,
    loadSeedPost: (job) => result.cards.find((card) => card.id === job.postId),
    discoverSources: () => [deepDiveCandidate],
    ingestSourceCandidate: (candidate) => ({
      assets: [
        {
          id: `${candidate.source.id}-text`,
          sourceId: candidate.source.id,
          kind: "text",
          content: technicalSourceFixture.body,
          createdAt: "2026-06-10T00:20:00.000Z"
        }
      ],
      chunks: [
        {
          id: `${candidate.source.id}-chunk-1`,
          sourceId: candidate.source.id,
          content: technicalSourceFixture.body,
          conceptHints: ["Speculative Decoding"]
        }
      ]
    })
  },
  {
    now: "2026-06-10T00:22:00.000Z",
    kinds: ["discover_sources"]
  }
);
const deepDiveImportRecord = deepDiveImportBatch.records[0];
const deepDiveImport = deepDiveImportRecord.result?.sourceImport;

assert.equal(deepDiveImportRecord.status, "succeeded", "deep-dive discovery with a qualified candidate should succeed");
assert.equal(deepDiveImport?.qualityGate?.verdict, "accept", "deep-dive candidates should pass the quality gate before import");
assert.ok(deepDiveImport?.posts.length, "deep-dive should import the new source into posts");
assert.equal(deepDiveImport?.source.id, "deep-dive-source-1", "deep-dive should import the discovered source, not the seed source");
assert.ok(
  deepDiveImport?.posts.every((post) => post.hook.includes("你已经知道")),
  "deep-dive posts should bridge from a known concept in the hook"
);
assert.ok(
  deepDiveImport?.posts.every((post) => post.recommendedBecause.includes("点了深入")),
  "deep-dive posts should explain the go-deeper trigger"
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
const englishFollowupSourcePlan = createFollowupSourceImportPlan({
  job: followupJob,
  seedPost: followupSeedPost,
  createdAt: "2026-06-10T00:00:00.000Z",
  contentLanguage: "en"
});
const followupChunkContent = followupSourcePlan.input.chunks[0]?.content ?? "";
const seedPostText = collectStrings(followupSeedPost)
  .map((value) => value.replace(/\s+/g, " ").trim())
  .join("\n\n");
const followupLoopPostId = "followup-ai-agent-xxx-post-1";

assert.equal(followupProtocol.intent, "expand_broader", "follow-up protocol should encode broaden intent");
assert.equal(followupProtocolValidation.valid, true, "follow-up protocol should validate");
assert.equal(isFollowupSource(followupSourcePlan.input.source), true, "follow-up source helper should identify local follow-up sources");
assert.equal(
  isFollowupPost({ sources: [followupSourcePlan.input.source] }),
  true,
  "follow-up post helper should identify posts backed by follow-up sources"
);
assert.equal(isFollowupPostId(followupLoopPostId), true, "follow-up id helper should identify generated follow-up posts");
assert.equal(isFollowupPostId(interestSignal.postId), false, "follow-up id helper should not match ordinary posts");
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
assert.match(
  englishFollowupSourcePlan.input.recommendedBecause,
  /follow-up/i,
  "English mode deterministic follow-up fallback should use English recommendation text"
);
assert.equal(
  calculateCjkRatio(englishFollowupSourcePlan.input.recommendedBecause),
  0,
  "English mode deterministic follow-up recommendation should not contain CJK text"
);

for (const segment of followupChunkContent.split(/\n\n+/).filter(Boolean)) {
  assert.ok(seedPostText.includes(segment), `follow-up chunk segment should come from seed post text: ${segment}`);
}

const followupLoopSignal = {
  ...interestSignal,
  postId: followupLoopPostId,
  createdAt: "2026-06-10T00:01:00.000Z"
};
const followupLoopFeedback = {
  ...interestFeedback,
  postId: followupLoopPostId
};
const followupLoopPlan = createBackgroundCurationPlan({
  signals: [followupLoopSignal],
  feedback: [followupLoopFeedback],
  topicStates: [interestedTopicState],
  generatedAt: "2026-06-10T00:01:00.000Z",
  sourceCandidates: [
    {
      id: "candidate-followup-loop",
      source: {
        id: "article-followup-loop",
        title: "A source that should not be queued from a follow-up card",
        url: "https://example.com/followup-loop",
        type: "article"
      },
      topicId: "knowledge-graph",
      conceptIds: ["Knowledge Graph", "Memory"],
      relevanceScore: 0.95,
      noveltyScore: 0.8,
      qualityScore: 0.9,
      reason: "This candidate would match if follow-up signals were allowed to expand.",
      discoveredAt: "2026-06-10T00:01:00.000Z"
    }
  ]
});

assert.equal(followupLoopPlan.jobs.length, 0, "follow-up card signals should not enqueue any curation jobs");
assert.equal(
  followupLoopPlan.acceptedSourceCandidateIds.length,
  0,
  "follow-up card signals should not pull discovery or import candidates into the chain"
);
assert.ok(
  followupLoopPlan.expansionPlan.suppressions.some((suppression) => suppression.postId === followupLoopPostId),
  "follow-up card signals should be recorded as suppressed at the expansion source"
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
  previousTurns: [
    {
      id: "previous-thread-turn",
      userId: "local-user",
      question: "What should I review first?",
      intent: "grounded_qa",
      tier: "free",
      zone: "inside",
      status: "answered",
      threadId: "thread-smoke",
      createdAt: "2026-06-10T00:20:00.000Z"
    }
  ],
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
const englishDarkTurn = await runConversationTurn({
  question: "What is quantum chromodynamics?",
  posts: result.cards,
  registry: result.sourceRegistry,
  memory: boundaryMemory,
  now: "2026-06-10T00:31:00.000Z"
}, {
  contentLanguage: "en"
});

assert.equal(darkTurn.zone, "dark", "questions outside the library should be dark");
assert.equal(darkTurn.intent, "discovery_proposal", "dark questions should propose discovery instead of answering");
assert.equal(darkTurn.answer, null, "the agent must not answer dark questions from model memory");
assert.equal(darkTurn.actions[0]?.kind, "confirm_discovery", "dark turns should first ask for discovery confirmation");
assert.equal(darkTurn.actions[0]?.questions?.length, 2, "dark turns should ask a bounded confirmation block");
assert.ok(
  darkTurn.actions.some((action) => action.kind === "discover_sources" && action.queries?.length),
  "dark turns should keep the legacy discovery action available"
);
assert.ok(darkTurn.nearestPosts.length <= 2, "dark turns should return at most two nearest library cards");
assert.match(
  englishDarkTurn.notes.join(" "),
  /outside your library/i,
  "English mode deterministic dark-zone fallback should use English notes"
);
assert.match(
  englishDarkTurn.actions[0]?.label ?? "",
  /Confirm research/i,
  "English mode deterministic dark-zone fallback should use English action labels"
);

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
          content: [
            "Knowledge graph memory systems store entities as concept nodes and learning events as typed edges, then use edge weights to select review prompts and recommendations.",
            "In a 120-card evaluation set, graph-aware retrieval improved cited-card recall from 0.54 to 0.71 because the retriever could follow Memory -> Recommendation and Memory -> Review edges instead of relying only on title overlap.",
            "The implementation trade-off is maintenance cost: every imported card needs durable edge evidence, stale aliases must be merged, and low-confidence edges should be excluded from scheduling decisions."
          ].join(" "),
          createdAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      chunks: [
        {
          id: `${candidate.source.id}-chunk-1`,
          sourceId: candidate.source.id,
          content: [
            "Knowledge graph memory systems store entities as concept nodes and learning events as typed edges, then use edge weights to select review prompts and recommendations.",
            "In a 120-card evaluation set, graph-aware retrieval improved cited-card recall from 0.54 to 0.71 because the retriever could follow Memory -> Recommendation and Memory -> Review edges instead of relying only on title overlap.",
            "The implementation trade-off is maintenance cost: every imported card needs durable edge evidence, stale aliases must be merged, and low-confidence edges should be excluded from scheduling decisions."
          ].join(" "),
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
appPersistence.saveAgentTurnRecords(
  [
    {
      id: "agent-turn-smoke",
      userId: "user-smoke",
      question: "What should I research?",
      intent: "discovery_proposal",
      tier: "free",
      zone: "dark",
      status: "pending_confirmation",
      threadId: "agent-thread-smoke",
      createdAt: "2026-06-10T00:20:00.000Z"
    }
  ],
  "2026-06-10T00:20:00.000Z"
);
appPersistence.saveNotifications(
  [
    {
      id: "notification-smoke",
      kind: "agent_answer",
      turnId: "agent-turn-smoke",
      postIds: [result.cards[0].id],
      body: "Grounded answer smoke.",
      createdAt: "2026-06-10T00:21:00.000Z"
    }
  ],
  "2026-06-10T00:21:00.000Z"
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
assert.equal(
  appSnapshot.posts.every((post) => !("media" in post)),
  true,
  "legacy-style persisted posts without media should rehydrate without migration"
);
assert.equal(appSnapshot.harnessRuns.length, 1, "persistence should store harness runs");
assert.equal(appSnapshot.curationJobs.length, 3, "persistence should store curation job records");
assert.equal(appSnapshot.releasePlans.length, 1, "persistence should store release plans");
assert.equal(appSnapshot.userMemories[0]?.userId, "user-smoke", "persistence should store user memory");
assert.equal(appSnapshot.memoryEvents.length, 5, "persistence should store memory edit events");
assert.equal(appSnapshot.interactionSignals.length, 1, "persistence should store interaction signals");
assert.equal(appSnapshot.topicStates.length, 1, "persistence should store topic states");
assert.equal(appSnapshot.sourceCandidates.length, 1, "persistence should store source candidates");
assert.equal(appSnapshot.sourceCandidates[0]?.status, "pending", "source candidates should preserve status");
assert.equal(appSnapshot.agentTurns[0]?.status, "pending_confirmation", "agent turn status should persist");
assert.equal(appSnapshot.agentTurns[0]?.threadId, "agent-thread-smoke", "agent turn thread id should persist");
assert.equal(appSnapshot.notifications.length, 1, "persistence should store agent notifications");

let legacyAgentTurnSnapshot = JSON.stringify({
  version: 1,
  updatedAt: "2026-06-10T00:00:00.000Z",
  agentTurns: [
    {
      id: "legacy-agent-turn",
      userId: "legacy-user",
      question: "Legacy question?",
      intent: "grounded_qa",
      tier: "free",
      zone: "inside",
      createdAt: "2026-06-10T00:00:00.000Z"
    }
  ]
});
const legacyAgentTurnPersistence = createAITimelinePersistenceStore({
  read: () => legacyAgentTurnSnapshot,
  write: (serialized) => {
    legacyAgentTurnSnapshot = serialized;
  }
});
const legacyAgentTurn = legacyAgentTurnPersistence.getSnapshot().agentTurns[0];

assert.equal(legacyAgentTurn.status, "answered", "legacy agent turns should default to answered");
assert.equal(legacyAgentTurn.threadId, "legacy-agent-turn", "legacy agent turns should default threadId to their id");
assert.deepEqual(
  legacyAgentTurnPersistence.getSnapshot().notifications,
  [],
  "legacy snapshots should default notifications to an empty list"
);

// --- User notes: self-grounded source + post ---
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

const ideaNote = transformUserNote("投机解码可以作为 [[RAG]] 系统的延迟优化假设。", {
  kind: "idea",
  createdAt: "2026-01-06T00:00:00.000Z",
  libraryConcepts: ["Speculative Decoding", "RAG"],
  libraryCards: backlinkCards,
  conceptAliases: [
    {
      canonical: "Speculative Decoding",
      aliases: ["投机解码"],
      decidedBy: "user",
      decidedAt: "2026-07-06T00:00:00.000Z"
    }
  ]
});
assert.equal(ideaNote.post.kind, "idea", "idea notes should persist as idea posts");
assert.ok(
  ideaNote.post.concepts.includes("Speculative Decoding"),
  "idea note concept matching should reuse concept aliases"
);
const ideaLinked = buildLinkedKnowledgeGraph({
  cards: [...backlinkCards, ideaNote.post],
  signals: [
    ...linkedSignals,
    { id: "sig-idea", cardId: ideaNote.post.id, type: "save", createdAt: "2026-01-06T00:00:00.000Z" }
  ],
  conceptAliases: [
    {
      canonical: "Speculative Decoding",
      aliases: ["投机解码"],
      decidedBy: "user",
      decidedAt: "2026-07-06T00:00:00.000Z"
    }
  ]
});
assert.ok(
  ideaLinked.nodes.some((node) => node.id === ideaNote.post.id && node.kind === "idea"),
  "a user idea becomes a distinct idea node"
);
assert.ok(
  ideaLinked.edges.some((edge) => edge.source === ideaNote.post.id && edge.kind === "mentions"),
  "idea nodes should connect to resolved concept hubs"
);

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
