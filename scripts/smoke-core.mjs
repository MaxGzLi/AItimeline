import assert from "node:assert/strict";

const { createModelKnowledgePostRunner } = await import("../packages/core/dist/harness/modelRunner.js");
const { createOpenAICompatibleModelClient, createOpenAICompatibleModelClientFromEnv } = await import(
  "../packages/core/dist/model/openaiCompatibleClient.js"
);
const { transformMockYouTubeUrl } = await import("../packages/core/dist/transform/mockYoutubeImport.js");

const result = transformMockYouTubeUrl(
  "https://www.youtube.com/watch?v=aitimeline-demo",
  "2026-06-10T00:00:00.000Z"
);

assert.equal(result.harnessRun.status, "succeeded", "harness run should succeed");
assert.equal(result.cards.length, 4, "mock import should produce four cards");
assert.equal(result.sourceRegistry.snapshots.length, 1, "transcript asset should produce one source snapshot");
assert.equal(result.sourceRegistry.chunks.length, 4, "mock transcript should produce four registered chunks");

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
