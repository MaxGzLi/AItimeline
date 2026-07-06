import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiServer, listen } from "../apps/api/src/server.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "aitimeline-api-"));
const mediaRootDir = join(tempDir, "media");
await mkdir(join(mediaRootDir, "smoke-source"), { recursive: true });
await writeFile(join(mediaRootDir, "smoke-source", "1.png"), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

let discoveryBaseUrl = "";
const fakeSearchProvider = {
  id: "smoke",
  async search(query) {
    return [
      {
        url: `${discoveryBaseUrl}/fixtures/article-background?query=${encodeURIComponent(query)}`,
        title: `Background source for ${query}`,
        snippet:
          "A discovered background source that prepares related knowledge with citations, concepts and review hooks."
      }
    ];
  }
};
const server = createApiServer({
  dataPath: join(tempDir, "aitimeline.json"),
  curationDataPath: join(tempDir, "curation-jobs.json"),
  mediaRootDir,
  enableFixtures: true,
  searchProvider: fakeSearchProvider
});
const address = await listen(server, 0);
const baseUrl = `http://${address.address}:${address.port}`;
discoveryBaseUrl = baseUrl;

try {
  const health = await requestJson("/health");

  assert.equal(health.ok, true, "API health check should pass");

  const mediaResponse = await fetch(`${baseUrl}/media/smoke-source/1.png`);
  const mediaBytes = new Uint8Array(await mediaResponse.arrayBuffer());

  assert.equal(mediaResponse.status, 200, "media route should serve files from the configured media root");
  assert.equal(mediaResponse.headers.get("content-type"), "image/png", "media route should set image content-type");
  assert.equal(mediaBytes.byteLength, 8, "media route should return the written image bytes");

  const traversalResponse = await fetch(`${baseUrl}/media/smoke-source/%2e%2e/aitimeline.json`);
  const plainTraversalResponse = await fetch(`${baseUrl}/media/../aitimeline.json`);

  assert.notEqual(traversalResponse.status, 200, "media route must reject path traversal");
  assert.notEqual(plainTraversalResponse.status, 200, "media route must not serve normalized traversal paths");

  const importResult = await requestJson("/api/import/article", {
    method: "POST",
    body: {
      url: `${baseUrl}/fixtures/article`,
      createdAt: "2026-06-10T00:00:00.000Z",
      recommendedBecause: "Smoke imported this article through the API."
    }
  });

  assert.equal(importResult.importRecord.status, "ready", "article API import should be ready");
  assert.ok(importResult.posts.length > 0, "article API import should create posts");
  assert.equal(importResult.releasePlan.immediatePostIds.length, importResult.posts.length, "new posts should be ready");

  const timeline = await requestJson("/api/timeline?now=2026-06-10T00:00:00.000Z");

  assert.ok(timeline.posts.length > 0, "timeline API should expose imported posts");
  assert.equal(typeof timeline.posts[0].score, "number", "timeline API should rank posts");
  assert.ok(Array.isArray(timeline.posts[0].scoreReasons), "timeline API should explain ranking scores");

  const firstPost = timeline.posts[0];
  const evidenceResult = await requestJson(`/api/evidence/${encodeURIComponent(firstPost.id)}`);

  assert.equal(evidenceResult.ledger.postId, firstPost.id, "evidence API should return the requested post ledger");
  assert.ok(evidenceResult.ledger.summary.totalClaims > 0, "evidence API should expose grounded claims");
  assert.ok(evidenceResult.ledger.claims[0].evidence.length > 0, "evidence API should resolve source chunks");

  const askResult = await requestJson("/api/ask", {
    method: "POST",
    body: { postId: importResult.posts[0].id, question: "What is the main point of this source?" }
  });

  // No model env in the smoke run, so /api/ask uses the deterministic grounded answer.
  assert.equal(askResult.runnerKind, "deterministic", "ask API should fall back to the deterministic answer without a model");
  assert.ok(typeof askResult.answer === "string" && askResult.answer.length > 0, "ask API should return an answer");
  assert.ok(askResult.citations.length > 0, "ask API should resolve grounded citations from the source registry");
  assert.equal(askResult.grounded, true, "ask API answer should be grounded in source chunks");

  const firstTopic = firstPost.concepts[0] ?? "agentic-learning";
  const memoryResult = await requestJson("/api/memory", {
    method: "POST",
    body: {
      userId: "smoke-user",
      edits: [
        { kind: "add", field: "profile.interests", value: "AI Agents" },
        { kind: "add", field: "knowledge.savedConcepts", value: firstTopic },
        { kind: "set", field: "profile.explanationStyle", value: "example-first" }
      ]
    }
  });

  assert.deepEqual(memoryResult.memory.profile.interests, ["AI Agents"], "memory API should add interests");
  assert.equal(memoryResult.memory.profile.explanationStyle, "example-first", "memory API should set style");

  const candidateResult = await requestJson("/api/source-candidates", {
    method: "POST",
    body: {
      url: `${baseUrl}/fixtures/article-background`,
      title: "Background curation can prepare related sources",
      intakeKind: "agent_discovery",
      topicId: firstTopic,
      conceptIds: firstPost.concepts,
      relevanceScore: 0.94,
      noveltyScore: 0.72,
      qualityScore: 0.88,
      reason: "The user liked a related post and opened the thread.",
      discoveredAt: "2026-06-10T00:00:00.000Z"
    }
  });

  assert.equal(candidateResult.record.status, "pending", "source candidate should enter pending inbox");

  const candidateInbox = await requestJson("/api/source-candidates?status=pending");

  assert.equal(candidateInbox.records.length, 1, "candidate inbox should expose pending source candidates");

  const signalResult = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T00:00:00.000Z",
      topicState: {
        topicId: firstTopic,
        interestScore: 0.82,
        fatigueScore: 0.12,
        comprehensionScore: 0.72
      },
      signal: {
        postId: firstPost.id,
        topicId: firstTopic,
        conceptIds: firstPost.concepts,
        impression: true,
        dwellTimeMs: 18000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: false,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-06-10T00:00:00.000Z"
      }
    }
  });

  assert.ok(signalResult.records.length > 0, "signal API should enqueue curation jobs");
  assert.equal(signalResult.topicState.topicId, firstTopic, "signal API should persist next topic state");
  assert.equal(typeof signalResult.topicState.interestScore, "number", "topic state should include interest score");
  assert.ok(
    signalResult.records.some((record) => record.job.kind === "import_source"),
    "strong interest with source candidates should enqueue source import"
  );

  const personalizedTimeline = await requestJson(
    "/api/timeline?userId=smoke-user&now=2026-06-10T00:00:00.000Z"
  );

  assert.ok(personalizedTimeline.posts[0].scoreReasons.length > 0, "personalized timeline should explain top rank");
  assert.ok(personalizedTimeline.recommendationSummary.total > 0, "timeline should summarize recommendation mix");

  const curationRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:00:00.000Z",
      kinds: ["import_source"]
    }
  });

  assert.ok(curationRun.records.length > 0, "curation run should process due jobs");
  assert.ok(
    curationRun.records.some((record) => record.status === "succeeded" && record.result?.sourceImport),
    "curation run should import a background source"
  );

  const beforeFollowupSnapshot = await requestJson("/api/snapshot");
  const followupRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:00:00.000Z",
      kinds: ["generate_followup"]
    }
  });

  assert.ok(followupRun.records.length > 0, "curation run should process follow-up jobs");
  const followupRecord = followupRun.records.find(
    (record) =>
      record.status === "succeeded" &&
      record.result?.sourceImport?.importRecord.status === "ready" &&
      record.result?.followupProtocol
  );

  assert.ok(followupRecord, "follow-up run should produce a grounded source import and protocol");
  assert.ok(
    followupRecord.result.sourceImport.posts.length > 0,
    "the first follow-up for a seed post should persist its card"
  );

  // 第二轮:同一种子再触发一次跟进,产物与第一轮同题,必须被去重跳过。
  const afterFirstFollowupSnapshot = await requestJson("/api/snapshot");

  await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T01:00:00.000Z",
      topicState: {
        topicId: firstTopic,
        interestScore: 0.82,
        fatigueScore: 0.12,
        comprehensionScore: 0.72
      },
      signal: {
        postId: firstPost.id,
        topicId: firstTopic,
        conceptIds: firstPost.concepts,
        impression: true,
        dwellTimeMs: 18000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: false,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-06-10T01:00:00.000Z"
      }
    }
  });

  const repeatFollowupRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T01:00:00.000Z",
      kinds: ["generate_followup"]
    }
  });
  const repeatFollowupRecord = repeatFollowupRun.records.find(
    (record) => record.status === "succeeded" && record.result?.sourceImport
  );

  assert.ok(repeatFollowupRecord, "repeat follow-up run should still process the job");
  assert.deepEqual(
    repeatFollowupRecord.result.sourceImport.posts,
    [],
    "duplicate-titled follow-up posts should be skipped before persistence"
  );

  const snapshot = await requestJson("/api/snapshot");

  assert.ok(snapshot.sourceImports.length >= 3, "snapshot should include direct, background, and follow-up imports");
  assert.equal(
    snapshot.posts.length,
    afterFirstFollowupSnapshot.posts.length,
    "duplicate-titled follow-up posts should not increase the persisted post count"
  );
  assert.ok(
    snapshot.posts.length > beforeFollowupSnapshot.posts.length,
    "the first follow-up card should have increased the post count"
  );
  assert.ok(snapshot.posts.length >= importResult.posts.length, "snapshot should persist posts");
  assert.ok(snapshot.curationJobs.length >= signalResult.records.length, "snapshot should persist curation records");
  assert.equal(snapshot.userMemories.length, 1, "snapshot should persist user memory");
  assert.equal(snapshot.interactionSignals.length, 2, "snapshot should persist both interaction signals");
  assert.equal(snapshot.topicStates.length, 1, "snapshot should persist topic states");
  assert.equal(snapshot.sourceCandidates.length, 1, "snapshot should persist source candidates");
  assert.equal(snapshot.sourceCandidates[0].status, "imported", "imported source candidate should be marked imported");

  // --- Background source discovery: interest without candidates -> discover job -> pending inbox ---
  const secondPost = importResult.posts.find((post) => post.id !== firstPost.id) ?? firstPost;
  const secondTopic = secondPost.concepts[0] ?? "agentic-learning";
  const discoverySignal = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T01:00:00.000Z",
      signal: {
        postId: secondPost.id,
        topicId: secondTopic,
        conceptIds: secondPost.concepts,
        impression: true,
        dwellTimeMs: 16000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: false,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-06-10T01:00:00.000Z"
      }
    }
  });

  assert.ok(
    discoverySignal.records.some((record) => record.job.kind === "discover_sources"),
    "strong interest without matching candidates should enqueue source discovery"
  );

  const discoveryRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T02:00:00.000Z",
      kinds: ["discover_sources"]
    }
  });

  assert.ok(
    discoveryRun.records.some(
      (record) => record.status === "succeeded" && record.result?.discoveredSourceCandidates?.length
    ),
    "discovery jobs should return candidates from the configured search provider"
  );

  const discoveredInbox = await requestJson("/api/source-candidates?status=pending");

  assert.ok(
    discoveredInbox.records.some(
      (record) => record.intakeKind === "agent_discovery" && record.candidate.reason.startsWith("为")
    ),
    "discovered candidates should land in the pending inbox"
  );

  // --- Agent entry: grounded turn, dark turn with inline discovery, metering ---
  const agentGrounded = await requestJson("/api/agent/ask", {
    method: "POST",
    body: { question: `Tell me more about ${firstTopic}` }
  });

  assert.equal(agentGrounded.turn.intent, "grounded_qa", "library-covered questions should get grounded answers");
  assert.equal(agentGrounded.turn.answer.grounded, true, "agent answers should be grounded");
  assert.ok(agentGrounded.turn.answer.citations.length > 0, "agent answers should cite source chunks");
  assert.notEqual(agentGrounded.turn.zone, "dark", "matched concepts should place the turn on the boundary");
  assert.equal(agentGrounded.turnRecord.tier, "free", "deterministic turns should meter as free");

  const agentDark = await requestJson("/api/agent/ask", {
    method: "POST",
    body: { question: "What is quantum chromodynamics?" }
  });

  assert.equal(agentDark.turn.zone, "dark", "out-of-library questions should be dark");
  assert.equal(agentDark.turn.intent, "discovery_proposal", "dark turns should propose discovery, not answer");
  assert.equal(agentDark.turn.answer, null, "the agent must not answer dark questions from model memory");
  assert.ok(
    agentDark.discoveredCandidates.length > 0,
    "dark turns should trigger inline discovery when a provider is configured"
  );
  assert.equal(agentDark.snapshotSummary.agentTurns, 2, "agent turns should be metered in the snapshot");

  // --- Notes: user posts become self-grounded posts and get an observer reply ---
  const noteResult = await requestJson("/api/notes", {
    method: "POST",
    body: {
      text: `My note: ${firstTopic} quality depends on retrieval quality.`,
      createdAt: "2026-06-10T01:00:00.000Z"
    }
  });

  assert.equal(noteResult.post.sources[0].type, "user_note", "notes should persist as user_note sources");
  assert.equal(noteResult.post.thread[0].kind, "agent_reply", "the observer reply on a note should be an agent_reply block");
  assert.ok(noteResult.post.citations.length > 0, "note posts should cite their own registry chunk");
  assert.equal(noteResult.turn.intent, "grounded_qa", "notes touching library concepts should get grounded replies");
  assert.ok(noteResult.turn.answer.citations.length > 0, "observer replies to notes should cite source chunks");
  assert.equal(noteResult.snapshotSummary.agentTurns, 3, "note replies should be metered as agent turns");

  const noteTimeline = await requestJson("/api/timeline?now=2026-06-11T00:00:00.000Z");
  const timelineNotePost = noteTimeline.posts.find((post) => post.id === noteResult.post.id);

  assert.ok(timelineNotePost, "the note should appear in the timeline immediately");
  assert.ok(timelineNotePost.thread.length > 0, "the observer reply should persist on the note's thread");

  const finalSnapshot = await requestJson("/api/snapshot");
  const localUserMemory = finalSnapshot.userMemories.find((record) => record.userId === "local-user");

  assert.equal(
    localUserMemory?.memory.interaction.recentQuestions.length,
    3,
    "agent questions and notes should accumulate into user memory"
  );

  // --- Inline replies: commenting on a card appends a public in-post thread ---
  const replyResult = await requestJson(`/api/posts/${encodeURIComponent(firstPost.id)}/replies`, {
    method: "POST",
    body: {
      text: `How does ${firstTopic} keep its citations grounded?`,
      createdAt: "2026-06-10T03:00:00.000Z"
    }
  });

  const replyKinds = replyResult.post.thread.map((block) => block.kind);

  assert.ok(replyKinds.includes("user_comment"), "a reply should append the user's comment block");
  assert.ok(replyKinds.includes("agent_reply"), "a reply should append the observer's reply block");
  assert.equal(replyResult.turn.intent, "grounded_qa", "replies target the card and answer grounded");
  assert.ok(replyResult.turn.answer.citations.length > 0, "observer replies to comments should cite source chunks");
  assert.equal(replyResult.snapshotSummary.agentTurns, 4, "comment replies should be metered as agent turns");

  const replyTimeline = await requestJson("/api/timeline?now=2026-06-11T00:00:00.000Z");
  const replyTimelinePost = replyTimeline.posts.find((post) => post.id === firstPost.id);
  const persistedCommentBlocks = replyTimelinePost.thread.filter(
    (block) => block.kind === "user_comment" || block.kind === "agent_reply"
  );

  assert.equal(persistedCommentBlocks.length, 2, "the comment and observer reply should persist on the card thread after reload");

  const missingReply = await fetch(`${baseUrl}/api/posts/does-not-exist/replies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "hi" })
  });

  assert.equal(missingReply.status, 404, "replying to a missing post should 404");

  // --- On-demand discovery from the reply chip (/api/discovery/run) ---
  const candidatesBefore = (await requestJson("/api/snapshot")).sourceCandidates.length;
  const chipDiscovery = await requestJson("/api/discovery/run", {
    method: "POST",
    body: { queries: ["向量数据库该怎么选?"], concepts: [] }
  });

  assert.equal(chipDiscovery.configured, true, "discovery/run should report the provider as configured");
  assert.ok(chipDiscovery.candidates.length > 0, "discovery/run should return candidates from the provider");

  const candidatesAfter = (await requestJson("/api/snapshot")).sourceCandidates.length;

  assert.ok(candidatesAfter > candidatesBefore, "discovery/run should persist the discovered candidates");

  const emptyDiscovery = await fetch(`${baseUrl}/api/discovery/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: [], concepts: [] })
  });

  assert.equal(emptyDiscovery.status, 400, "discovery/run without queries or concepts should 400");

  if (!process.env.AITIMELINE_SEARCH_API_KEY) {
    // A server without a provider reports the unconfigured state instead of erroring.
    const bareServer = createApiServer({
      dataPath: join(tempDir, "bare.json"),
      curationDataPath: join(tempDir, "bare-jobs.json")
    });
    const bareAddress = await listen(bareServer, 0);

    try {
      const bareResponse = await fetch(`http://${bareAddress.address}:${bareAddress.port}/api/discovery/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: ["anything"], concepts: [] })
      });
      const barePayload = await bareResponse.json();

      assert.equal(bareResponse.status, 200, "unconfigured discovery/run should still respond 200");
      assert.equal(barePayload.configured, false, "unconfigured discovery/run should report configured=false");
      assert.deepEqual(barePayload.candidates, [], "unconfigured discovery/run should return no candidates");
    } finally {
      await new Promise((resolveClose, rejectClose) => {
        bareServer.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }

  console.log("API smoke passed");
} finally {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  await rm(tempDir, { recursive: true, force: true });
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();

  assert.equal(response.ok, true, `${options.method ?? "GET"} ${path} failed: ${JSON.stringify(payload)}`);

  return payload;
}
