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
const deepReadFallbackModelEndpoint = "https://deepread-fallback.local/v1/chat/completions";
const observedDeepReadFallbackRequests = [];
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

  if (url.startsWith("https://network-fail.local/")) {
    throw new TypeError("fetch failed");
  }

  if (url.startsWith("https://fallback-leak.local/")) {
    throw new Error("network provider body from https://internal-provider.local/private/deep-dive");
  }

  if (url === deepReadFallbackModelEndpoint) {
    observedDeepReadFallbackRequests.push({ url, headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
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
  assert.ok(
    Array.isArray(settingsSnapshot.conceptBriefs),
    "old snapshots should expose conceptBriefs as an empty compatible field"
  );
  assert.ok(
    Array.isArray(settingsSnapshot.weeklyRecaps),
    "old snapshots should expose weeklyRecaps as an empty compatible field"
  );
  assert.ok(
    Array.isArray(settingsSnapshot.learningGoals),
    "old snapshots should expose learningGoals as an empty compatible field"
  );
  assert.ok(
    Array.isArray(settingsSnapshot.deepReadArticles),
    "old snapshots should expose deepReadArticles as an empty compatible field"
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

  const backfillDataPath = join(tempDir, "review-backfill.json");
  const backfillCurationPath = join(tempDir, "review-backfill-curation.json");
  const backfillPosts = [
    makeApiSmokePost({
      id: "legacy-liked-a",
      title: "Legacy liked A",
      concepts: ["Legacy Review"],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "legacy-saved-b",
      title: "Legacy saved B",
      concepts: ["Legacy Review"],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "legacy-liked-c",
      title: "Legacy liked C",
      concepts: ["Legacy Review"],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  ];
  const connectionNotePost = {
    ...makeApiSmokePost({
      id: "legacy-connection-note",
      title: "Legacy connection note",
      concepts: ["Legacy Review"],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    kind: "connection_note"
  };

  await writeFile(
    backfillDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-01T00:00:00.000Z",
      posts: [...backfillPosts, connectionNotePost],
      interactionSignals: [
        makeInteractionSignalRecord(backfillPosts[0], { liked: true, createdAt: "2026-06-01T00:00:00.000Z" }),
        makeInteractionSignalRecord(backfillPosts[1], { saved: true, createdAt: "2026-06-02T00:00:00.000Z" }),
        makeInteractionSignalRecord(backfillPosts[2], { liked: true, createdAt: "2026-06-03T00:00:00.000Z" }),
        makeInteractionSignalRecord(connectionNotePost, { liked: true, createdAt: "2026-06-04T00:00:00.000Z" })
      ]
    })
  );

  const backfillServer = createApiServer({
    dataPath: backfillDataPath,
    curationDataPath: backfillCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const firstDue = await requestJsonFromServer(backfillServer, "/api/review/due?now=2026-06-10T00:00:00.000Z");
    const firstSnapshot = await requestJsonFromServer(backfillServer, "/api/snapshot");
    const secondDue = await requestJsonFromServer(backfillServer, "/api/review/due?now=2026-06-10T00:00:00.000Z");
    const secondSnapshot = await requestJsonFromServer(backfillServer, "/api/snapshot");

    assert.deepEqual(
      firstDue.due.map((state) => state.postId),
      backfillPosts.map((post) => post.id),
      "legacy liked/saved signals should be backfilled into due review states"
    );
    assert.equal(firstSnapshot.reviewStates.length, 3, "review backfill should skip connection_note cards");
    assert.equal(
      firstSnapshot.reviewStates.find((state) => state.postId === backfillPosts[0].id)?.dueAt,
      "2026-06-02T00:00:00.000Z",
      "review backfill should derive dueAt from the original signal createdAt"
    );
    assert.deepEqual(secondDue.due, firstDue.due, "second due request should not duplicate backfilled review states");
    assert.equal(secondSnapshot.reviewStates.length, 3, "review backfill should be idempotent");
  } finally {
    await closeServer(backfillServer);
  }

  const invalidHistoricalSignalDataPath = join(tempDir, "invalid-historical-signal.json");
  const invalidHistoricalSignalCurationPath = join(tempDir, "invalid-historical-signal-curation.json");
  const historicalSignalPost = makeApiSmokePost({
    id: "historical-signal-post",
    title: "Historical signal post",
    concepts: ["Historical Signal"]
  });

  await writeFile(
    invalidHistoricalSignalDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: [historicalSignalPost],
      interactionSignals: [
        makeInteractionSignalRecord(historicalSignalPost, { createdAt: "not-a-date" })
      ]
    })
  );

  const invalidHistoricalSignalServer = createApiServer({
    dataPath: invalidHistoricalSignalDataPath,
    curationDataPath: invalidHistoricalSignalCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const originalConsoleWarn = console.warn;
    const historicalSignalWarnings = [];
    let historicalTimelineResponse;

    console.warn = (...args) => historicalSignalWarnings.push(args);

    try {
      historicalTimelineResponse = await dispatchToServer(
        invalidHistoricalSignalServer,
        `${baseUrl}/api/timeline?now=2026-06-10T00:00:00.000Z`
      );
    } finally {
      console.warn = originalConsoleWarn;
    }

    const historicalTimeline = await historicalTimelineResponse.json();

    assert.equal(historicalTimelineResponse.status, 200, "one bad historical signal must not crash timeline");
    assert.ok(
      historicalTimeline.posts.some((post) => post.id === historicalSignalPost.id),
      "timeline should keep serving posts after isolating a bad historical signal"
    );
    assert.ok(
      historicalSignalWarnings.some((args) => String(args[0]).includes("skipped invalid historical interaction signal")),
      "isolated historical signals should be recorded in the server log"
    );
  } finally {
    await closeServer(invalidHistoricalSignalServer);
  }

  const structuredErrorDataPath = join(tempDir, "structured-error-redaction.json");
  const structuredErrorCurationPath = join(tempDir, "structured-error-redaction-curation.json");
  const sensitiveStructuredError =
    "provider failed at https://internal.example/private using /Users/example/private-config.json";

  await writeFile(
    structuredErrorDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      sourceImports: [
        {
          id: "failed-structured-import",
          source: {
            id: "failed-structured-source",
            title: "Failed structured source",
            url: "https://example.com/failed-structured-source",
            type: "article"
          },
          status: "failed",
          createdAt: "2026-06-10T00:00:00.000Z",
          errorMessage: sensitiveStructuredError
        }
      ],
      subscriptions: [
        {
          id: "failed-structured-subscription",
          kind: "rss",
          feedUrl: "https://example.com/feed.xml",
          title: "Failed structured subscription",
          filterMode: "relevant",
          createdAt: "2026-06-01T00:00:00.000Z",
          lastError: sensitiveStructuredError
        }
      ]
    })
  );

  const structuredErrorServer = createApiServer({
    dataPath: structuredErrorDataPath,
    curationDataPath: structuredErrorCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const structuredTimeline = await requestJsonFromServer(
      structuredErrorServer,
      "/api/timeline?now=2026-06-10T00:00:00.000Z"
    );
    const structuredSubscriptions = await requestJsonFromServer(structuredErrorServer, "/api/subscriptions");
    const structuredSnapshot = await requestJsonFromServer(structuredErrorServer, "/api/snapshot");

    for (const payload of [structuredTimeline, structuredSubscriptions, structuredSnapshot]) {
      const serialized = JSON.stringify(payload);
      assert.equal(serialized.includes("internal.example"), false, "structured responses must redact internal URLs");
      assert.equal(serialized.includes("/Users/example"), false, "structured responses must redact file paths");
    }
  } finally {
    await closeServer(structuredErrorServer);
  }

  const backfillLimitDataPath = join(tempDir, "review-backfill-limit.json");
  const backfillLimitCurationPath = join(tempDir, "review-backfill-limit-curation.json");
  const backfillLimitPosts = Array.from({ length: 55 }, (_, index) =>
    makeApiSmokePost({
      id: `legacy-limit-${index + 1}`,
      title: `Legacy limit ${index + 1}`,
      concepts: ["Legacy Review Limit"],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  );

  await writeFile(
    backfillLimitDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-01T00:00:00.000Z",
      posts: backfillLimitPosts,
      interactionSignals: backfillLimitPosts.map((post, index) =>
        makeInteractionSignalRecord(post, {
          liked: true,
          createdAt: `2026-06-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`
        })
      )
    })
  );

  const backfillLimitServer = createApiServer({
    dataPath: backfillLimitDataPath,
    curationDataPath: backfillLimitCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    await requestJsonFromServer(backfillLimitServer, "/api/review/due?now=2026-06-20T00:00:00.000Z");
    const limitSnapshot = await requestJsonFromServer(backfillLimitServer, "/api/snapshot");

    assert.equal(limitSnapshot.reviewStates.length, 50, "legacy review backfill should create at most 50 states per request");
  } finally {
    await closeServer(backfillLimitServer);
  }

  const reviewGradeDataPath = join(tempDir, "review-grades.json");
  const reviewGradeCurationPath = join(tempDir, "review-grades-curation.json");
  const reviewGradePosts = [
    makeReviewGradePost("review-remembered", "Review remembered", "Remembered Concept"),
    makeReviewGradePost("review-fuzzy", "Review fuzzy", "Fuzzy Concept"),
    makeReviewGradePost("review-forgot", "Review forgot", "Forgot Concept"),
    makeReviewGradePost("review-forgot-peer-a", "Review forgot peer A", "Forgot Concept"),
    makeReviewGradePost("review-forgot-peer-b", "Review forgot peer B", "Forgot Concept")
  ];

  await writeFile(
    reviewGradeDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: reviewGradePosts,
      reviewStates: [
        {
          postId: "review-remembered",
          intervalDays: 3,
          dueAt: "2026-06-10T00:00:00.000Z",
          lastReviewedAt: "2026-06-07T00:00:00.000Z"
        },
        {
          postId: "review-fuzzy",
          intervalDays: 3,
          dueAt: "2026-06-10T00:00:00.000Z",
          lastReviewedAt: "2026-06-07T00:00:00.000Z"
        },
        {
          postId: "review-forgot",
          intervalDays: 7,
          dueAt: "2026-06-10T00:00:00.000Z",
          lastReviewedAt: "2026-06-03T00:00:00.000Z"
        },
        {
          postId: "review-forgot-peer-a",
          intervalDays: 7,
          dueAt: "2026-06-20T00:00:00.000Z",
          lastReviewedAt: "2026-06-03T00:00:00.000Z"
        },
        {
          postId: "review-forgot-peer-b",
          intervalDays: 14,
          dueAt: "2026-06-24T00:00:00.000Z",
          lastReviewedAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      topicStates: [
        {
          topicId: "Forgot Concept",
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.9,
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    })
  );

  const reviewGradeServer = createApiServer({
    dataPath: reviewGradeDataPath,
    curationDataPath: reviewGradeCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const reviewDue = await requestJsonFromServer(
      reviewGradeServer,
      "/api/review/due?now=2026-06-10T00:00:00.000Z"
    );
    const rememberedDue = reviewDue.due.find((item) => item.postId === "review-remembered");
    const forgotDue = reviewDue.due.find((item) => item.postId === "review-forgot");

    assert.deepEqual(
      rememberedDue?.reviewPrompt,
      {
        id: "review-remembered-prompt-3",
        prompt: "Review remembered prompt for day 3",
        answerHint: "Review remembered answer for day 3"
      },
      "due review should select the prompt whose dueInDays matches the current interval"
    );
    assert.equal(
      forgotDue?.reviewPrompt?.answerHint,
      "Review forgot answer for day 7",
      "due review should carry the matched prompt answerHint"
    );
    assert.ok(
      reviewDue.due.every((item) => item.reviewPrompt?.id && item.reviewPrompt.prompt && item.reviewPrompt.answerHint),
      "every due review item should carry an id, prompt, and answerHint"
    );

    const rememberedBody = {
      reviewedAt: "2026-06-10T01:00:00.000Z",
      grade: "remembered",
      reviewEventId: "review-event-remembered-1"
    };
    const remembered = await requestJsonFromServer(
      reviewGradeServer,
      "/api/review/review-remembered/complete",
      { method: "POST", body: rememberedBody }
    );
    const rememberedSnapshot = await requestJsonFromServer(reviewGradeServer, "/api/snapshot");
    const rememberedReplay = await requestJsonFromServer(
      reviewGradeServer,
      "/api/review/review-remembered/complete",
      {
        method: "POST",
        body: {
          ...rememberedBody,
          reviewedAt: "2026-06-12T01:00:00.000Z",
          grade: "forgot"
        }
      }
    );
    const rememberedReplaySnapshot = await requestJsonFromServer(reviewGradeServer, "/api/snapshot");

    assert.equal(remembered.reviewState.intervalDays, 7, "remembered should advance to the next review interval");
    assert.equal(remembered.nextDueAt, "2026-06-17T01:00:00.000Z", "remembered should return its next due time");
    assert.equal(rememberedReplay.reviewState.intervalDays, 7, "same reviewEventId replay must not advance twice");
    assert.equal(
      rememberedReplay.nextDueAt,
      remembered.nextDueAt,
      "same reviewEventId must return the first result even when replay payload fields change"
    );
    assert.equal(rememberedReplay.idempotentReplay, true, "same reviewEventId should be reported as a replay");
    assert.equal(
      rememberedReplaySnapshot.interactionSignals.length,
      rememberedSnapshot.interactionSignals.length,
      "same reviewEventId replay must not duplicate review side effects"
    );
    assert.deepEqual(
      rememberedReplaySnapshot.topicStates,
      rememberedSnapshot.topicStates,
      "same reviewEventId replay must not update topic state twice"
    );

    const fuzzy = await requestJsonFromServer(reviewGradeServer, "/api/review/review-fuzzy/complete", {
      method: "POST",
      body: {
        reviewedAt: "2026-06-10T02:00:00.000Z",
        grade: "fuzzy",
        reviewEventId: "review-event-fuzzy-1"
      }
    });

    assert.equal(fuzzy.reviewState.intervalDays, 3, "fuzzy should keep the current review interval");
    assert.equal(fuzzy.nextDueAt, "2026-06-13T02:00:00.000Z", "fuzzy should schedule from the held interval");

    const forgot = await requestJsonFromServer(reviewGradeServer, "/api/review/review-forgot/complete", {
      method: "POST",
      body: {
        reviewedAt: "2026-06-10T03:00:00.000Z",
        grade: "forgot",
        reviewEventId: "review-event-forgot-1"
      }
    });
    const forgotSnapshot = await requestJsonFromServer(reviewGradeServer, "/api/snapshot");
    const forgotMemory = forgotSnapshot.userMemories.find((record) => record.userId === "local-user")?.memory;

    assert.equal(forgot.reviewState.intervalDays, 1, "forgot should reset to the shortest review interval");
    assert.equal(forgot.nextDueAt, "2026-06-11T03:00:00.000Z", "forgot should return the reset due time");
    assert.deepEqual(forgot.masteryPromotions, [], "forgot must not promote mastery");
    assert.equal(
      forgotMemory?.knowledge.knownConcepts.includes("Forgot Concept") ?? false,
      false,
      "forgot must not add the reviewed concept to mastery memory"
    );
  } finally {
    await closeServer(reviewGradeServer);
  }

  const failedCandidateDataPath = join(tempDir, "failed-candidate.json");
  const failedCandidateCurationPath = join(tempDir, "failed-candidate-curation.json");
  const failedCandidateRecord = makeSourceCandidateRecord({
    id: "legacy-unsupported-candidate",
    url: "https://github.com/example/legacy-unsupported-candidate",
    score: 0.9,
    status: "queued",
    concept: "Legacy Candidate",
    createdAt: "2026-06-10T00:00:00.000Z"
  });
  failedCandidateRecord.candidate.source.type = "repo";
  const failedCandidateJob = makeQueuedImportJobRecord(
    failedCandidateRecord,
    "2026-06-10T00:00:00.000Z"
  );

  await writeFile(
    failedCandidateDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      sourceCandidates: [failedCandidateRecord]
    })
  );
  await writeFile(
    failedCandidateCurationPath,
    JSON.stringify({ version: 1, records: [failedCandidateJob] })
  );

  const failedCandidateServer = createApiServer({
    dataPath: failedCandidateDataPath,
    curationDataPath: failedCandidateCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const failedCandidateBatch = await requestJsonFromServer(failedCandidateServer, "/api/curation/run", {
      method: "POST",
      body: { now: "2026-06-10T00:00:00.000Z", kinds: ["import_source"] }
    });
    const failedCandidateSnapshot = await requestJsonFromServer(failedCandidateServer, "/api/snapshot");
    const terminalCandidate = failedCandidateSnapshot.sourceCandidates.find(
      (record) => record.id === failedCandidateRecord.id
    );
    const terminalJob = failedCandidateBatch.records.find((record) => record.job.id === failedCandidateJob.job.id);

    assert.equal(terminalJob?.status, "failed", "unsupported legacy import jobs should reach a failed terminal state");
    assert.equal(terminalJob?.lastError, "Source import failed.", "failed job responses should redact internal causes");
    assert.equal(
      terminalCandidate?.status,
      "rejected_source",
      "non-network terminal import failures should move candidates out of queued"
    );
    assert.deepEqual(
      terminalCandidate?.rejectionReasons,
      ["Source import failed."],
      "terminal candidate failures should persist a stable failure reason"
    );
  } finally {
    await closeServer(failedCandidateServer);
  }

  const masteryDataPath = join(tempDir, "mastery-promotion.json");
  const masteryCurationPath = join(tempDir, "mastery-promotion-curation.json");
  const masteryConcept = "Mastery Loop";
  const masteryPosts = [
    makeApiSmokePost({
      id: "mastery-card-a",
      title: "Mastery card A",
      concepts: [masteryConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "mastery-card-b",
      title: "Mastery card B",
      concepts: [masteryConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  ];

  await writeFile(
    masteryDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: masteryPosts,
      learningGoals: [
        {
          id: "learning-goal-mastery-loop",
          concept: masteryConcept,
          createdAt: "2026-06-09T00:00:00.000Z",
          status: "active"
        }
      ],
      reviewStates: [
        {
          postId: masteryPosts[0].id,
          intervalDays: 3,
          dueAt: "2026-06-10T00:00:00.000Z",
          lastReviewedAt: "2026-06-07T00:00:00.000Z"
        },
        {
          postId: masteryPosts[1].id,
          intervalDays: 7,
          dueAt: "2026-06-17T00:00:00.000Z",
          lastReviewedAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      topicStates: [
        {
          topicId: masteryConcept.toLowerCase(),
          interestScore: 0.4,
          fatigueScore: 0.1,
          comprehensionScore: 0.2,
          updatedAt: "2026-05-01T00:00:00.000Z"
        },
        {
          topicId: masteryConcept,
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.72,
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    })
  );

  const masteryServer = createApiServer({
    dataPath: masteryDataPath,
    curationDataPath: masteryCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const promoted = await requestJsonFromServer(
      masteryServer,
      `/api/review/${encodeURIComponent(masteryPosts[0].id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: "2026-06-10T00:00:00.000Z" }
      }
    );
    const promotedSnapshot = await requestJsonFromServer(masteryServer, "/api/snapshot");
    const promotedMemory = promotedSnapshot.userMemories.find((record) => record.userId === "local-user")?.memory;
    const promotionEvent = promotedSnapshot.memoryEvents.find(
      (record) => record.event.kind === "auto_mastery_promotion" && record.event.field === "knowledge.knownConcepts"
    );
    const promotionNotification = promotedSnapshot.notifications.find((record) => record.kind === "mastery_promotion");
    const goalRecord = promotedSnapshot.learningGoals.find((record) => record.id === "learning-goal-mastery-loop");
    const goalNotification = promotedSnapshot.notifications.find((record) => record.kind === "learning_goal_achieved");

    assert.equal(promoted.masteryPromotions.length, 1, "complete should auto-promote a concept that meets mastery rules");
    assert.equal(
      promoted.learningGoalAchievements.length,
      1,
      "auto-promoted active goal concepts should be marked achieved in the review response"
    );
    assert.ok(
      promotedMemory?.knowledge.knownConcepts.includes(masteryConcept),
      "auto-promoted concept should enter knownConcepts"
    );
    assert.ok(promotionEvent, "auto promotion should persist a memory event with an auto_mastery_promotion kind");
    assert.match(
      promotionEvent?.event.reason ?? "",
      /cards=2\/2.*score=/,
      "auto promotion memory event should record card, interval, and score evidence"
    );
    assert.ok(promotionNotification, "auto promotion should create a mastery notification");
    assert.match(promotionNotification?.body ?? "", /已进入已掌握/, "mastery notification should use the zh template");
    assert.equal(goalRecord?.status, "achieved", "auto-promoted active goal should persist as achieved");
    assert.ok(goalRecord?.achievedAt, "achieved learning goals should persist achievedAt");
    assert.ok(goalNotification, "auto-promoted learning goal should create a goal notification");

    await requestJsonFromServer(masteryServer, "/api/goals?userId=local-user&now=2026-06-10T00:00:00.000Z");
    const repeatedGoalSnapshot = await requestJsonFromServer(masteryServer, "/api/snapshot");
    assert.equal(
      repeatedGoalSnapshot.notifications.filter((record) => record.kind === "learning_goal_achieved").length,
      1,
      "learning goal achieved notification should be idempotent across lazy checks"
    );

    await requestJsonFromServer(masteryServer, "/api/memory", {
      method: "POST",
      body: {
        edits: [{ kind: "add", field: "knowledge.knownConcepts", value: "Manual Only Concept" }]
      }
    });
    const demotion = await requestJsonFromServer(masteryServer, "/api/memory", {
      method: "POST",
      body: {
        edits: [
          { kind: "remove", field: "knowledge.knownConcepts", value: masteryConcept },
          { kind: "remove", field: "knowledge.knownConcepts", value: "Manual Only Concept" }
        ]
      }
    });
    const demotedSnapshot = await requestJsonFromServer(masteryServer, "/api/snapshot");
    const blacklistEvents = demotedSnapshot.memoryEvents.filter(
      (record) => record.event.kind === "auto_mastery_blacklist" && record.event.field === "knowledge.knownConcepts"
    );

    assert.ok(
      demotion.events.some((event) => event.kind === "auto_mastery_blacklist"),
      "manual removal of an auto-promoted concept should return a blacklist event"
    );
    assert.equal(
      blacklistEvents.length,
      1,
      "batch removal should only blacklist the auto-promoted concept, not manual ones removed alongside"
    );
    assert.deepEqual(
      blacklistEvents[0]?.event.previousValue,
      [masteryConcept],
      "blacklist event should carry a single-concept diff so batch removals stay precise"
    );

    const blockedPromotion = await requestJsonFromServer(
      masteryServer,
      `/api/review/${encodeURIComponent(masteryPosts[1].id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: "2026-06-11T00:00:00.000Z" }
      }
    );
    const blockedSnapshot = await requestJsonFromServer(masteryServer, "/api/snapshot");
    const blockedMemory = blockedSnapshot.userMemories.find((record) => record.userId === "local-user")?.memory;

    assert.deepEqual(blockedPromotion.masteryPromotions, [], "blacklisted concepts should not be auto-promoted again");
    assert.equal(
      blockedMemory?.knowledge.knownConcepts.includes(masteryConcept),
      false,
      "blacklisted concepts should stay out of knownConcepts after later review completions"
    );
    assert.equal(
      blockedSnapshot.notifications.filter((record) => record.kind === "mastery_promotion").length,
      1,
      "blacklisted concepts should not create another mastery notification"
    );
  } finally {
    await closeServer(masteryServer);
  }

  const goalDataPath = join(tempDir, "learning-goals.json");
  const goalCurationPath = join(tempDir, "learning-goals-curation.json");
  const goalPosts = [
    makeApiSmokePost({
      id: "goal-foundation",
      title: "Goal Foundation",
      concepts: ["Foundation"],
      createdAt: "2026-07-01T00:00:00.000Z"
    }),
    {
      ...makeApiSmokePost({
        id: "goal-prerequisite",
        title: "Goal Prerequisite",
        concepts: ["Prerequisite"],
        createdAt: "2026-07-02T00:00:00.000Z"
      }),
      graphEdges: [
        {
          id: "goal-prereq-requires-foundation",
          sourceConcept: "Prerequisite",
          relation: "requires",
          targetConcept: "Foundation",
          evidence: "Prerequisite requires Foundation.",
          weight: 0.8
        }
      ]
    },
    {
      ...makeApiSmokePost({
        id: "goal-target",
        title: "Goal Topic",
        concepts: ["Goal Topic"],
        createdAt: "2026-07-03T00:00:00.000Z"
      }),
      graphEdges: [
        {
          id: "goal-topic-requires-prerequisite",
          sourceConcept: "Goal Topic",
          relation: "requires",
          targetConcept: "Prerequisite",
          evidence: "Goal Topic requires Prerequisite.",
          weight: 0.9
        },
        {
          id: "goal-topic-requires-gap",
          sourceConcept: "Goal Topic",
          relation: "requires",
          targetConcept: "Gap Concept",
          evidence: "Goal Topic requires an uncovered gap concept.",
          weight: 0.7
        }
      ]
    },
    makeApiSmokePost({
      id: "goal-other",
      title: "Other Goal",
      concepts: ["Other Goal"],
      createdAt: "2026-07-04T00:00:00.000Z"
    })
  ];

  await writeFile(
    goalDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-08T00:00:00.000Z",
      posts: goalPosts
    })
  );

  const goalServer = createApiServer({
    dataPath: goalDataPath,
    curationDataPath: goalCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const createdGoal = await requestJsonFromServer(goalServer, "/api/goals", {
      method: "POST",
      body: {
        concept: "Goal Topic",
        now: "2026-07-08T00:00:00.000Z"
      }
    });
    const queuedGapTopics = createdGoal.gapProduction.records.map((record) => record.job.topicId);

    assert.equal(createdGoal.record.status, "active", "POST /api/goals should create an active learning goal");
    assert.ok(createdGoal.record.tree, "created active goals should include a realtime skill tree");
    assert.ok(
      createdGoal.record.tree.nodes.some((node) => node.concept === "Gap Concept" && node.gap),
      "created goal tree should expose uncovered gap concepts"
    );
    assert.ok(
      queuedGapTopics.includes("Gap Concept"),
      "creating a learning goal should enqueue gap concepts as concept_brief jobs"
    );
    assert.ok(
      createdGoal.gapProduction.records.length > 0 && createdGoal.gapProduction.records.length <= 3,
      "gap production should enqueue at most 3 concept_brief jobs per call"
    );
    assert.equal(
      createdGoal.gapProduction.budget.used,
      createdGoal.gapProduction.records.length,
      "goal gap production should consume the daily auto-job budget"
    );

    const goalsAfterFirstGet = await requestJsonFromServer(
      goalServer,
      "/api/goals?userId=local-user&now=2026-07-08T00:00:00.000Z"
    );
    const snapshotAfterFirstGet = await requestJsonFromServer(goalServer, "/api/snapshot");
    const usedAfterFirstGet = snapshotAfterFirstGet.autoJobBudget[0]?.used ?? 0;
    const queuedAfterFirstGet = snapshotAfterFirstGet.curationJobs.filter((record) => record.job.kind === "concept_brief").length;

    await requestJsonFromServer(goalServer, "/api/goals?userId=local-user&now=2026-07-08T00:00:00.000Z");
    const snapshotAfterRepeatGet = await requestJsonFromServer(goalServer, "/api/snapshot");
    const queuedAfterRepeatGet = snapshotAfterRepeatGet.curationJobs.filter(
      (record) => record.job.kind === "concept_brief"
    ).length;

    assert.equal(goalsAfterFirstGet.records.length, 1, "GET /api/goals should list active goals");
    assert.equal(
      snapshotAfterRepeatGet.autoJobBudget[0]?.used,
      usedAfterFirstGet,
      "repeated GET /api/goals should not consume budget for duplicate gap jobs"
    );
    assert.equal(
      queuedAfterRepeatGet,
      queuedAfterFirstGet,
      "repeated GET /api/goals should not duplicate concept_brief queue records"
    );

    const goalTimeline = await requestJsonFromServer(
      goalServer,
      "/api/timeline?userId=local-user&now=2026-07-08T00:00:00.000Z"
    );

    assert.ok(
      goalTimeline.posts.some((post) => post.scoreReasons.some((reason) => reason.includes("在你的学习路径上"))),
      "timeline ranking should expose the learning path reason when a card concept hits an active goal path"
    );
    assert.ok(Array.isArray(goalTimeline.timelineBlocks), "timeline API should expose block structure");
    assert.ok(
      goalTimeline.timelineBlocks.some((block) => block.divider?.topicLabel),
      "timeline blocks should expose divider metadata"
    );
    assert.ok(
      goalTimeline.posts.some((post) => post.blockTopic?.source === "learning_goal"),
      "timeline posts should expose their computed blockTopic"
    );

    await requestJsonFromServer(goalServer, "/api/goals", {
      method: "POST",
      body: { concept: "Prerequisite", now: "2026-07-08T00:01:00.000Z" }
    });
    await requestJsonFromServer(goalServer, "/api/goals", {
      method: "POST",
      body: { concept: "Foundation", now: "2026-07-08T00:02:00.000Z" }
    });
    const overLimitResponse = await dispatchToServer(goalServer, `${baseUrl}/api/goals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ concept: "Other Goal", now: "2026-07-08T00:03:00.000Z" })
    });
    const overLimitPayload = await overLimitResponse.json();

    assert.equal(overLimitResponse.status, 400, "POST /api/goals should reject more than 3 active goals");
    assert.match(overLimitPayload.error, /3 active learning goals/, "active goal limit error should explain the cap");

    const archivedGoal = await requestJsonFromServer(
      goalServer,
      `/api/goals/${encodeURIComponent(createdGoal.record.id)}`,
      {
        method: "POST",
        body: { status: "archived" }
      }
    );

    assert.equal(archivedGoal.record.status, "archived", "POST /api/goals/:id should archive a goal");

    const deletedGoal = await requestJsonFromServer(
      goalServer,
      `/api/goals/${encodeURIComponent(createdGoal.record.id)}`,
      {
        method: "DELETE"
      }
    );

    assert.equal(deletedGoal.deleted, true, "DELETE /api/goals/:id should delete a goal");
  } finally {
    await closeServer(goalServer);
  }

  const topicBlocksDataPath = join(tempDir, "topic-blocks-timeline.json");
  const topicBlocksCurationPath = join(tempDir, "topic-blocks-curation.json");
  const topicBlocksNow = "2026-07-08T10:00:00.000Z";
  const topicBlockPosts = [
    makeApiSmokePost({
      id: "alpha-block-1",
      title: "Alpha block 1",
      concepts: ["Alpha"],
      createdAt: "2026-07-08T08:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "alpha-block-2",
      title: "Alpha block 2",
      concepts: ["Alpha"],
      createdAt: "2026-07-08T08:01:00.000Z"
    }),
    makeApiSmokePost({
      id: "alpha-block-3",
      title: "Alpha block 3",
      concepts: ["Alpha"],
      createdAt: "2026-07-08T08:02:00.000Z"
    }),
    makeApiSmokePost({
      id: "beta-block-1",
      title: "Beta block 1",
      concepts: ["Beta"],
      createdAt: "2026-07-08T09:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "beta-block-2",
      title: "Beta block 2",
      concepts: ["Beta"],
      createdAt: "2026-07-08T09:01:00.000Z"
    }),
    makeApiSmokePost({
      id: "beta-block-3",
      title: "Beta block 3",
      concepts: ["Beta"],
      createdAt: "2026-07-08T09:02:00.000Z"
    })
  ];

  await writeFile(
    topicBlocksDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: topicBlocksNow,
      posts: topicBlockPosts,
      userMemories: [
        {
          userId: "local-user",
          updatedAt: topicBlocksNow,
          memory: {
            profile: { interests: ["Beta"], goals: [] },
            knowledge: { knownConcepts: [], weakConcepts: [], savedConcepts: [] },
            interaction: { recentCardIds: [], recentQuestions: [] },
            agent: { topicAgents: [], preferredSourceTypes: [] }
          }
        }
      ]
    })
  );

  const topicBlocksServer = createApiServer({
    dataPath: topicBlocksDataPath,
    curationDataPath: topicBlocksCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const initialTopicBlocksTimeline = await requestJsonFromServer(
      topicBlocksServer,
      `/api/timeline?userId=local-user&now=${encodeURIComponent(topicBlocksNow)}`
    );

    assert.equal(
      initialTopicBlocksTimeline.timelineBlocks[0]?.topic.label,
      "Beta",
      "timeline blocks should initially follow the highest-ranked topic block"
    );

    await requestJsonFromServer(topicBlocksServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: topicBlocksNow,
        signal: {
          postId: "alpha-block-1",
          topicId: "Alpha",
          conceptIds: ["Alpha"],
          impression: true,
          dwellTimeMs: 300000,
          openedThread: false,
          liked: false,
          saved: false,
          askedQuestion: false,
          reviewed: false,
          skippedQuickly: false,
          createdAt: topicBlocksNow
        }
      }
    });

    const dwellBoostedTimeline = await requestJsonFromServer(
      topicBlocksServer,
      `/api/timeline?userId=local-user&now=${encodeURIComponent(topicBlocksNow)}`
    );

    assert.equal(
      dwellBoostedTimeline.timelineBlocks[0]?.topic.label,
      "Alpha",
      "same-day dwell aggregation should change the timeline block order"
    );

    // Dwell reports are cumulative per card and re-sent as they grow: two
    // records for the same post must aggregate as max, not sum.
    for (const dwellTimeMs of [60000, 90000]) {
      await requestJsonFromServer(topicBlocksServer, "/api/signals", {
        method: "POST",
        body: {
          generatedAt: topicBlocksNow,
          signal: {
            postId: "alpha-block-2",
            topicId: "Alpha",
            conceptIds: ["Alpha"],
            impression: true,
            dwellTimeMs,
            openedThread: false,
            liked: false,
            saved: false,
            askedQuestion: false,
            reviewed: false,
            skippedQuickly: false,
            createdAt: topicBlocksNow
          }
        }
      });
    }

    const cumulativeDwellTimeline = await requestJsonFromServer(
      topicBlocksServer,
      `/api/timeline?userId=local-user&now=${encodeURIComponent(topicBlocksNow)}`
    );
    const alphaBlock = cumulativeDwellTimeline.timelineBlocks.find((block) => block.topic.label === "Alpha");

    // alpha-block-1 max 300000 clamped to 120000, alpha-block-2 max(60000, 90000)
    // = 90000 -> 210000ms = 3.5 min * 6 = 21. A sum would give 27.
    assert.equal(
      alphaBlock?.dwellBoost,
      21,
      "cumulative dwell re-sends for the same post should aggregate as per-post max, not sum"
    );
  } finally {
    await closeServer(topicBlocksServer);
  }

  const guaranteeDataPath = join(tempDir, "goal-production-guarantee.json");
  const guaranteeCurationPath = join(tempDir, "goal-production-guarantee-curation.json");
  const guaranteeNow = "2026-07-08T09:00:00.000Z";
  const guaranteePosts = [
    {
      ...makeApiSmokePost({
        id: "guarantee-goal-a-post",
        title: "Guarantee Goal A",
        concepts: ["Guarantee Goal A"],
        createdAt: guaranteeNow
      }),
      graphEdges: [
        {
          id: "guarantee-a-requires-gap",
          sourceConcept: "Guarantee Goal A",
          relation: "requires",
          targetConcept: "Guarantee Gap A",
          evidence: "Guarantee Goal A requires Guarantee Gap A.",
          weight: 0.9
        }
      ]
    },
    {
      ...makeApiSmokePost({
        id: "guarantee-goal-b-post",
        title: "Guarantee Goal B",
        concepts: ["Guarantee Goal B"],
        createdAt: guaranteeNow
      }),
      graphEdges: [
        {
          id: "guarantee-b-requires-gap",
          sourceConcept: "Guarantee Goal B",
          relation: "requires",
          targetConcept: "Guarantee Gap B",
          evidence: "Guarantee Goal B requires Guarantee Gap B.",
          weight: 0.9
        }
      ]
    }
  ];
  const previousBudgetForGuarantee = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "2";

  await writeFile(
    guaranteeDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: guaranteeNow,
      posts: guaranteePosts,
      learningGoals: [
        {
          id: "guarantee-goal-a",
          concept: "Guarantee Goal A",
          createdAt: guaranteeNow,
          status: "active"
        },
        {
          id: "guarantee-goal-b",
          concept: "Guarantee Goal B",
          createdAt: guaranteeNow,
          status: "active"
        }
      ]
    })
  );

  const guaranteeServer = createApiServer({
    dataPath: guaranteeDataPath,
    curationDataPath: guaranteeCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const firstGuaranteeRun = await requestJsonFromServer(guaranteeServer, "/api/curation/run", {
      method: "POST",
      body: { now: guaranteeNow, kinds: ["concept_brief"] }
    });
    const firstGuaranteeSnapshot = await requestJsonFromServer(guaranteeServer, "/api/snapshot");
    const firstGuaranteeJobs = firstGuaranteeSnapshot.curationJobs.filter(
      (record) => record.job.kind === "concept_brief"
    );

    assert.equal(
      firstGuaranteeRun.goalProductionGuarantee.records.length,
      2,
      "daily production guarantee should reserve one production slot per active goal"
    );
    assert.deepEqual(
      firstGuaranteeRun.goalProductionGuarantee.records.map((record) => record.job.topicId).sort(),
      ["Guarantee Gap A", "Guarantee Gap B"],
      "daily production guarantee should use existing gap concept_brief demand"
    );
    assert.equal(
      firstGuaranteeSnapshot.autoJobBudget.find((record) => record.date === "2026-07-08")?.used,
      2,
      "daily production guarantee should consume slots inside the existing budget"
    );
    assert.equal(firstGuaranteeJobs.length, 2, "daily production guarantee should persist queued jobs");

    const repeatedGuaranteeRun = await requestJsonFromServer(guaranteeServer, "/api/curation/run", {
      method: "POST",
      body: { now: "2026-07-08T09:05:00.000Z", kinds: ["concept_brief"] }
    });
    const repeatedGuaranteeSnapshot = await requestJsonFromServer(guaranteeServer, "/api/snapshot");

    assert.equal(
      repeatedGuaranteeRun.goalProductionGuarantee.records.length,
      0,
      "daily production guarantee should be idempotent for a goal already produced today"
    );
    assert.equal(
      repeatedGuaranteeSnapshot.curationJobs.filter((record) => record.job.kind === "concept_brief").length,
      firstGuaranteeJobs.length,
      "daily production guarantee should not duplicate jobs on repeated runs"
    );
    assert.equal(
      repeatedGuaranteeSnapshot.autoJobBudget.find((record) => record.date === "2026-07-08")?.used,
      2,
      "daily production guarantee should not consume more budget on repeated runs"
    );
  } finally {
    await closeServer(guaranteeServer);
    if (previousBudgetForGuarantee === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousBudgetForGuarantee;
    }
  }

  const noDemandDataPath = join(tempDir, "goal-production-no-demand.json");
  const noDemandCurationPath = join(tempDir, "goal-production-no-demand-curation.json");
  const noDemandNow = "2026-07-08T11:00:00.000Z";

  await writeFile(
    noDemandDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: noDemandNow,
      posts: [
        makeApiSmokePost({
          id: "no-demand-goal-post",
          title: "No Demand Goal",
          concepts: ["No Demand Goal"],
          createdAt: noDemandNow
        })
      ],
      learningGoals: [
        {
          id: "no-demand-goal",
          concept: "No Demand Goal",
          createdAt: noDemandNow,
          status: "active"
        }
      ],
      userMemories: [
        {
          userId: "local-user",
          updatedAt: noDemandNow,
          memory: {
            profile: { interests: [], goals: [] },
            knowledge: { knownConcepts: ["No Demand Goal"], weakConcepts: [], savedConcepts: [] },
            interaction: { recentCardIds: [], recentQuestions: [] },
            agent: { topicAgents: [], preferredSourceTypes: [] }
          }
        }
      ]
    })
  );

  const noDemandServer = createApiServer({
    dataPath: noDemandDataPath,
    curationDataPath: noDemandCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const noDemandRun = await requestJsonFromServer(noDemandServer, "/api/curation/run", {
      method: "POST",
      body: { now: noDemandNow, kinds: ["concept_brief"] }
    });
    const noDemandSnapshot = await requestJsonFromServer(noDemandServer, "/api/snapshot");

    assert.equal(
      noDemandRun.goalProductionGuarantee.records.length,
      0,
      "daily production guarantee should not force production when a goal has no existing demand"
    );
    assert.equal(noDemandSnapshot.curationJobs.length, 0, "no-demand goals should not create curation jobs");
  } finally {
    await closeServer(noDemandServer);
  }

  const lowIntervalDataPath = join(tempDir, "mastery-low-interval.json");
  const lowIntervalCurationPath = join(tempDir, "mastery-low-interval-curation.json");
  const lowIntervalConcept = "Low Interval Mastery";
  const lowIntervalPosts = [
    makeApiSmokePost({
      id: "low-interval-a",
      title: "Low interval A",
      concepts: [lowIntervalConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "low-interval-b",
      title: "Low interval B",
      concepts: [lowIntervalConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  ];

  await writeFile(
    lowIntervalDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: lowIntervalPosts,
      reviewStates: [
        { postId: lowIntervalPosts[0].id, intervalDays: 1, dueAt: "2026-06-10T00:00:00.000Z" },
        { postId: lowIntervalPosts[1].id, intervalDays: 7, dueAt: "2026-06-17T00:00:00.000Z" }
      ],
      topicStates: [
        {
          topicId: lowIntervalConcept,
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.78,
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    })
  );

  const lowIntervalServer = createApiServer({
    dataPath: lowIntervalDataPath,
    curationDataPath: lowIntervalCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const lowInterval = await requestJsonFromServer(
      lowIntervalServer,
      `/api/review/${encodeURIComponent(lowIntervalPosts[0].id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: "2026-06-10T00:00:00.000Z" }
      }
    );
    const lowIntervalSnapshot = await requestJsonFromServer(lowIntervalServer, "/api/snapshot");

    assert.deepEqual(lowInterval.masteryPromotions, [], "concepts should not promote when fewer than two cards meet interval rules");
    assert.equal(lowIntervalSnapshot.userMemories.length, 0, "low-interval negative case should not write memory");
  } finally {
    await closeServer(lowIntervalServer);
  }

  const lowScoreDataPath = join(tempDir, "mastery-low-score.json");
  const lowScoreCurationPath = join(tempDir, "mastery-low-score-curation.json");
  const lowScoreConcept = "Low Score Mastery";
  const lowScorePosts = [
    makeApiSmokePost({
      id: "low-score-a",
      title: "Low score A",
      concepts: [lowScoreConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "low-score-b",
      title: "Low score B",
      concepts: [lowScoreConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  ];

  await writeFile(
    lowScoreDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: lowScorePosts,
      reviewStates: [
        { postId: lowScorePosts[0].id, intervalDays: 3, dueAt: "2026-06-10T00:00:00.000Z" },
        { postId: lowScorePosts[1].id, intervalDays: 7, dueAt: "2026-06-17T00:00:00.000Z" }
      ],
      topicStates: [
        {
          topicId: lowScoreConcept,
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.2,
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    })
  );

  const lowScoreServer = createApiServer({
    dataPath: lowScoreDataPath,
    curationDataPath: lowScoreCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const lowScore = await requestJsonFromServer(
      lowScoreServer,
      `/api/review/${encodeURIComponent(lowScorePosts[0].id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: "2026-06-10T00:00:00.000Z" }
      }
    );
    const lowScoreSnapshot = await requestJsonFromServer(lowScoreServer, "/api/snapshot");

    assert.deepEqual(lowScore.masteryPromotions, [], "concepts should not promote when topic comprehension is below threshold");
    assert.equal(lowScoreSnapshot.userMemories.length, 0, "low-score negative case should not write memory");
  } finally {
    await closeServer(lowScoreServer);
  }

  const legacyMasteryDataPath = join(tempDir, "mastery-legacy-compatible.json");
  const legacyMasteryCurationPath = join(tempDir, "mastery-legacy-compatible-curation.json");
  await writeFile(
    legacyMasteryDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z"
    })
  );
  const legacyMasteryServer = createApiServer({
    dataPath: legacyMasteryDataPath,
    curationDataPath: legacyMasteryCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const legacyMasterySnapshot = await requestJsonFromServer(legacyMasteryServer, "/api/snapshot");

    assert.deepEqual(legacyMasterySnapshot.memoryEvents, [], "legacy snapshots without memoryEvents should load compatibly");
    assert.deepEqual(legacyMasterySnapshot.notifications, [], "legacy snapshots without notifications should load compatibly");
    assert.deepEqual(legacyMasterySnapshot.reviewStates, [], "legacy snapshots without reviewStates should load compatibly");
  } finally {
    await closeServer(legacyMasteryServer);
  }

  const subscriptionDataPath = join(tempDir, "subscriptions.json");
  const subscriptionCurationPath = join(tempDir, "subscriptions-curation-jobs.json");
  const subscriptionFeedUrl = "https://feeds.local/aitimeline-rss.xml";
  const subscriptionFeedFixture = `
    <rss version="2.0">
      <channel>
        <title>Subscription Smoke Feed</title>
        <link>https://feeds.local/</link>
        <item>
          <title>RAG retrieval architecture 4</title>
          <link>https://sources.local/rag-4</link>
          <pubDate>Tue, 07 Jul 2026 04:00:00 GMT</pubDate>
          <description>RAG retrieval architecture and evaluation notes.</description>
        </item>
        <item>
          <title>RAG retrieval architecture 3</title>
          <link>https://sources.local/rag-3</link>
          <pubDate>Tue, 07 Jul 2026 03:00:00 GMT</pubDate>
          <description>RAG retrieval quality improves with grounded evaluation.</description>
        </item>
        <item>
          <title>RAG retrieval architecture 2</title>
          <link>https://sources.local/rag-2</link>
          <pubDate>Tue, 07 Jul 2026 02:00:00 GMT</pubDate>
          <description>RAG system design and indexing trade-offs.</description>
        </item>
        <item>
          <title>RAG retrieval architecture 1</title>
          <link>https://sources.local/rag-1</link>
          <pubDate>Tue, 07 Jul 2026 01:00:00 GMT</pubDate>
          <description>RAG notes beyond the single-source import cap.</description>
        </item>
        <item>
          <title>Gardening calendar</title>
          <link>https://sources.local/garden</link>
          <pubDate>Tue, 07 Jul 2026 00:00:00 GMT</pubDate>
          <description>Tomato watering schedule with no relevant AI concepts.</description>
        </item>
      </channel>
    </rss>
  `;
  let subscriptionFeedFetchCount = 0;

  await writeFile(
    subscriptionDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-07T00:00:00.000Z",
      topicStates: [
        {
          topicId: "RAG",
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.7,
          updatedAt: "2026-07-07T00:00:00.000Z"
        }
      ],
      userSettings: { contentLanguage: "en" }
    })
  );

  const subscriptionServer = createApiServer({
    dataPath: subscriptionDataPath,
    curationDataPath: subscriptionCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider,
    feedFetch: async (input) => {
      const url = getFetchUrl(input);

      if (url !== subscriptionFeedUrl) {
        throw new Error(`Unexpected subscription fetch: ${url}`);
      }

      subscriptionFeedFetchCount += 1;
      return new Response(subscriptionFeedFixture, {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      });
    }
  });

  try {
    const legacySubscriptionSnapshot = await requestJsonFromServer(subscriptionServer, "/api/snapshot");

    assert.deepEqual(
      legacySubscriptionSnapshot.subscriptions,
      [],
      "legacy API snapshots without subscriptions should expose an empty subscriptions array"
    );

    const createdSubscription = await requestJsonFromServer(subscriptionServer, "/api/subscriptions", {
      method: "POST",
      body: { url: subscriptionFeedUrl }
    });
    const listedSubscriptions = await requestJsonFromServer(subscriptionServer, "/api/subscriptions");

    assert.equal(createdSubscription.record.title, "Subscription Smoke Feed", "subscription API should store feed title");
    assert.equal(createdSubscription.record.filterMode, "relevant", "subscription API should default to relevant mode");
    assert.equal(listedSubscriptions.records.length, 1, "subscription list API should expose the stored subscription");
    assert.equal(subscriptionFeedFetchCount, 1, "subscription create should validate by fetching the feed once");

    await requestJsonFromServer(subscriptionServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-07T06:00:00.000Z",
        kinds: []
      }
    });

    const subscriptionSnapshot = await requestJsonFromServer(subscriptionServer, "/api/snapshot");
    const subscriptionCandidates = subscriptionSnapshot.sourceCandidates.filter(
      (record) => record.intakeKind === "subscription"
    );
    const subscriptionQueuedJobs = await requestJsonFromServer(subscriptionServer, "/api/curation/jobs?status=queued");
    const subscriptionImportJobs = subscriptionQueuedJobs.jobs.filter((record) => record.job.kind === "import_source");

    assert.equal(subscriptionFeedFetchCount, 2, "first curation run should poll the subscription feed");
    assert.equal(subscriptionCandidates.length, 5, "subscription poll should save all new feed entries as candidates");
    assert.equal(
      subscriptionCandidates.filter((record) => record.status === "queued").length,
      3,
      "relevant subscription polling should queue at most three entries per source"
    );
    assert.equal(
      subscriptionCandidates.filter((record) => record.status === "pending").length,
      2,
      "irrelevant and over-cap subscription entries should remain pending candidates"
    );
    assert.equal(subscriptionImportJobs.length, 3, "subscription import jobs should be enqueued through curation");

    await requestJsonFromServer(subscriptionServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-07T06:00:00.000Z",
        kinds: []
      }
    });

    const subscriptionSnapshotAfterRepeat = await requestJsonFromServer(subscriptionServer, "/api/snapshot");
    const subscriptionQueuedJobsAfterRepeat = await requestJsonFromServer(
      subscriptionServer,
      "/api/curation/jobs?status=queued"
    );

    assert.equal(subscriptionFeedFetchCount, 2, "repeat subscription polling inside 6h should not fetch again");
    assert.equal(
      subscriptionSnapshotAfterRepeat.sourceCandidates.filter((record) => record.intakeKind === "subscription").length,
      5,
      "repeat subscription polling should not duplicate candidates"
    );
    assert.equal(
      subscriptionQueuedJobsAfterRepeat.jobs.filter((record) => record.job.kind === "import_source").length,
      3,
      "repeat subscription polling should not duplicate import jobs"
    );

    await requestJsonFromServer(subscriptionServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-07T11:59:00.000Z",
        kinds: []
      }
    });

    assert.equal(subscriptionFeedFetchCount, 2, "lastPolledAt younger than 6h should skip subscription feed fetch");

    await requestJsonFromServer(subscriptionServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-07T13:00:00.000Z",
        kinds: []
      }
    });

    const subscriptionSnapshotAfterRefetch = await requestJsonFromServer(subscriptionServer, "/api/snapshot");
    const subscriptionQueuedJobsAfterRefetch = await requestJsonFromServer(
      subscriptionServer,
      "/api/curation/jobs?status=queued"
    );

    assert.equal(subscriptionFeedFetchCount, 3, "polling after 6h should fetch the subscription feed again");
    assert.equal(
      subscriptionSnapshotAfterRefetch.sourceCandidates.filter((record) => record.intakeKind === "subscription").length,
      5,
      "re-fetching an unchanged feed should not duplicate candidates"
    );
    assert.equal(
      subscriptionQueuedJobsAfterRefetch.jobs.filter((record) => record.job.kind === "import_source").length,
      3,
      "re-fetching an unchanged feed should not duplicate import jobs"
    );
  } finally {
    await closeServer(subscriptionServer);
  }

  const previousSupplyBudget = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "2";

  const supplyNow = "2026-07-08T12:00:00.000Z";
  const supplyDataPath = join(tempDir, "supply-drought.json");
  const supplyCurationPath = join(tempDir, "supply-drought-curation.json");
  const supplyOldPosts = [
    makeApiSmokePost({
      id: "supply-old-1",
      title: "Supply old card 1",
      concepts: ["Supply"],
      createdAt: "2026-07-04T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "supply-old-2",
      title: "Supply old card 2",
      concepts: ["Supply"],
      createdAt: "2026-07-05T00:00:00.000Z"
    })
  ];
  const recentConnectionNote = {
    ...makeApiSmokePost({
      id: "supply-connection-note",
      title: "Supply recent connection note",
      concepts: ["Supply"],
      createdAt: "2026-07-08T11:00:00.000Z"
    }),
    kind: "connection_note"
  };
  const supplyCandidates = [
    makeSourceCandidateRecord({
      id: "supply-candidate-1",
      url: "https://network-fail.local/supply-1",
      score: 0.99
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-2",
      url: `${baseUrl}/fixtures/article-background?query=supply-2`,
      score: 0.94
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-3",
      url: `${baseUrl}/fixtures/article-background?query=supply-3`,
      score: 0.9
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-4",
      url: `${baseUrl}/fixtures/article-background?query=supply-4`,
      score: 0.86
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-5",
      url: `${baseUrl}/fixtures/article-background?query=supply-5`,
      score: 0.82
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-6",
      url: `${baseUrl}/fixtures/article-background?query=supply-6`,
      score: 0.78
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-unreachable",
      url: `${baseUrl}/fixtures/article-background?query=unreachable`,
      score: 1,
      status: "unreachable"
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-already-queued",
      url: `${baseUrl}/fixtures/article-background?query=already-queued`,
      score: 0.97,
      status: "queued"
    })
  ];
  const existingQueuedImportJob = makeQueuedImportJobRecord(
    supplyCandidates.find((record) => record.id === "supply-candidate-already-queued"),
    supplyNow
  );

  await writeFile(
    supplyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: supplyNow,
      posts: [...supplyOldPosts, recentConnectionNote],
      sourceCandidates: supplyCandidates,
      subscriptions: [
        {
          id: "supply-subscription-1",
          kind: "rss",
          feedUrl: "https://feeds.local/supply-1.xml",
          title: "Supply subscription 1",
          filterMode: "relevant",
          createdAt: "2026-07-01T00:00:00.000Z",
          lastPolledAt: supplyNow
        },
        {
          id: "supply-subscription-2",
          kind: "rss",
          feedUrl: "https://feeds.local/supply-2.xml",
          title: "Supply subscription 2",
          filterMode: "relevant",
          createdAt: "2026-07-01T00:00:00.000Z",
          lastPolledAt: supplyNow
        }
      ],
      reviewStates: [
        {
          postId: "supply-old-1",
          intervalDays: 1,
          dueAt: "2026-07-07T00:00:00.000Z"
        }
      ]
    })
  );
  await writeFile(
    supplyCurationPath,
    JSON.stringify({
      version: 1,
      records: [existingQueuedImportJob]
    })
  );

  const supplyServer = createApiServer({
    dataPath: supplyDataPath,
    curationDataPath: supplyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const droughtTimeline = await requestJsonFromServer(
      supplyServer,
      `/api/timeline?now=${encodeURIComponent(supplyNow)}`
    );

    assert.equal(droughtTimeline.supplyStatus.newCards48h, 0, "connection_note cards should not count as new supply");
    assert.equal(droughtTimeline.supplyStatus.pendingCandidates, 6, "supplyStatus should count pending candidates");
    assert.equal(droughtTimeline.supplyStatus.queuedCandidates, 1, "supplyStatus should count queued candidates");
    assert.equal(droughtTimeline.supplyStatus.activeSubscriptions, 2, "supplyStatus should count active subscriptions");
    assert.equal(droughtTimeline.supplyStatus.queuedImports, 1, "supplyStatus should count queued import_source jobs");
    assert.equal(droughtTimeline.supplyStatus.budgetRemaining, 2, "supplyStatus should expose today's budget remaining");
    assert.equal(droughtTimeline.supplyStatus.reviewDueCount, 1, "supplyStatus should count due review cards");
    assert.equal(droughtTimeline.supplyStatus.drought, true, "old-card supply should be in drought");

    const refillResult = await requestJsonFromServer(supplyServer, "/api/supply/refill", {
      method: "POST",
      body: { now: supplyNow }
    });
    const refillSnapshot = await requestJsonFromServer(supplyServer, "/api/snapshot");
    const refillJobs = await requestJsonFromServer(supplyServer, "/api/curation/jobs?status=queued");
    const refillImportJobs = refillJobs.jobs.filter((record) => record.job.kind === "import_source");

    assert.deepEqual(refillResult, { queued: 2, skipped: 3, budgetRemaining: 0 }, "refill should queue to the budget limit and skip the rest of top-5");
    assert.equal(
      refillSnapshot.autoJobBudget.find((record) => record.date === "2026-07-08")?.used,
      2,
      "refill should consume the daily auto-job budget"
    );
    assert.deepEqual(
      refillImportJobs.map((record) => record.job.sourceCandidate.id).sort(),
      ["supply-candidate-1", "supply-candidate-2", "supply-candidate-already-queued"].sort(),
      "refill should enqueue the highest-scored pending candidates and leave unreachable unselected"
    );
    assert.equal(
      refillSnapshot.sourceCandidates.find((record) => record.id === "supply-candidate-unreachable")?.status,
      "unreachable",
      "unreachable candidates should remain unreachable after refill"
    );

    const repeatRefill = await requestJsonFromServer(supplyServer, "/api/supply/refill", {
      method: "POST",
      body: { now: supplyNow }
    });
    const repeatRefillJobs = await requestJsonFromServer(supplyServer, "/api/curation/jobs?status=queued");

    assert.equal(repeatRefill.queued, 0, "repeat refill should not enqueue duplicates");
    assert.equal(repeatRefill.budgetRemaining, 0, "repeat refill should report exhausted budget");
    assert.equal(
      repeatRefillJobs.jobs.filter((record) => record.job.kind === "import_source").length,
      3,
      "repeat refill should keep the import queue idempotent"
    );

    // Frequency control must be exercised while the drought persists: run the
    // worker twice without executing imports (kinds excludes import_source), so
    // no new cards are produced between the two checks.
    await requestJsonFromServer(supplyServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: supplyNow,
        kinds: ["generate_followup"]
      }
    });
    const stillDroughtTimeline = await requestJsonFromServer(
      supplyServer,
      `/api/timeline?now=${encodeURIComponent(supplyNow)}`
    );

    assert.equal(
      stillDroughtTimeline.supplyStatus.drought,
      true,
      "drought should still hold before the repeat notification check"
    );

    await requestJsonFromServer(supplyServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: supplyNow,
        kinds: ["generate_followup"]
      }
    });
    const persistentDroughtNotifications = await requestJsonFromServer(supplyServer, "/api/notifications");

    assert.equal(
      persistentDroughtNotifications.records.filter((record) => record.kind === "supply_drought").length,
      1,
      "supply_drought notification should not repeat while the drought persists"
    );

    await requestJsonFromServer(supplyServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: supplyNow,
        kinds: ["import_source"]
      }
    });
    const afterNetworkFailureSnapshot = await requestJsonFromServer(supplyServer, "/api/snapshot");
    const afterNetworkNotifications = await requestJsonFromServer(supplyServer, "/api/notifications");

    assert.equal(
      afterNetworkFailureSnapshot.sourceCandidates.find((record) => record.id === "supply-candidate-1")?.status,
      "unreachable",
      "network failed import_source jobs should mark their source candidate unreachable"
    );
    assert.equal(
      afterNetworkFailureSnapshot.sourceCandidates.find((record) => record.id === "supply-candidate-2")?.status,
      "imported",
      "successful refill imports should mark candidates imported"
    );
    assert.equal(
      afterNetworkNotifications.records.filter((record) => record.kind === "supply_drought").length,
      1,
      "worker drought check should create one supply_drought notification"
    );

    const recoveredAfterImportsTimeline = await requestJsonFromServer(
      supplyServer,
      `/api/timeline?now=${encodeURIComponent("2026-07-08T12:05:00.000Z")}`
    );

    assert.equal(
      recoveredAfterImportsTimeline.supplyStatus.drought,
      false,
      "successful imports should lift the drought"
    );

    await requestJsonFromServer(supplyServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-08T12:05:00.000Z",
        kinds: ["import_source"]
      }
    });
    const repeatedNotifications = await requestJsonFromServer(supplyServer, "/api/notifications");

    assert.equal(
      repeatedNotifications.records.filter((record) => record.kind === "supply_drought").length,
      1,
      "no further supply_drought notification should be created once supply recovers"
    );
  } finally {
    await closeServer(supplyServer);
    if (previousSupplyBudget === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousSupplyBudget;
    }
  }

  const supplyRecoveredDataPath = join(tempDir, "supply-recovered.json");
  const supplyRecoveredCurationPath = join(tempDir, "supply-recovered-curation.json");
  await writeFile(
    supplyRecoveredDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: supplyNow,
      posts: [
        makeApiSmokePost({
          id: "supply-new-1",
          title: "Supply new card 1",
          concepts: ["Supply"],
          createdAt: "2026-07-08T10:00:00.000Z"
        }),
        makeApiSmokePost({
          id: "supply-new-2",
          title: "Supply new card 2",
          concepts: ["Supply"],
          createdAt: "2026-07-08T11:00:00.000Z"
        }),
        makeApiSmokePost({
          id: "supply-new-3",
          title: "Supply new card 3",
          concepts: ["Supply"],
          createdAt: "2026-07-08T12:00:00.000Z"
        })
      ]
    })
  );
  const supplyRecoveredServer = createApiServer({
    dataPath: supplyRecoveredDataPath,
    curationDataPath: supplyRecoveredCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const recoveredTimeline = await requestJsonFromServer(
      supplyRecoveredServer,
      `/api/timeline?now=${encodeURIComponent(supplyNow)}`
    );

    assert.equal(recoveredTimeline.supplyStatus.newCards48h, 3, "three recent cards should count as sufficient supply");
    assert.equal(recoveredTimeline.supplyStatus.drought, false, "supplyStatus drought should turn false at the threshold");
  } finally {
    await closeServer(supplyRecoveredServer);
  }

  const legacySupplyDataPath = join(tempDir, "supply-legacy-compatible.json");
  const legacySupplyCurationPath = join(tempDir, "supply-legacy-compatible-curation.json");
  const legacyCandidate = makeSourceCandidateRecord({
    id: "legacy-candidate-without-status",
    url: `${baseUrl}/fixtures/article-background?query=legacy-supply`,
    score: 0.6
  });
  const { status: _status, ...legacyCandidateWithoutStatus } = legacyCandidate;

  await writeFile(
    legacySupplyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: supplyNow,
      sourceCandidates: [legacyCandidateWithoutStatus]
    })
  );
  const legacySupplyServer = createApiServer({
    dataPath: legacySupplyDataPath,
    curationDataPath: legacySupplyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const legacySupplySnapshot = await requestJsonFromServer(legacySupplyServer, "/api/snapshot");

    assert.equal(
      legacySupplySnapshot.sourceCandidates[0]?.status,
      "pending",
      "legacy source candidates without unreachable-era status should normalize to pending"
    );
  } finally {
    await closeServer(legacySupplyServer);
  }

  const weeklyDataPath = join(tempDir, "weekly-recap.json");
  const weeklyCurationPath = join(tempDir, "weekly-recap-curation-jobs.json");
  const weeklyPosts = [
    makeApiSmokePost({
      id: "weekly-api-old",
      title: "Old RAG API card",
      concepts: ["RAG", "Evaluation"],
      createdAt: "2026-06-23T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "weekly-api-new-rag",
      title: "New RAG API card",
      concepts: ["RAG", "Retrieval"],
      createdAt: "2026-06-29T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "weekly-api-new-agent",
      title: "New Agent API card",
      concepts: ["Agent Memory"],
      createdAt: "2026-07-02T00:00:00.000Z"
    })
  ];

  await writeFile(
    weeklyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-06T00:00:00.000Z",
      posts: weeklyPosts,
      reviewStates: [
        {
          postId: "weekly-api-old",
          intervalDays: 3,
          dueAt: "2026-07-03T00:00:00.000Z",
          lastReviewedAt: "2026-07-04T00:00:00.000Z"
        },
        {
          postId: "weekly-api-new-rag",
          intervalDays: 1,
          dueAt: "2026-07-05T00:00:00.000Z"
        }
      ],
      interactionSignals: [
        {
          id: "weekly-api-signal",
          signal: {
            postId: "weekly-api-new-agent",
            topicId: "Agent Memory",
            conceptIds: ["Agent Memory"],
            impression: true,
            dwellTimeMs: 9000,
            openedThread: true,
            liked: false,
            saved: true,
            askedQuestion: false,
            reviewed: true,
            skippedQuickly: false,
            createdAt: "2026-07-02T00:00:00.000Z"
          },
          feedback: {
            postId: "weekly-api-new-agent",
            topicId: "Agent Memory",
            conceptIds: ["Agent Memory"],
            signalStrength: 1,
            inferredState: "needs_review",
            nextAction: "schedule_review",
            reason: "Weekly recap smoke."
          },
          createdAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      userSettings: { contentLanguage: "en" }
    })
  );

  const weeklyServer = createApiServer({
    dataPath: weeklyDataPath,
    curationDataPath: weeklyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const weeklyFirst = await requestJsonFromServer(
      weeklyServer,
      `/api/recap/weekly?now=${encodeURIComponent("2026-07-07T12:00:00.000Z")}`
    );
    const weeklySecond = await requestJsonFromServer(
      weeklyServer,
      `/api/recap/weekly?now=${encodeURIComponent("2026-07-07T12:00:00.000Z")}`
    );
    const weeklySnapshot = await requestJsonFromServer(weeklyServer, "/api/snapshot");

    assert.ok(weeklyFirst.recap, "weekly recap API should lazily generate the latest completed week");
    assert.equal(weeklyFirst.recap.id, weeklySecond.recap.id, "weekly recap API should return the same id on repeat");
    assert.equal(weeklyFirst.recap.stats.newCardCount, 2, "weekly recap API should expose correct new-card count");
    assert.equal(weeklyFirst.recap.stats.newConceptCount, 2, "weekly recap API should expose correct new-concept count");
    assert.equal(weeklyFirst.recap.stats.reviewCompletedCount, 2, "weekly recap API should expose correct review completion count");
    assert.equal(weeklySnapshot.weeklyRecaps.length, 1, "weekly recap API should not duplicate same-week records");

    const weeklySeen = await requestJsonFromServer(weeklyServer, "/api/recap/weekly/seen", {
      method: "POST",
      body: {
        dismissed: true,
        id: weeklyFirst.recap.id,
        seenAt: "2026-07-07T12:30:00.000Z"
      }
    });

    assert.equal(weeklySeen.recap.seenAt, "2026-07-07T12:30:00.000Z", "weekly recap seen endpoint should mark seenAt");
    assert.equal(
      weeklySeen.recap.dismissedAt,
      "2026-07-07T12:30:00.000Z",
      "weekly recap seen endpoint should persist dismissals"
    );
  } finally {
    await closeServer(weeklyServer);
  }

  const shortWeeklyDataPath = join(tempDir, "weekly-recap-short.json");
  const shortWeeklyCurationPath = join(tempDir, "weekly-recap-short-curation-jobs.json");

  await writeFile(
    shortWeeklyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-06T00:00:00.000Z",
      posts: [
        makeApiSmokePost({
          id: "weekly-api-too-new",
          title: "Too new API card",
          concepts: ["Fresh"],
          createdAt: "2026-07-02T00:00:00.000Z"
        })
      ]
    })
  );

  const shortWeeklyServer = createApiServer({
    dataPath: shortWeeklyDataPath,
    curationDataPath: shortWeeklyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const shortWeekly = await requestJsonFromServer(
      shortWeeklyServer,
      `/api/recap/weekly?now=${encodeURIComponent("2026-07-07T12:00:00.000Z")}`
    );

    assert.equal(shortWeekly.recap, null, "weekly recap API should return null when data is younger than a full week");
  } finally {
    await closeServer(shortWeeklyServer);
  }

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

  const boundarySnapshotBefore = await requestJson("/api/snapshot");
  const validBoundarySignal = {
    postId: firstPost.id,
    topicId: firstPost.concepts[0] ?? firstPost.id,
    conceptIds: firstPost.concepts,
    impression: true,
    dwellTimeMs: 1000,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-06-10T00:00:00.000Z"
  };
  const nullBodyResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null"
  });
  const nullBodyPayload = await nullBodyResponse.json();

  assert.equal(nullBodyResponse.status, 400, "JSON null request bodies should be rejected as client errors");
  assert.equal(nullBodyPayload.error, "Request body must be an object.", "null body errors should be stable");

  for (const invalidObjectBody of ["[]", "42", '"scalar"']) {
    const invalidObjectBodyResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: invalidObjectBody
    });

    assert.equal(invalidObjectBodyResponse.status, 400, "array and scalar JSON bodies should return 400");
  }

  const invalidSignals = [
    { ...validBoundarySignal, createdAt: "not-a-date" },
    { ...validBoundarySignal, createdAt: "2026/06/10 00:00:00" },
    { ...validBoundarySignal, createdAt: "2026-02-30T00:00:00.000Z" },
    { ...validBoundarySignal, dwellTimeMs: -1 },
    { ...validBoundarySignal, dwellSeconds: -1 },
    { ...validBoundarySignal, liked: "yes" },
    { ...validBoundarySignal, conceptIds: "not-an-array" },
    { ...validBoundarySignal, postId: "missing-post" }
  ];

  for (const invalidSignal of invalidSignals) {
    const invalidSignalResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signal: invalidSignal })
    });

    assert.equal(invalidSignalResponse.status, 400, "invalid signals should return 400");
  }

  const nonFiniteDwellResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signal: validBoundarySignal }).replace('"dwellTimeMs":1000', '"dwellTimeMs":1e999')
  });

  assert.equal(nonFiniteDwellResponse.status, 400, "non-finite signal dwell should return 400");

  const declaredOversizeResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(1024 * 1024 + 1) },
    body: "{}"
  });
  const declaredOversizePayload = await declaredOversizeResponse.json();

  assert.equal(declaredOversizeResponse.status, 413, "oversized Content-Length should be rejected before reading");
  assert.equal(declaredOversizePayload.error, "Request body is too large.", "413 should return a JSON error");

  let streamedRequestDestroyed = false;
  let streamedRequestResumed = false;
  const streamedOversizeResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: Buffer.alloc(1024 * 1024 + 1, 97),
    onDestroy: () => {
      streamedRequestDestroyed = true;
    },
    onResume: () => {
      streamedRequestResumed = true;
    }
  });
  const streamedOversizePayload = await streamedOversizeResponse.json();

  assert.equal(streamedOversizeResponse.status, 413, "chunked oversized bodies should return 413");
  assert.equal(streamedOversizePayload.error, "Request body is too large.", "streamed 413 should stay JSON");
  assert.equal(streamedRequestDestroyed, false, "streamed body rejection must not destroy the request before 413");
  assert.equal(streamedRequestResumed, true, "streamed body rejection should safely drain the remaining request");

  const boundarySnapshotAfter = await requestJson("/api/snapshot");
  const timelineAfterInvalidSignals = await dispatchToServer(
    server,
    `${baseUrl}/api/timeline?now=2026-06-10T00:00:00.000Z`
  );

  assert.equal(
    boundarySnapshotAfter.interactionSignals.length,
    boundarySnapshotBefore.interactionSignals.length,
    "invalid signals must not be persisted"
  );
  assert.equal(timelineAfterInvalidSignals.status, 200, "timeline should remain healthy after invalid signal attempts");

  const originalConsoleError = console.error;
  const loggedInternalErrors = [];
  let redactedErrorResponse;

  console.error = (...args) => loggedInternalErrors.push(args);

  try {
    redactedErrorResponse = await dispatchToServer(server, `${baseUrl}/api/import/article`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://network-fail.local/private-provider-path" })
    });
  } finally {
    console.error = originalConsoleError;
  }

  const redactedErrorPayload = await redactedErrorResponse.json();

  assert.equal(redactedErrorResponse.status, 500, "unexpected provider failures should return 500");
  assert.equal(redactedErrorPayload.error, "Internal server error.", "500 responses should use a stable message");
  assert.equal(
    JSON.stringify(redactedErrorPayload).includes("network-fail.local"),
    false,
    "500 responses must not expose internal upstream URLs"
  );
  assert.ok(loggedInternalErrors.length > 0, "unexpected error causes should be written to the server log");
  assert.ok(
    loggedInternalErrors.flat().some((value) => String(value).includes("fetch failed")),
    "server logs should retain the detailed unexpected error cause"
  );

  const legacyNotificationDataPath = join(tempDir, "legacy-error-notification.json");
  const legacyNotificationCurationPath = join(tempDir, "legacy-error-notification-curation.json");
  const legacyProviderDetail = "provider body from https://internal-provider.local/private/research";
  const legacyNotification = {
    id: "legacy-research-error-notification",
    kind: "research_progress",
    turnId: "legacy-research-turn",
    question: "What failed?",
    postIds: [],
    body: `Research finished, but every imported source failed or was blocked by validation: ${legacyProviderDetail}`,
    createdAt: "2026-06-10T04:00:00.000Z"
  };
  const legacyFallbackPost = {
    ...makeApiSmokePost({
      id: "legacy-fallback-provider-error",
      title: "Legacy fallback provider error",
      concepts: ["Fallback Redaction"],
      createdAt: legacyNotification.createdAt
    }),
    recommendedBecause:
      `No better source was found, so this same-source follow-up was generated after "Seed card". ${legacyProviderDetail}`
  };

  await writeFile(
    legacyNotificationDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: legacyNotification.createdAt,
      posts: [legacyFallbackPost],
      notifications: [legacyNotification]
    })
  );

  const legacyNotificationServer = createApiServer({
    dataPath: legacyNotificationDataPath,
    curationDataPath: legacyNotificationCurationPath,
    mediaRootDir
  });

  try {
    const listedLegacyNotifications = await requestJsonFromServer(legacyNotificationServer, "/api/notifications");
    const legacyNotificationSnapshot = await requestJsonFromServer(legacyNotificationServer, "/api/snapshot");
    const legacyFallbackTimeline = await requestJsonFromServer(
      legacyNotificationServer,
      "/api/timeline?now=2026-06-10T04:00:00.000Z"
    );
    const readLegacyNotification = await requestJsonFromServer(
      legacyNotificationServer,
      `/api/notifications/${encodeURIComponent(legacyNotification.id)}/read`,
      { method: "POST", body: {} }
    );
    const responseBodies = [
      listedLegacyNotifications.records[0]?.body,
      legacyNotificationSnapshot.notifications[0]?.body,
      readLegacyNotification.record?.body
    ];

    assert.deepEqual(
      responseBodies,
      Array(3).fill(
        "Research finished, but every imported source failed or was blocked by validation: Source import failed."
      ),
      "legacy research failure notifications should expose only a stable failure detail"
    );
    assert.equal(
      JSON.stringify({
        listedLegacyNotifications,
        legacyNotificationSnapshot,
        legacyFallbackTimeline,
        readLegacyNotification
      }).includes(legacyProviderDetail),
      false,
      "notification, snapshot, and timeline APIs must not expose historical provider error text"
    );
    assert.equal(
      legacyFallbackTimeline.posts[0]?.recommendedBecause,
      "No better source was found, so this same-source follow-up was generated.",
      "historical same-source fallback posts should expose only a stable reason"
    );
  } finally {
    await closeServer(legacyNotificationServer);
  }

  const fallbackLeakDataPath = join(tempDir, "deep-dive-fallback-redaction.json");
  const fallbackLeakCurationPath = join(tempDir, "deep-dive-fallback-redaction-curation.json");
  const fallbackLeakNow = "2026-06-10T05:00:00.000Z";
  const fallbackLeakProviderDetail = "https://internal-provider.local/private/deep-dive";
  const fallbackLeakOriginalPostIds = new Set(boundarySnapshotAfter.posts.map((post) => post.id));

  await writeFile(
    fallbackLeakDataPath,
    JSON.stringify({
      ...boundarySnapshotAfter,
      updatedAt: fallbackLeakNow,
      interactionSignals: [],
      topicStates: [],
      sourceCandidates: [],
      autoJobBudget: []
    })
  );
  await writeFile(fallbackLeakCurationPath, JSON.stringify({ version: 1, records: [] }));

  const previousModelName = process.env.AITIMELINE_MODEL_NAME;
  const previousOpenAiModel = process.env.OPENAI_MODEL;
  delete process.env.AITIMELINE_MODEL_NAME;
  delete process.env.OPENAI_MODEL;

  const fallbackLeakServer = createApiServer({
    dataPath: fallbackLeakDataPath,
    curationDataPath: fallbackLeakCurationPath,
    mediaRootDir,
    searchProvider: {
      id: "fallback-leak-smoke",
      async search() {
        return [
          {
            url: "https://fallback-leak.local/new-source",
            title: "Deep-dive source that fails upstream",
            snippet: "A source candidate whose provider failure must never reach a successful fallback card."
          }
        ];
      }
    }
  });

  if (previousModelName === undefined) {
    delete process.env.AITIMELINE_MODEL_NAME;
  } else {
    process.env.AITIMELINE_MODEL_NAME = previousModelName;
  }

  if (previousOpenAiModel === undefined) {
    delete process.env.OPENAI_MODEL;
  } else {
    process.env.OPENAI_MODEL = previousOpenAiModel;
  }

  try {
    const fallbackLeakSignal = await requestJsonFromServer(fallbackLeakServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: fallbackLeakNow,
        signal: {
          postId: firstPost.id,
          topicId: firstPost.concepts[0] ?? firstPost.id,
          conceptIds: firstPost.concepts,
          impression: true,
          dwellTimeMs: 12000,
          openedThread: true,
          liked: true,
          saved: false,
          askedQuestion: false,
          reviewed: false,
          skippedQuickly: false,
          createdAt: fallbackLeakNow
        },
        topicState: {
          topicId: firstPost.concepts[0] ?? firstPost.id,
          interestScore: 0.9,
          fatigueScore: 0.1,
          comprehensionScore: 0.5
        },
        sourceCandidates: []
      }
    });
    const queuedDeepDiveJob = fallbackLeakSignal.plan.jobs.find(
      (job) => job.kind === "discover_sources" && job.nextAction === "continue_deeper"
    );

    assert.ok(queuedDeepDiveJob, "an interested signal should queue a deep-dive follow-up job");

    const previousFallbackConsoleError = console.error;
    const fallbackErrorLogs = [];
    let fallbackLeakBatch;

    console.error = (...args) => fallbackErrorLogs.push(args);

    try {
      fallbackLeakBatch = await requestJsonFromServer(fallbackLeakServer, "/api/curation/run", {
        method: "POST",
        body: { now: "2026-06-10T06:00:00.000Z", kinds: ["discover_sources"] }
      });
    } finally {
      console.error = previousFallbackConsoleError;
    }

    const fallbackLeakSnapshot = await requestJsonFromServer(fallbackLeakServer, "/api/snapshot");
    const safeFallbackPost = fallbackLeakSnapshot.posts.find(
      (post) =>
        !fallbackLeakOriginalPostIds.has(post.id) &&
        typeof post.recommendedBecause === "string" &&
        post.recommendedBecause === "没找到可用的新来源,所以生成了同源跟进卡。"
    );
    const fallbackPayload = JSON.stringify({ fallbackLeakBatch, fallbackLeakSnapshot });

    assert.ok(safeFallbackPost, "a failed deep-dive source should produce a same-source fallback with a stable reason");
    assert.equal(
      fallbackPayload.includes(fallbackLeakProviderDetail),
      false,
      "successful fallback cards and job responses must not expose the original provider failure"
    );
    assert.ok(
      fallbackErrorLogs.flat().some((value) => String(value).includes(fallbackLeakProviderDetail)),
      "deep-dive fallback failures should retain the provider detail in server logs"
    );
  } finally {
    await closeServer(fallbackLeakServer);
  }

  const firstConcept = firstPost.concepts[0];
  const deepReadEnvDataPath = join(tempDir, "deepread-env-fallback.json");
  const deepReadEnvCurationPath = join(tempDir, "deepread-env-fallback-curation.json");
  const deepReadEnvKeys = [
    "AITIMELINE_MODEL_NAME",
    "AITIMELINE_MODEL_API_KEY",
    "AITIMELINE_MODEL_BASE_URL",
    "AITIMELINE_MODEL_DEEPREAD_NAME",
    "AITIMELINE_MODEL_DEEPREAD_API_KEY",
    "AITIMELINE_MODEL_DEEPREAD_BASE_URL"
  ];
  const previousDeepReadEnv = Object.fromEntries(deepReadEnvKeys.map((key) => [key, process.env[key]]));
  let deepReadEnvServer;

  observedDeepReadFallbackRequests.length = 0;

  try {
    process.env.AITIMELINE_MODEL_NAME = "fallback-deepread-model";
    process.env.AITIMELINE_MODEL_API_KEY = "fallback-deepread-key";
    process.env.AITIMELINE_MODEL_BASE_URL = "https://deepread-fallback.local/v1";
    process.env.AITIMELINE_MODEL_DEEPREAD_NAME = "deepread-override-model";
    process.env.AITIMELINE_MODEL_DEEPREAD_API_KEY = "";
    process.env.AITIMELINE_MODEL_DEEPREAD_BASE_URL = "   ";

    await writeFile(
      deepReadEnvDataPath,
      JSON.stringify({
        ...boundarySnapshotAfter,
        updatedAt: "2026-06-15T00:00:00.000Z",
        deepReadArticles: [],
        autoJobBudget: []
      })
    );

    deepReadEnvServer = createApiServer({
      dataPath: deepReadEnvDataPath,
      curationDataPath: deepReadEnvCurationPath,
      mediaRootDir,
      enableFixtures: true,
      searchProvider: fakeSearchProvider
    });
  } finally {
    for (const key of deepReadEnvKeys) {
      if (previousDeepReadEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousDeepReadEnv[key];
      }
    }
  }

  try {
    await requestJsonFromServer(deepReadEnvServer, "/api/deepread", {
      method: "POST",
      body: { topic: firstConcept, now: "2026-06-15T00:00:00.000Z" }
    });
    await requestJsonFromServer(deepReadEnvServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-06-15T00:01:00.000Z",
        limit: 1,
        kinds: ["deep_read_article"]
      }
    });

    assert.ok(
      observedDeepReadFallbackRequests.length > 0,
      "blank deep-read base URL should fall back to the configured default model endpoint"
    );
    assert.equal(
      observedDeepReadFallbackRequests[0].headers.get("authorization"),
      "Bearer fallback-deepread-key",
      "blank deep-read API key should fall back to the configured default model key"
    );
  } finally {
    await closeServer(deepReadEnvServer);
  }

  const briefOpen = await requestJson(`/api/concepts/${encodeURIComponent(firstConcept)}/brief`, {
    method: "POST",
    body: {
      now: "2026-06-10T00:05:00.000Z"
    }
  });

  assert.equal(briefOpen.brief.concept, firstConcept, "concept brief endpoint should return a fallback brief for the concept");
  assert.equal(briefOpen.queued, true, "concept brief endpoint should lazily enqueue a metered job");
  assert.ok(
    briefOpen.brief.sentences.every((sentence) => sentence.cardId),
    "concept brief fallback should keep every sentence traceable to a card"
  );

  const briefBatch = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:06:00.000Z",
      limit: 2,
      kinds: ["concept_brief"]
    }
  });
  const briefSnapshot = await requestJson("/api/snapshot");
  const persistedBrief = briefSnapshot.conceptBriefs.find((brief) => brief.concept === firstConcept);

  assert.ok(
    briefBatch.records.some((record) => record.job.kind === "concept_brief"),
    "curation run should execute queued concept_brief jobs"
  );
  assert.ok(persistedBrief, "concept_brief curation job should persist the generated brief");
  assert.ok(
    persistedBrief.sentences.every((sentence) => persistedBrief.sourceCardIds.includes(sentence.cardId)),
    "persisted concept brief should keep every sentence sourced to a card id"
  );

  const deepReadQueue = await requestJson("/api/deepread", {
    method: "POST",
    body: {
      topic: firstConcept,
      userId: "local-user",
      now: "2026-06-10T00:07:00.000Z"
    }
  });

  assert.equal(deepReadQueue.queued, true, "deep-read endpoint should enqueue a background job");
  assert.ok(
    deepReadQueue.records.some((record) => record.job.kind === "deep_read_article"),
    "deep-read queue response should expose the deep_read_article job"
  );

  let deepReadFrequencyBlocked = false;

  try {
    await requestJson("/api/deepread", {
      method: "POST",
      body: {
        topic: firstConcept,
        userId: "local-user",
        now: "2026-06-10T00:08:00.000Z"
      }
    });
  } catch {
    deepReadFrequencyBlocked = true;
  }

  assert.equal(deepReadFrequencyBlocked, true, "deep-read endpoint should frequency-control to one article per day");

  const deepReadBatch = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:09:00.000Z",
      limit: 1,
      kinds: ["deep_read_article"]
    }
  });
  const generatedDeepRead = deepReadBatch.records.flatMap((record) => record.result?.deepReadArticle ?? [])[0];

  assert.ok(generatedDeepRead, "deep-read worker should generate a fallback article without model config");
  assert.equal(
    generatedDeepRead.runnerKind,
    "deterministic_fallback",
    "network-isolated deep-read worker should use deterministic fallback"
  );
  assert.ok(Array.isArray(generatedDeepRead.discardedMaterials), "deep-read article should include discard list field");
  assert.ok(Array.isArray(generatedDeepRead.deletedParagraphLog), "deep-read article should include deletion log field");

  const deepReadList = await requestJson("/api/deepread");
  const deepReadGet = await requestJson(`/api/deepread/${encodeURIComponent(generatedDeepRead.id)}`);

  assert.ok(
    deepReadList.records.some((record) => record.id === generatedDeepRead.id),
    "deep-read list endpoint should return generated articles"
  );
  assert.equal(deepReadGet.record.id, generatedDeepRead.id, "deep-read detail endpoint should return one article");

  const deepReadSnapshot = await requestJson("/api/snapshot");
  const deepReadRegistryCitations = new Set(
    deepReadSnapshot.sourceRegistries.flatMap((record) =>
      record.registry.chunks.map((chunk) => `${chunk.sourceId}|${chunk.id}`)
    )
  );
  const deepReadParagraphCitations = generatedDeepRead.chapters.flatMap((chapter) =>
    chapter.paragraphs.flatMap((paragraph) => paragraph.citations)
  );
  const deepReadFactParagraphs = generatedDeepRead.chapters.flatMap((chapter) =>
    chapter.paragraphs.filter((paragraph) => paragraph.kind === "fact")
  );

  assert.ok(deepReadFactParagraphs.length > 0, "deep-read smoke should generate at least one factual paragraph");
  assert.ok(
    deepReadFactParagraphs.every((paragraph) => paragraph.citations.length > 0),
    "every factual deep-read paragraph must carry at least one citation"
  );

  assert.ok(
    deepReadParagraphCitations.every((citation) =>
      deepReadRegistryCitations.has(`${citation.sourceId}|${citation.chunkId}`)
    ),
    "every deep-read paragraph citation should resolve to a source registry chunk"
  );

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
    assert.deepEqual(legacySnapshot.weeklyRecaps, [], "legacy snapshots without weeklyRecaps should load with an empty array");
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
  const signalIdempotencyDataPath = join(tempDir, "signal-idempotency.json");
  const signalIdempotencyCurationPath = join(tempDir, "signal-idempotency-curation.json");
  const signalIdempotencyPost = makeApiSmokePost({
    id: "signal-idempotency-post",
    title: "Signal idempotency post",
    concepts: ["Idempotency Budget"],
    createdAt: "2026-06-09T00:00:00.000Z"
  });

  await writeFile(
    signalIdempotencyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-09T00:00:00.000Z",
      posts: [signalIdempotencyPost]
    })
  );

  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "20";
  const signalIdempotencyServer = createApiServer({
    dataPath: signalIdempotencyDataPath,
    curationDataPath: signalIdempotencyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const idempotencyBudgetBody = {
      generatedAt: "2026-06-09T03:00:00.000Z",
      topicState: {
        topicId: "Idempotency Budget",
        interestScore: 0.8,
        fatigueScore: 0.1,
        comprehensionScore: 0.5
      },
      signal: {
        postId: signalIdempotencyPost.id,
        topicId: "Idempotency Budget",
        conceptIds: ["Idempotency Budget"],
        impression: true,
        dwellTimeMs: 18000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: false,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-06-09T03:00:00.000Z"
      }
    };
    await requestJsonFromServer(signalIdempotencyServer, "/api/signals", {
      method: "POST",
      body: idempotencyBudgetBody
    });
    const firstIdempotencySnapshot = await requestJsonFromServer(signalIdempotencyServer, "/api/snapshot");
    const repeatedBudgetSignal = await requestJsonFromServer(signalIdempotencyServer, "/api/signals", {
      method: "POST",
      body: idempotencyBudgetBody
    });
    const repeatedIdempotencySnapshot = await requestJsonFromServer(signalIdempotencyServer, "/api/snapshot");
    const firstIdempotencyBudgetRecord = firstIdempotencySnapshot.autoJobBudget.find(
      (record) => record.date === "2026-06-09"
    );
    const repeatedIdempotencyBudgetRecord = repeatedIdempotencySnapshot.autoJobBudget.find(
      (record) => record.date === "2026-06-09"
    );

    assert.equal(repeatedBudgetSignal.idempotentReplay, true, "identical signal retries should short-circuit");
    assert.equal(firstIdempotencyBudgetRecord?.used, 1, "first signal should consume one automatic-job budget slot");
    assert.equal(repeatedIdempotencyBudgetRecord?.used, 1, "identical signal retry should not consume budget twice");
    assert.equal(
      repeatedIdempotencyBudgetRecord?.discarded,
      firstIdempotencyBudgetRecord?.discarded,
      "identical signal retry should not count as a discarded budget attempt"
    );
    assert.deepEqual(
      repeatedIdempotencySnapshot.topicStates,
      firstIdempotencySnapshot.topicStates,
      "identical signal retry should not update topic state twice"
    );
    assert.equal(
      repeatedIdempotencySnapshot.interactionSignals.length,
      firstIdempotencySnapshot.interactionSignals.length,
      "identical signal retry should keep one signal record"
    );
  } finally {
    await closeServer(signalIdempotencyServer);
  }

  const budgetDataPath = join(tempDir, "budget-aitimeline.json");
  const budgetCurationPath = join(tempDir, "budget-curation-jobs.json");
  const budgetPosts = [
    makeApiSmokePost({
      id: "budget-post",
      title: "Budget post",
      concepts: ["Budget Concept"],
      createdAt: "2026-06-10T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "budget-post-2",
      title: "Budget post 2",
      concepts: ["Budget Concept"],
      createdAt: "2026-06-10T00:00:00.000Z"
    })
  ];

  await writeFile(
    budgetDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: budgetPosts
    })
  );

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
    const firstBudgetBody = {
      generatedAt: "2026-06-10T03:00:00.000Z",
      topicState: {
        topicId: "Budget Concept",
        interestScore: 0.8,
        fatigueScore: 0.1,
        comprehensionScore: 0.8
      },
      signal: budgetSignal
    };
    const firstBudgetSignal = await requestJsonFromServer(budgetServer, "/api/signals", {
      method: "POST",
      body: firstBudgetBody
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

  const memorySnapshotBeforeNoop = await requestJson("/api/snapshot");
  const ignoredMemoryReplacement = await requestJson("/api/memory", {
    method: "POST",
    body: {
      userId: "smoke-user",
      memory: {
        profile: { interests: ["Injected replacement"], goals: [] },
        knowledge: { knownConcepts: ["Injected mastery"], weakConcepts: [], savedConcepts: [] },
        interaction: { recentCardIds: [], recentQuestions: [] },
        agent: { topicAgents: [], preferredSourceTypes: [] }
      },
      edits: []
    }
  });
  const memorySnapshotAfterNoop = await requestJson("/api/snapshot");

  assert.deepEqual(
    ignoredMemoryReplacement.memory,
    memoryResult.memory,
    "memory API should ignore a request-body full-memory replacement"
  );
  assert.deepEqual(ignoredMemoryReplacement.events, [], "empty memory edits should be a no-op");
  assert.equal(
    memorySnapshotAfterNoop.updatedAt,
    memorySnapshotBeforeNoop.updatedAt,
    "empty memory edits should not write a new snapshot"
  );
  assert.equal(
    memorySnapshotAfterNoop.memoryEvents.length,
    memorySnapshotBeforeNoop.memoryEvents.length,
    "empty memory edits should not create audit events"
  );

  const editedFromPersistedMemory = await requestJson("/api/memory", {
    method: "POST",
    body: {
      userId: "smoke-user",
      memory: {
        profile: { interests: ["Injected replacement"], goals: [] },
        knowledge: { knownConcepts: [], weakConcepts: [], savedConcepts: [] },
        interaction: { recentCardIds: [], recentQuestions: [] },
        agent: { topicAgents: [], preferredSourceTypes: [] }
      },
      edits: [{ kind: "add", field: "profile.interests", value: "Persisted baseline" }]
    }
  });

  assert.deepEqual(
    editedFromPersistedMemory.memory.profile.interests,
    ["AI Agents", "Persisted baseline"],
    "memory edits should apply to persisted currentMemory rather than body.memory"
  );

  const candidateSnapshotBeforeUnsupported = await requestJson("/api/snapshot");
  const unsupportedCandidateResponse = await dispatchToServer(server, `${baseUrl}/api/source-candidates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://github.com/example/unsupported-candidate",
      title: "Unsupported repository candidate"
    })
  });
  const unsupportedCandidatePayload = await unsupportedCandidateResponse.json();
  const candidateSnapshotAfterUnsupported = await requestJson("/api/snapshot");

  assert.equal(unsupportedCandidateResponse.status, 400, "inferred unsupported candidate types should return 400");
  assert.match(
    unsupportedCandidatePayload.error,
    /Supported types: article, blog, news, youtube/,
    "unsupported candidate errors should explain the worker-supported types"
  );
  assert.equal(
    candidateSnapshotAfterUnsupported.sourceCandidates.length,
    candidateSnapshotBeforeUnsupported.sourceCandidates.length,
    "unsupported candidates must not be persisted"
  );

  const selfQueuedCandidateResponse = await dispatchToServer(server, `${baseUrl}/api/source-candidates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${baseUrl}/fixtures/article-background?query=self-queued`,
      title: "Self queued candidate",
      status: "queued"
    })
  });
  const candidateSnapshotAfterSelfQueued = await requestJson("/api/snapshot");

  assert.equal(selfQueuedCandidateResponse.status, 400, "candidate intake must not accept a client-supplied queued state");
  assert.equal(
    candidateSnapshotAfterSelfQueued.sourceCandidates.length,
    candidateSnapshotBeforeUnsupported.sourceCandidates.length,
    "a candidate without a matching job must not become permanently queued"
  );

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
  assert.ok(snapshot.deepReadArticles.length >= 1, "snapshot should persist deep-read articles");

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
    destroyed: false,
    complete: false,
    destroy() {
      this.destroyed = true;
      options.onDestroy?.();
    },
    resume() {
      options.onResume?.();
    },
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

  assert.equal(response.ok, true, `${path} should respond with 2xx: ${JSON.stringify(payload)}`);

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

function makeReviewGradePost(id, title, concept) {
  return {
    ...makeApiSmokePost({ id, title, concepts: [concept] }),
    reviewPrompts: [1, 3, 7].map((dueInDays) => ({
      id: `${id}-prompt-${dueInDays}`,
      kind: dueInDays === 1 ? "recall" : dueInDays === 3 ? "compare" : "apply",
      prompt: `${title} prompt for day ${dueInDays}`,
      answerHint: `${title} answer for day ${dueInDays}`,
      dueInDays
    }))
  };
}

function makeInteractionSignalRecord(post, { liked = false, saved = false, createdAt = "2026-06-01T00:00:00.000Z" } = {}) {
  const topicId = post.concepts[0] ?? post.id;
  const signal = {
    postId: post.id,
    topicId,
    conceptIds: post.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked,
    saved,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt
  };

  return {
    id: `signal-${post.id}-${createdAt}`,
    signal,
    feedback: {
      postId: post.id,
      topicId,
      conceptIds: post.concepts,
      signalStrength: liked || saved ? 1 : 0,
      inferredState: liked || saved ? "interested" : "not_relevant",
      nextAction: liked || saved ? "schedule_review" : "continue_deeper",
      reason: "Smoke fixture."
    },
    createdAt
  };
}

function makeSourceCandidateRecord({
  id,
  url,
  score,
  status = "pending",
  concept = "Supply",
  createdAt = "2026-07-08T00:00:00.000Z"
}) {
  const sourceId = `article-${id}`;

  return {
    id,
    candidate: {
      id,
      source: {
        id: sourceId,
        title: `Source candidate ${id}`,
        url,
        type: "article"
      },
      topicId: concept,
      conceptIds: [concept],
      relevanceScore: score,
      noveltyScore: score,
      qualityScore: score,
      reason: `Candidate ${id} is ranked for supply refill.`,
      discoveredAt: createdAt
    },
    status,
    intakeKind: "agent_discovery",
    createdAt,
    updatedAt: createdAt
  };
}

function makeQueuedImportJobRecord(candidateRecord, createdAt) {
  return {
    id: `queued-import-${candidateRecord.candidate.id}`,
    job: {
      id: `queued-import-${candidateRecord.candidate.id}`,
      kind: "import_source",
      topicId: candidateRecord.candidate.topicId,
      conceptIds: candidateRecord.candidate.conceptIds,
      priority: 0.7,
      reason: "Existing queued import smoke fixture.",
      createdAt,
      runAfter: createdAt,
      sourceCandidate: candidateRecord.candidate
    },
    status: "queued",
    attempts: 0,
    createdAt,
    updatedAt: createdAt
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
