import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.AITIMELINE_TIMEZONE = "UTC";

const { transformArticleUrl } = await import("../packages/core/dist/transform/articleImport.js");
const { transformYouTubeUrl } = await import("../packages/core/dist/transform/youtubeImport.js");
const { agentHarnessSystemPrompt } = await import("../packages/core/dist/harness/systemPrompt.js");
const { createModelKnowledgePostRunner } = await import("../packages/core/dist/harness/modelRunner.js");
const { createCommandModelClient } = await import("../packages/core/dist/model/commandModelClient.js");
const { createAgentHarnessConfig, deterministicKnowledgePostRunner } = await import("../packages/core/dist/harness/runner.js");
const { calculateCjkRatio } = await import("../packages/core/dist/harness/contentLanguage.js");
const { askGrounded, askSystemPrompt } = await import("../packages/core/dist/harness/askGrounded.js");
const { followupHarnessSystemPrompt } = await import("../packages/core/dist/harness/followupHarness.js");
const { createSourceRegistry } = await import("../packages/core/dist/source/sourceRegistry.js");

assert.ok(
  agentHarnessSystemPrompt.includes("Write all user-facing text in Simplified Chinese."),
  "knowledge post system prompt should require Simplified Chinese"
);
assert.ok(
  followupHarnessSystemPrompt.includes("Write all user-facing text in Simplified Chinese."),
  "follow-up system prompt should require Simplified Chinese"
);
assert.ok(
  askSystemPrompt.includes("Write all user-facing text in Simplified Chinese."),
  "askGrounded system prompt should require Simplified Chinese"
);
assert.ok(
  agentHarnessSystemPrompt.includes("never copy") && agentHarnessSystemPrompt.includes("verbatim"),
  "knowledge post system prompt should forbid verbatim copying outside citation quote fields"
);
assert.ok(
  followupHarnessSystemPrompt.includes("never copy") && followupHarnessSystemPrompt.includes("verbatim"),
  "follow-up system prompt should forbid verbatim copying outside citation quote fields"
);
assert.ok(
  askSystemPrompt.includes("never copy") && askSystemPrompt.includes("verbatim"),
  "askGrounded system prompt should forbid verbatim copying outside citation quote fields"
);

const createdAt = "2026-06-10T00:00:00.000Z";
const articleUrl = "https://example.com/model-import-test";
const articleHtml = `
  <html>
    <head>
      <meta property="og:title" content="Wiring a real model into the import pipeline" />
      <meta name="author" content="AITimeline Test" />
    </head>
    <body>
      <article>
        <p>An AI Agent can turn source material into durable knowledge when it keeps citations, extracts concepts, and builds a learning surface the reader can revisit later.</p>
        <p>A Knowledge Graph lets Memory become useful because saved concepts, weak concepts, and Recommendation signals can point the learner toward review at the right moment.</p>
      </article>
    </body>
  </html>
`;
const fetchArticleHtml = async () =>
  new Response(articleHtml, { status: 200, headers: { "content-type": "text/html" } });

// 1) No runner -> the deterministic template path (the green-baseline default).
const deterministic = await transformArticleUrl(articleUrl, { fetch: fetchArticleHtml, createdAt });

assert.equal(
  deterministic.harnessRun?.runnerKind,
  "deterministic",
  "no runner should fall back to the deterministic template runner"
);
assert.ok(deterministic.cards.length > 0, "deterministic import should produce cards");
assert.equal(deterministic.importRecord.status, "ready", "deterministic import should be ready");

// 2) Inject a fake ModelClient that returns canned, valid KnowledgePost JSON. We derive the
//    canned post from the grounded deterministic card and tag the hook, so the test stays robust
//    (real grounding/citations) while still proving the model output is what reaches the card.
const sentinelHook = "[beyond source] Model-written hook proves the LLM output reached the card";
const modelPost = { ...deterministic.cards[0], hook: sentinelHook };
let modelCalls = 0;
const modelRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 0,
  client: {
    async complete() {
      modelCalls += 1;
      return { content: JSON.stringify({ posts: [modelPost] }) };
    }
  }
});

