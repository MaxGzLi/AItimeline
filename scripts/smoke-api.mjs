import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiServer } from "../apps/api/src/server.mjs";

const previousContentLanguage = process.env.AITIMELINE_CONTENT_LANGUAGE;
process.env.AITIMELINE_CONTENT_LANGUAGE = "zh";

const tempDir = await mkdtemp(join(tmpdir(), "aitimeline-api-"));
const mediaRootDir = join(tempDir, "media");
const dataPath = join(tempDir, "aitimeline.json");
const curationDataPath = join(tempDir, "curation-jobs.json");
await mkdir(join(mediaRootDir, "smoke-source"), { recursive: true });
await writeFile(join(mediaRootDir, "smoke-source", "1.png"), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

let discoveryBaseUrl = "";
const baseUrl = "http://aitimeline-smoke.local";
const observedSearchQueries = [];
const fakeSearchProvider = {
  id: "smoke",
  async search(query) {
    observedSearchQueries.push(query);
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
  dataPath,
  curationDataPath,
  mediaRootDir,
  enableFixtures: true,
  searchProvider: fakeSearchProvider
});
discoveryBaseUrl = baseUrl;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = getFetchUrl(input);

  if (url === `${baseUrl}/fixtures/connection-note`) {
    return new Response(
      `
        <html>
          <head><meta property="og:title" content="Connection note smoke import" /></head>
          <body>
            <article>
              <p>Knowledge Graph evaluation evidence from the imported source connects Knowledge Graph and Evaluation for the learner.</p>
            </article>
          </body>
        </html>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    );
  }

  if (url.startsWith(baseUrl)) {
    return dispatchToServer(server, url, init);
  }

  return originalFetch(input, init);
};

try {
  const health = await requestJson("/health");

  assert.equal(health.ok, true, "API health check should pass");

  const initialSettings = await requestJson("/api/settings");

  assert.equal(initialSettings.contentLanguage, "zh", "settings API should default to Chinese");
  assert.deepEqual(initialSettings.userSettings, {}, "settings API should keep old snapshots compatible");

  const savedSettings = await requestJson("/api/settings", {
    method: "POST",
    body: { contentLanguage: "en" }
  });
  const settingsSnapshot = await requestJson("/api/snapshot");

  assert.equal(savedSettings.contentLanguage, "en", "settings API should accept English mode");
  assert.equal(savedSettings.userSettings.contentLanguage, "en", "settings API should return persisted user settings");
  assert.equal(
    settingsSnapshot.userSettings.contentLanguage,
    "en",
    "settings API should persist content language into the snapshot"
  );

  const settingsReloadedServer = createApiServer({
    dataPath,
    curationDataPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const settingsReloadedResponse = await dispatchToServer(settingsReloadedServer, `${baseUrl}/api/settings`);
    const settingsReloaded = await settingsReloadedResponse.json();

    assert.equal(settingsReloadedResponse.ok, true, "reloaded API server should read settings");
    assert.equal(settingsReloaded.contentLanguage, "en", "settings should survive server recreation");
    assert.equal(
      settingsReloaded.userSettings.contentLanguage,
      "en",
      "reloaded settings should expose persisted user language"
    );
  } finally {
    await closeServer(settingsReloadedServer);
  }

  const resetSettings = await requestJson("/api/settings", {
    method: "POST",
    body: { userSettings: { contentLanguage: "zh" } }
  });

  assert.equal(resetSettings.contentLanguage, "zh", "settings API should reset back to Chinese mode");

  const connectionDataPath = join(tempDir, "connection-note.json");
  const connectionCurationPath = join(tempDir, "connection-curation-jobs.json");
  const dismissedConnectionPost = makeApiSmokePost({
    id: "old-dismissed-kg-eval",
    title: "Old dismissed Knowledge Graph card",
    concepts: ["Knowledge Graph", "Evaluation"],
    createdAt: "2026-06-01T00:00:00.000Z"
  });
  const seededConnectionPosts = [
    dismissedConnectionPost,
    makeApiSmokePost({ id: "old-hub-rag", title: "Hub RAG", concepts: ["Memory", "RAG"] }),
    makeApiSmokePost({ id: "old-hub-rec", title: "Hub Recommendation", concepts: ["Memory", "Recommendation"] }),
    makeApiSmokePost({ id: "old-hub-notebook", title: "Hub NotebookLM", concepts: ["Memory", "NotebookLM"] }),
    makeApiSmokePost({ id: "old-hub-youtube", title: "Hub YouTube", concepts: ["Memory", "YouTube"] })
  ];

  await writeFile(
    connectionDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-06T00:00:00.000Z",
      posts: seededConnectionPosts,
      dismissedPosts: [
        {
          postId: dismissedConnectionPost.id,
          dismissedAt: "2026-07-05T00:00:00.000Z",
          mode: "soft"
        }
      ],
      userSettings: { contentLanguage: "zh" }
    })
  );

  const connectionServer = createApiServer({
    dataPath: connectionDataPath,
    curationDataPath: connectionCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const suggestion = await requestJsonFromServer(connectionServer, "/api/concept-merge-suggestions", {
      method: "POST",
      body: {
        left: "Speculative Decoding",
        right: "speculative decoding",
        leftExcerpt: "Speculative Decoding speeds inference.",
        rightExcerpt: "speculative decoding speeds inference too."
      }
    });

    assert.equal(suggestion.suggestion.status, "pending", "concept merge suggestion endpoint should persist pending suggestions");

    const resolvedSuggestion = await requestJsonFromServer(
      connectionServer,
      `/api/concept-merge-suggestions/${encodeURIComponent(suggestion.suggestion.id)}/resolve`,
      {
        method: "POST",
        body: {
          decision: "merge",
          canonical: "Speculative Decoding"
        }
      }
    );

    assert.equal(resolvedSuggestion.suggestion.status, "merged", "merge decision should resolve the suggestion");
    assert.ok(
      resolvedSuggestion.conceptAliases.some(
        (record) => record.canonical === "Speculative Decoding" && record.aliases.includes("speculative decoding")
      ),
      "merge decision should write a user concept alias"
    );

    const unmerged = await requestJsonFromServer(connectionServer, "/api/concept-aliases/unmerge", {
      method: "POST",
      body: {
        canonical: "Speculative Decoding",
        alias: "speculative decoding"
      }
    });

    assert.equal(unmerged.conceptAliases.length, 0, "unmerge endpoint should remove the selected alias");

    const separateSuggestion = await requestJsonFromServer(connectionServer, "/api/concept-merge-suggestions", {
      method: "POST",
      body: {
        left: "RAG",
        right: "RAG evaluation"
      }
    });
    await requestJsonFromServer(
      connectionServer,
      `/api/concept-merge-suggestions/${encodeURIComponent(separateSuggestion.suggestion.id)}/resolve`,
      {
        method: "POST",
        body: { decision: "separate" }
      }
    );
    const repeatedSeparate = await requestJsonFromServer(connectionServer, "/api/concept-merge-suggestions", {
      method: "POST",
      body: {
        left: "RAG",
        right: "RAG evaluation"
      }
    });

    assert.equal(repeatedSeparate.suggestion.status, "separate", "separated concept pairs should not be asked again");

    const connectionImport = await requestJsonFromServer(connectionServer, "/api/import/article", {
      method: "POST",
      body: {
        url: `${baseUrl}/fixtures/connection-note`,
        createdAt: "2026-07-06T00:00:00.000Z",
        recommendedBecause: "Smoke import should create a connection note."
      }
    });

    assert.equal(connectionImport.importRecord.status, "ready", "connection smoke import should be ready");

    const connectionSnapshot = await requestJsonFromServer(connectionServer, "/api/snapshot");
    const connectionNote = connectionSnapshot.posts.find((post) => post.kind === "connection_note");

    assert.ok(connectionNote, "import should persist a connection_note card into the snapshot");
    assert.equal(
      connectionNote.connectionNote.restorePostId,
      dismissedConnectionPost.id,
      "connection note should carry undismiss target data when waking a dismissed card"
    );
    assert.equal(
      connectionNote.connectionNote.oldPostId,
      dismissedConnectionPost.id,
      "connection note should reference the old card"
    );
    assert.ok(connectionNote.connectionNote.newPostId, "connection note should reference the new card");
    assert.ok(
      connectionNote.summary.includes(connectionNote.connectionNote.evidence),
      "connection note card text should include existing graph edge evidence"
    );
  } finally {
    await closeServer(connectionServer);
  }

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
  const dismissedPost = timeline.posts.find((post) => post.id !== firstPost.id);

  assert.ok(dismissedPost, "article smoke should have a second post for dismiss lifecycle coverage");

  const dismissResult = await requestJson(`/api/posts/${encodeURIComponent(dismissedPost.id)}/dismiss`, {
    method: "POST"
  });
  const repeatedDismissResult = await requestJson(`/api/posts/${encodeURIComponent(dismissedPost.id)}/dismiss`, {
    method: "POST"
  });

  assert.equal(dismissResult.dismissed, true, "dismiss endpoint should mark a post dismissed");
  assert.equal(repeatedDismissResult.dismissed, true, "dismiss endpoint should be idempotent");
  assert.equal(dismissResult.record.mode, "soft", "dismiss endpoint should default to soft mode");
  assert.equal(repeatedDismissResult.record.mode, "soft", "repeated default dismiss should remain soft");

  const dismissedList = await requestJson("/api/dismissed");
  const dismissedListRecord = dismissedList.records.find((record) => record.postId === dismissedPost.id);

  assert.ok(dismissedListRecord, "dismissed list endpoint should return the dismissed post");
  assert.equal(dismissedListRecord.title, dismissedPost.title, "dismissed list endpoint should include the post title");
  assert.equal(dismissedListRecord.mode, "soft", "dismissed list endpoint should expose soft mode");
  assert.equal(
    dismissedListRecord.dismissedAt,
    repeatedDismissResult.record.dismissedAt,
    "repeated dismiss should refresh the dismissedAt timestamp without duplicating the record"
  );

  const dismissedTimeline = await requestJson("/api/timeline?now=2026-06-10T00:00:00.000Z");

  assert.equal(
    dismissedTimeline.posts.some((post) => post.id === dismissedPost.id),
    false,
    "dismissed posts should leave the timeline"
  );

  const softReturnAt = new Date(repeatedDismissResult.record.dismissedAt);
  softReturnAt.setUTCDate(softReturnAt.getUTCDate() + 31);
  const expiredSoftTimeline = await requestJson(`/api/timeline?now=${encodeURIComponent(softReturnAt.toISOString())}`);

  assert.equal(
    expiredSoftTimeline.posts.some((post) => post.id === dismissedPost.id),
    true,
    "soft dismissed posts should return to the timeline after 30 days"
  );

  const reloadedServer = createApiServer({
    dataPath,
    curationDataPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const reloadedResponse = await dispatchToServer(
      reloadedServer,
      `${baseUrl}/api/timeline?now=2026-06-10T00:00:00.000Z`
    );
    const reloadedTimeline = await reloadedResponse.json();

    assert.equal(reloadedResponse.ok, true, "reloaded API server should read the persisted snapshot");
    assert.equal(
      reloadedTimeline.posts.some((post) => post.id === dismissedPost.id),
      false,
      "dismissed posts should stay dismissed after recreating the store"
    );
  } finally {
    await closeServer(reloadedServer);
  }

  const legacyDataPath = join(tempDir, "legacy-dismissed.json");
  const legacyCurationPath = join(tempDir, "legacy-curation-jobs.json");
  await writeFile(
    legacyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: [dismissedPost],
      dismissedPostIds: [dismissedPost.id],
      reviewStates: [
        {
          postId: dismissedPost.id,
          intervalDays: 1,
          dueAt: "2026-06-11T00:00:00.000Z"
        }
      ]
    })
  );
  const legacyServer = createApiServer({
    dataPath: legacyDataPath,
    curationDataPath: legacyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const legacySnapshotResponse = await dispatchToServer(legacyServer, `${baseUrl}/api/snapshot`);
    const legacySnapshot = await legacySnapshotResponse.json();
    const legacyTimelineResponse = await dispatchToServer(
      legacyServer,
      `${baseUrl}/api/timeline?now=2026-06-11T00:00:00.000Z`
    );
    const legacyTimeline = await legacyTimelineResponse.json();
    const legacyDueResponse = await dispatchToServer(
      legacyServer,
      `${baseUrl}/api/review/due?now=2026-06-11T00:00:00.000Z`
    );
    const legacyDue = await legacyDueResponse.json();

    assert.equal(legacySnapshotResponse.ok, true, "legacy dismissed snapshot should load");
    assert.deepEqual(
      legacySnapshot.dismissedPosts,
      [
        {
          postId: dismissedPost.id,
          dismissedAt: "2026-06-10T00:00:00.000Z",
          mode: "hard"
        }
      ],
      "legacy dismissedPostIds should migrate to hard dismissedPosts using snapshot updatedAt"
    );
    assert.equal(
      Object.hasOwn(legacySnapshot, "dismissedPostIds"),
      false,
      "loaded snapshots should expose only the new dismissedPosts field"
    );
    assert.equal(
      legacyTimeline.posts.some((post) => post.id === dismissedPost.id),
      false,
      "legacy hard dismissal should keep the post out of the timeline"
    );
    assert.equal(
      legacyDue.due.some((state) => state.postId === dismissedPost.id),
      false,
      "legacy hard dismissal should keep the post out of due review"
    );
  } finally {
    await closeServer(legacyServer);
  }

  const firstTopic = firstPost.concepts[0] ?? "agentic-learning";
  const reviewSeedSignal = {
    postId: firstPost.id,
    topicId: firstTopic,
    conceptIds: firstPost.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: false,
    saved: true,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-06-10T00:00:00.000Z"
  };
  const reviewSeedResult = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T00:00:00.000Z",
      signal: reviewSeedSignal
    }
  });

  assert.equal(reviewSeedResult.snapshotSummary.reviewStates, 1, "first save should create a review state");

  const reviewSnapshot = await requestJson("/api/snapshot");
  const firstReviewState = reviewSnapshot.reviewStates.find((state) => state.postId === firstPost.id);

  assert.ok(firstReviewState, "review state should persist in the snapshot");
  assert.equal(firstReviewState.intervalDays, 1, "initial review interval should be one day");
  assert.equal(firstReviewState.dueAt, "2026-06-11T00:00:00.000Z", "initial review dueAt should be signal time + one day");

  const softReviewDismiss = await requestJson(`/api/posts/${encodeURIComponent(firstPost.id)}/dismiss`, {
    method: "POST"
  });
  const softReviewTimeline = await requestJson("/api/timeline?now=2026-06-10T00:00:00.000Z");
  const softDueReview = await requestJson(`/api/review/due?now=${encodeURIComponent(firstReviewState.dueAt)}`);

  assert.equal(softReviewDismiss.record.mode, "soft", "review-card dismiss should default to soft");
  assert.equal(
    softReviewTimeline.posts.some((post) => post.id === firstPost.id),
    false,
    "soft dismissed review cards should leave the regular timeline"
  );
  assert.equal(
    softDueReview.due.some((state) => state.postId === firstPost.id),
    true,
    "soft dismissed review cards should stay in the due review endpoint"
  );

  const undismissResult = await requestJson(`/api/posts/${encodeURIComponent(firstPost.id)}/dismiss`, {
    method: "DELETE"
  });
  const restoredTimeline = await requestJson("/api/timeline?now=2026-06-10T00:00:00.000Z");

  assert.equal(undismissResult.restored, true, "undismiss endpoint should report a restored post");
  assert.equal(
    restoredTimeline.posts.some((post) => post.id === firstPost.id),
    true,
    "undismiss should restore the post to the timeline"
  );

  const hardReviewSeedSignal = {
    ...reviewSeedSignal,
    postId: dismissedPost.id,
    conceptIds: dismissedPost.concepts,
    createdAt: "2026-06-10T00:01:00.000Z"
  };
  const hardReviewSeedResult = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T00:01:00.000Z",
      signal: hardReviewSeedSignal
    }
  });
  const hardDismissResult = await requestJson(`/api/posts/${encodeURIComponent(dismissedPost.id)}/dismiss`, {
    method: "POST",
    body: { mode: "hard" }
  });
  const hardDueReview = await requestJson(`/api/review/due?now=${encodeURIComponent(firstReviewState.dueAt)}`);
  const hardDismissedList = await requestJson("/api/dismissed");
  const hardDismissedListRecord = hardDismissedList.records.find((record) => record.postId === dismissedPost.id);

  assert.equal(hardReviewSeedResult.snapshotSummary.reviewStates, 2, "second saved post should create a review state");
  assert.equal(hardDismissResult.record.mode, "hard", "dismiss endpoint should hard-dismiss when requested");
  assert.equal(
    hardDueReview.due.some((state) => state.postId === dismissedPost.id),
    false,
    "hard dismissed cards should be excluded from due review"
  );
  assert.equal(hardDismissedListRecord?.mode, "hard", "dismissed list should reflect hard dismissal upgrades");

  const topicSnapshotBeforePureExposure = await requestJson("/api/snapshot");
  const topicStateBeforePureExposure = topicSnapshotBeforePureExposure.topicStates.find((state) => state.topicId === firstTopic);
  const pureExposureResult = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T00:05:00.000Z",
      signal: {
        ...reviewSeedSignal,
        saved: false,
        createdAt: "2026-06-10T00:05:00.000Z"
      }
    }
  });
  const pureExposureSnapshot = await requestJson("/api/snapshot");
  const topicStateAfterPureExposure = pureExposureSnapshot.topicStates.find((state) => state.topicId === firstTopic);

  assert.equal(pureExposureResult.records.length, 0, "pure exposure should not enqueue curation records");
  assert.deepEqual(
    topicStateAfterPureExposure,
    topicStateBeforePureExposure,
    "pure exposure should not change topic state"
  );

  const previousBudget = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  const budgetDataPath = join(tempDir, "budget-aitimeline.json");
  const budgetCurationPath = join(tempDir, "budget-curation-jobs.json");
  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "1";
  const budgetServer = createApiServer({
    dataPath: budgetDataPath,
    curationDataPath: budgetCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const budgetSignal = {
      postId: "budget-post",
      topicId: "Budget Concept",
      conceptIds: ["Budget Concept"],
      impression: true,
      dwellTimeMs: 18000,
      openedThread: true,
      liked: true,
      saved: false,
      askedQuestion: false,
      reviewed: false,
      skippedQuickly: false,
      createdAt: "2026-06-10T03:00:00.000Z"
    };
    const firstBudgetSignal = await requestJsonFromServer(budgetServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-06-10T03:00:00.000Z",
        topicState: {
          topicId: "Budget Concept",
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.8
        },
        signal: budgetSignal
      }
    });
    const secondBudgetSignal = await requestJsonFromServer(budgetServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-06-10T03:01:00.000Z",
        topicState: {
          topicId: "Budget Concept",
          interestScore: 0.82,
          fatigueScore: 0.1,
          comprehensionScore: 0.8
        },
        signal: {
          ...budgetSignal,
          postId: "budget-post-2",
          createdAt: "2026-06-10T03:01:00.000Z"
        }
      }
    });
    const budgetJobs = await requestJsonFromServer(budgetServer, "/api/curation/jobs?status=queued");
    const budgetSnapshot = await requestJsonFromServer(budgetServer, "/api/snapshot");
    const budgetRecord = budgetSnapshot.autoJobBudget.find((record) => record.date === "2026-06-10");

    assert.equal(firstBudgetSignal.records.length, 1, "budget limit should allow the first automatic job");
    assert.equal(secondBudgetSignal.records.length, 0, "budget limit should discard later automatic jobs");
    assert.equal(budgetJobs.jobs.length, 1, "discarded automatic jobs should not accumulate in the queue");
    assert.equal(budgetRecord?.used, 1, "budget snapshot should count the accepted automatic job");
    assert.ok((budgetRecord?.discarded ?? 0) >= 1, "budget snapshot should count discarded automatic jobs");
  } finally {
    if (previousBudget === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousBudget;
    }

    await closeServer(budgetServer);
  }

  const dueReview = await requestJson(`/api/review/due?now=${encodeURIComponent(firstReviewState.dueAt)}`);

  assert.deepEqual(
    dueReview.due.map((state) => state.postId),
    [firstPost.id],
    "due review endpoint should return due review states sorted by dueAt"
  );

  const dueTimeline = await requestJson(`/api/timeline?now=${encodeURIComponent(firstReviewState.dueAt)}`);
  const dueTimelinePost = dueTimeline.posts.find((post) => post.id === firstPost.id);

  assert.ok(dueTimelinePost, "due review post should appear in the timeline");
  assert.equal(dueTimelinePost.reviewDueAt, firstReviewState.dueAt, "due review timeline post should expose reviewDueAt");
  assert.equal(dueTimelinePost.recommendationIntent, "review", "due review timeline post should use review intent");


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
  assert.ok(snapshot.interactionSignals.length >= 4, "snapshot should persist lifecycle and interaction signals");
  assert.equal(snapshot.topicStates.length, 1, "snapshot should persist topic states");
  assert.equal(Object.hasOwn(snapshot, "dismissedPostIds"), false, "snapshot should not write legacy dismissedPostIds");
  assert.equal(
    snapshot.dismissedPosts.find((record) => record.postId === dismissedPost.id)?.mode,
    "hard",
    "snapshot should persist dismissed post records and hard upgrades"
  );
  assert.equal(snapshot.reviewStates.length, 2, "snapshot should persist review states");
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
    agentDark.turn.actions.some((action) => action.kind === "confirm_discovery"),
    "dark turns should return a discovery confirmation action"
  );
  assert.equal(
    agentDark.discoveredCandidates.length,
    0,
    "dark turns should not silently send discovery candidates to the inbox before confirmation"
  );
  assert.equal(
    agentDark.turnRecord.status,
    "pending_confirmation",
    "dark turns should wait for confirmation before research starts"
  );
  assert.equal(agentDark.snapshotSummary.agentTurns, 2, "agent turns should be metered in the snapshot");

  const candidatesBeforeResearch = (await requestJson("/api/snapshot")).sourceCandidates.length;
  const confirmResult = await requestJson("/api/agent/confirm", {
    method: "POST",
    body: {
      turnId: agentDark.turnRecord.id,
      now: "2026-06-10T02:29:00.000Z",
      choices: {
        focus: "definition",
        depth: "quick"
      }
    }
  });

  assert.equal(confirmResult.accepted, true, "agent confirm should accept pending dark turns");
  assert.ok(
    confirmResult.records.some((record) => record.job.kind === "research_question"),
    "agent confirm should enqueue a research_question curation job"
  );
  assert.equal(confirmResult.turnRecord.status, "researching", "confirmed turns should move to researching");

  const researchRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T02:30:00.000Z",
      kinds: ["research_question"]
    }
  });

  assert.ok(
    researchRun.records.some((record) => record.status === "succeeded" && record.job.kind === "research_question"),
    "research_question jobs should run through the curation worker"
  );

  const afterResearchSnapshot = await requestJson("/api/snapshot");
  const researchTurn = afterResearchSnapshot.agentTurns.find((record) => record.id === agentDark.turnRecord.id);
  const originImports = afterResearchSnapshot.sourceImports.filter(
    (record) => record.source.origin?.turnId === agentDark.turnRecord.id
  );
  const pendingAfterResearch = afterResearchSnapshot.sourceCandidates.filter(
    (record) => record.status === "pending" && record.createdAt === "2026-06-10T02:30:00.000Z"
  );
  const answerNotification = afterResearchSnapshot.notifications.find(
    (record) => record.kind === "agent_answer" && record.turnId === agentDark.turnRecord.id
  );

  assert.equal(researchTurn?.status, "answered", "research worker should close the original turn as answered");
  assert.ok(originImports.length > 0, "research worker should automatically import top sources");
  assert.ok(originImports.length <= 2, "quick research should import no more than two sources");
  assert.ok(
    afterResearchSnapshot.sourceCandidates.length > candidatesBeforeResearch,
    "research worker should leave non-imported candidates in Discover"
  );
  assert.ok(pendingAfterResearch.length > 0, "remaining research candidates should be pending in Discover");
  assert.ok(answerNotification, "research worker should create an agent_answer notification");
  assert.ok(answerNotification.body.includes("依据:"), "agent_answer notifications should include a cited grounded answer");
  assert.ok(answerNotification.citations?.length > 0, "agent_answer notifications should carry citations");
  assert.equal(
    originImports.every((record) => record.source.origin?.question === agentDark.turn.question),
    true,
    "auto-imported research sources should record their origin question"
  );

  const notificationsResponse = await requestJson("/api/notifications");
  const notificationDetail = notificationsResponse.records.find((record) => record.id === answerNotification.id);

  assert.ok(notificationDetail, "notifications endpoint should include the research answer");
  assert.ok(notificationDetail.supportPosts.length > 0, "notification details should include support cards");

  const readNotification = await requestJson(`/api/notifications/${encodeURIComponent(answerNotification.id)}/read`, {
    method: "POST"
  });

  assert.equal(readNotification.record.readAt.length > 0, true, "notification read endpoint should set readAt");

  const researchPost = afterResearchSnapshot.posts.find((post) =>
    post.sources.some((source) => source.origin?.turnId === agentDark.turnRecord.id)
  );

  assert.ok(researchPost, "research imports should create at least one post with source origin");

  const compoundTurn = await requestJson("/api/agent/ask", {
    method: "POST",
    body: {
      postId: researchPost.id,
      question: "这条来源还能说明什么?"
    }
  });

  assert.match(
    compoundTurn.turn.answer.answer,
    /这条证据来自你 \d+ 月 \d+ 日的提问/,
    "later grounded answers citing an originated source should include the compound-interest origin note"
  );

  // --- Notes: user posts become self-grounded posts and get an observer reply ---
  const noteResult = await requestJson("/api/notes", {
    method: "POST",
    body: {
      text: `My note: ${firstTopic} quality depends on retrieval quality.`,
      createdAt: "2026-06-10T01:00:00.000Z"
    }
  });

  assert.equal(noteResult.post.sources[0].type, "user_note", "notes should persist as user_note sources");
  assert.equal(noteResult.post.kind, undefined, "old note calls without kind should not become idea posts");
  assert.equal(noteResult.post.thread[0].kind, "agent_reply", "the observer reply on a note should be an agent_reply block");
  assert.ok(noteResult.post.citations.length > 0, "note posts should cite their own registry chunk");
  assert.equal(noteResult.turn.intent, "grounded_qa", "notes touching library concepts should get grounded replies");
  assert.ok(noteResult.turn.answer.citations.length > 0, "observer replies to notes should cite source chunks");
  assert.equal(noteResult.snapshotSummary.agentTurns, 4, "note replies should be metered as agent turns");

  const noteTimeline = await requestJson("/api/timeline?now=2026-06-11T00:00:00.000Z");
  const timelineNotePost = noteTimeline.posts.find((post) => post.id === noteResult.post.id);

  assert.ok(timelineNotePost, "the note should appear in the timeline immediately");
  assert.ok(timelineNotePost.thread.length > 0, "the observer reply should persist on the note's thread");

  const finalSnapshot = await requestJson("/api/snapshot");
  const localUserMemory = finalSnapshot.userMemories.find((record) => record.userId === "local-user");

  assert.equal(
    localUserMemory?.memory.interaction.recentQuestions.length,
    4,
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
  assert.equal(replyResult.snapshotSummary.agentTurns, 5, "comment replies should be metered as agent turns");

  const replyTimeline = await requestJson("/api/timeline?now=2026-06-11T00:00:00.000Z");
  const replyTimelinePost = replyTimeline.posts.find((post) => post.id === firstPost.id);
  const persistedCommentBlocks = replyTimelinePost.thread.filter(
    (block) => block.kind === "user_comment" || block.kind === "agent_reply"
  );

  assert.equal(persistedCommentBlocks.length, 2, "the comment and observer reply should persist on the card thread after reload");

  // --- Idea flow: kind=idea notes get library links, probes, testable research, and no card from probe answers ---
  const firstSourceTitle = firstPost.sources[0]?.title ?? firstPost.title;
  const ideaResult = await requestJson("/api/notes", {
    method: "POST",
    body: {
      text: `Idea: ${firstTopic} could make citation review cheaper when the graph already knows the source boundary.`,
      kind: "idea",
      createdAt: "2026-06-10T03:10:00.000Z"
    }
  });

  assert.equal(ideaResult.post.kind, "idea", "kind=idea notes should persist as idea posts");
  assert.equal(ideaResult.turn.intent, "idea_observation", "idea notes should produce an idea observation turn");
  assert.match(ideaResult.turn.notes.join("\n"), /库内关联/, "idea replies should include the library-link section");
  assert.ok(
    ideaResult.turn.notes.join("\n").includes(firstSourceTitle),
    "idea library links should cite source titles"
  );
  assert.ok(ideaResult.turn.nearestPosts.length > 0, "idea replies should link real in-library cards");
  assert.ok(ideaResult.turn.nearestPosts.length <= 3, "idea replies should cap library links at three cards");

  const ideaProbeAction = ideaResult.turn.actions.find((action) => action.kind === "idea_probe");
  const ideaResearchAction = ideaResult.turn.actions.find((action) => action.kind === "research_idea");

  assert.ok(ideaProbeAction, "idea replies should include an idea_probe action");
  assert.ok(ideaResearchAction?.question, "idea replies should include a testable research_idea action");

  const beforeProbeSnapshot = await requestJson("/api/snapshot");
  const probeAnswer = await requestJson("/api/agent/ask", {
    method: "POST",
    body: {
      question: "可以先验证 citation review 成本是否随已知边界下降。",
      threadId: ideaResult.turnRecord.threadId,
      now: "2026-06-10T03:12:00.000Z"
    }
  });
  const afterProbeSnapshot = await requestJson("/api/snapshot");

  assert.equal(
    probeAnswer.turnRecord.threadId,
    ideaResult.turnRecord.threadId,
    "idea probe answers should stay in the idea thread with previous turns available"
  );
  assert.equal(afterProbeSnapshot.posts.length, beforeProbeSnapshot.posts.length, "idea probe answers should not create cards");
  assert.equal(
    afterProbeSnapshot.reviewStates.length,
    beforeProbeSnapshot.reviewStates.length,
    "idea probe answers should not create review items"
  );

  const searchQueryStart = observedSearchQueries.length;
  const ideaResearchRequest = await requestJson("/api/agent/research-idea", {
    method: "POST",
    body: {
      turnId: ideaResult.turnRecord.id,
      question: ideaResearchAction.question,
      concepts: ideaResearchAction.concepts,
      now: "2026-06-10T03:19:00.000Z"
    }
  });

  assert.ok(
    ideaResearchRequest.records.some((record) => record.job.kind === "research_idea"),
    "idea evidence buttons should enqueue a research_idea curation job"
  );
  assert.ok(
    ideaResearchRequest.records[0].job.researchIdea.supportQueries.some((query) => /evidence|case/i.test(query)),
    "research_idea jobs should store support-oriented queries"
  );
  assert.ok(
    ideaResearchRequest.records[0].job.researchIdea.challengeQueries.some((query) => /criticism|limitations|counterexample/i.test(query)),
    "research_idea jobs should store challenge-oriented queries"
  );

  const ideaResearchRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T03:20:00.000Z",
      kinds: ["research_idea"]
    }
  });
  const ideaSearchQueries = observedSearchQueries.slice(searchQueryStart);

  assert.ok(
    ideaResearchRun.records.some((record) => record.status === "succeeded" && record.job.kind === "research_idea"),
    "research_idea jobs should run through the curation worker"
  );
  assert.ok(
    ideaResearchRun.records.some((record) => record.result?.ideaResearchQueries?.support?.length > 0),
    "research_idea results should expose support query groups"
  );
  assert.ok(
    ideaResearchRun.records.some((record) => record.result?.ideaResearchQueries?.challenge?.length > 0),
    "research_idea results should expose challenge query groups"
  );
  assert.ok(
    ideaSearchQueries.some((query) => /evidence|case/i.test(query)),
    "support-oriented research_idea queries should be sent to search"
  );
  assert.ok(
    ideaSearchQueries.some((query) => /criticism|limitations|counterexample/i.test(query)),
    "challenge-oriented research_idea queries should be sent to search"
  );

  const afterIdeaResearchSnapshot = await requestJson("/api/snapshot");
  const ideaImports = afterIdeaResearchSnapshot.sourceImports.filter(
    (record) => record.source.origin?.turnId === ideaResult.turnRecord.id
  );
  const ideaNotification = afterIdeaResearchSnapshot.notifications.find(
    (record) => record.kind === "agent_answer" && record.turnId === ideaResult.turnRecord.id
  );

  assert.ok(ideaImports.length > 0, "research_idea should import evidence sources");
  assert.ok(ideaImports.length <= 4, "research_idea should import at most two sources per side");
  assert.ok(ideaNotification, "research_idea should create an agent_answer notification");
  assert.match(ideaNotification.body, /支持的证据/, "research_idea notifications should include a support column");
  assert.match(ideaNotification.body, /相反的声音/, "research_idea notifications should include an opposing column");
  assert.ok(ideaNotification.citations?.length > 0, "research_idea notifications should carry source citations");

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

    try {
      const bareResponse = await dispatchToServer(bareServer, `${baseUrl}/api/discovery/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: ["anything"], concepts: [] })
      });
      const barePayload = await bareResponse.json();

      assert.equal(bareResponse.status, 200, "unconfigured discovery/run should still respond 200");
      assert.equal(barePayload.configured, false, "unconfigured discovery/run should report configured=false");
      assert.deepEqual(barePayload.candidates, [], "unconfigured discovery/run should return no candidates");

      const bareIdea = await requestJsonFromServer(bareServer, "/api/notes", {
        method: "POST",
        body: {
          text: "一个空库里的原创想法需要先找正反证据。",
          kind: "idea",
          createdAt: "2026-06-10T03:40:00.000Z"
        }
      });

      assert.match(
        bareIdea.turn.notes.join("\n"),
        /库内没有相关材料/,
        "ideas in an empty library should say there is no related material"
      );
      assert.ok(
        bareIdea.turn.actions.some((action) => action.kind === "idea_probe"),
        "empty-library idea replies should still include probe actions"
      );
      const bareIdeaResearchAction = bareIdea.turn.actions.find((action) => action.kind === "research_idea");
      assert.ok(bareIdeaResearchAction, "empty-library idea replies should still include research actions");
      await requestJsonFromServer(bareServer, "/api/agent/research-idea", {
        method: "POST",
        body: {
          turnId: bareIdea.turnRecord.id,
          question: bareIdeaResearchAction.question,
          concepts: bareIdeaResearchAction.concepts,
          now: "2026-06-10T03:49:00.000Z"
        }
      });
      await requestJsonFromServer(bareServer, "/api/curation/run", {
        method: "POST",
        body: {
          now: "2026-06-10T03:50:00.000Z",
          kinds: ["research_idea"]
        }
      });
      const bareIdeaNotifications = await requestJsonFromServer(bareServer, "/api/notifications");

      assert.ok(
        bareIdeaNotifications.records.some(
          (record) => record.turnId === bareIdea.turnRecord.id && /搜索服务未配置/.test(record.body)
        ),
        "unconfigured idea research should create a clear notification"
      );

      const bareDark = await requestJsonFromServer(bareServer, "/api/agent/ask", {
        method: "POST",
        body: { question: "What is offline-only research?" }
      });
      await requestJsonFromServer(bareServer, "/api/agent/confirm", {
        method: "POST",
        body: {
          turnId: bareDark.turnRecord.id,
          now: "2026-06-10T03:59:00.000Z",
          choices: { focus: "definition", depth: "quick" }
        }
      });
      await requestJsonFromServer(bareServer, "/api/curation/run", {
        method: "POST",
        body: {
          now: "2026-06-10T04:00:00.000Z",
          kinds: ["research_question"]
        }
      });
      const bareNotifications = await requestJsonFromServer(bareServer, "/api/notifications");

      assert.ok(
        bareNotifications.records.some((record) => /搜索服务未配置/.test(record.body)),
        "unconfigured research should create a clear notification"
      );
    } finally {
      await closeServer(bareServer);
    }
  }

  const oneSidedIdeaServer = createApiServer({
    dataPath: join(tempDir, "one-sided-idea.json"),
    curationDataPath: join(tempDir, "one-sided-idea-jobs.json"),
    searchProvider: {
      id: "one-sided-idea",
      async search(query) {
        if (/criticism|limitations|counterexample|contrary/i.test(query)) {
          return [];
        }

        return [
          {
            url: `${baseUrl}/fixtures/article-background?one-sided=${encodeURIComponent(query)}`,
            title: `One-sided support source for ${query}`,
            snippet: "A support-only source for testing one empty side in idea research notifications."
          }
        ];
      }
    }
  });

  try {
    const oneSidedIdea = await requestJsonFromServer(oneSidedIdeaServer, "/api/notes", {
      method: "POST",
      body: {
        text: "A support-only idea should still report when the opposing side is empty.",
        kind: "idea",
        createdAt: "2026-06-10T04:10:00.000Z"
      }
    });
    const action = oneSidedIdea.turn.actions.find((item) => item.kind === "research_idea");
    assert.ok(action, "one-sided idea setup should include a research_idea action");
    await requestJsonFromServer(oneSidedIdeaServer, "/api/agent/research-idea", {
      method: "POST",
      body: {
        turnId: oneSidedIdea.turnRecord.id,
        question: action.question,
        concepts: action.concepts,
        now: "2026-06-10T04:11:00.000Z"
      }
    });
    await requestJsonFromServer(oneSidedIdeaServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-06-10T04:12:00.000Z",
        kinds: ["research_idea"]
      }
    });
    const oneSidedNotifications = await requestJsonFromServer(oneSidedIdeaServer, "/api/notifications");
    const oneSidedNotification = oneSidedNotifications.records.find(
      (record) => record.turnId === oneSidedIdea.turnRecord.id
    );

    assert.ok(oneSidedNotification, "one-sided idea research should still create a notification");
    assert.match(oneSidedNotification.body, /支持的证据/, "one-sided notifications should include support evidence");
    assert.match(
      oneSidedNotification.body,
      /没找到这一侧的靠谱来源/,
      "one-sided notifications should state when opposing evidence is empty"
    );
  } finally {
    await closeServer(oneSidedIdeaServer);
  }

  const failingImportServer = createApiServer({
    dataPath: join(tempDir, "failing-import.json"),
    curationDataPath: join(tempDir, "failing-import-jobs.json"),
    searchProvider: {
      id: "unsupported-source-type",
      async search(query) {
        return [
          {
            url: `${baseUrl}/unsupported-research-source/${encodeURIComponent(query)}`,
            title: `Unsupported research source for ${query}`,
            snippet: "This result is intentionally unsupported by the background ingestion worker.",
            sourceType: "repo"
          }
        ];
      }
    }
  });

  try {
    const blockedDark = await requestJsonFromServer(failingImportServer, "/api/agent/ask", {
      method: "POST",
      body: { question: "What should happen when every research import fails?" }
    });
    await requestJsonFromServer(failingImportServer, "/api/agent/confirm", {
      method: "POST",
      body: {
        turnId: blockedDark.turnRecord.id,
        now: "2026-06-10T04:29:00.000Z",
        choices: { focus: "definition", depth: "quick" }
      }
    });
    await requestJsonFromServer(failingImportServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-06-10T04:30:00.000Z",
        kinds: ["research_question"]
      }
    });
    const blockedNotifications = await requestJsonFromServer(failingImportServer, "/api/notifications");

    assert.ok(
      blockedNotifications.records.some((record) => /门禁|导入失败/.test(record.body)),
      "all-blocked or all-failed research imports should create an explanatory notification"
    );
  } finally {
    await closeServer(failingImportServer);
  }

  // 完成复习放在最后:休眠期排除会让这张卡退出时间线,中段的排序/整理断言需要它在场。
  const completedReview = await requestJson(`/api/review/${encodeURIComponent(firstPost.id)}/complete`, {
    method: "POST",
    body: {
      reviewedAt: firstReviewState.dueAt
    }
  });

  assert.equal(completedReview.reviewState.intervalDays, 3, "completing review should advance the interval");
  assert.equal(
    completedReview.reviewState.lastReviewedAt,
    firstReviewState.dueAt,
    "completing review should record lastReviewedAt"
  );

  const dueAfterComplete = await requestJson(`/api/review/due?now=${encodeURIComponent(firstReviewState.dueAt)}`);
  const timelineAfterComplete = await requestJson(`/api/timeline?now=${encodeURIComponent(firstReviewState.dueAt)}`);
  const completedTimelinePost = timelineAfterComplete.posts.find((post) => post.id === firstPost.id);

  assert.equal(
    dueAfterComplete.due.some((state) => state.postId === firstPost.id),
    false,
    "completed reviews should leave the due review endpoint until their next dueAt"
  );
  assert.equal(
    completedTimelinePost,
    undefined,
    "completed reviews should rest out of the timeline entirely until the next dueAt"
  );

  console.log("API smoke passed");
} finally {
  globalThis.fetch = originalFetch;
  await closeServer(server);
  await rm(tempDir, { recursive: true, force: true });
  if (previousContentLanguage === undefined) {
    delete process.env.AITIMELINE_CONTENT_LANGUAGE;
  } else {
    process.env.AITIMELINE_CONTENT_LANGUAGE = previousContentLanguage;
  }
}

