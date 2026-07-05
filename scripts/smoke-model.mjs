import assert from "node:assert/strict";

const { transformArticleUrl } = await import("../packages/core/dist/transform/articleImport.js");
const { transformYouTubeUrl } = await import("../packages/core/dist/transform/youtubeImport.js");
const { agentHarnessSystemPrompt } = await import("../packages/core/dist/harness/systemPrompt.js");
const { createModelKnowledgePostRunner } = await import("../packages/core/dist/harness/modelRunner.js");
const { calculateCjkRatio } = await import("../packages/core/dist/harness/contentLanguage.js");
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

// 4) The language gate is opt-in: English model output repairs when enabled, and passes when disabled.
const englishModelPost = toEnglishUserFacingPost(deterministic.cards[0]);
const zhModelPost = toChineseUserFacingPost(deterministic.cards[0]);
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
  chunks: deterministic.chunks,
  sourceRegistry: deterministic.sourceRegistry,
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

// 7) askGrounded: no client falls back to a deterministic grounded answer.
const askDeterministic = await askGrounded({
  post: deterministic.cards[0],
  registry: deterministic.sourceRegistry,
  question: "What should an AI agent do with a source?"
});

assert.equal(askDeterministic.runnerKind, "deterministic", "askGrounded without a client should use the deterministic path");
assert.ok(askDeterministic.answer.length > 0, "deterministic ask should produce an answer");
assert.ok(askDeterministic.citations.length >= 1, "deterministic ask should cite the source chunk");

console.log("Model import smoke passed");

function toEnglishUserFacingPost(post) {
  return {
    ...post,
    title: "AI Agent turns source material into durable knowledge",
    hook: "AI Agent keeps citations, extracts concepts, and builds a learning surface.",
    thesis: "An AI Agent can turn source material into durable knowledge when it keeps citations and extracts concepts.",
    shortBody:
      "An AI Agent keeps citations, extracts concepts, and builds a learning surface the reader can revisit later.",
    summary:
      "An AI Agent turns source material into durable knowledge by keeping citations, extracting concepts, and building a learning surface.",
    keyTakeaway:
      "The key lesson is that AI Agent work becomes durable knowledge through citations, concepts, and a learning surface.",
    recommendedBecause: "Smoke test selected this English card to prove the language gate repairs it.",
    thread: post.thread.map((block) => ({
      ...block,
      body:
        "AI Agent output becomes durable knowledge when it keeps citations, extracts concepts, and gives the reader a learning surface to revisit."
    })),
    reviewPrompts: post.reviewPrompts.map((prompt) => ({
      ...prompt,
      prompt: "How do citations and concepts help an AI Agent create durable knowledge?"
    }))
  };
}

function toChineseUserFacingPost(post) {
  return {
    ...post,
    title: "AI Agent 把来源变成知识卡",
    hook: "这张卡要用中文重写：AI Agent 不是照抄原文，而是保留 citations、抽取 concepts，让读者之后能复习。",
    thesis: "来源的核心是：AI Agent 通过 citations 和 concepts，把材料整理成之后可回看的知识。",
    shortBody:
      "这段内容说明，AI Agent 需要保留 citations、抽取 concepts，并把来源材料变成读者以后还能回来的学习表面。",
    summary: "来源说，AI Agent 会保留 citations、抽取 concepts，并建立可回看的知识表面。",
    keyTakeaway: "要点是把 AI Agent 的输出做成可复习知识：保留 citations、抽取 concepts，而不是只做摘要。",
    recommendedBecause: "这次 smoke 用来确认英文模型输出会被中文语言门禁修复。",
    thread: post.thread.map((block, index) => ({
      ...block,
      body: [
        "用中文解释：AI Agent 先保留 citations，再抽取 concepts，所以来源不会变成一次性摘要。",
        "例子：读者导入文章后，AI Agent 生成带 citations 的卡片，并把 concepts 接到后续复习。",
        "对比来看，普通摘要只压缩文本；这张卡强调 citations、concepts 和可复习的知识结构。",
        "下一步可以追问：AI Agent 如何把 concepts 连到用户已有的知识图谱。",
        "快速复习：请说出 citations 和 concepts 为什么能让这条知识以后再次出现。"
      ][index] ?? "这条线程继续用中文说明 AI Agent 如何保留 citations 和 concepts。"
    })),
    reviewPrompts: post.reviewPrompts.map((prompt, index) => ({
      ...prompt,
      prompt:
        index === 0
          ? "请用自己的话说明：AI Agent 为什么要保留 citations，并从来源里抽取 concepts？"
          : "复习时怎么判断：AI Agent 生成的知识卡是否保留了 citations 和 concepts？"
    }))
  };
}