const model = await transformArticleUrl(articleUrl, {
  fetch: fetchArticleHtml,
  createdAt,
  runner: modelRunner
});

assert.equal(modelCalls, 1, "the model client should be called exactly once");
assert.equal(model.harnessRun?.runnerKind, "model", "passing a model runner should run the model path");
assert.equal(model.importRecord.status, "ready", "model output should pass schema + grounding and be ready");
assert.equal(model.cards.length, 1, "model import should accept the single grounded model post");
assert.equal(
  model.cards[0].hook,
  sentinelHook,
  "the card hook should come from the model output, not the deterministic template"
);
assert.ok(
  model.validation.every((result) => result.valid),
  "model output should pass validation with no errors"
);

// 2b) Paper digest model path: prompt includes the section-card protocol, cross-bucket sampled
//     chunks, and the exact figure assetId list; legal media survives validation unchanged.
const paperSource = {
  id: "paper-model-smoke",
  title: "Paper digest model smoke",
  url: "https://arxiv.org/abs/2603.07670",
  type: "paper"
};
const makePaperChunk = (kind, index, text) => ({
  id: `${paperSource.id}-${kind}-${index}`,
  sourceId: paperSource.id,
  content: `${text} ${kind} sample ${index} ${index === 5 ? "should stay out of the sampled prompt" : "reaches the paper prompt"}.`,
  conceptHints: []
});
const motivationChunks = Array.from({ length: 5 }, (_, index) =>
  makePaperChunk(
    "motivation",
    index + 1,
    "The paper motivates grounded AI Agent memory with citations, durable source chunks, and inspectable retrieval trails."
  )
);
const methodChunks = Array.from({ length: 5 }, (_, index) =>
  makePaperChunk(
    "method",
    index + 1,
    "The method builds a graph-backed architecture with retrieval nodes, summary edges, and evaluation hooks."
  )
);
const experimentChunks = Array.from({ length: 4 }, (_, index) =>
  makePaperChunk(
    "experiment",
    index + 1,
    "The experiments compare baselines on benchmark tasks and report result accuracy for retrieval quality."
  )
);
const conclusionChunks = Array.from({ length: 3 }, (_, index) =>
  makePaperChunk(
    "conclusion",
    index + 1,
    "The conclusion names limitations around consolidation, forgetting, and long-term maintenance of memory graphs."
  )
);
const paperChunks = [...motivationChunks, ...methodChunks, ...experimentChunks, ...conclusionChunks];
const paperTextAsset = {
  id: `${paperSource.id}-text`,
  sourceId: paperSource.id,
  kind: "text",
  content: paperChunks.map((chunk) => chunk.content).join("\n\n"),
  createdAt
};
const architectureImageAsset = {
  id: `${paperSource.id}-image-1`,
  sourceId: paperSource.id,
  kind: "image",
  url: `/media/${paperSource.id}/1.png`,
  caption: "Figure 1: Architecture overview of the memory graph.",
  figureLabel: "Figure 1",
  createdAt
};
const resultImageAsset = {
  id: `${paperSource.id}-image-2`,
  sourceId: paperSource.id,
  kind: "image",
  url: `/media/${paperSource.id}/2.png`,
  caption: "Table 1: Experiment results across retrieval benchmarks.",
  figureLabel: "Table 1",
  createdAt
};
const paperDigest = {
  buckets: [
    { kind: "motivation", title: "Abstract / Introduction", chunkIds: motivationChunks.map((chunk) => chunk.id) },
    { kind: "method", title: "Method and Architecture", chunkIds: methodChunks.map((chunk) => chunk.id) },
    { kind: "experiment", title: "Experiments", chunkIds: experimentChunks.map((chunk) => chunk.id) },
    { kind: "conclusion", title: "Limitations and Conclusion", chunkIds: conclusionChunks.map((chunk) => chunk.id) }
  ],
  figures: [
    {
      assetId: architectureImageAsset.id,
      figureLabel: architectureImageAsset.figureLabel,
      caption: architectureImageAsset.caption
    },
    {
      assetId: resultImageAsset.id,
      figureLabel: resultImageAsset.figureLabel,
      caption: resultImageAsset.caption
    }
  ]
};
const paperSourceRegistry = createSourceRegistry({
  sources: [paperSource],
  assets: [paperTextAsset, architectureImageAsset, resultImageAsset],
  chunks: paperChunks,
  createdAt
});
const deterministicPaperDigest = await deterministicKnowledgePostRunner.run({
  source: paperSource,
  chunks: paperChunks,
  sourceRegistry: paperSourceRegistry,
  paperDigest,
  createdAt,
  recommendedBecause: "Smoke test paper digest model protocol."
});

