import assert from "node:assert/strict";

const { transformArticleUrl } = await import("../packages/core/dist/transform/articleImport.js");
const { transformYouTubeUrl } = await import("../packages/core/dist/transform/youtubeImport.js");
const { agentHarnessSystemPrompt } = await import("../packages/core/dist/harness/systemPrompt.js");
const { createModelKnowledgePostRunner } = await import("../packages/core/dist/harness/modelRunner.js");
const { askGrounded, askSystemPrompt } = await import("../packages/core/dist/harness/askGrounded.js");
const { followupHarnessSystemPrompt } = await import("../packages/core/dist/harness/followupHarness.js");

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
const sentinelHook = "Model-written hook proves the LLM output reached the card";
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

// 3) Prove the two paths actually diverge: the deterministic card never carries the model sentinel.
assert.notEqual(
  deterministic.cards[0].hook,
  sentinelHook,
  "the deterministic path should keep the template hook, not the model sentinel"
);

// 4) The same runner option threads through the YouTube transform path.
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

// 5) askGrounded: a model client answers grounded in the post's cited source chunks.
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
            answer: "An AI agent should extract claims and keep citations.",
            citedExcerpts: [1]
          })
        };
      }
    }
  }
);

assert.equal(askCalls, 1, "askGrounded should call the model client once");
assert.equal(askModelResult.runnerKind, "model", "askGrounded with a client should use the model path");
assert.ok(askModelResult.answer.includes("extract claims"), "ask answer should come from the model output");
assert.ok(askModelResult.citations.length >= 1, "ask should resolve at least one grounded citation");
assert.equal(askModelResult.grounded, true, "an answer citing an excerpt should be grounded");

// 6) askGrounded: no client falls back to a deterministic grounded answer.
const askDeterministic = await askGrounded({
  post: deterministic.cards[0],
  registry: deterministic.sourceRegistry,
  question: "What should an AI agent do with a source?"
});

assert.equal(askDeterministic.runnerKind, "deterministic", "askGrounded without a client should use the deterministic path");
assert.ok(askDeterministic.answer.length > 0, "deterministic ask should produce an answer");
assert.ok(askDeterministic.citations.length >= 1, "deterministic ask should cite the source chunk");

console.log("Model import smoke passed");
