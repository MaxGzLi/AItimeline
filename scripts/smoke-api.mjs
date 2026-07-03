import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiServer, listen } from "../apps/api/src/server.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "aitimeline-api-"));
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
  enableFixtures: true,
  searchProvider: fakeSearchProvider
});
const address = await listen(server, 0);
const baseUrl = `http://${address.address}:${address.port}`;
discoveryBaseUrl = baseUrl;

try {
  const health = await requestJson("/health");

  assert.equal(health.ok, true, "API health check should pass");

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

  const followupRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:00:00.000Z",
      kinds: ["generate_followup"]
    }
  });

  assert.ok(followupRun.records.length > 0, "curation run should process follow-up jobs");
  assert.ok(
    followupRun.records.some(
      (record) =>
        record.status === "succeeded" &&
        record.result?.sourceImport?.importRecord.status === "ready" &&
        record.result?.followupProtocol
    ),
    "follow-up run should produce a grounded source import and protocol"
  );

  const snapshot = await requestJson("/api/snapshot");

  assert.ok(snapshot.sourceImports.length >= 3, "snapshot should include direct, background, and follow-up imports");
  assert.ok(snapshot.posts.length >= importResult.posts.length, "snapshot should persist posts");
  assert.ok(snapshot.curationJobs.length >= signalResult.records.length, "snapshot should persist curation records");
  assert.equal(snapshot.userMemories.length, 1, "snapshot should persist user memory");
  assert.equal(snapshot.interactionSignals.length, 1, "snapshot should persist interaction signals");
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
      (record) => record.intakeKind === "agent_discovery" && record.candidate.reason.startsWith("Discovered")
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