assert.equal(deterministicPaperDigest.posts.length, 4, "paper digest fallback fixture should create four section posts");
assert.ok(
  deterministicPaperDigest.posts.some((post) => post.media?.[0]?.assetId === architectureImageAsset.id),
  "paper digest fallback fixture should attach the architecture image"
);
assert.ok(
  deterministicPaperDigest.posts.some((post) => post.media?.[0]?.assetId === resultImageAsset.id),
  "paper digest fallback fixture should attach the experiment result image"
);

let capturedPaperDigestPrompt = "";
const paperDigestModelRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 0,
  client: {
    async complete(request) {
      capturedPaperDigestPrompt = request.messages.map((message) => message.content).join("\n");

      return { content: JSON.stringify({ posts: deterministicPaperDigest.posts }) };
    }
  }
});
const paperDigestModelResult = await paperDigestModelRunner.run({
  source: paperSource,
  chunks: paperChunks,
  sourceRegistry: paperSourceRegistry,
  paperDigest,
  createdAt,
  recommendedBecause: "Smoke test paper digest model protocol."
});

assert.match(capturedPaperDigestPrompt, /Paper digest protocol/, "paper prompt should include the section-card protocol");
assert.match(
  capturedPaperDigestPrompt,
  new RegExp(architectureImageAsset.id),
  "paper prompt should include the figure assetId list"
);
assert.match(
  capturedPaperDigestPrompt,
  /method sample 1 reaches the paper prompt/,
  "paper prompt should include sampled chunks beyond the old first-four slice"
);
assert.doesNotMatch(
  capturedPaperDigestPrompt,
  /method sample 5 should stay out of the sampled prompt/,
  "paper prompt should cap each bucket at four chunks"
);
assert.equal(paperDigestModelResult.run.status, "succeeded", "paper digest model output should pass validation");
assert.equal(paperDigestModelResult.posts.length, 4, "paper digest model output should accept section cards");

for (const post of paperDigestModelResult.posts) {
  const expectedPost = deterministicPaperDigest.posts.find((candidate) => candidate.id === post.id);

  assert.deepEqual(post.media, expectedPost?.media, "paper digest media should survive the model path unchanged");
}

// 3) Prove the two paths actually diverge: the deterministic card never carries the model sentinel.
assert.notEqual(
  deterministic.cards[0].hook,
  sentinelHook,
  "the deterministic path should keep the template hook, not the model sentinel"
);

// 4) The language gate is opt-in: English model output repairs when enabled, and passes when disabled.
const englishModelPost = toEnglishUserFacingPost(deterministic.cards[0]);
const zhGroundedEvidence =
  `这张知识卡说明，AI Agent 会把导入材料整理成可以长期复习的知识，并且保留引用、提取概念、` +
  `建立学习界面，让读者以后能够重新查看和验证。${deterministic.chunks[0].content}`;
const zhModelPost = toChineseUserFacingPost(deterministic.cards[0], zhGroundedEvidence);
const languageGateChunks = deterministic.chunks.map((chunk) =>
  chunk.id === deterministic.cards[0].citations[0].chunkId
    ? { ...chunk, content: zhGroundedEvidence }
    : chunk
);
const languageGateRegistry = {
  ...deterministic.sourceRegistry,
  chunks: languageGateChunks
};
let languageGateCalls = 0;
let languageRepairPrompt = "";
const languageGateRunner = createModelKnowledgePostRunner({
  contentLanguage: "zh",
  maxRepairAttempts: 1,
  client: {
    async complete(request) {
      languageGateCalls += 1;

      if (languageGateCalls === 1) {
        return { content: JSON.stringify({ posts: [englishModelPost] }) };
      }

      languageRepairPrompt = request.messages.at(-1)?.content ?? "";
      return { content: JSON.stringify({ posts: [zhModelPost] }) };
    }
  }
});
const languageGateResult = await languageGateRunner.run({
  source: deterministic.source,
  chunks: languageGateChunks,
  sourceRegistry: languageGateRegistry,
  createdAt,
  recommendedBecause: "这次 smoke 用来确认英文模型输出会被中文语言门禁修复。"
});

