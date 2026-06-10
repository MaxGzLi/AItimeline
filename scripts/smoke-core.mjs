import assert from "node:assert/strict";

const { createModelKnowledgePostRunner } = await import("../packages/core/dist/harness/modelRunner.js");
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

console.log(
  JSON.stringify(
    {
      status: result.harnessRun.status,
      cards: result.cards.length,
      snapshots: result.sourceRegistry.snapshots.length,
      chunks: result.sourceRegistry.chunks.length,
      modelRunnerRepairCalls: repairCalls,
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