function getFetchUrl(input) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

async function dispatchToServer(targetServer, url, options = {}) {
  const parsedUrl = new URL(url);
  const body = await normalizeRequestBody(options.body);
  const headers = {
    host: parsedUrl.host,
    ...(options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : {})
  };
  const request = {
    method: options.method ?? "GET",
    url: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers,
    destroy() {},
    async *[Symbol.asyncIterator]() {
      if (body.byteLength > 0) {
        yield body;
      }
    }
  };
  const response = createMockResponse();
  const handler = targetServer.listeners("request")[0];

  await new Promise((resolve, reject) => {
    response.done.then(resolve, reject);

    try {
      const handled = handler(request, response);
      Promise.resolve(handled).catch(reject);
    } catch (error) {
      reject(error);
    }
  });

  return new Response(response.body, {
    status: response.statusCode,
    headers: response.headers
  });
}

async function requestJsonFromServer(targetServer, path, options = {}) {
  const response = await dispatchToServer(targetServer, `${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json();

  assert.equal(response.ok, true, `${path} should respond with 2xx`);

  return payload;
}

async function normalizeRequestBody(body) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  return Buffer.from(String(body));
}

function createMockResponse() {
  const chunks = [];
  const headers = new Headers();
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  return {
    statusCode: 200,
    headers,
    done,
    get body() {
      return Buffer.concat(chunks);
    },
    setHeader(name, value) {
      headers.set(name, String(value));
    },
    writeHead(statusCode, nextHeaders = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(nextHeaders)) {
        headers.set(name, String(value));
      }
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk) {
        this.write(chunk);
      }
      resolveDone();
    }
  };
}

async function closeServer(targetServer) {
  await new Promise((resolveClose) => {
    targetServer.close(() => resolveClose());
  });
}

function makeApiSmokePost({ id, title, concepts, createdAt = "2026-06-01T00:00:00.000Z" }) {
  return {
    id,
    title,
    hook: title,
    thesis: title,
    shortBody: title,
    summary: title,
    keyTakeaway: title,
    concepts,
    sources: [
      {
        id: `${id}-source`,
        title: `${title} source`,
        url: `https://example.com/${id}`,
        type: "article"
      }
    ],
    citations: [],
    recommendedBecause: "Smoke fixture.",
    trustState: "supported",
    createdAt,
    estimatedReadMinutes: 1,
    difficulty: "beginner",
    confidence: "high",
    thread: [],
    graphEdges: concepts.slice(0, -1).map((concept, index) => ({
      id: `${id}-edge-${index + 1}`,
      sourceConcept: concept,
      relation: "extends",
      targetConcept: concepts[index + 1],
      evidence: `${title} links ${concept} to ${concepts[index + 1]}.`,
      weight: 0.72
    })),
    reviewPrompts: [],
    nextActions: [],
    harnessVersion: "smoke"
  };
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