assert.equal(languageGateCalls, 2, "language gate should ask the model to repair English output");
assert.match(
  languageRepairPrompt,
  /must be rewritten primarily in Simplified Chinese, keeping key English terms/,
  "repair prompt should include the language validation issue"
);
assert.match(languageRepairPrompt, /\$\.title/, "language validation should report the failing field path");
assert.equal(languageGateResult.run.status, "succeeded", "Chinese repair output should pass the model harness");
assert.equal(languageGateResult.posts.length, 1, "language repair should keep the repaired post");
assert.ok(
  calculateCjkRatio(languageGateResult.posts[0].title) >= 0.3,
  "repaired title should be primarily Chinese with key English terms retained"
);

let overlapRepairCalls = 0;
let overlapRepairPrompt = "";
// Anchor-style grounding (2026-08-03): an anchor-free pure-Chinese paraphrase now
// passes as narrative, so the repairable overlap failure is a Latin anchor term
// the cited evidence never mentions.
const weakOverlapPost = {
  ...zhModelPost,
  summary: "这句话只用中文转述，把 prompt cache 说成了文章的核心机制。"
};
const overlapRepairRunner = createModelKnowledgePostRunner({
  contentLanguage: "zh",
  maxRepairAttempts: 1,
  client: {
    async complete(request) {
      overlapRepairCalls += 1;

      if (overlapRepairCalls === 1) {
        return { content: JSON.stringify({ posts: [weakOverlapPost] }) };
      }

      overlapRepairPrompt = request.messages.at(-1)?.content ?? "";
      return { content: JSON.stringify({ posts: [zhModelPost] }) };
    }
  }
});
const overlapRepairResult = await overlapRepairRunner.run({
  source: deterministic.source,
  chunks: languageGateChunks,
  sourceRegistry: languageGateRegistry,
  createdAt,
  recommendedBecause: "这次 smoke 用来确认中文 source-fact 重合度失败会得到可操作修复提示。"
});

assert.equal(overlapRepairCalls, 2, "weak source-fact overlap should ask the model to repair output");
assert.match(
  overlapRepairPrompt,
  /verbatim.*English terms|English terms.*verbatim/i,
  "repair prompt should tell the model to preserve cited English anchor terms verbatim"
);
assert.match(
  overlapRepairPrompt,
  /Source fact does not overlap enough with cited evidence/,
  "repair prompt should include the weak overlap validation issue"
);
assert.match(
  overlapRepairPrompt,
  /citing the chunk that actually names the term/,
  "repair prompt should teach citation retargeting for missing entities and terms"
);
assert.equal(overlapRepairResult.run.status, "succeeded", "source-fact overlap repair output should pass");
assert.equal(overlapRepairResult.posts.length, 1, "source-fact overlap repair should keep the repaired post");

let disabledLanguageCalls = 0;
const disabledLanguageRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 0,
  client: {
    async complete() {
      disabledLanguageCalls += 1;
      return { content: JSON.stringify({ posts: [englishModelPost] }) };
    }
  }
});
const disabledLanguageResult = await disabledLanguageRunner.run({
  source: deterministic.source,
  chunks: deterministic.chunks,
  sourceRegistry: deterministic.sourceRegistry,
  createdAt,
  recommendedBecause: "Smoke test confirms the language gate stays off by default."
});

assert.equal(disabledLanguageCalls, 1, "disabled language gate should not trigger a repair");
assert.equal(disabledLanguageResult.run.status, "succeeded", "English output should pass when contentLanguage is unset");
assert.equal(disabledLanguageResult.posts[0].title, englishModelPost.title, "ungated output should be accepted as-is");

// 4b) 按卡保留:修复轮次用尽后,通过校验的卡片保留,失败的卡片丢弃,不再一票否决整批。
let salvageCalls = 0;
const salvageRunner = createModelKnowledgePostRunner({
  contentLanguage: "zh",
  maxRepairAttempts: 1,
  client: {
    async complete() {
      salvageCalls += 1;
      return {
        content: JSON.stringify({
          posts: [zhModelPost, { ...englishModelPost, id: `${englishModelPost.id}-en` }]
        })
      };
    }
  }
});
const salvageResult = await salvageRunner.run({
  source: deterministic.source,
  chunks: languageGateChunks,
  sourceRegistry: languageGateRegistry,
  createdAt,
  recommendedBecause: "这次 smoke 用来确认单张坏卡不会拖垮整批卡片。"
});

assert.equal(salvageCalls, 2, "partial salvage should still spend the repair attempt first");
assert.equal(salvageResult.run.status, "succeeded", "a run with at least one valid post should succeed");
assert.equal(salvageResult.posts.length, 1, "only the post that passed validation should be accepted");
assert.equal(salvageResult.posts[0].id, zhModelPost.id, "the accepted post should be the valid Chinese one");
assert.ok(
  salvageResult.validation.some((result) => !result.valid),
  "the dropped post's validation issues should stay observable on the run"
);

// 4c) Batch acceptance is fail-closed: maxPostsPerRun is enforced before
// acceptance, and duplicate IDs are never resolved by arbitrary first-wins.
const overLimitPosts = Array.from({ length: 3 }, (_, index) => ({
  ...modelPost,
  id: `${modelPost.id}-limit-${index + 1}`
}));
const overLimitRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 0,
  client: {
    async complete() {
      return { content: JSON.stringify({ posts: overLimitPosts }) };
    }
  }
});
const overLimitResult = await overLimitRunner.run({
  source: deterministic.source,
  chunks: deterministic.chunks,
  sourceRegistry: deterministic.sourceRegistry,
  createdAt,
  config: createAgentHarnessConfig({ maxPostsPerRun: 1 })
});

assert.equal(overLimitResult.validation.length, 3, "every over-limit candidate should retain a validation record");
assert.equal(overLimitResult.posts.length, 1, "maxPostsPerRun=1 should deterministically retain only the first valid post");
assert.equal(overLimitResult.posts[0].id, overLimitPosts[0].id, "max-post truncation should preserve model order");
assert.equal(overLimitResult.run.outputPostIds.length, 1, "run output IDs should contain only accepted posts");
assert.equal(
  overLimitResult.validation.filter((result) =>
    result.issues.some((issue) => issue.severity === "error" && /maxPostsPerRun/.test(issue.message))
  ).length,
  2,
  "every tail post beyond maxPostsPerRun should be rejected explicitly"
);

const duplicateIdRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 0,
  client: {
    async complete() {
      return { content: JSON.stringify({ posts: [modelPost, { ...modelPost }] }) };
    }
  }
});
const duplicateIdResult = await duplicateIdRunner.run({
  source: deterministic.source,
  chunks: deterministic.chunks,
  sourceRegistry: deterministic.sourceRegistry,
  createdAt,
  config: createAgentHarnessConfig({ maxPostsPerRun: 4 })
});

assert.equal(duplicateIdResult.posts.length, 0, "duplicate post IDs should reject every ambiguous candidate");
assert.equal(duplicateIdResult.run.status, "failed", "a duplicate-only model batch should fail closed");
assert.equal(
  duplicateIdResult.validation.filter((result) =>
    result.issues.some((issue) => issue.severity === "error" && /must be unique/.test(issue.message))
  ).length,
  2,
  "both candidates sharing a post ID should carry uniqueness errors"
);

// 5) The same runner option threads through the YouTube transform path.
const youtubeUrl = "https://www.youtube.com/watch?v=model-demo";
const fakePlayerResponse = {
  videoDetails: { title: "Model runner transcript demo", author: "AITimeline Test Channel", lengthSeconds: "120" },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { baseUrl: "https://youtube.test/api/timedtext?v=model-demo", languageCode: "en", name: { simpleText: "English" } }
      ]
    }
  }
};
const fetchYouTube = async (url) => {
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
            segs: [{ utf8: "An AI Agent turns source material into durable knowledge with citations and concepts." }]
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }

  return new Response("not found", { status: 404 });
};

const youtubeDeterministic = await transformYouTubeUrl(youtubeUrl, { fetch: fetchYouTube, createdAt });

assert.equal(
  youtubeDeterministic.harnessRun?.runnerKind,
  "deterministic",
  "youtube with no runner should use the deterministic template runner"
);
assert.equal(youtubeDeterministic.importRecord.status, "ready", "youtube deterministic import should be ready");

const youtubeModelPost = { ...youtubeDeterministic.cards[0], hook: sentinelHook };
const youtubeModelRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 0,
  client: {
    async complete() {
      return { content: JSON.stringify({ posts: [youtubeModelPost] }) };
    }
  }
});
const youtubeModel = await transformYouTubeUrl(youtubeUrl, {
  fetch: fetchYouTube,
  createdAt,
  runner: youtubeModelRunner
});

assert.equal(youtubeModel.harnessRun?.runnerKind, "model", "youtube with a model runner should run the model path");
assert.equal(youtubeModel.importRecord.status, "ready", "youtube model import should be ready");
assert.equal(youtubeModel.cards[0].hook, sentinelHook, "youtube card hook should come from the model output");

// 6) askGrounded: a model client answers grounded in the post's cited source chunks.
let askCalls = 0;
const askModelResult = await askGrounded(
  {
    post: deterministic.cards[0],
    registry: deterministic.sourceRegistry,
    question: "What should an AI agent do with a source?"
  },
  {
    client: {
      async complete() {
        askCalls += 1;
        return {
          content: JSON.stringify({
            answer: "An AI Agent can turn source material into durable knowledge when it keeps citations.",
            citedExcerpts: [1]
          })
        };
      }
    }
  }
);

assert.equal(askCalls, 1, "askGrounded should call the model client once");
assert.equal(askModelResult.runnerKind, "model", "askGrounded with a client should use the model path");
assert.ok(askModelResult.answer.includes("durable knowledge"), "ask answer should come from the model output");
assert.ok(askModelResult.citations.length >= 1, "ask should resolve at least one grounded citation");
assert.equal(askModelResult.grounded, true, "an answer citing an excerpt should be grounded");

const askWithoutExplicitCitation = await askGrounded(
  {
    post: deterministic.cards[0],
    registry: deterministic.sourceRegistry,
    question: "Can you answer without citing the excerpt?"
  },
  {
    contentLanguage: "zh",
    client: {
      async complete() {
        return {
          content: JSON.stringify({
            answer: "An AI Agent can turn source material into durable knowledge when it keeps citations.",
            citedExcerpts: []
          })
        };
      }
    }
  }
);

assert.equal(askWithoutExplicitCitation.grounded, false, "an answer with no explicit citation must fail closed");
assert.deepEqual(askWithoutExplicitCitation.citations, [], "askGrounded must not attach every excerpt as a fallback");
assert.equal(
  askWithoutExplicitCitation.answer,
  "库内暂无足够依据回答这个问题。",
  "citation rejection should use the final-user Chinese message"
);

const askWithUnsupportedCitedAnswer = await askGrounded(
  {
    post: deterministic.cards[0],
    registry: deterministic.sourceRegistry,
    question: "What is the Moon made of?"
  },
  {
    contentLanguage: "en",
    client: {
      async complete() {
        return {
          content: JSON.stringify({
            answer: "The Moon is made of cheese and cures every disease.",
            citedExcerpts: [1]
          })
        };
      }
    }
  }
);

assert.equal(
  askWithUnsupportedCitedAnswer.grounded,
  false,
  "a valid excerpt index must not ground an answer unsupported by that excerpt"
);
assert.deepEqual(askWithUnsupportedCitedAnswer.citations, [], "unsupported cited answers should expose no citations");

const askWithTwoAnchorHallucination = await askGrounded(
  {
    post: deterministic.cards[0],
    registry: deterministic.sourceRegistry,
    question: "What does the source material guarantee?"
  },
  {
    contentLanguage: "en",
    client: {
      async complete() {
        return {
          content: JSON.stringify({
            answer: "Source material guarantees immortality and cancer cures.",
            citedExcerpts: [1]
          })
        };
      }
    }
  }
);

assert.equal(
  askWithTwoAnchorHallucination.grounded,
  false,
  "two retrieval anchors must not ground an unsupported ask answer"
);
assert.deepEqual(
  askWithTwoAnchorHallucination.citations,
  [],
  "a rejected two-anchor ask hallucination must expose no citations"
);

const askWithHighCopyHallucination = await askGrounded(
  {
    post: deterministic.cards[0],
    registry: deterministic.sourceRegistry,
    question: "Can copied evidence support an extra claim?"
  },
  {
    contentLanguage: "en",
    client: {
      async complete() {
        return {
          content: JSON.stringify({
            answer:
              "An AI Agent can turn source material into durable knowledge when it keeps citations guaranteeing immortality.",
            citedExcerpts: [1]
          })
        };
      }
    }
  }
);

assert.equal(
  askWithHighCopyHallucination.grounded,
  false,
  "a high-copy ask answer with an unsupported tail must fail closed"
);

const askWithInvalidStructure = await askGrounded(
  {
    post: deterministic.cards[0],
    registry: deterministic.sourceRegistry,
    question: "What if the response is not JSON?"
  },
  {
    contentLanguage: "en",
    client: {
      async complete() {
        return { content: "The model returned unstructured prose without citations." };
      }
    }
  }
);

assert.equal(askWithInvalidStructure.grounded, false, "an unparsable model answer must fail closed");
assert.deepEqual(askWithInvalidStructure.citations, [], "an unparsable model answer must expose no citations");
assert.equal(
  askWithInvalidStructure.answer,
  "There is not enough evidence in your library to answer this question.",
  "citation rejection should use the final-user English message"
);

let emptyEvidenceModelCalls = 0;
const askWithNoEvidence = await askGrounded(
  {
    post: deterministic.cards[0],
    registry: { ...deterministic.sourceRegistry, chunks: [], chunkVersions: [] },
    question: "Can an empty library answer?"
  },
  {
    contentLanguage: "en",
    client: {
      async complete() {
        emptyEvidenceModelCalls += 1;
        return { content: JSON.stringify({ answer: "guess", citedExcerpts: [1] }) };
      }
    }
  }
);

assert.equal(emptyEvidenceModelCalls, 0, "askGrounded should not call a model when no evidence exists");
assert.equal(askWithNoEvidence.grounded, false, "empty evidence must fail closed");
assert.deepEqual(askWithNoEvidence.citations, [], "empty evidence must return no citations");

// 7) askGrounded: no client falls back to a deterministic grounded answer.
const askDeterministic = await askGrounded({
  post: deterministic.cards[0],
  registry: deterministic.sourceRegistry,
  question: "What should an AI agent do with a source?"
});

assert.equal(askDeterministic.runnerKind, "deterministic", "askGrounded without a client should use the deterministic path");
assert.ok(askDeterministic.answer.length > 0, "deterministic ask should produce an answer");
assert.ok(askDeterministic.citations.length >= 1, "deterministic ask should cite the source chunk");

// 8) Command model client: a stub CLI reads the prompt on stdin, and its stdout becomes the card.
//    The stub exits non-zero on an empty prompt, so a ready import also proves stdin was wired.
const commandSentinel = "[beyond source] Command-runner hook proves the CLI stdout reached the card";
const commandModelPost = { ...deterministic.cards[0], hook: commandSentinel };
const commandFixtureDir = mkdtempSync(join(tmpdir(), "aitimeline-command-model-"));
const commandResponsePath = join(commandFixtureDir, "response.json");

writeFileSync(commandResponsePath, JSON.stringify({ posts: [commandModelPost] }), "utf8");

const fakeModelCliPath = fileURLToPath(new URL("./fixtures/fake-model-cli.mjs", import.meta.url));
const commandRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 0,
  client: createCommandModelClient({
    command: `node ${JSON.stringify(fakeModelCliPath)} ${JSON.stringify(commandResponsePath)}`,
    timeoutMs: 30000
  })
});
const commandModel = await transformArticleUrl(articleUrl, {
  fetch: fetchArticleHtml,
  createdAt,
  runner: commandRunner
});

assert.equal(commandModel.harnessRun?.runnerKind, "model", "a command runner should run the model path");
assert.equal(commandModel.importRecord.status, "ready", "command output should pass schema + grounding and be ready");
assert.equal(commandModel.cards.length, 1, "command import should accept the single grounded post");
assert.equal(commandModel.cards[0].hook, commandSentinel, "the card hook should come from the command stdout");
assert.ok(
  commandModel.validation.every((result) => result.valid),
  "command output should pass validation with no errors"
);

const failingCommandRunner = createModelKnowledgePostRunner({
  maxRepairAttempts: 0,
  client: createCommandModelClient({
    command: `node ${JSON.stringify(fakeModelCliPath)} --fail`,
    timeoutMs: 30000
  })
});
const commandFailure = await transformArticleUrl(articleUrl, {
  fetch: fetchArticleHtml,
  createdAt,
  runner: failingCommandRunner
});

assert.equal(commandFailure.importRecord.status, "failed", "a non-zero command exit should fail the import closed");
assert.equal(commandFailure.cards.length, 0, "a failed command should publish no cards");
assert.match(
  commandFailure.importRecord.errorMessage ?? "",
  /model command exited with code 1/,
  "the import error should name the command exit code"
);
assert.match(
  commandFailure.importRecord.errorMessage ?? "",
  /refused this prompt on purpose/,
  "the import error should carry the command stderr excerpt"
);

const commandFailureFallback = await transformArticleUrl(articleUrl, { fetch: fetchArticleHtml, createdAt });

assert.equal(
  commandFailureFallback.importRecord.status,
  "ready",
  "a broken command must not break the deterministic fallback path"
);
assert.ok(commandFailureFallback.cards.length > 0, "the deterministic fallback should still produce cards");
assert.notEqual(
  commandFailureFallback.cards[0].hook,
  commandSentinel,
  "the deterministic fallback should keep the template hook, not the command sentinel"
);

rmSync(commandFixtureDir, { recursive: true, force: true });

console.log("Model import smoke passed");

function toEnglishUserFacingPost(post) {
  return {
    ...post,
    title: post.title,
    hook: post.summary,
    thesis: post.thesis,
    shortBody: post.shortBody,
    summary: post.summary,
    keyTakeaway: post.keyTakeaway,
    recommendedBecause: "[beyond source] Smoke test selected this English card to prove the language gate repairs it.",
    thread: post.thread.map((block) => ({
      ...block,
      body: post.summary
    })),
    reviewPrompts: post.reviewPrompts.map((prompt) => ({
      ...prompt,
      prompt: "[beyond source] How do citations and concepts help an AI Agent create durable knowledge?"
    }))
  };
}

function toChineseUserFacingPost(post, groundedChineseSentence) {
  return {
    ...post,
    title: "AI Agent 会把导入材料整理成可以长期复习的知识",
    hook: groundedChineseSentence,
    thesis: groundedChineseSentence,
    shortBody: groundedChineseSentence,
    summary: groundedChineseSentence,
    keyTakeaway: groundedChineseSentence,
    recommendedBecause: "[超出来源] 这次 smoke 用来确认英文模型输出会被中文语言门禁修复。",
    thread: post.thread.map((block) => ({
      ...block,
      body: `[超出来源] ${groundedChineseSentence} 这道学习活动用于复习。`
    })),
    graphEdges: post.graphEdges.map((edge) => ({ ...edge, evidence: groundedChineseSentence })),
    reviewPrompts: post.reviewPrompts.map((prompt, index) => ({
      ...prompt,
      prompt:
        index === 0
          ? "[超出来源] 请说明 AI Agent 为什么要保留 citations 与 concepts？"
          : "[超出来源] 请判断 AI Agent 知识卡怎样保留 citations 与 concepts？",
      answerHint: groundedChineseSentence
    }))
  };
}
