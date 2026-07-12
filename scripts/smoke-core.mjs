import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.AITIMELINE_TIMEZONE = "UTC";

const { applyDailyAutoJobBudget, createBackgroundCurationPlan } = await import("../packages/core/dist/agents/backgroundCuration.js");
const { createDeterministicConceptBrief, generateConceptBrief } = await import("../packages/core/dist/agents/conceptBrief.js");
const { runConversationTurn } = await import("../packages/core/dist/agents/conversationAgent.js");
const {
  createDeepReadArticle,
  createDeepReadMaterialContext,
  createDeepReadOutlineContracts,
  dedupeArticleParagraphs,
  gateDeepReadChapter,
  gateDeepReadParagraph,
  selectDeepReadMaterials
} = await import("../packages/core/dist/deepread/index.js");
const { runIdeaObservation } = await import("../packages/core/dist/agents/ideaFlow.js");
const { createStaticSearchProvider } = await import("../packages/core/dist/discovery/searchProvider.js");
const { DISCOVERY_GEO_BAIT_TERMS, planDiscoveryQueries, runSourceDiscovery, screenDiscoveredSources } = await import(
  "../packages/core/dist/discovery/sourceDiscovery.js"
);
const { buildKnowledgeBoundary, classifyConceptZone } = await import(
  "../packages/core/dist/graph/knowledgeBoundary.js"
);
const {
  createInMemoryBackgroundCurationJobStore,
  createPersistentBackgroundCurationJobStore,
  decodeBackgroundCurationJobStoreSnapshot,
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
const { validateClaimSupport, validateGrounding } = await import("../packages/core/dist/harness/groundingGate.js");
const { validateKnowledgePost } = await import("../packages/core/dist/harness/schema.js");
const { createAgentHarnessConfig, defaultAgentHarnessConfig, runDeterministicAgentHarness, selectAgentHarnessInputChunks, validateHarnessPosts } = await import(
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
const { buildSkillTree } = await import("../packages/core/dist/graph/skillTree.js");
const { createOpenAICompatibleModelClient, createOpenAICompatibleModelClientFromEnv } = await import(
  "../packages/core/dist/model/openaiCompatibleClient.js"
);
const { createSourcePostReleasePlan } = await import("../packages/core/dist/ranking/postReleasePlan.js");
const { arrangeTimelineBlocks, resolveCardBlockTopic } = await import(
  "../packages/core/dist/ranking/arrangeTimelineBlocks.js"
);
const { buildWeeklyRecap, buildWeeklyRecapId, getIsoWeekStart } = await import(
  "../packages/core/dist/recap/weeklyRecap.js"
);
const { coalesceInteractionSignals } = await import(
  "../packages/core/dist/interaction/coalesceInteractionSignals.js"
);
const {
  countSeenReadSignalsByPostId,
  filterTimelineLifecycle,
  isPureExposureSignal,
  summarizeLifecycleSignals
} = await import("../packages/core/dist/ranking/lifecycle.js");
const { rankPersonalizedTimeline } = await import("../packages/core/dist/ranking/ranker.js");
const { advanceReviewState, createInitialReviewState, getRestingReviewStates } = await import(
  "../packages/core/dist/review/reviewState.js"
);
const { createOpenAICompatibleSourceImportWorker, createSourceImportWorker } = await import(
  "../packages/core/dist/source/sourceImportWorker.js"
);
const { evaluateSourceQualityDeterministic } = await import("../packages/core/dist/source/sourceQualityGate.js");
const { createAITimelinePersistenceStore, decodeAITimelinePersistenceSnapshot } = await import("../packages/core/dist/storage/persistenceStore.js");
const { readSerializedRevision } = await import("../packages/core/dist/storage/revisionedStorage.js");
const { normalizeSubscriptionFeedUrl, parseSubscriptionFeed } = await import(
  "../packages/core/dist/subscriptions/feedParser.js"
);
const { normalizeMathDelimiters } = await import("../packages/core/dist/text/mathDelimiters.js");
const {
  addDaysToDayKey,
  differenceInDayKeys,
  getDayKey,
  getIsoWeekKey,
  getIsoWeekStartKey,
  getStartOfDayInstant,
  isValidIanaTimeZone,
  resolveTimelineTimeZone
} = await import("../packages/core/dist/time/calendarKeys.js");
const { fetchArticle, parseArxivAtom, transformArticleUrl } = await import(
  "../packages/core/dist/transform/articleImport.js"
);
const { transformUserNote } = await import("../packages/core/dist/transform/noteImport.js");
const { parseArxivHtmlDecomposition } = await import("../packages/core/dist/transform/arxivHtmlImport.js");
const { transformMockYouTubeUrl } = await import("../packages/core/dist/transform/mockYoutubeImport.js");
const { transformYouTubeUrl } = await import("../packages/core/dist/transform/youtubeImport.js");
const { seoWaterSourceFixture, technicalSourceFixture } = await import("../packages/core/dist/fixtures.js");

function createSmokeStorage(read, write) {
  return {
    read,
    write,
    compareAndSwap(expectedRevision, serialized) {
      if (readSerializedRevision(read()) !== expectedRevision) return false;
      write(serialized);
      return true;
    }
  };
}

const w4eMainFixtureRaw = await readFile(new URL("./fixtures/w4e/aitimeline-v1.json", import.meta.url), "utf8");
const w4eQueueFixtureRaw = await readFile(new URL("./fixtures/w4e/curation-jobs-v1.json", import.meta.url), "utf8");
const decodedW4eMainFixture = decodeAITimelinePersistenceSnapshot(w4eMainFixtureRaw);
const decodedW4eQueueFixture = decodeBackgroundCurationJobStoreSnapshot(w4eQueueFixtureRaw, { timeZone: "UTC" });

let roundTripMainRaw = w4eMainFixtureRaw;
const roundTripMainStorage = createSmokeStorage(
  () => roundTripMainRaw,
  (serialized) => { roundTripMainRaw = serialized; }
);
const roundTripMainStore = createAITimelinePersistenceStore(roundTripMainStorage);
assert.equal(roundTripMainStore.flushMigration("2026-07-10T00:00:00.000Z"), true, "v1 main fixture should flush one canonical migration");
const roundTripMainSnapshot = roundTripMainStore.getSnapshot();
assert.equal(roundTripMainSnapshot.revision, 1, "main fixture migration should advance revision exactly once");
const reopenedRoundTripMainStore = createAITimelinePersistenceStore(roundTripMainStorage);
assert.deepEqual(reopenedRoundTripMainStore.getSnapshot(), roundTripMainSnapshot, "main fixture should deep-round-trip after reopen");
assert.equal(reopenedRoundTripMainStore.flushMigration("2026-07-10T00:00:01.000Z"), false, "second main migration flush should be a no-op");

let roundTripQueueRaw = w4eQueueFixtureRaw;
const roundTripQueueStorage = createSmokeStorage(
  () => roundTripQueueRaw,
  (serialized) => { roundTripQueueRaw = serialized; }
);
const roundTripQueueStore = createPersistentBackgroundCurationJobStore(roundTripQueueStorage, [], { timeZone: "UTC" });
assert.equal(roundTripQueueStore.flushMigration(), true, "v1 queue fixture should flush one canonical migration");
const roundTripQueueSnapshot = decodeBackgroundCurationJobStoreSnapshot(roundTripQueueRaw, { timeZone: "UTC" }).snapshot;
assert.equal(roundTripQueueSnapshot.revision, 1, "queue fixture migration should advance revision exactly once");
const reopenedRoundTripQueueStore = createPersistentBackgroundCurationJobStore(roundTripQueueStorage, [], { timeZone: "UTC" });
assert.deepEqual(reopenedRoundTripQueueStore.list(), roundTripQueueStore.list(), "queue fixture should deep-round-trip after reopen");
assert.equal(reopenedRoundTripQueueStore.flushMigration(), false, "second queue migration flush should be a no-op");

assert.equal(decodedW4eMainFixture.snapshot.version, 2, "v1 main fixture should migrate to canonical v2");
assert.equal(decodedW4eMainFixture.snapshot.revision, 0, "v1 main fixture should begin at revision zero");
assert.deepEqual(decodedW4eMainFixture.snapshot.posts[0].thread[0].citations, [], "legacy thread citations should whitelist-migrate to empty");
assert.equal(decodedW4eMainFixture.snapshot.posts[0].thread[0].grounded, false, "legacy thread grounded should fail closed");
assert.equal(decodedW4eMainFixture.snapshot.interactionSignals[0].signal.impression, false, "legacy signal impression should migrate to false");
assert.equal(decodedW4eMainFixture.snapshot.interactionSignals[0].signal.createdAt, decodedW4eMainFixture.snapshot.interactionSignals[0].createdAt, "legacy signal createdAt should inherit owner time");
assert.equal(decodedW4eMainFixture.snapshot.interactionSignals[0].reviewEventId, "w4e-review-event-1", "W1 idempotency ledger must survive decode");
assert.equal(decodedW4eQueueFixture.snapshot.records.length, 5, "v1 queue fixture should preserve all supported statuses");
assert.equal(decodedW4eQueueFixture.snapshot.records.find((record) => record.id === "w4e-root|retry-2")?.originalJobId, "w4e-root", "explicit retry suffix should map to root lineage");
assert.equal(decodedW4eQueueFixture.snapshot.records.find((record) => record.id === "w4e-root|retry-2")?.attempt, 2, "explicit retry suffix should map attempt");
assert.ok(decodedW4eQueueFixture.issues.some((issue) => issue.recordId === "deep-read-opaque-fixture-hash" && issue.severity === "warning"), "unproven opaque retry lineage should emit a conservative warning");
const legacyDeepReadHash = (value) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash.toString(16);
};
const knownOpaqueRootId = `deep-read-${legacyDeepReadHash("fixture-user|persistence|2026-07-03")}`;
const knownOpaqueRetryId = `deep-read-${legacyDeepReadHash("fixture-user|persistence|2026-07-03|retry-3")}`;
const knownOpaqueRecord = structuredClone(JSON.parse(w4eQueueFixtureRaw).records.find((record) => record.id === "w4e-root|retry-2"));
knownOpaqueRecord.id = knownOpaqueRetryId;
knownOpaqueRecord.job.id = knownOpaqueRetryId;
const decodedKnownOpaque = decodeBackgroundCurationJobStoreSnapshot({ version: 1, records: [knownOpaqueRecord] }, { timeZone: "UTC" });
assert.equal(decodedKnownOpaque.snapshot.records[0].originalJobId, knownOpaqueRootId, "known opaque deep-read retry hashes should recover their root id");
assert.equal(decodedKnownOpaque.snapshot.records[0].attempt, 3, "known opaque deep-read retry hashes should recover their attempt");

let appendCasSerialized = w4eMainFixtureRaw;
let injectAppendCompetitor = true;
const appendCasStore = createAITimelinePersistenceStore({
  read: () => appendCasSerialized,
  compareAndSwap(expectedRevision, serialized) {
    if (injectAppendCompetitor) {
      injectAppendCompetitor = false;
      const competing = decodeAITimelinePersistenceSnapshot(appendCasSerialized).snapshot;
      competing.version = 2;
      competing.revision = expectedRevision + 1;
      competing.updatedAt = "2026-07-10T00:00:00.000Z";
      competing.posts[0].thread.push({
        id: "w4e-competing-thread-block",
        kind: "user_comment",
        title: "Competing writer",
        body: "This block won the first CAS."
      });
      appendCasSerialized = JSON.stringify(competing);
      return false;
    }
    if (readSerializedRevision(appendCasSerialized) !== expectedRevision) return false;
    appendCasSerialized = serialized;
    return true;
  }
});
const appendedBlock = {
  id: "w4e-request-thread-block",
  kind: "user_comment",
  title: "Request writer",
  body: "This block rebases after the conflict."
};
const appendedAfterConflict = appendCasStore.appendThreadBlocks("w4e-post-1", [appendedBlock], {
  expectedRevision: 0,
  savedAt: "2026-07-10T00:00:01.000Z"
});
assert.equal(appendedAfterConflict.revision, 2, "append should re-read and commit after an injected CAS conflict");
assert.ok(appendedAfterConflict.posts[0].thread.some((block) => block.id === "w4e-competing-thread-block"), "append CAS retry must preserve the competing block");
assert.ok(appendedAfterConflict.posts[0].thread.some((block) => block.id === appendedBlock.id), "append CAS retry must add the request block");
const appendRevisionBeforeReplay = appendedAfterConflict.revision;
assert.equal(
  appendCasStore.appendThreadBlocks("w4e-post-1", [appendedBlock], { savedAt: "2026-07-10T00:00:02.000Z" }).revision,
  appendRevisionBeforeReplay,
  "replaying an identical block should be an idempotent no-op"
);
assert.throws(
  () => appendCasStore.appendThreadBlocks("w4e-post-1", [{ ...appendedBlock, body: "Collision" }]),
  /Thread block collision/,
  "reusing a block id with different content must fail"
);

let leaseQueueSerialized = JSON.stringify({
  version: 2,
  revision: 0,
  records: [structuredClone(decodedW4eQueueFixture.snapshot.records.find((record) => record.id === "w4e-queued"))]
});
const leaseQueueStorage = createSmokeStorage(
  () => leaseQueueSerialized,
  (serialized) => { leaseQueueSerialized = serialized; }
);
const leaseStoreA = createPersistentBackgroundCurationJobStore(leaseQueueStorage);
const claimA = leaseStoreA.claimNextDueJob("2026-07-10T00:00:00.000Z", {
  workerId: "lease-worker-a",
  leaseDurationMs: 1000
});
assert.equal(claimA?.status, "running", "claim should persist running before execution");
assert.equal(claimA?.attempts, 1, "claim should increment the fencing generation");
const leaseStoreBeforeExpiry = createPersistentBackgroundCurationJobStore(leaseQueueStorage);
assert.equal(
  leaseStoreBeforeExpiry.claimNextDueJob("2026-07-10T00:00:00.500Z", {
    workerId: "lease-worker-b",
    leaseDurationMs: 1000
  }),
  undefined,
  "a reconstructed store must not claim an unexpired running job"
);
const leaseStoreB = createPersistentBackgroundCurationJobStore(leaseQueueStorage);
const claimB = leaseStoreB.claimNextDueJob("2026-07-10T00:00:01.000Z", {
  workerId: "lease-worker-b",
  leaseDurationMs: 1000
});
assert.equal(claimB?.attempts, 2, "claim should recover an expired lease and issue a new fencing generation");
assert.equal(claimB?.startedAt, claimA?.startedAt, "lease recovery must retain the stable first effect time");
assert.throws(
  () => leaseStoreA.renewLease(claimA.id, { workerId: "lease-worker-a", claimGeneration: claimA.attempts }, "2026-07-10T00:00:01.100Z", 1000),
  /owner or generation mismatch/,
  "the expired owner must not renew after another worker reclaims the job"
);
assert.throws(
  () => leaseStoreA.completeClaim(claimA.id, { workerId: "lease-worker-a", claimGeneration: claimA.attempts }, {
    status: "succeeded",
    completedAt: "2026-07-10T00:00:01.100Z",
    result: { kind: claimA.job.kind, message: "stale" }
  }),
  /owner or generation mismatch/,
  "the expired owner must not complete after another worker reclaims the job"
);
const renewedB = leaseStoreB.renewLease(
  claimB.id,
  { workerId: "lease-worker-b", claimGeneration: claimB.attempts },
  "2026-07-10T00:00:01.500Z",
  1000
);
assert.equal(renewedB.leaseUntil, "2026-07-10T00:00:02.500Z", "owner heartbeat should extend leaseUntil");
const completedB = leaseStoreB.completeClaim(
  claimB.id,
  { workerId: "lease-worker-b", claimGeneration: claimB.attempts },
  {
    status: "succeeded",
    completedAt: "2026-07-10T00:00:02.000Z",
    result: { kind: claimB.job.kind, message: "completed by worker B" }
  }
);
assert.equal(completedB.status, "succeeded", "the current fenced owner should complete successfully");

const retryRoot = structuredClone(decodedW4eQueueFixture.snapshot.records.find((record) => record.id === "w4e-root|retry-2"));
const retryStore = createInMemoryBackgroundCurationJobStore([retryRoot]);
const retryThree = retryStore.enqueueRetry(retryRoot.id, "2026-07-10T01:00:00.000Z");
assert.equal(retryThree.originalJobId, "w4e-root", "retry lineage must retain the original job id");
assert.equal(retryThree.attempt, 3, "retry lineage attempt should increase monotonically");
assert.equal(retryStore.get(retryRoot.id)?.status, "failed", "enqueueRetry must not revive the old terminal record");
assert.equal(
  retryStore.enqueueRetry(retryRoot.id, "2026-07-10T01:00:01.000Z").id,
  retryThree.id,
  "a lineage with an active retry should reuse it instead of creating another active record"
);
assert.equal(
  retryStore.list().filter((record) => record.originalJobId === "w4e-root" && ["queued", "running"].includes(record.status)).length,
  1,
  "one retry lineage may have at most one active record"
);
assert.throws(
  () => retryStore.enqueueRetry(retryThree.id, "2026-07-10T01:00:02.000Z"),
  /requires a failed terminal record/,
  "enqueueRetry should reject non-failed records"
);

assert.throws(
  () => decodeBackgroundCurationJobStoreSnapshot({ version: 1, records: {} }),
  /\$\.records: expected an array/,
  "an invalid queue records container must fail startup"
);
const badNestedQueueFixture = JSON.parse(w4eQueueFixtureRaw);
badNestedQueueFixture.records.push({
  ...structuredClone(badNestedQueueFixture.records[0]),
  id: "bad-nested-queue-record",
  job: { ...structuredClone(badNestedQueueFixture.records[0].job), id: "bad-nested-queue-record", priority: "bad" }
});
const decodedBadNestedQueue = decodeBackgroundCurationJobStoreSnapshot(badNestedQueueFixture);
assert.equal(decodedBadNestedQueue.snapshot.records.length, 5, "one bad nested queue record should be quarantined");
assert.ok(
  decodedBadNestedQueue.issues.some((issue) => issue.recordId === "bad-nested-queue-record" && issue.jsonPath.endsWith("job.priority")),
  "quarantined queue records should report their id and nested JSON path"
);
const survivingQueueStore = createInMemoryBackgroundCurationJobStore(decodedBadNestedQueue.snapshot.records);
assert.equal(
  survivingQueueStore.claimNextDueJob("2026-07-10T00:00:00.000Z", {
    workerId: "surviving-record-worker",
    leaseDurationMs: 1000
  })?.id,
  "w4e-running-crash",
  "valid records should remain claimable after a bad nested owner record is isolated"
);

assert.throws(
  () => decodeAITimelinePersistenceSnapshot(JSON.stringify({ ...JSON.parse(w4eMainFixtureRaw), posts: {} })),
  /\$\.posts: expected an array/,
  "invalid collection containers must fail the whole snapshot"
);
const badSignalFixture = JSON.parse(w4eMainFixtureRaw);
badSignalFixture.interactionSignals.push({ ...badSignalFixture.interactionSignals[0], id: "bad-signal", signal: { ...badSignalFixture.interactionSignals[0].signal, createdAt: "bad-date" } });
const decodedWithBadSignal = decodeAITimelinePersistenceSnapshot(badSignalFixture);
assert.equal(decodedWithBadSignal.snapshot.interactionSignals.length, 1, "one invalid signal owner should be quarantined");
assert.ok(decodedWithBadSignal.issues.some((issue) => issue.recordId === "bad-signal" && issue.jsonPath.endsWith("signal.createdAt")), "quarantined records should report path and id at load time");

const timeZoneBoundary = "2026-07-05T16:30:00.000Z";

assert.equal(resolveTimelineTimeZone(), "UTC", "smoke should inject a deterministic timeline timezone");
assert.equal(
  resolveTimelineTimeZone({}),
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  "an explicit empty timezone environment should use the host system timezone"
);
assert.equal(
  getDayKey(timeZoneBoundary),
  "2026-07-05",
  "implicit day keys should honor AITIMELINE_TIMEZONE"
);
assert.equal(
  getDayKey(timeZoneBoundary, "Asia/Shanghai"),
  "2026-07-06",
  "Asia/Shanghai should roll the UTC Sunday instant into Monday"
);
assert.equal(
  getDayKey(timeZoneBoundary, "UTC"),
  "2026-07-05",
  "UTC should keep the boundary instant on Sunday"
);
assert.equal(
  getDayKey("2026-07-06", "America/Los_Angeles"),
  "2026-07-06",
  "a persisted civil day key should not shift through UTC midnight"
);
assert.equal(
  getIsoWeekStartKey(timeZoneBoundary, "Asia/Shanghai"),
  "2026-07-06",
  "Asia/Shanghai week keys should start on the local Monday"
);
assert.equal(
  getIsoWeekStartKey(timeZoneBoundary, "UTC"),
  "2026-06-29",
  "UTC week keys should keep the instant in the preceding ISO week"
);
assert.equal(getIsoWeekKey(timeZoneBoundary, "Asia/Shanghai"), "2026-W28", "local ISO week id should be stable");
assert.equal(getIsoWeekKey(timeZoneBoundary, "UTC"), "2026-W27", "UTC ISO week id should be stable");
const losAngelesWeekStart = getIsoWeekStart("2026-07-08T12:00:00.000Z", "America/Los_Angeles");
assert.equal(
  getDayKey(losAngelesWeekStart, "America/Los_Angeles"),
  "2026-07-06",
  "Date-based ISO week start should resolve to local Monday in a negative-offset timezone"
);
assert.equal(
  getIsoWeekStartKey(losAngelesWeekStart, "America/Los_Angeles"),
  "2026-07-06",
  "Date-based ISO week start should round-trip through the day-key helper"
);
assert.equal(
  getStartOfDayInstant("2018-11-04", "America/Sao_Paulo").toISOString(),
  "2018-11-04T03:00:00.000Z",
  "start-of-day resolution should handle a timezone that skips local midnight"
);
assert.equal(addDaysToDayKey("2026-03-07", 2), "2026-03-09", "civil day addition should ignore DST length");
assert.equal(differenceInDayKeys("2026-03-09", "2026-03-07"), 2, "civil day differences should ignore DST length");
assert.equal(isValidIanaTimeZone("Asia/Shanghai"), true, "valid IANA timezone names should be accepted");
assert.equal(isValidIanaTimeZone("Mars/Olympus"), false, "invalid IANA timezone names should be rejected");
assert.throws(
  () => resolveTimelineTimeZone("Mars/Olympus"),
  /Invalid IANA time zone/,
  "invalid configured timezones should fail fast"
);

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

function makeRankedSmokePost({ id, concept, score, createdAt = "2026-07-08T00:00:00.000Z", kind }) {
  return {
    ...makeSmokePost({
      id,
      title: id,
      concepts: [concept],
      createdAt
    }),
    kind,
    score,
    scoreReasons: [`score ${score}`]
  };
}

function makeSourceQualityInput(fixture, sourceId, url, concepts, title = fixture.title) {
  return {
    source: {
      id: sourceId,
      title,
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

const rssSubscriptionFixture = `
  <rss version="2.0">
    <channel>
      <title>AI Timeline RSS</title>
      <link>https://example.com/</link>
      <item>
        <title><![CDATA[RAG & Agents]]></title>
        <link>https://example.com/rag-agents</link>
        <pubDate>Tue, 07 Jul 2026 00:00:00 GMT</pubDate>
        <description><![CDATA[<p>RAG summary with CDATA.</p>]]></description>
      </item>
      <item>
        <guid>https://example.com/missing-title</guid>
        <dc:date>2026-07-06T00:00:00.000Z</dc:date>
        <description>Missing title should not drop the item.</description>
      </item>
    </channel>
  </rss>
`;
const atomSubscriptionFixture = `
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>AI Timeline Atom</title>
    <link href="https://example.org/" />
    <entry>
      <title>Agent Memory</title>
      <link rel="alternate" href="https://example.org/agent-memory" />
      <updated>2026-07-05T12:00:00Z</updated>
      <summary><![CDATA[Agent <b>memory</b> summary.]]></summary>
    </entry>
    <entry>
      <title>Entry without link tag</title>
      <id>https://example.org/no-link-tag</id>
    </entry>
  </feed>
`;
const parsedRssSubscription = parseSubscriptionFeed(rssSubscriptionFixture, "https://example.com/rss.xml");
const parsedAtomSubscription = parseSubscriptionFeed(atomSubscriptionFixture, "https://example.org/atom.xml");
const parsedBadSubscription = parseSubscriptionFeed("<rss><channel><item></channel></rss>", "https://example.com/bad.xml");

const blockTopicA = { id: "topic-a", label: "Topic A", source: "card_topic" };
const blockTopicB = { id: "topic-b", label: "Topic B", source: "card_topic" };
const blockTopicC = { id: "topic-c", label: "Topic C", source: "card_topic" };
const blockArrangementFixture = [
  makeRankedSmokePost({ id: "a-1", concept: "Topic A", score: 90 }),
  makeRankedSmokePost({ id: "a-2", concept: "Topic A", score: 89 }),
  makeRankedSmokePost({ id: "a-3", concept: "Topic A", score: 88 }),
  makeRankedSmokePost({ id: "review-due", concept: "Review", score: 87 }),
  makeRankedSmokePost({ id: "b-1", concept: "Topic B", score: 95 }),
  makeRankedSmokePost({ id: "b-2", concept: "Topic B", score: 94 }),
  makeRankedSmokePost({ id: "connection-note", concept: "Connection", score: 93, kind: "connection_note" }),
  makeRankedSmokePost({ id: "c-1", concept: "Topic C", score: 86 }),
  makeRankedSmokePost({ id: "c-2", concept: "Topic C", score: 85 }),
  makeRankedSmokePost({ id: "c-3", concept: "Topic C", score: 84 }),
  makeRankedSmokePost({ id: "c-4", concept: "Topic C", score: 83 })
];
const blockTopicsByPostId = Object.fromEntries(
  blockArrangementFixture.map((post) => [
    post.id,
    post.id.startsWith("a-")
      ? blockTopicA
      : post.id.startsWith("b-")
        ? blockTopicB
        : post.id.startsWith("c-")
          ? blockTopicC
          : { id: post.concepts[0], label: post.concepts[0], source: "card_topic" }
  ])
);
const blockArrangement = arrangeTimelineBlocks({
  cards: blockArrangementFixture,
  blockTopicsByPostId,
  interleavedPostIds: ["review-due"]
});

assert.deepEqual(
  blockArrangement.items.map((item) => (item.kind === "block" ? item.block.topic.id : item.card.id)),
  ["topic-a", "review-due", "topic-b", "connection-note", "topic-c"],
  "timeline blocks should keep due review and connection_note cards in their original interleaved positions"
);
assert.deepEqual(
  blockArrangement.blocks.map((block) => block.postIds.length),
  [3, 2, 4],
  "timeline blocks should group new cards into 3-4 card blocks and keep short same-topic blocks short"
);
const fiveCardShortBlockArrangement = arrangeTimelineBlocks({
  cards: [1, 2, 3, 4, 5].map((index) =>
    makeRankedSmokePost({ id: `five-card-${index}`, concept: "Five Card Topic", score: 90 - index })
  ),
  blockTopicsByPostId: Object.fromEntries(
    [1, 2, 3, 4, 5].map((index) => [
      `five-card-${index}`,
      { id: "five-card-topic", label: "Five Card Topic", source: "card_topic" }
    ])
  )
});

assert.deepEqual(
  fiveCardShortBlockArrangement.blocks.map((block) => block.postIds.length),
  [3, 2],
  "a five-card topic should prefer a 3+2 split instead of leaving a singleton short block"
);
assert.equal(blockArrangement.blocks[0].divider.topicLabel, "Topic A", "blocks should expose divider metadata");

const baseOrderArrangement = arrangeTimelineBlocks({
  cards: [
    makeRankedSmokePost({ id: "cold-1", concept: "Cold", score: 70 }),
    makeRankedSmokePost({ id: "cold-2", concept: "Cold", score: 69 }),
    makeRankedSmokePost({ id: "cold-3", concept: "Cold", score: 68 }),
    makeRankedSmokePost({ id: "hot-1", concept: "Hot", score: 86 }),
    makeRankedSmokePost({ id: "hot-2", concept: "Hot", score: 85 }),
    makeRankedSmokePost({ id: "hot-3", concept: "Hot", score: 84 })
  ],
  blockTopicsByPostId: {
    "cold-1": { id: "cold", label: "Cold", source: "card_topic" },
    "cold-2": { id: "cold", label: "Cold", source: "card_topic" },
    "cold-3": { id: "cold", label: "Cold", source: "card_topic" },
    "hot-1": { id: "hot", label: "Hot", source: "card_topic" },
    "hot-2": { id: "hot", label: "Hot", source: "card_topic" },
    "hot-3": { id: "hot", label: "Hot", source: "card_topic" }
  }
});
const dwellOrderArrangement = arrangeTimelineBlocks({
  cards: baseOrderArrangement.blocks.flatMap((block) => block.cards),
  blockTopicsByPostId: {
    "cold-1": { id: "cold", label: "Cold", source: "card_topic" },
    "cold-2": { id: "cold", label: "Cold", source: "card_topic" },
    "cold-3": { id: "cold", label: "Cold", source: "card_topic" },
    "hot-1": { id: "hot", label: "Hot", source: "card_topic" },
    "hot-2": { id: "hot", label: "Hot", source: "card_topic" },
    "hot-3": { id: "hot", label: "Hot", source: "card_topic" }
  },
  topicDwellMs: {
    cold: 300000
  }
});

assert.equal(baseOrderArrangement.blocks[0].topic.id, "hot", "block order should start from the highest block score");
assert.equal(dwellOrderArrangement.blocks[0].topic.id, "cold", "same-day dwell should boost a topic block forward");
assert.deepEqual(
  arrangeTimelineBlocks({
    cards: blockArrangementFixture,
    blockTopicsByPostId,
    interleavedPostIds: ["review-due"]
  }),
  blockArrangement,
  "arranging timeline blocks should be deterministic for identical input"
);

const alternatingArrangement = arrangeTimelineBlocks({
  cards: [
    makeRankedSmokePost({ id: "alt-a-1", concept: "Alt A", score: 99 }),
    makeRankedSmokePost({ id: "alt-a-2", concept: "Alt A", score: 98 }),
    makeRankedSmokePost({ id: "alt-a-3", concept: "Alt A", score: 97 }),
    makeRankedSmokePost({ id: "alt-a-4", concept: "Alt A", score: 96 }),
    makeRankedSmokePost({ id: "alt-a-5", concept: "Alt A", score: 95 }),
    makeRankedSmokePost({ id: "alt-a-6", concept: "Alt A", score: 94 }),
    makeRankedSmokePost({ id: "alt-a-7", concept: "Alt A", score: 93 }),
    makeRankedSmokePost({ id: "alt-a-8", concept: "Alt A", score: 92 }),
    makeRankedSmokePost({ id: "alt-b-1", concept: "Alt B", score: 70 }),
    makeRankedSmokePost({ id: "alt-b-2", concept: "Alt B", score: 69 }),
    makeRankedSmokePost({ id: "alt-b-3", concept: "Alt B", score: 68 })
  ],
  blockTopicsByPostId: Object.fromEntries(
    ["alt-a-1", "alt-a-2", "alt-a-3", "alt-a-4", "alt-a-5", "alt-a-6", "alt-a-7", "alt-a-8", "alt-b-1", "alt-b-2", "alt-b-3"].map(
      (id) => [
        id,
        id.startsWith("alt-a")
          ? { id: "alt-a", label: "Alt A", source: "card_topic" }
          : { id: "alt-b", label: "Alt B", source: "card_topic" }
      ]
    )
  )
});

assert.deepEqual(
  alternatingArrangement.blocks.map((block) => block.topic.id),
  ["alt-a", "alt-b", "alt-a"],
  "blocks should alternate topics when another topic block is available"
);

const aliasGoalTopic = resolveCardBlockTopic(
  makeSmokePost({ id: "alias-hit", title: "Alias Hit", concepts: ["ML"] }),
  [{ id: "goal-ml", label: "Machine Learning", conceptIds: ["Machine Learning"], progressPercent: 60 }],
  [{ canonical: "Machine Learning", aliases: ["ML"], decidedBy: "user", decidedAt: "2026-07-08T00:00:00.000Z" }]
);
const fallbackTopic = resolveCardBlockTopic({
  ...makeSmokePost({ id: "fallback-hit", title: "Fallback Hit", concepts: ["No Goal"] }),
  topicId: "explicit-topic"
});
const laggingGoalTopic = resolveCardBlockTopic(
  makeSmokePost({ id: "multi-hit", title: "Multi Hit", concepts: ["Shared"] }),
  [
    { id: "goal-a", label: "Goal A", conceptIds: ["Shared"], progressPercent: 70, createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "goal-b", label: "Goal B", conceptIds: ["Shared"], progressPercent: 20, createdAt: "2026-07-02T00:00:00.000Z" }
  ]
);

assert.equal(aliasGoalTopic.goalId, "goal-ml", "blockTopic should hit an active goal closure through aliases");
assert.equal(fallbackTopic.id, "explicit-topic", "blockTopic should fall back to the card topicId when no goal matches");
assert.equal(laggingGoalTopic.goalId, "goal-b", "blockTopic should choose the least-progressed goal on multiple matches");

assert.equal(parsedRssSubscription.error, undefined, "RSS subscription fixture should parse without error");
assert.equal(parsedRssSubscription.entries.length, 2, "RSS subscription fixture should keep CDATA and missing-field items");
assert.equal(parsedRssSubscription.entries[0].title, "RAG & Agents", "RSS parser should decode CDATA text");
assert.equal(parsedRssSubscription.entries[0].summary, "RAG summary with CDATA.", "RSS parser should strip summary HTML");
assert.equal(
  parsedRssSubscription.entries[1].title,
  "Untitled feed item",
  "RSS parser should retain entries missing title"
);
assert.equal(parsedAtomSubscription.error, undefined, "Atom subscription fixture should parse without error");
assert.equal(parsedAtomSubscription.entries.length, 2, "Atom subscription fixture should keep missing-link entries");
assert.equal(parsedAtomSubscription.entries[0].link, "https://example.org/agent-memory", "Atom parser should read link href");
assert.equal(
  parsedAtomSubscription.entries[1].link,
  "https://example.org/no-link-tag",
  "Atom parser should fall back to entry id"
);
assert.equal(parsedBadSubscription.entries.length, 0, "bad feed XML should return an empty entries array");
assert.ok(parsedBadSubscription.error, "bad feed XML should return an error instead of throwing");

const parsedEntitySubscription = parseSubscriptionFeed(
  `<rss version="2.0"><channel><title>Entities</title><item><title>It&rsquo;s here &mdash; now &amp; then</title><link>https://example.com/entities</link></item></channel></rss>`,
  "https://example.com/entities.xml"
);

assert.equal(
  parsedEntitySubscription.entries[0].title,
  "It’s here — now & then",
  "feed parser should decode common HTML named entities in titles"
);

const youtubeChannelId = "UCaaaaaaaaaaaaaaaaaaaaaa";
const youtubeFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${youtubeChannelId}`;
const youtubeHandleFetch = async () =>
  new Response(`<html><script>{"channelId":"${youtubeChannelId}"}</script></html>`, {
    status: 200,
    headers: { "content-type": "text/html" }
  });
const normalizedYouTubeByChannel = await normalizeSubscriptionFeedUrl(
  `youtube.com/channel/${youtubeChannelId}`
);
const normalizedYouTubeByFeed = await normalizeSubscriptionFeedUrl(
  `youtube.com/feeds/videos.xml?channel_id=${youtubeChannelId}`
);
const normalizedYouTubeByHandle = await normalizeSubscriptionFeedUrl("youtube.com/@aitimeline", {
  fetch: youtubeHandleFetch
});

assert.equal(normalizedYouTubeByChannel.feedUrl, youtubeFeedUrl, "YouTube channel URL should normalize to feed URL");
assert.equal(normalizedYouTubeByFeed.feedUrl, youtubeFeedUrl, "YouTube feed URL should stay canonical");
assert.equal(normalizedYouTubeByHandle.feedUrl, youtubeFeedUrl, "YouTube handle URL should resolve through fixture HTML");
assert.equal(normalizedYouTubeByHandle.kind, "youtube_channel", "YouTube handle normalization should mark channel kind");

const youtubeCrowdedHandleFetch = async () =>
  new Response(
    `<html><script>{"channelId":"UCbbbbbbbbbbbbbbbbbbbbbb"}</script><script>{"externalId":"${youtubeChannelId}"}</script></html>`,
    {
      status: 200,
      headers: { "content-type": "text/html" }
    }
  );
const normalizedYouTubeCrowdedHandle = await normalizeSubscriptionFeedUrl("youtube.com/@crowded", {
  fetch: youtubeCrowdedHandleFetch
});

assert.equal(
  normalizedYouTubeCrowdedHandle.feedUrl,
  youtubeFeedUrl,
  "handle resolution should prefer the page owner's externalId over an earlier channelId"
);

let legacySubscriptionJson = JSON.stringify({
  version: 1,
  updatedAt: "2026-07-07T00:00:00.000Z"
});
const legacySubscriptionStore = createAITimelinePersistenceStore(createSmokeStorage(
  () => legacySubscriptionJson,
  (serialized) => { legacySubscriptionJson = serialized; }
));

assert.deepEqual(
  legacySubscriptionStore.getSnapshot().subscriptions,
  [],
  "old snapshots without subscriptions should expose an empty subscriptions array"
);

const weeklyRecapWeekStart = "2026-06-29T00:00:00.000Z";
const weeklyRecap = buildWeeklyRecap(
  {
    contentLanguage: "en",
    posts: [
      makeSmokePost({
        id: "weekly-old-rag",
        title: "Old RAG card",
        concepts: ["ＲＡＧ", "Evaluation"],
        createdAt: "2026-06-23T09:00:00.000Z"
      }),
      makeSmokePost({
        id: "weekly-new-rag",
        title: "Weekly RAG card",
        concepts: ["RAG", "Retrieval"],
        createdAt: "2026-06-29T09:00:00.000Z"
      }),
      makeSmokePost({
        id: "weekly-new-agent",
        title: "Weekly Agent card",
        concepts: ["Agent Memory"],
        createdAt: "2026-07-02T09:00:00.000Z"
      }),
      makeSmokePost({
        id: "weekly-future-card",
        title: "Future card",
        concepts: ["Future Concept"],
        createdAt: "2026-07-06T09:00:00.000Z"
      })
    ],
    reviewStates: [
      {
        postId: "weekly-old-rag",
        intervalDays: 3,
        dueAt: "2026-07-03T00:00:00.000Z",
        lastReviewedAt: "2026-07-04T00:00:00.000Z"
      },
      {
        postId: "weekly-new-rag",
        intervalDays: 1,
        dueAt: "2026-07-05T00:00:00.000Z"
      }
    ],
    interactionSignals: [
      {
        postId: "weekly-new-rag",
        topicId: "RAG",
        conceptIds: ["RAG", "Retrieval"],
        impression: true,
        dwellTimeMs: 18000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: true,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-07-01T00:00:00.000Z"
      },
      {
        postId: "weekly-new-agent",
        topicId: "Agent Memory",
        conceptIds: ["Agent Memory"],
        impression: true,
        dwellTimeMs: 8000,
        openedThread: false,
        liked: false,
        saved: true,
        askedQuestion: false,
        reviewed: true,
        skippedQuickly: false,
        createdAt: "2026-07-02T00:00:00.000Z"
      }
    ],
    topicStates: []
  },
  weeklyRecapWeekStart
);

assert.ok(weeklyRecap, "weekly recap should build for a completed cross-week fixture");
assert.equal(weeklyRecap.id, buildWeeklyRecapId(weeklyRecapWeekStart), "weekly recap id should be ISO-week stable");
assert.equal(weeklyRecap.stats.newCardCount, 2, "weekly recap should count cards created in the target week");
assert.equal(weeklyRecap.stats.newConceptCount, 2, "weekly recap should count concepts first seen in the target week");
assert.equal(weeklyRecap.stats.reviewCompletedCount, 2, "weekly recap should count completed reviews in the target week");
assert.equal(weeklyRecap.stats.reviewDueCount, 3, "weekly recap should count due plus completed review posts");
assert.equal(weeklyRecap.stats.topConcepts[0]?.concept, "RAG", "weekly recap should rank the most active concept");
assert.ok(
  weeklyRecap.conceptTrend.points.every(
    (point, index, points) => index === 0 || point.totalConcepts >= points[index - 1].totalConcepts
  ),
  "weekly recap concept trend should be monotonic"
);
assert.equal(
  weeklyRecap.conceptTrend.points[weeklyRecap.conceptTrend.weekStartIndex]?.date,
  "2026-06-29",
  "weekly recap weekStartIndex should point at the target Monday"
);
assert.ok(weeklyRecap.narrative.en.length >= 2, "weekly recap should include English narrative lines");

const weeklyBoundaryPosts = [
  {
    id: "weekly-timezone-baseline",
    concepts: ["Baseline"],
    createdAt: "2026-06-29T00:00:00.000Z"
  },
  {
    id: "weekly-timezone-boundary",
    concepts: ["Timezone Boundary"],
    createdAt: timeZoneBoundary
  }
];
const shanghaiBoundaryRecap = buildWeeklyRecap(
  {
    posts: weeklyBoundaryPosts,
    reviewStates: [],
    interactionSignals: [],
    timeZone: "Asia/Shanghai"
  },
  "2026-07-06"
);
const utcBoundaryRecap = buildWeeklyRecap(
  {
    posts: weeklyBoundaryPosts,
    reviewStates: [],
    interactionSignals: [],
    timeZone: "UTC"
  },
  "2026-07-06"
);

assert.equal(
  shanghaiBoundaryRecap?.stats.newCardCount,
  1,
  "weekly recap should place a Sunday UTC / Monday Shanghai card in the Shanghai week"
);
assert.equal(
  utcBoundaryRecap?.stats.newCardCount,
  0,
  "weekly recap should keep the same instant in the preceding UTC week"
);

const insufficientWeeklyRecap = buildWeeklyRecap(
  {
    posts: [
      makeSmokePost({
        id: "weekly-too-new",
        title: "Too new",
        concepts: ["Fresh"],
        createdAt: "2026-07-02T00:00:00.000Z"
      })
    ],
    reviewStates: [],
    interactionSignals: [],
    topicStates: []
  },
  weeklyRecapWeekStart
);

assert.equal(insufficientWeeklyRecap, null, "weekly recap should not build when the library is younger than a full week");

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
const neutralTitleGateVerdict = evaluateSourceQualityDeterministic(
  makeSourceQualityInput(
    technicalSourceFixture,
    "neutral-title-source",
    "https://example.com/speculative-decoding-evaluation",
    ["Speculative Decoding", "LLM serving"],
    "Speculative decoding latency evaluation"
  )
);
const baitTitleGateVerdict = evaluateSourceQualityDeterministic(
  makeSourceQualityInput(
    technicalSourceFixture,
    "bait-title-source",
    "https://example.com/speculative-decoding-explained-part-2",
    ["Speculative Decoding", "LLM serving"],
    "Speculative decoding explained Part 2"
  )
);

assert.equal(seoGateVerdict.verdict, "reject", "deterministic source gate should reject SEO water");
assert.ok(seoGateVerdict.reasons.length > 0, "rejected sources should include reasons");
assert.equal(technicalGateVerdict.verdict, "accept", "deterministic source gate should accept a normal technical article");
assert.ok(
  baitTitleGateVerdict.score < neutralTitleGateVerdict.score,
  "series/explained title bait should visibly reduce deterministic source quality score"
);
assert.equal(
  baitTitleGateVerdict.verdict,
  "accept",
  "series/explained title bait alone should not reject an otherwise technical source"
);

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
const duplicatePersistence = createAITimelinePersistenceStore(createSmokeStorage(
  () => duplicateSnapshotJson,
  (serialized) => { duplicateSnapshotJson = serialized; }
));
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
assert.equal(
  applyDailyAutoJobBudget({
    plan: budgetPlan,
    limit: 1,
    now: timeZoneBoundary,
    timeZone: "Asia/Shanghai"
  }).budget.date,
  "2026-07-06",
  "daily auto-job budgets should reset on the configured civil day"
);
assert.equal(
  applyDailyAutoJobBudget({ plan: budgetPlan, limit: 1, now: timeZoneBoundary, timeZone: "UTC" }).budget.date,
  "2026-07-05",
  "daily auto-job budgets should retain UTC day boundaries when configured"
);

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

const requiredKnowledgeBlocks = ["explain", "example", "contrast", "extension", "quiz"];
const fallbackKnowledgeBlocks = result.cards[0].thread.filter((block) => requiredKnowledgeBlocks.includes(block.kind));

assert.deepEqual(
  fallbackKnowledgeBlocks.map((block) => block.kind),
  requiredKnowledgeBlocks,
  "deterministic fallback should produce all five required knowledge blocks"
);
assert.ok(
  fallbackKnowledgeBlocks.every((block) => block.body.replace(/\s+/g, "").length >= 80),
  "deterministic fallback Chinese knowledge blocks should meet the depth guideline"
);
assert.ok(
  validateKnowledgePost(result.cards[0]).issues.every(
    (issue) => issue.severity !== "warning" || !/thinner than the content-depth/.test(issue.message)
  ),
  "deterministic fallback knowledge blocks should not trigger thin-block warnings"
);

const articleSamplingSource = {
  id: "sampling-article",
  title: "Sampling fixture",
  url: "https://example.com/sampling",
  type: "article"
};
const articleSamplingChunks = Array.from({ length: 18 }, (_, index) => ({
  id: `sampling-article-chunk-${index + 1}`,
  sourceId: articleSamplingSource.id,
  content: `Sampling paragraph ${index + 1} explains durable context selection for Article Sampling and Known Concept with enough distinct words to form a registered chunk.`,
  conceptHints: index === 12 ? ["Known Concept"] : ["Article Sampling"]
}));
const articleSamplingUserContext = {
  knownConcepts: ["Known Concept"],
  weakConcepts: ["Weak Concept"],
  topicStates: [
    {
      topicId: "Known Concept",
      interestScore: 0.8,
      fatigueScore: 0.1,
      comprehensionScore: 0.7
    }
  ]
};
const sampledArticleChunks = selectAgentHarnessInputChunks(
  {
    source: articleSamplingSource,
    chunks: articleSamplingChunks,
    userContext: articleSamplingUserContext
  },
  createAgentHarnessConfig()
);

assert.ok(sampledArticleChunks.length > 4, "ordinary article sampling should include more than four chunks");
assert.ok(sampledArticleChunks.length <= 16, "ordinary article sampling should cap model context at sixteen chunks");
assert.ok(
  sampledArticleChunks.some((chunk) => chunk.id === "sampling-article-chunk-13"),
  "ordinary article sampling should prioritize chunks that match userContext concepts"
);

const deterministicSamplingResult = runDeterministicAgentHarness({
  source: articleSamplingSource,
  chunks: articleSamplingChunks,
  userContext: articleSamplingUserContext,
  createdAt: "2026-06-10T00:00:00.000Z"
});
let capturedModelMessages = [];
const samplingModelRunner = createModelKnowledgePostRunner({
  client: {
    async complete(request) {
      capturedModelMessages = request.messages;
      return {
        content: JSON.stringify({ posts: [deterministicSamplingResult.posts[0]] })
      };
    }
  },
  maxRepairAttempts: 0
});

await samplingModelRunner.run({
  source: articleSamplingSource,
  chunks: articleSamplingChunks,
  userContext: articleSamplingUserContext,
  createdAt: "2026-06-10T00:00:00.000Z"
});

const capturedPrompt = capturedModelMessages.map((message) => message.content).join("\n");

assert.ok(
  capturedPrompt.includes("sampling-article-chunk-13") && capturedPrompt.includes("sampling-article-chunk-16"),
  "model input for ordinary article import should contain sampled chunks beyond the first four"
);
assert.ok(
  capturedPrompt.includes("Known Concept") && capturedPrompt.includes("Weak Concept"),
  "model input should include fixture userContext concepts"
);

const conceptBrief = createDeterministicConceptBrief({
  concept: "Sampling Concept",
  cards: deterministicSamplingResult.posts.slice(0, 3).map((post) => ({
    id: post.id,
    title: post.title,
    keyTakeaway: post.keyTakeaway,
    concepts: post.concepts,
    createdAt: post.createdAt,
    graphEdges: post.graphEdges
  })),
  reviewCount: 1,
  contentLanguage: "zh",
  createdAt: "2026-06-10T00:00:00.000Z"
});
const conceptBriefCardIds = new Set(conceptBrief.sourceCardIds);

assert.ok(conceptBrief.sentences.length >= 3, "concept_brief fallback should produce a multi-sentence brief");
assert.ok(
  conceptBrief.sentences.every((sentence) => conceptBriefCardIds.has(sentence.cardId)),
  "concept_brief fallback should make every sentence traceable to a source card id"
);

const fullWidthRagBrief = createDeterministicConceptBrief({
  concept: "RAG",
  cards: [
    {
      id: "full-width-rag-brief-card",
      title: "RAG retrieval context",
      keyTakeaway: "Retrieval supplies grounded context before generation.",
      concepts: ["ＲＡＧ", "Retrieval"],
      createdAt: "2026-06-10T00:00:00.000Z",
      graphEdges: [
        {
          sourceConcept: "ＲＡＧ",
          targetConcept: "Retrieval",
          relation: "requires"
        }
      ]
    }
  ],
  contentLanguage: "en",
  createdAt: "2026-06-10T00:00:00.000Z"
});

assert.deepEqual(
  fullWidthRagBrief.adjacentConcepts.map((record) => record.concept),
  ["Retrieval"],
  "concept briefs should match full-width and half-width forms through the shared concept key"
);

let conceptKeyPersistenceSnapshot = "";
const conceptKeyPersistence = createAITimelinePersistenceStore(createSmokeStorage(
  () => conceptKeyPersistenceSnapshot,
  (serialized) => { conceptKeyPersistenceSnapshot = serialized; }
));
const conceptKeyPersistenceResult = conceptKeyPersistence.saveConceptBriefs(
  [
    { ...fullWidthRagBrief, id: "full-width-rag-brief", concept: "ＲＡＧ" },
    { ...fullWidthRagBrief, id: "half-width-rag-brief", concept: "RAG" }
  ],
  "2026-06-10T00:01:00.000Z"
);

assert.equal(
  conceptKeyPersistenceResult.conceptBriefs.length,
  1,
  "persistence should upsert full-width and half-width concept labels under one shared key"
);
assert.equal(
  conceptKeyPersistenceResult.conceptBriefs[0]?.concept,
  "RAG",
  "the latest concept brief should replace an equivalent full-width concept entry"
);

const briefSourcePost = deterministicSamplingResult.posts[0];
const modelConceptBriefInput = {
  concept: "Sampling Concept",
  cards: [
    {
      id: briefSourcePost.id,
      title: briefSourcePost.title,
      keyTakeaway: briefSourcePost.keyTakeaway,
      concepts: briefSourcePost.concepts,
      createdAt: briefSourcePost.createdAt,
      graphEdges: briefSourcePost.graphEdges
    }
  ],
  reviewCount: 1,
  contentLanguage: "en",
  createdAt: "2026-06-10T00:00:00.000Z"
};
const hallucinatedModelBrief = await generateConceptBrief(modelConceptBriefInput, {
  client: {
    async complete() {
      return {
        content: JSON.stringify({
          sentences: [
            {
              text: "Aspirin guarantees immortality and cures cancer.",
              cardId: briefSourcePost.id
            }
          ]
        })
      };
    }
  }
});

assert.equal(
  hallucinatedModelBrief.runnerKind,
  "deterministic",
  "concept brief should fall back when a model sentence is not supported by its cited card"
);

const markedHallucinatedModelBrief = await generateConceptBrief(modelConceptBriefInput, {
  client: {
    async complete() {
      return {
        content: JSON.stringify({
          sentences: [
            {
              text: "[beyond source] Aspirin guarantees immortality.",
              cardId: briefSourcePost.id
            }
          ]
        })
      };
    }
  }
});

assert.equal(
  markedHallucinatedModelBrief.runnerKind,
  "deterministic",
  "a beyond-source marker must not bypass Concept Brief card support"
);

const twoAnchorHallucinatedModelBrief = await generateConceptBrief(modelConceptBriefInput, {
  client: {
    async complete() {
      return {
        content: JSON.stringify({
          sentences: [
            {
              text: "Article Sampling guarantees immortality and cancer cures.",
              cardId: briefSourcePost.id
            }
          ]
        })
      };
    }
  }
});

assert.equal(
  twoAnchorHallucinatedModelBrief.runnerKind,
  "deterministic",
  "two retrieval anchors must not carry an unsupported Concept Brief predicate"
);

const highCopyHallucinatedModelBrief = await generateConceptBrief(modelConceptBriefInput, {
  client: {
    async complete() {
      return {
        content: JSON.stringify({
          sentences: [
            {
              text: `${briefSourcePost.keyTakeaway.replace(/[.!?。！？]+$/u, "")} guaranteeing immortality.`,
              cardId: briefSourcePost.id
            }
          ]
        })
      };
    }
  }
});

assert.equal(
  highCopyHallucinatedModelBrief.runnerKind,
  "deterministic",
  "a high-copy Concept Brief sentence with an unsupported tail must fall back"
);

const supportedModelBrief = await generateConceptBrief(modelConceptBriefInput, {
  client: {
    async complete() {
      return {
        content: JSON.stringify({
          sentences: [{ text: briefSourcePost.keyTakeaway, cardId: briefSourcePost.id }]
        })
      };
    }
  }
});

assert.equal(supportedModelBrief.runnerKind, "model", "a card-supported concept brief sentence should use the model path");
assert.equal(
  normalizeMathDelimiters("Inline \\(a+b\\) and display \\[c=d\\]"),
  "Inline $a+b$ and display $$c=d$$",
  "math delimiter normalization should convert \\(...\\) and \\[...\\] before rendering"
);

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
assert.equal(
  buildConceptDigest("a-concept-no-card-mentions", result.cards).cardCount,
  0,
  "an unknown concept should produce an empty digest"
);

const requiresDigestCards = [
  makeSmokePost({
    id: "requires-dependent",
    title: "Dependent before prerequisite",
    concepts: ["Advanced Topic"],
    createdAt: "2026-06-01T00:00:00.000Z",
    graphEdges: [
      {
        id: "requires-edge",
        sourceConcept: "Advanced Topic",
        relation: "requires",
        targetConcept: "Foundation Topic",
        evidence: "Advanced Topic requires Foundation Topic.",
        weight: 0.88
      }
    ]
  }),
  makeSmokePost({
    id: "requires-prerequisite",
    title: "Prerequisite created later",
    concepts: ["Foundation Topic"],
    createdAt: "2026-06-03T00:00:00.000Z"
  })
];
const requiresDigest = buildConceptDigest("Foundation Topic", requiresDigestCards);

assert.deepEqual(
  requiresDigest.entries.map((entry) => entry.cardId),
  ["requires-prerequisite", "requires-dependent"],
  "concept digest entries should follow requires topology before createdAt"
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

const conflictingSourceAliases = [
  { canonical: "Alpha Auto", aliases: ["ＲＡＧ"], decidedBy: "auto", decidedAt: "2026-07-06T02:00:00.000Z" },
  { canonical: "Zulu User", aliases: ["RAG"], decidedBy: "user", decidedAt: "2026-07-06T01:00:00.000Z" }
];

for (const orderedAliases of [conflictingSourceAliases, [...conflictingSourceAliases].reverse()]) {
  assert.equal(
    resolveConcept("ＲＡＧ", orderedAliases),
    "Zulu User",
    "user alias decisions should override conflicting automatic aliases regardless of record order"
  );
}

const aliasProvenanceRecords = [
  { canonical: "Alpha Mixed", aliases: ["Provenance Alias"], decidedBy: "auto", decidedAt: "2026-07-06T05:00:00.000Z" },
  { canonical: "Alpha Mixed", aliases: ["Different User Alias"], decidedBy: "user", decidedAt: "2026-07-06T06:00:00.000Z" },
  { canonical: "Zulu Explicit", aliases: ["Provenance Alias"], decidedBy: "user", decidedAt: "2026-07-06T04:00:00.000Z" }
];

for (const orderedAliases of [aliasProvenanceRecords, [...aliasProvenanceRecords].reverse()]) {
  assert.equal(
    resolveConcept("Provenance Alias", orderedAliases),
    "Zulu Explicit",
    "alias conflict priority should retain each raw edge's decision provenance"
  );
}

let aliasProvenancePersistenceJson = "";
const aliasProvenancePersistence = createAITimelinePersistenceStore(createSmokeStorage(
  () => aliasProvenancePersistenceJson,
  (serialized) => { aliasProvenancePersistenceJson = serialized; }
));
const persistedAliasProvenance = aliasProvenancePersistence.saveConceptAliases(
  aliasProvenanceRecords,
  "2026-07-06T07:00:00.000Z"
).conceptAliases;

assert.equal(
  resolveConcept("Provenance Alias", persistedAliasProvenance),
  "Zulu Explicit",
  "persistence normalization should preserve per-alias user/auto provenance"
);

const samePriorityAliases = [
  { canonical: "Zulu Auto", aliases: ["Shared Alias"], decidedBy: "auto", decidedAt: "2026-07-06T03:00:00.000Z" },
  { canonical: "Alpha Auto", aliases: ["Shared Alias"], decidedBy: "auto", decidedAt: "2026-07-06T03:00:00.000Z" }
];

for (const orderedAliases of [samePriorityAliases, [...samePriorityAliases].reverse()]) {
  assert.equal(
    resolveConcept("Shared Alias", orderedAliases),
    "Alpha Auto",
    "same-priority alias conflicts should use a deterministic canonical-key tie-break"
  );
}

const newestSamePriorityAliases = [
  { canonical: "Older User", aliases: ["Latest Alias"], decidedBy: "user", decidedAt: "2026-07-06T03:00:00.000Z" },
  { canonical: "Newer User", aliases: ["Latest Alias"], decidedBy: "user", decidedAt: "2026-07-06T04:00:00.000Z" }
];

for (const orderedAliases of [newestSamePriorityAliases, [...newestSamePriorityAliases].reverse()]) {
  assert.equal(
    resolveConcept("Latest Alias", orderedAliases),
    "Newer User",
    "same-priority alias conflicts should prefer the newest decision regardless of record order"
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

const shanghaiBoundaryLimitedNote = createConnectionNoteForImport({
  existingPosts: [
    ...connectionOldPosts,
    { ...batchNote, id: "connection-note-shanghai-boundary", createdAt: "2026-07-05T16:30:00.000Z" }
  ],
  newPosts: [connectionNewPost],
  now: "2026-07-06T15:30:00.000Z",
  dailyLimit: 1,
  timeZone: "Asia/Shanghai"
});

assert.equal(
  shanghaiBoundaryLimitedNote,
  null,
  "connection-note daily limits should compare civil days in the configured timezone"
);

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

const registeredOtherSource = {
  id: "registered-other-source",
  title: "Registered other source",
  url: "https://example.com/registered-other-source",
  type: "article"
};
const registeredOtherChunk = {
  id: "registered-other-chunk",
  sourceId: registeredOtherSource.id,
  content: "This chunk belongs only to the registered other source."
};
const sourceChunkMismatchRegistry = {
  ...result.sourceRegistry,
  sources: [...result.sourceRegistry.sources, registeredOtherSource],
  chunks: [...result.sourceRegistry.chunks, registeredOtherChunk]
};
const sourceChunkMismatchCard = {
  ...contractCard,
  citations: [
    {
      ...contractCard.citations[0],
      sourceId: registeredOtherSource.id,
      chunkId: contractCard.citations[0].chunkId
    }
  ]
};
const sourceChunkMismatchGrounding = validateGrounding(sourceChunkMismatchCard, sourceChunkMismatchRegistry);

assert.equal(
  sourceChunkMismatchGrounding.valid,
  false,
  "citation sourceId/chunkId pairs should fail when both exist but the chunk belongs to another source"
);
assert.ok(
  sourceChunkMismatchGrounding.issues.some(
    (issue) => issue.severity === "error" && /must belong to the cited sourceId/.test(issue.message)
  ),
  "source/chunk ownership failures should be explicit gate errors"
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
const hallucinatedMediaCaptionCard = {
  ...contractCard,
  id: `${contractCard.id}-hallucinated-media-caption`,
  media: [
    {
      assetId: smokeImageAsset.id,
      caption: `${smokeImageAsset.caption} 999 unicorns prove immortality.`,
      origin: "paper"
    }
  ]
};
const signedCaptionRegistry = {
  ...registryWithSmokeImage,
  assets: registryWithSmokeImage.assets.map((asset) =>
    asset.id === smokeImageAsset.id && asset.kind === "image"
      ? { ...asset, caption: "Figure 1: Accuracy increased by +5%." }
      : asset
  )
};
const signedCaptionReversalCard = {
  ...contractCard,
  id: `${contractCard.id}-signed-caption-reversal`,
  media: [
    {
      assetId: smokeImageAsset.id,
      caption: "Figure 1: Accuracy increased by -5%.",
      origin: "paper"
    }
  ]
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
  validateHarnessPosts([hallucinatedMediaCaptionCard], defaultAgentHarnessConfig, registryWithSmokeImage)[0].valid,
  false,
  "media captions should fail when they do not match the registered image caption"
);
assert.equal(
  validateHarnessPosts([signedCaptionReversalCard], defaultAgentHarnessConfig, signedCaptionRegistry)[0].valid,
  false,
  "media caption comparison must preserve semantically meaningful numeric signs"
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

const probeChunkId = contractCard.citations[0].chunkId;
const validateSummaryAgainstEvidence = (summary, evidenceText) => {
  const probeRegistry = {
    ...result.sourceRegistry,
    chunks: result.sourceRegistry.chunks.map((chunk) =>
      chunk.id === probeChunkId ? { ...chunk, content: evidenceText, conceptHints: [] } : chunk
    )
  };

  return validateGrounding({ ...contractCard, summary }, probeRegistry);
};

const aspirinHallucination = validateSummaryAgainstEvidence(
  "Aspirin guarantees immortality and cures cancer.",
  "Aspirin can reduce ordinary pain."
);

assert.equal(
  aspirinHallucination.checks.find((check) => check.fieldPath === "$.summary")?.status,
  "failed",
  "a single shared noun must not support an unrelated strong factual claim"
);

const appendedAspirinHallucination = validateSummaryAgainstEvidence(
  "Aspirin can reduce ordinary pain, guaranteeing immortality.",
  "Aspirin can reduce ordinary pain."
);

assert.equal(
  appendedAspirinHallucination.checks.find((check) => check.fieldPath === "$.summary")?.status,
  "failed",
  "a supported clause must not mask an appended unsupported factual clause"
);

const reversedDirectionGrounding = validateSummaryAgainstEvidence(
  "Throughput decreased by -5% in 2024.",
  "Throughput increased by +5% in 2024."
);
const reversedDirectionCheck = reversedDirectionGrounding.checks.find((check) => check.fieldPath === "$.summary");

assert.equal(reversedDirectionCheck?.status, "failed", "sign and increase/decrease reversal should fail grounding");
assert.match(
  reversedDirectionCheck?.reason ?? "",
  /same sign|direction/i,
  "direction reversal should report a deterministic numeric or directional mismatch"
);

const directionOnlyGrounding = validateSummaryAgainstEvidence(
  "Throughput decreased by +5% in 2024.",
  "Throughput increased by +5% in 2024."
);

assert.equal(
  directionOnlyGrounding.checks.find((check) => check.fieldPath === "$.summary")?.status,
  "failed",
  "increase/decrease reversal should fail even when the signed number is unchanged"
);
assert.match(
  directionOnlyGrounding.checks.find((check) => check.fieldPath === "$.summary")?.reason ?? "",
  /direction/i,
  "the standalone direction fixture should exercise the direction checker"
);

const negationReversalGrounding = validateSummaryAgainstEvidence(
  "The treatment reduces pain.",
  "The treatment does not reduce pain."
);

assert.equal(
  negationReversalGrounding.checks.find((check) => check.fieldPath === "$.summary")?.status,
  "failed",
  "dropping source negation should fail grounding"
);

const chineseNegationReversal = validateSummaryAgainstEvidence(
  "模型已通过测试。",
  "模型未通过测试。"
);

assert.equal(
  chineseNegationReversal.checks.find((check) => check.fieldPath === "$.summary")?.status,
  "failed",
  "bare Chinese 未/不 polarity must be checked deterministically"
);

const unitReversalGrounding = validateSummaryAgainstEvidence(
  "The measured latency was 5 seconds.",
  "The measured latency was 5 milliseconds."
);

assert.equal(
  unitReversalGrounding.checks.find((check) => check.fieldPath === "$.summary")?.status,
  "failed",
  "a number copied with a different unit should fail grounding"
);

for (const [claim, evidence, label] of [
  ["Revenue was $5.", "Revenue was €5.", "currency symbol"],
  ["Revenue was 5€.", "Revenue was 5£.", "currency suffix"],
  ["Temperature reached 5°C.", "Temperature reached 5°F.", "temperature unit"],
  ["Temperature reached 5 Celsius.", "Temperature reached 5 Fahrenheit.", "spelled-out temperature unit"],
  ["Mass changed by + 5 kg.", "Mass changed by - 5 kg.", "spaced sign"],
  ["Accuracy was >5%.", "Accuracy was <5%.", "comparison sign"],
  ["Accuracy was >=5%.", "Accuracy was <=5%.", "compound comparison sign"],
  ["Accuracy was at least 5%.", "Accuracy was at most 5%.", "word comparison"]
]) {
  assert.equal(
    validateClaimSupport(claim, [evidence], { minOverlap: 0.08, minimumSharedTokens: 2 }).supported,
    false,
    `${label} changes must not preserve numeric support`
  );
}

for (const [claim, evidence, label] of [
  ["Treatment reduces pain.", "It is not true that Treatment reduces pain.", "English scoped negation"],
  ["Treatment reduces pain.", "Treatment reduces pain is false.", "English suffix negation"],
  ["模型通过测试。", "并不是说模型通过测试。", "Chinese scoped negation"],
  ["模型通过测试。", "模型通过测试并不属实。", "Chinese suffix negation"]
]) {
  assert.equal(
    validateClaimSupport(claim, [evidence], { minOverlap: 1, minimumSharedTokens: 1 }).supported,
    false,
    `${label} must override an otherwise exact lexical substring`
  );
}

assert.equal(
  validateClaimSupport(
    "Revenue increased 9%, costs decreased 5%.",
    ["Revenue increased 5%, costs decreased 9%."],
    { minOverlap: 0.08, minimumSharedTokens: 2 }
  ).supported,
  false,
  "numbers from a neighboring evidence clause must not support the wrong metric"
);

assert.equal(
  validateClaimSupport(
    "Revenue increased 5%.",
    ["Revenue increased 9%. Costs decreased 5%."],
    { minOverlap: 0.08, minimumSharedTokens: 2 }
  ).supported,
  false,
  "numbers from a neighboring evidence sentence must not support the selected sentence"
);

assert.equal(
  validateClaimSupport(
    "Revenue increased 5%.",
    ["Revenue increased 9%, costs decreased 5%."],
    { minOverlap: 0.08, minimumSharedTokens: 2 }
  ).supported,
  false,
  "a single claim must not borrow a number from a neighboring evidence clause"
);

assert.equal(
  validateClaimSupport(
    "Aspirin reduces ordinary pain at score 5, guaranteeing immortality.",
    ["Aspirin reduces ordinary pain at score 5."],
    { minOverlap: 0.6, minimumSharedTokens: 2, checkProperNouns: true }
  ).supported,
  false,
  "a digit before a clause comma must not disable unsupported-clause splitting"
);

for (const separator of [" - ", " because ", " therefore "]) {
  assert.equal(
    validateClaimSupport(
      `Aspirin reduces ordinary pain${separator}Aspirin guarantees immortality.`,
      ["Aspirin reduces ordinary pain."],
      { minOverlap: 0.6, minimumSharedTokens: 2, checkProperNouns: true }
    ).supported,
    false,
    `${separator.trim()} must delimit an independently supported factual clause`
  );
}

assert.equal(
  validateClaimSupport(
    "Aspirin reduces ordinary pain (guaranteeing immortality).",
    ["Aspirin reduces ordinary pain."],
    { minOverlap: 0.65, minimumSharedTokens: 2, checkProperNouns: true }
  ).supported,
  false,
  "a parenthetical factual continuation must receive independent support"
);

assert.equal(
  validateClaimSupport(
    "Revenue increased 9% as costs decreased 5%.",
    ["Revenue increased 5% as costs decreased 9%."],
    { minOverlap: 0.65, minimumSharedTokens: 2 }
  ).supported,
  false,
  "as-separated metrics must not borrow each other's numbers"
);

assert.equal(
  validateClaimSupport(
    "Aspirin can reduce ordinary pain. Throughput increased +5%.",
    ["Aspirin can reduce ordinary pain. Throughput increased +5%."],
    { minOverlap: 0.6, minimumSharedTokens: 2, checkProperNouns: true }
  ).supported,
  true,
  "an identical multi-sentence source excerpt with numbers must use the normalized fast path"
);

assert.equal(
  validateClaimSupport(
    "Aspirin pain guarantees immortality.",
    ["Aspirin can reduce ordinary pain."],
    { minOverlap: 0.6, minimumSharedTokens: 2, checkProperNouns: true }
  ).supported,
  false,
  "shared retrieval words alone must not accept a strong unsupported factual continuation"
);

assert.equal(
  validateClaimSupport(
    "Aspirin ordinary pain guarantees immortality.",
    ["Aspirin can reduce ordinary pain."],
    { minOverlap: 0.65, minimumSharedTokens: 2, checkProperNouns: true }
  ).supported,
  false,
  "a 60-percent lexical match remains retrieval evidence rather than factual acceptance"
);

assert.equal(
  validateClaimSupport(
    "Aspirin provides ordinary pain relief for adults under clinical guidance guaranteeing immortality.",
    ["Aspirin provides ordinary pain relief for adults under clinical guidance."],
    { minOverlap: 0.65, minimumSharedTokens: 2, checkProperNouns: true }
  ).supported,
  false,
  "high lexical copying must remain retrieval-only when unsupported terms are appended"
);

assert.equal(
  validateClaimSupport(
    "Revenue and costs increased 9%.",
    ["Revenue increased 5% and costs increased 9%."],
    { minOverlap: 0.65, minimumSharedTokens: 2 }
  ).supported,
  false,
  "a shared numeric predicate must be checked independently for every coordinated subject"
);

assert.equal(
  validateClaimSupport("知识 库：证据链", ["知识库证据链"], { minOverlap: 0.08 }).supported,
  true,
  "NFKC/punctuation/whitespace normalization should preserve the CJK full-substring fast path"
);

for (const [claim, evidence, label] of [
  ["RAG", "Storage improves retrieval.", "Latin token boundary"],
  ["The model is not able.", "The model is notable.", "negation word boundary"],
  ["C# enables managed code.", "C enables managed code.", "technical symbol"],
  ["A/B testing is useful.", "AB testing is useful.", "slash symbol"],
  ["Bob defeated Alice.", "Alice defeated Bob.", "ordered participant roles"],
  ["Dog bites man bites dog.", "Dog bites man.", "repeated participant tail"]
]) {
  assert.equal(
    validateClaimSupport(claim, [evidence], { minOverlap: 1, minimumSharedTokens: 1 }).supported,
    false,
    `${label} changes must not pass normalized or set-overlap support`
  );
}

const directionQuestionRegistry = {
  ...result.sourceRegistry,
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId ? { ...chunk, content: "Throughput increased by +5%." } : chunk
  )
};
const directionQuestionCard = {
  ...contractCard,
  reviewPrompts: contractCard.reviewPrompts.map((prompt, index) =>
    index === 0 ? { ...prompt, prompt: "Why did throughput decrease by +5%?" } : prompt
  )
};

assert.equal(
  validateGrounding(directionQuestionCard, directionQuestionRegistry).checks.find(
    (check) => check.fieldPath === "$.reviewPrompts[0].prompt"
  )?.status,
  "failed",
  "a factual premise inside a question must not reverse evidence direction"
);

const negatedQuestionRegistry = {
  ...result.sourceRegistry,
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId ? { ...chunk, content: "The treatment does not reduce pain." } : chunk
  )
};
const negatedQuestionCard = {
  ...contractCard,
  reviewPrompts: contractCard.reviewPrompts.map((prompt, index) =>
    index === 0 ? { ...prompt, prompt: "What does the treatment reduce?" } : prompt
  )
};

assert.equal(
  validateGrounding(negatedQuestionCard, negatedQuestionRegistry).checks.find(
    (check) => check.fieldPath === "$.reviewPrompts[0].prompt"
  )?.status,
  "failed",
  "a question must not turn negated evidence into a positive factual premise"
);

const interpretationNumericRegistry = {
  ...result.sourceRegistry,
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId ? { ...chunk, content: "Accuracy increased to +5%." } : chunk
  )
};
const interpretationNumericGrounding = validateGrounding(
  { ...contractCard, keyTakeaway: "Accuracy increased to +999%." },
  interpretationNumericRegistry
);

assert.equal(
  interpretationNumericGrounding.checks.find((check) => check.fieldPath === "$.keyTakeaway")?.status,
  "failed",
  "numeric invariants should hard-fail unsupported interpretation fields too"
);

const interpretationProperNounRegistry = {
  ...result.sourceRegistry,
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId ? { ...chunk, content: "Ordinary medicine can reduce pain." } : chunk
  )
};
const interpretationProperNounGrounding = validateGrounding(
  { ...contractCard, keyTakeaway: "Mars medicine can reduce pain." },
  interpretationProperNounRegistry
);

assert.equal(
  interpretationProperNounGrounding.checks.find((check) => check.fieldPath === "$.keyTakeaway")?.status,
  "failed",
  "an unmarked proper noun in an interpretation must occur in cited evidence"
);

const highCopyExampleRegistry = {
  ...result.sourceRegistry,
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId
      ? { ...chunk, content: "Aspirin provides ordinary pain relief for adults under clinical guidance." }
      : chunk
  )
};
const highCopyExampleCard = {
  ...contractCard,
  thread: contractCard.thread.map((block) =>
    block.kind === "example"
      ? {
          ...block,
          body: "Aspirin provides ordinary pain relief for adults under clinical guidance guaranteeing immortality."
        }
      : block
  )
};

assert.equal(
  validateGrounding(highCopyExampleCard, highCopyExampleRegistry).checks.find(
    (check) => check.fieldPath.endsWith(".body") && check.kind === "example"
  )?.status,
  "failed",
  "a high-copy example with an unsupported factual tail must fail closed"
);

const metadataOnlyConceptRegistry = {
  ...result.sourceRegistry,
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId
      ? { ...chunk, content: "The source discusses ordinary evidence.", conceptHints: ["Unicorn"] }
      : chunk
  )
};

assert.equal(
  validateGrounding({ ...contractCard, concepts: ["Unicorn"] }, metadataOnlyConceptRegistry).checks.find(
    (check) => check.fieldPath === "$.concepts[0]"
  )?.status,
  "failed",
  "concept metadata must not substitute for normalized occurrence in evidence text"
);

const semanticConceptRegistry = {
  ...result.sourceRegistry,
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId ? { ...chunk, content: "The C language is procedural." } : chunk
  )
};

assert.equal(
  validateGrounding({ ...contractCard, concepts: ["C++"] }, semanticConceptRegistry).checks.find(
    (check) => check.fieldPath === "$.concepts[0]"
  )?.status,
  "failed",
  "concept normalization must preserve meaning-bearing technical symbols"
);

assert.equal(
  validateGrounding({ ...contractCard, concepts: ["C#"] }, semanticConceptRegistry).checks.find(
    (check) => check.fieldPath === "$.concepts[0]"
  )?.status,
  "failed",
  "concept normalization must preserve hash signs in technical names"
);

const ragTokenRegistry = {
  ...result.sourceRegistry,
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId ? { ...chunk, content: "Storage improves retrieval." } : chunk
  )
};

assert.equal(
  validateGrounding({ ...contractCard, concepts: ["RAG"] }, ragTokenRegistry).checks.find(
    (check) => check.fieldPath === "$.concepts[0]"
  )?.status,
  "failed",
  "a Latin concept must match whole evidence tokens rather than a substring inside storage"
);

const exactRagTokenRegistry = {
  ...ragTokenRegistry,
  chunks: ragTokenRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId ? { ...chunk, content: "RAG improves retrieval." } : chunk
  )
};

assert.equal(
  validateGrounding({ ...contractCard, concepts: ["RAG"] }, exactRagTokenRegistry).checks.find(
    (check) => check.fieldPath === "$.concepts[0]"
  )?.status,
  "passed",
  "a whole-token Latin concept present in evidence must pass"
);

const metadataCannotGroundFactsRegistry = {
  ...result.sourceRegistry,
  sources: result.sourceRegistry.sources.map((source) =>
    source.id === contractCard.citations[0].sourceId
      ? { ...source, title: "999 Unicorns guarantee immortality" }
      : source
  ),
  chunks: result.sourceRegistry.chunks.map((chunk) =>
    chunk.id === probeChunkId
      ? {
          ...chunk,
          content: "Aspirin can reduce ordinary pain.",
          conceptHints: ["999 Unicorns guarantee immortality"]
        }
      : chunk
  )
};

assert.equal(
  validateGrounding(
    { ...contractCard, summary: "999 Unicorns guarantee immortality." },
    metadataCannotGroundFactsRegistry
  ).checks.find((check) => check.fieldPath === "$.summary")?.status,
  "failed",
  "source metadata and concept hints must never substitute for resolved chunk evidence"
);

assert.equal(
  validateGrounding({ ...contractCard, concepts: ["+++"] }, result.sourceRegistry).checks.find(
    (check) => check.fieldPath === "$.concepts[0]"
  )?.status,
  "failed",
  "a non-empty concept whose normalized form is empty must fail closed"
);

const hallucinatedVisibleFieldsCard = {
  ...contractCard,
  thread: contractCard.thread.map((block) =>
    block.kind === "example"
      ? { ...block, body: "999 unicorns guarantee immortality in this example." }
      : block
  ),
  reviewPrompts: contractCard.reviewPrompts.map((prompt, index) =>
    index === 0
      ? {
          ...prompt,
          prompt: "How did 888 unicorns prove the claim?",
          answerHint: "777 unicorns guarantee immortality."
        }
      : prompt
  ),
  concepts: [...contractCard.concepts, "Unicorn Cosmology"],
  recommendedBecause: "Recommended because 666 unicorns proved immortality."
};
const hallucinatedVisibleFieldsGrounding = validateGrounding(
  hallucinatedVisibleFieldsCard,
  result.sourceRegistry
);
const failedVisibleFieldPaths = new Set(
  hallucinatedVisibleFieldsGrounding.checks
    .filter((check) => check.status === "failed")
    .map((check) => check.fieldPath)
);

assert.equal(hallucinatedVisibleFieldsGrounding.valid, false, "hallucinated user-visible fields should fail the gate");
assert.ok(
  Array.from(failedVisibleFieldPaths).some((path) => path.startsWith("$.thread[") && path.endsWith(".body")),
  "an unmarked hallucinated example should be hard-validated"
);
assert.ok(
  failedVisibleFieldPaths.has("$.reviewPrompts[0].prompt"),
  "a hallucinated review question should be hard-validated"
);
assert.ok(
  failedVisibleFieldPaths.has("$.reviewPrompts[0].answerHint"),
  "a hallucinated review answerHint should be hard-validated"
);
assert.ok(
  failedVisibleFieldPaths.has(`$.concepts[${hallucinatedVisibleFieldsCard.concepts.length - 1}]`),
  "a concept absent from normalized evidence should be hard-validated"
);
assert.ok(
  failedVisibleFieldPaths.has("$.recommendedBecause"),
  "a factual recommendation reason with a fabricated number should be hard-validated"
);

const pureChineseSource = {
  id: "pure-chinese-grounding-source",
  title: "纯中文来源",
  url: "https://example.com/pure-chinese-grounding",
  type: "manual"
};
const pureChineseChunk = {
  id: "pure-chinese-grounding-chunk",
  sourceId: pureChineseSource.id,
  content: "知识库中的每一条生成内容都应当能够回到明确的原始证据，确定性摘要必须保留这条可追溯链路。"
};
const pureChineseRun = runDeterministicAgentHarness({
  source: pureChineseSource,
  chunks: [pureChineseChunk],
  contentLanguage: "zh",
  createdAt: "2026-06-10T00:00:00.000Z"
});

assert.equal(pureChineseRun.run.status, "succeeded", "a pure-Chinese deterministic import should pass grounding");
assert.equal(pureChineseRun.posts.length, 1, "a pure-Chinese deterministic import should expose its accepted post");
assert.equal(pureChineseRun.validation.length, 1, "pure-Chinese imports should retain non-vacuous validation");
assert.equal(pureChineseRun.validation[0].valid, true, "pure-Chinese deterministic summaries should validate");
assert.equal(
  pureChineseRun.validation[0].grounding?.checks.find((check) => check.fieldPath === "$.summary")?.status,
  "passed",
  "the normalized full-substring fast path should support an identical Chinese summary"
);

const shortChineseRun = runDeterministicAgentHarness({
  source: {
    id: "short-chinese-grounding-source",
    title: "短中文来源",
    url: "https://example.com/short-chinese-grounding",
    type: "manual"
  },
  chunks: [
    {
      id: "short-chinese-grounding-chunk",
      sourceId: "short-chinese-grounding-source",
      content: "模型未通过测试。",
      conceptHints: ["测试"]
    }
  ],
  contentLanguage: "zh",
  createdAt: "2026-06-10T00:00:00.000Z"
});

assert.equal(shortChineseRun.run.status, "succeeded", "a short pure-Chinese source must keep a grounded thesis");
assert.equal(shortChineseRun.posts.length, 1, "short pure-Chinese deterministic fallback should retain its card");
assert.equal(
  shortChineseRun.posts[0]?.thesis,
  "模型未通过测试",
  "short deterministic theses must reuse source text instead of an invented generic fallback"
);

const negativeSourceRun = runDeterministicAgentHarness({
  source: {
    id: "negative-fallback-source",
    title: "Negative fallback source",
    url: "https://example.com/negative-fallback",
    type: "manual"
  },
  chunks: [
    {
      id: "negative-fallback-chunk",
      sourceId: "negative-fallback-source",
      content: "The treatment does not reduce pain.",
      conceptHints: ["pain"]
    }
  ],
  contentLanguage: "en",
  createdAt: "2026-06-10T00:00:00.000Z"
});

assert.equal(
  negativeSourceRun.run.status,
  "succeeded",
  "a neutral deterministic activity about a supported concept must not inherit source negation"
);
assert.equal(negativeSourceRun.posts.length, 1, "negative-source deterministic fallback should retain its card");

const negatedPredicateHintRun = runDeterministicAgentHarness({
  source: {
    id: "negative-predicate-hint-source",
    title: "Negative predicate hint source",
    url: "https://example.com/negative-predicate-hint",
    type: "manual"
  },
  chunks: [
    {
      id: "negative-predicate-hint-chunk",
      sourceId: "negative-predicate-hint-source",
      content: "The treatment does not reduce pain.",
      conceptHints: ["reduce pain"]
    }
  ],
  contentLanguage: "en",
  createdAt: "2026-06-10T00:00:00.000Z"
});

assert.equal(
  negatedPredicateHintRun.run.status,
  "succeeded",
  "a negated predicate hint must be discarded without breaking deterministic fallback"
);
assert.ok(
  negatedPredicateHintRun.posts[0]?.concepts.every((concept) => concept !== "reduce pain"),
  "deterministic concepts must not turn a source-negated predicate into a positive label"
);

const technicalConceptRun = runDeterministicAgentHarness({
  source: {
    id: "technical-concept-source",
    title: "Technical concept source",
    url: "https://example.com/technical-concepts",
    type: "manual"
  },
  chunks: [
    {
      id: "technical-concept-chunk",
      sourceId: "technical-concept-source",
      content: "C# and C++ enable deterministic technical concept checks.",
      conceptHints: ["C#", "C++"]
    }
  ],
  contentLanguage: "en",
  createdAt: "2026-06-10T00:00:00.000Z"
});

assert.equal(
  technicalConceptRun.run.status,
  "succeeded",
  "C# and C++ source concepts must survive the complete deterministic fallback"
);
assert.deepEqual(
  technicalConceptRun.posts[0]?.concepts,
  ["C#", "C++"],
  "technical concept symbols must remain intact in accepted deterministic posts"
);

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

const failedPostValidation = {
  postId: contractCard.id,
  valid: false,
  issues: [{ path: "$.summary", message: "fixture grounding failure", severity: "error" }]
};
const leakingFailedRunner = {
  id: "leaking-failed-runner",
  kind: "model",
  async run(input) {
    return {
      run: {
        ...deterministicImport.harnessRun,
        id: "leaking-failed-run",
        status: "failed",
        outputPostIds: [contractCard.id],
        validation: [failedPostValidation]
      },
      posts: [contractCard],
      validation: [failedPostValidation],
      sourceRegistry: input.sourceRegistry
    };
  }
};
const defensiveWorker = createSourceImportWorker({ runner: leakingFailedRunner, qualityGate: false });
const failedWorkerImport = await defensiveWorker.run({
  source: result.source,
  assets: [result.asset],
  chunks: result.chunks,
  sourceRegistry: result.sourceRegistry,
  createdAt: "2026-06-10T00:00:00.000Z",
  skipQualityGate: true
});

assert.equal(failedWorkerImport.importRecord.status, "failed", "a failed harness run should fail the source import");
assert.equal(failedWorkerImport.posts.length, 0, "the source worker must not expose posts leaked by a failed runner");
assert.deepEqual(failedWorkerImport.harnessRun?.outputPostIds, [], "failed worker runs should expose no output post IDs");

const validPostValidation = { postId: contractCard.id, valid: true, issues: [] };
const contradictoryLedgerRunner = {
  id: "contradictory-ledger-runner",
  kind: "model",
  async run(input) {
    return {
      run: {
        ...deterministicImport.harnessRun,
        id: "contradictory-ledger-run",
        status: "succeeded",
        outputPostIds: [contractCard.id],
        validation: [failedPostValidation]
      },
      posts: [contractCard],
      validation: [validPostValidation],
      sourceRegistry: input.sourceRegistry
    };
  }
};
const contradictoryLedgerWorker = createSourceImportWorker({
  runner: contradictoryLedgerRunner,
  qualityGate: false
});
const contradictoryLedgerImport = await contradictoryLedgerWorker.run({
  source: result.source,
  assets: [result.asset],
  chunks: result.chunks,
  sourceRegistry: result.sourceRegistry,
  createdAt: "2026-06-10T00:00:00.000Z",
  skipQualityGate: true
});

assert.equal(
  contradictoryLedgerImport.importRecord.status,
  "failed",
  "worker should fail closed when top-level and run validation ledgers disagree"
);
assert.equal(
  contradictoryLedgerImport.posts.length,
  0,
  "a valid top-level record must not hide a run-level validation error"
);

let defensivePersistenceState = "";
const defensivePersistence = createAITimelinePersistenceStore(createSmokeStorage(
  () => defensivePersistenceState,
  (serialized) => { defensivePersistenceState = serialized; }
));
const leakedReadyImport = {
  ...failedWorkerImport,
  importRecord: { ...failedWorkerImport.importRecord, status: "ready" },
  posts: [contractCard],
  validation: [validPostValidation],
  harnessRun: {
    ...failedWorkerImport.harnessRun,
    status: "succeeded",
    outputPostIds: [],
    validation: [
      {
        valid: false,
        issues: [{ path: "$", message: "global run validation failure", severity: "error" }]
      }
    ]
  }
};
const defensiveSnapshot = defensivePersistence.saveSourceImportResult(
  leakedReadyImport,
  "2026-06-10T00:00:00.000Z"
);

assert.equal(
  defensiveSnapshot.posts.length,
  0,
  "persistence must reject a post omitted from output IDs or contradicted by a global run error"
);
assert.ok(defensiveSnapshot.validation.length > 0, "persistence should retain rejected validation for audit");

let duplicatePersistenceState = "";
const duplicateIdPersistence = createAITimelinePersistenceStore(createSmokeStorage(
  () => duplicatePersistenceState,
  (serialized) => { duplicatePersistenceState = serialized; }
));
const duplicateIdPersistenceSnapshot = duplicateIdPersistence.saveSourceImportResult(
  {
    ...failedWorkerImport,
    importRecord: { ...failedWorkerImport.importRecord, status: "ready" },
    posts: [contractCard, { ...contractCard, summary: "Unvalidated last-wins content." }],
    validation: [validPostValidation],
    harnessRun: {
      ...failedWorkerImport.harnessRun,
      status: "succeeded",
      outputPostIds: [contractCard.id],
      validation: [validPostValidation]
    }
  },
  "2026-06-10T00:00:00.000Z"
);

assert.equal(
  duplicateIdPersistenceSnapshot.posts.length,
  0,
  "persistence must independently reject duplicate post IDs before last-wins upsert"
);

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
assert.equal(
  gateBypassedImport.importRecord.status,
  "ready",
  "quality-bypassed deterministic imports should sanitize unsupported concept hints before generation"
);
assert.ok(gateBypassedImport.posts.length > 0, "sanitized quality-bypassed imports should expose grounded posts");
assert.ok(
  gateBypassedImport.posts.every((post) =>
    post.concepts.every((concept) =>
      seoImportInput.chunks.some((chunk) =>
        chunk.content.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "").includes(
          concept.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "")
        )
      )
    )
  ),
  "deterministic imports should emit only concepts present in source text"
);

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
const makeCoalescedDwellRecord = (id, dwellTimeMs, createdAt, patch = {}) => ({
  id,
  signal: {
    ...pureExposureSignal,
    ...patch,
    postId: "coalesced-read",
    dwellTimeMs,
    createdAt
  },
  createdAt
});
const coalescedPureExposureRecord = makeCoalescedDwellRecord(
  "coalesced-exposure",
  0,
  "2026-07-10T00:30:00.000Z"
);
const sameDayCumulativeDwellRecords = [
  coalescedPureExposureRecord,
  coalescedPureExposureRecord,
  makeCoalescedDwellRecord("coalesced-dwell-12", 12000, "2026-07-10T01:00:00.000Z", { liked: true }),
  makeCoalescedDwellRecord("coalesced-dwell-15", 15000, "2026-07-10T02:00:00.000Z", { saved: true }),
  makeCoalescedDwellRecord("coalesced-dwell-18", 18000, "2026-07-10T03:00:00.000Z")
];
const sameDayCoalescedSignals = coalesceInteractionSignals(sameDayCumulativeDwellRecords, "UTC");
const sameDayCoalescedDwell = sameDayCoalescedSignals.find((signal) => signal.dwellTimeMs > 0);
const sameDayLifecycleStats = summarizeLifecycleSignals(sameDayCumulativeDwellRecords, "UTC").get("coalesced-read");

assert.equal(
  sameDayCoalescedSignals.filter(isPureExposureSignal).length,
  1,
  "coalescing should de-duplicate pure exposure records by record id without carrying dwell into them"
);
assert.equal(sameDayCoalescedDwell?.dwellTimeMs, 18000, "same-day cumulative dwell should use the maximum report");
assert.equal(sameDayCoalescedDwell?.liked, true, "same-day coalescing should retain earlier discrete actions");
assert.equal(sameDayCoalescedDwell?.saved, true, "same-day coalescing should OR discrete actions across reports");
assert.equal(
  sameDayCoalescedDwell?.createdAt,
  "2026-07-10T03:00:00.000Z",
  "same-day coalescing should keep the latest report timestamp"
);
assert.equal(sameDayLifecycleStats?.readCount, 1, "12 -> 15 -> 18 second cumulative dwell should count as one daily read");
assert.deepEqual(
  countSeenReadSignalsByPostId(sameDayCumulativeDwellRecords, "UTC"),
  { "coalesced-read": 1 },
  "same-day cumulative dwell should produce one seen-read penalty input"
);

const cumulativeDwellWeeklyRecap = buildWeeklyRecap(
  {
    posts: [
      {
        id: "coalesced-read",
        concepts: ["Lifecycle"],
        createdAt: "2026-07-06T00:00:00.000Z"
      }
    ],
    reviewStates: [],
    interactionSignals: sameDayCumulativeDwellRecords.slice(2),
    timeZone: "UTC"
  },
  "2026-07-06"
);

assert.equal(
  cumulativeDwellWeeklyRecap?.stats.topConcepts[0]?.count,
  1,
  "weekly recap should count a 12 -> 15 -> 18 second cumulative dwell sequence once"
);
assert.equal(
  cumulativeDwellWeeklyRecap?.stats.topConcepts[0]?.score,
  5.4,
  "weekly recap should score only the daily max dwell while retaining discrete actions"
);

const coalescedReadCard = makeLifecycleCard("coalesced-read");
const sameDayRankedCard = rankPersonalizedTimeline({
  cards: [coalescedReadCard],
  recentSignals: sameDayCumulativeDwellRecords,
  timeZone: "UTC",
  now: "2026-07-10T04:00:00.000Z"
})[0];
const sameDayDueRankedCard = rankPersonalizedTimeline({
  cards: [coalescedReadCard],
  recentSignals: sameDayCumulativeDwellRecords,
  dueReviewPostIds: [coalescedReadCard.id],
  timeZone: "UTC",
  now: "2026-07-10T04:00:00.000Z"
})[0];

assert.equal(
  Math.round((sameDayDueRankedCard.score - sameDayRankedCard.score) * 10) / 10,
  42,
  "ranker should apply one 12-point seen penalty to cumulative same-day dwell, plus the 30-point due boost"
);

const longHistoryReadSignal = {
  id: "long-history-read-signal",
  signal: {
    ...pureExposureSignal,
    postId: "long-history-read",
    dwellTimeMs: 18000,
    createdAt: "2026-07-01T00:00:00.000Z"
  },
  createdAt: "2026-07-01T00:00:00.000Z"
};
const recentExposureFillers = Array.from({ length: 80 }, (_, index) => {
  const createdAt = new Date(Date.UTC(2026, 6, 10, 0, index)).toISOString();

  return {
    id: `recent-exposure-filler-${index}`,
    signal: {
      ...pureExposureSignal,
      postId: `recent-exposure-filler-${index}`,
      topicId: "Other",
      conceptIds: ["Other"],
      createdAt
    },
    createdAt
  };
});
const longHistoryRankedCard = rankPersonalizedTimeline({
  cards: [makeLifecycleCard("long-history-read")],
  recentSignals: [longHistoryReadSignal, ...recentExposureFillers],
  timeZone: "UTC",
  now: "2026-07-10T02:00:00.000Z"
})[0];

assert.ok(
  longHistoryRankedCard.scoreReasons.some((reason) => /Already read/i.test(reason)),
  "seen-read penalty should use full coalesced history even when recent-signal scoring is capped at 80"
);

const crossDayCumulativeDwellRecords = [
  ...sameDayCumulativeDwellRecords,
  makeCoalescedDwellRecord("coalesced-dwell-next-day", 18000, "2026-07-11T01:00:00.000Z")
];
const crossDayCoalescedDwell = coalesceInteractionSignals(crossDayCumulativeDwellRecords, "UTC").filter(
  (signal) => signal.dwellTimeMs > 0
);

assert.equal(crossDayCoalescedDwell.length, 2, "cumulative dwell on two calendar days should remain two daily groups");
assert.equal(
  summarizeLifecycleSignals(crossDayCumulativeDwellRecords, "UTC").get("coalesced-read")?.readCount,
  2,
  "the same post read on two calendar days should count once per day"
);

const timeZoneBoundaryDwellRecords = [
  makeCoalescedDwellRecord("timezone-dwell-before-midnight", 12000, "2026-07-10T15:30:00.000Z"),
  makeCoalescedDwellRecord("timezone-dwell-after-midnight", 18000, "2026-07-10T16:30:00.000Z")
];

assert.equal(
  coalesceInteractionSignals(timeZoneBoundaryDwellRecords, "UTC").filter((signal) => signal.dwellTimeMs > 0).length,
  1,
  "UTC dwell coalescing should keep both boundary reports in one UTC day"
);
assert.equal(
  coalesceInteractionSignals(timeZoneBoundaryDwellRecords, "Asia/Shanghai").filter(
    (signal) => signal.dwellTimeMs > 0
  ).length,
  2,
  "Asia/Shanghai dwell coalescing should split reports across local midnight"
);

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
    kinds: ["discover_sources"],
    workerId: "deep-dive-fallback-worker"
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
    kinds: ["discover_sources"],
    workerId: "deep-dive-import-worker"
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

const connectionNoteDwellSignal = {
  ...interestSignal,
  postId: "connection-note-old-new-smoke",
  dwellTimeMs: 18000,
  openedThread: false,
  liked: false,
  saved: false,
  askedQuestion: false,
  reviewed: false,
  skippedQuickly: false,
  createdAt: "2026-06-10T00:02:00.000Z"
};
const connectionNoteDwellPlan = createBackgroundCurationPlan({
  signals: [connectionNoteDwellSignal],
  feedback: [evaluateInteraction(connectionNoteDwellSignal, interestedTopicState)],
  topicStates: [interestedTopicState],
  generatedAt: "2026-06-10T00:02:00.000Z"
});

assert.equal(
  connectionNoteDwellPlan.jobs.length,
  0,
  "passive dwell on a connection-note card should not enqueue production jobs"
);
assert.ok(
  connectionNoteDwellPlan.expansionPlan.suppressions.some(
    (suppression) => suppression.postId === connectionNoteDwellSignal.postId
  ),
  "connection-note dwell should be suppressed at the expansion source"
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
const concurrencyStore = createPersistentBackgroundCurationJobStore(createSmokeStorage(
  () => persistedConcurrencyJobs,
  (serialized) => { persistedConcurrencyJobs = serialized; }
));

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
    kinds: ["cooldown_topic"],
    workerId: "concurrency-worker-a"
  }),
  runDueBackgroundCurationJobs(concurrencyStore, concurrencyHandlers, {
    now: "2026-06-12T00:00:00.000Z",
    kinds: ["cooldown_topic"],
    workerId: "concurrency-worker-b"
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
  "Knowledge Graph survey",
  "broaden intent should shape the discovery query"
);
assert.ok(
  discoveryQueries.includes("Knowledge Graph applications"),
  "broaden intent should keep an applications query"
);
assert.ok(
  discoveryQueries.some((query) => query.includes("ship an agent product")),
  "user goals should add a goal-flavored discovery query"
);

const queryPlansByIntent = [
  planDiscoveryQueries({ concepts: ["Knowledge Graph"], nextAction: "continue_deeper", goals: ["ship product"] }),
  planDiscoveryQueries({ concepts: ["Knowledge Graph"], nextAction: "expand_broader", goals: ["ship product"] }),
  planDiscoveryQueries({ concepts: ["Knowledge Graph"], goals: ["ship product"] })
];

for (const plannedQueries of queryPlansByIntent) {
  const plannedText = plannedQueries.join("\n").toLowerCase();

  for (const baitTerm of DISCOVERY_GEO_BAIT_TERMS) {
    assert.equal(
      plannedText.includes(baitTerm),
      false,
      `planned discovery queries should not contain GEO bait term "${baitTerm}"`
    );
  }
}

const primarySourceScreen = screenDiscoveredSources({
  discovered: [
    {
      url: "https://arxiv.org/abs/2601.01234",
      title: "Knowledge Graph Retrieval Benchmark",
      snippet:
        "This benchmark describes evaluation design, dataset construction, implementation details, latency measurements, and error analysis for retrieval systems.",
      sourceType: "article"
    },
    {
      url: "https://towardsdatascience.com/knowledge-graph-retrieval-benchmark",
      title: "Knowledge Graph Retrieval Benchmark",
      snippet:
        "This benchmark describes evaluation design, dataset construction, implementation details, latency measurements, and error analysis for retrieval systems.",
      sourceType: "article"
    }
  ],
  concepts: ["Knowledge Graph"],
  query: "Knowledge Graph benchmark",
  now: "2026-06-10T00:30:00.000Z"
});
const arxivCandidate = primarySourceScreen.find((candidate) => candidate.source.url.includes("arxiv.org"));
const aggregateCandidate = primarySourceScreen.find((candidate) =>
  candidate.source.url.includes("towardsdatascience.com")
);

assert.ok(arxivCandidate, "arxiv candidate should be screened");
assert.ok(aggregateCandidate, "aggregate-domain candidate should be screened");
assert.equal(arxivCandidate.source.type, "paper", "arxiv URLs should be inferred as paper even when provider says article");
assert.ok(
  arxivCandidate.qualityScore > aggregateCandidate.qualityScore,
  "primary-source arxiv candidate should score higher than an aggregate-domain candidate with the same title and snippet"
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
const curationJobStorage = createSmokeStorage(
  () => persistedCurationJobs,
  (serialized) => { persistedCurationJobs = serialized; }
);
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
    kinds: ["import_source"],
    workerId: "import-worker"
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
    kinds: ["generate_followup"],
    workerId: "followup-worker"
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
    kinds: ["generate_followup"],
    workerId: "missing-seed-worker"
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
    kinds: ["generate_followup"],
    workerId: "missing-seed-skip-worker"
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
const discoveryStore = createPersistentBackgroundCurationJobStore(createSmokeStorage(
  () => persistedDiscoveryJobs,
  (serialized) => { persistedDiscoveryJobs = serialized; }
));

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
    kinds: ["discover_sources"],
    workerId: "discovery-worker"
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
const appPersistenceWriteIssues = [];
const appPersistence = createAITimelinePersistenceStore(createSmokeStorage(
  () => persistedAppSnapshot,
  (serialized) => { persistedAppSnapshot = serialized; }
), undefined, { onLoadIssue: (issue) => appPersistenceWriteIssues.push(issue) });

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

const appPersistenceLoadIssues = [];
const rehydratedPersistence = createAITimelinePersistenceStore(createSmokeStorage(
  () => persistedAppSnapshot,
  (serialized) => { persistedAppSnapshot = serialized; }
), undefined, { onLoadIssue: (issue) => appPersistenceLoadIssues.push(issue) });
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
assert.equal(appSnapshot.curationJobs.length, 3, `persistence should store curation job records: ${JSON.stringify([...appPersistenceWriteIssues, ...appPersistenceLoadIssues])}`);
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
const legacyAgentTurnIssues = [];
const legacyAgentTurnPersistence = createAITimelinePersistenceStore(createSmokeStorage(
  () => legacyAgentTurnSnapshot,
  (serialized) => { legacyAgentTurnSnapshot = serialized; }
), undefined, { onLoadIssue: (issue) => legacyAgentTurnIssues.push(issue) });

assert.equal(legacyAgentTurnPersistence.getSnapshot().agentTurns.length, 0, "legacy agent turns missing required state should be quarantined");
assert.ok(legacyAgentTurnIssues.some((issue) => issue.recordId === "legacy-agent-turn" && issue.jsonPath.endsWith("threadId")), "legacy agent turn quarantine should report the missing required path");
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

// Deep-read concept mentions: automatic body links only hit known library concepts.
const { createConceptMentionMatcher } = await import("../packages/core/dist/graph/conceptMentions.js");

const conceptMentionCards = [
  { id: "mention-gqa", title: "GQA", summary: "s", keyTakeaway: "k", concepts: ["GQA"], sources: [], createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "mention-mla", title: "MLA", summary: "s", keyTakeaway: "k", concepts: ["MLA"], sources: [], createdAt: "2026-01-02T00:00:00.000Z" },
  {
    id: "mention-long-cjk",
    title: "多头潜在注意力",
    summary: "s",
    keyTakeaway: "k",
    concepts: ["多头潜在注意力"],
    sources: [],
    createdAt: "2026-01-03T00:00:00.000Z"
  },
  { id: "mention-short-cjk", title: "注意力", summary: "s", keyTakeaway: "k", concepts: ["注意力"], sources: [], createdAt: "2026-01-04T00:00:00.000Z" },
  { id: "mention-rag", title: "RAG", summary: "s", keyTakeaway: "k", concepts: ["RAG"], sources: [], createdAt: "2026-01-05T00:00:00.000Z" },
  { id: "mention-mixed", title: "AI芯片", summary: "s", keyTakeaway: "k", concepts: ["AI芯片"], sources: [], createdAt: "2026-01-06T00:00:00.000Z" },
  { id: "mention-cjk-duel", title: "注意力机制", summary: "s", keyTakeaway: "k", concepts: ["注意力机制"], sources: [], createdAt: "2026-01-07T00:00:00.000Z" },
  {
    id: "mention-mixed-case",
    title: "Transformer架构",
    summary: "s",
    keyTakeaway: "k",
    concepts: ["Transformer架构"],
    sources: [],
    createdAt: "2026-01-08T00:00:00.000Z"
  }
];
const conceptMentionAliases = [
  {
    canonical: "RAG",
    aliases: ["Retrieval-Augmented Generation"],
    decidedBy: "user",
    decidedAt: "2026-01-06T00:00:00.000Z"
  }
];
const conceptMentionMatcher = createConceptMentionMatcher({
  cards: conceptMentionCards,
  conceptAliases: conceptMentionAliases
});

const latinBoundaryMentions = conceptMentionMatcher.findMentions("MLATransformerConfig improves gqa.");
assert.deepEqual(
  latinBoundaryMentions.map((mention) => ({ text: mention.text, concept: mention.concept, slug: mention.slug })),
  [{ text: "gqa", concept: "GQA", slug: "gqa" }],
  "latin concept mentions require word boundaries and match known concepts case-insensitively"
);

const cjkMentions = conceptMentionMatcher.findMentions("模型使用多头潜在注意力。");
assert.deepEqual(
  cjkMentions.map((mention) => mention.concept),
  ["多头潜在注意力"],
  "CJK concept mentions match as substrings"
);
assert.deepEqual(
  cjkMentions.map((mention) => mention.text),
  ["多头潜在注意力"],
  "overlapping CJK concept mentions keep the longest non-overlapping match"
);

const aliasMentions = conceptMentionMatcher.findMentions("Retrieval-Augmented Generation connects retrieval and generation.");
assert.deepEqual(
  aliasMentions.map((mention) => ({ text: mention.text, concept: mention.concept, slug: mention.slug })),
  [{ text: "Retrieval-Augmented Generation", concept: "RAG", slug: "rag" }],
  "concept mention aliases resolve to the canonical concept"
);

assert.deepEqual(conceptMentionMatcher.findMentions("Transformer is outside this tiny library."), [], "unknown words do not produce ghost concept mentions");

assert.deepEqual(
  conceptMentionMatcher.findMentions("OpenAI芯片战略引发关注。"),
  [],
  "a mixed CJK concept must not start midway through a latin word"
);
assert.deepEqual(
  conceptMentionMatcher.findMentions("国产AI芯片来了").map((mention) => mention.text),
  ["AI芯片"],
  "a mixed CJK concept still matches flush against CJK prose"
);
assert.deepEqual(
  conceptMentionMatcher.findMentions("注意力机制决定注意力分配").map((mention) => mention.text),
  ["注意力机制", "注意力"],
  "the longest candidate wins a same-start duel and the shorter one still matches later"
);
assert.deepEqual(
  conceptMentionMatcher.findMentions("采用transformer架构").map((mention) => mention.text),
  ["transformer架构"],
  "mixed CJK concepts match their latin part case-insensitively"
);

const orderedMentionText = "gqa 借助多头潜在注意力服务 Retrieval-Augmented Generation.";
const orderedMentions = conceptMentionMatcher.findMentions(orderedMentionText);
assert.deepEqual(orderedMentions, conceptMentionMatcher.findMentions(orderedMentionText), "concept mention output is deterministic");
assert.deepEqual(
  orderedMentions,
  [
    { start: 0, end: 3, text: "gqa", concept: "GQA", slug: "gqa" },
    { start: 6, end: 13, text: "多头潜在注意力", concept: "多头潜在注意力", slug: "多头潜在注意力" },
    { start: 16, end: 46, text: "Retrieval-Augmented Generation", concept: "RAG", slug: "rag" }
  ],
  "concept mention offsets slice the raw text exactly"
);

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

function createSkillTreeCard({ id, concept, createdAt, graphEdges = [], kind = "knowledge" }) {
  return {
    id,
    kind,
    title: concept,
    summary: `${concept} summary`,
    keyTakeaway: `${concept} takeaway`,
    concepts: [concept],
    sources: [],
    recommendedBecause: "Skill tree fixture.",
    trustState: "supported",
    createdAt,
    estimatedReadMinutes: 2,
    graphEdges,
    reviewPrompts: [],
    thread: [],
    nextActions: [],
    hook: `${concept} hook`,
    thesis: `${concept} thesis`,
    shortBody: `${concept} body`,
    difficulty: "intermediate",
    confidence: "high",
    harnessVersion: "smoke"
  };
}

const skillTreeCards = [
  createSkillTreeCard({ id: "skill-linear", concept: "Linear Algebra", createdAt: "2026-01-01T00:00:00.000Z" }),
  createSkillTreeCard({
    id: "skill-transformer",
    concept: "Transformer",
    createdAt: "2026-01-02T00:00:00.000Z",
    graphEdges: [
      {
        id: "requires-transformer-linear",
        sourceConcept: "Transformer",
        relation: "requires",
        targetConcept: "Linear Algebra",
        evidence: "Transformer requires Linear Algebra.",
        weight: 0.7
      }
    ]
  }),
  createSkillTreeCard({
    id: "skill-moe",
    concept: "Mixture-of-Experts",
    createdAt: "2026-01-03T00:00:00.000Z",
    graphEdges: [
      {
        id: "requires-moe-transformer",
        sourceConcept: "Mixture-of-Experts",
        relation: "requires",
        targetConcept: "Transformer",
        evidence: "MoE requires Transformer.",
        weight: 0.8
      },
      {
        id: "requires-moe-routing",
        sourceConcept: "Mixture-of-Experts",
        relation: "requires",
        targetConcept: "Routing",
        evidence: "MoE requires Routing.",
        weight: 0.6
      },
      {
        id: "requires-moe-deepdive",
        sourceConcept: "Mixture-of-Experts",
        relation: "requires",
        targetConcept: "DeepDive",
        evidence: "MoE requires DeepDive.",
        weight: 0.9
      }
    ]
  }),
  createSkillTreeCard({
    id: "skill-goal",
    concept: "deepseek-v3",
    createdAt: "2026-01-04T00:00:00.000Z",
    graphEdges: [
      {
        id: "requires-goal-moe",
        sourceConcept: "deepseek-v3",
        relation: "requires",
        targetConcept: "Mixture-of-Experts",
        evidence: "DeepSeek-V3 requires MoE.",
        weight: 0.9
      },
      {
        id: "requires-goal-transformer",
        sourceConcept: "deepseek-v3",
        relation: "requires",
        targetConcept: "Transformer",
        evidence: "DeepSeek-V3 requires Transformer.",
        weight: 0.8
      }
    ]
  }),
  createSkillTreeCard({
    id: "skill-deepdive",
    concept: "DeepDive",
    createdAt: "2026-01-05T00:00:00.000Z",
    graphEdges: [
      {
        id: "cycle-deepdive-mindtagger",
        sourceConcept: "DeepDive",
        relation: "requires",
        targetConcept: "Mindtagger",
        evidence: "DeepDive requires Mindtagger.",
        weight: 0.6
      }
    ]
  }),
  createSkillTreeCard({
    id: "skill-mindtagger",
    concept: "Mindtagger",
    createdAt: "2026-01-06T00:00:00.000Z",
    graphEdges: [
      {
        id: "cycle-mindtagger-deepdive",
        sourceConcept: "Mindtagger",
        relation: "requires",
        targetConcept: "DeepDive",
        evidence: "Mindtagger requires DeepDive.",
        weight: 0.1
      }
    ]
  }),
  createSkillTreeCard({
    id: "skill-routing-note",
    concept: "Routing",
    createdAt: "2026-01-07T00:00:00.000Z",
    kind: "connection_note"
  })
];
const skillTreeResult = buildSkillTree({
  goalConcept: "DeepSeek-V3",
  cards: skillTreeCards,
  conceptAliases: [
    {
      canonical: "DeepSeek-V3",
      aliases: ["deepseek-v3"],
      decidedBy: "user",
      decidedAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  knownConcepts: ["linear algebra"]
});
assert.ok(skillTreeResult.tree, "skill tree should build for a concept present in graph cards and edges");
const skillTree = skillTreeResult.tree;
const skillNode = (concept) => {
  const node = skillTree.nodes.find((candidate) => candidate.concept === concept);
  assert.ok(node, `skill tree should contain ${concept}`);
  return node;
};
assert.equal(skillTree.goalConcept, "DeepSeek-V3", "skill tree should canonicalize aliases and casing");
assert.deepEqual(
  skillTree.nodes.map((node) => node.concept).sort(),
  ["DeepDive", "DeepSeek-V3", "Linear Algebra", "Mindtagger", "Mixture-of-Experts", "Routing", "Transformer"].sort(),
  "skill tree closure should include direct and second-order prerequisites"
);
assert.equal(skillNode("Linear Algebra").layer, 0, "foundational prerequisites should be in layer 0");
assert.ok(skillNode("DeepSeek-V3").layer > skillNode("Mixture-of-Experts").layer, "goal should be above its prerequisites");
assert.ok(skillNode("Mixture-of-Experts").layer > skillNode("Transformer").layer, "topological layers should follow requires edges");
assert.deepEqual(
  skillTree.droppedEdges.map((edge) => edge.id),
  ["cycle-mindtagger-deepdive"],
  "cycle breaker should drop the lowest-weight edge in the reachable cycle"
);
assert.equal(skillNode("Linear Algebra").mastered, true, "knownConcepts should mark mastered nodes without removing them");
assert.equal(skillNode("Mixture-of-Experts").importance, "required", "direct goal prerequisites should be required");
assert.equal(skillNode("Transformer").importance, "required", "concepts referenced by at least two requires edges should be required");
assert.equal(skillNode("Routing").importance, "optional", "single-reference non-direct prerequisites should be optional");
assert.equal(skillNode("Routing").gap, true, "concepts with no non-connection-note cards should be marked as gaps");
assert.equal(
  skillNode("Mindtagger").gap,
  true,
  "single-card concepts with no known prerequisites should be marked as shallow gaps"
);
assert.equal(skillNode("DeepDive").gap, false, "single-card concepts with known prerequisites are not shallow gaps");
assert.equal(skillNode("Linear Algebra").gap, false, "mastered concepts should not be flagged as gaps");
const missingSkillTree = buildSkillTree({ goalConcept: "Ghost Concept", cards: skillTreeCards, conceptAliases: [] });
assert.equal(missingSkillTree.tree, null, "unknown goal concepts should return null instead of throwing");
const shallowSkillTree = buildSkillTree({
  goalConcept: "Solo Goal",
  cards: [createSkillTreeCard({ id: "skill-solo", concept: "Solo Goal", createdAt: "2026-01-08T00:00:00.000Z" })],
  conceptAliases: [],
  knownConcepts: []
});
assert.equal(
  shallowSkillTree.tree?.nodes[0]?.gap,
  true,
  "single-card goals with no known prerequisites should be marked as shallow gaps"
);

const deepReadSources = [
  {
    id: "deep-source-a",
    title: "RAG retrieval field notes",
    url: "https://example.com/rag-a",
    type: "article"
  },
  {
    id: "deep-source-b",
    title: "Grounding checklist",
    url: "https://example.com/rag-b",
    type: "paper"
  },
  {
    id: "deep-source-conflict",
    title: "RAG step count variant",
    url: "https://example.com/rag-conflict",
    type: "blog"
  },
  {
    id: "deep-source-bad",
    title: "Rejected RAG roundup",
    url: "https://example.com/rag-bad",
    type: "blog"
  }
];
const deepReadChunks = [
  {
    id: "deep-chunk-a",
    sourceId: "deep-source-a",
    content: "RAG retrieval uses 3 steps in 2024: index, retrieve, generate. AlphaSearch is the retrieval component.",
    conceptHints: ["RAG", "Retrieval"]
  },
  {
    id: "deep-chunk-b",
    sourceId: "deep-source-b",
    content: "RAG grounding keeps 2 independent checks in 2024: cite chunks and verify numbers.",
    conceptHints: ["RAG", "Grounding"]
  },
  {
    id: "deep-chunk-conflict",
    sourceId: "deep-source-conflict",
    content: "RAG retrieval uses 4 steps in 2024: index, retrieve, rerank, generate.",
    conceptHints: ["RAG", "Retrieval"]
  },
  {
    id: "deep-chunk-bad",
    sourceId: "deep-source-bad",
    content: "RAG magically solves every knowledge problem without evidence.",
    conceptHints: ["RAG"]
  }
];
const deepReadRegistry = {
  sources: deepReadSources,
  assets: [],
  snapshots: [],
  chunks: deepReadChunks,
  chunkVersions: []
};
const deepReadCards = [
  {
    ...makeSmokePost({
      id: "deep-card-a",
      title: "RAG retrieval",
      concepts: ["RAG", "Retrieval"],
      graphEdges: [
        {
          id: "deep-edge-retrieval",
          sourceConcept: "RAG",
          relation: "requires",
          targetConcept: "Retrieval",
          evidence: "RAG requires retrieval.",
          weight: 0.9
        },
        {
          id: "deep-edge-evaluation",
          sourceConcept: "RAG",
          relation: "requires",
          targetConcept: "Evaluation",
          evidence: "RAG requires evaluation.",
          weight: 0.8
        }
      ]
    }),
    sources: [deepReadSources[0]],
    citations: [{ sourceId: "deep-source-a", chunkId: "deep-chunk-a" }],
    confidence: "high",
    trustState: "supported"
  },
  {
    ...makeSmokePost({
      id: "deep-card-b",
      title: "RAG grounding",
      concepts: ["RAG", "Grounding"],
      graphEdges: [
        {
          id: "deep-edge-grounding",
          sourceConcept: "RAG",
          relation: "requires",
          targetConcept: "Grounding",
          evidence: "RAG requires grounding checks.",
          weight: 0.8
        }
      ]
    }),
    sources: [deepReadSources[1]],
    citations: [{ sourceId: "deep-source-b", chunkId: "deep-chunk-b" }],
    confidence: "high",
    trustState: "supported"
  },
  {
    ...makeSmokePost({
      id: "deep-card-conflict",
      title: "RAG step variant",
      concepts: ["RAG", "Retrieval"]
    }),
    sources: [deepReadSources[2]],
    citations: [{ sourceId: "deep-source-conflict", chunkId: "deep-chunk-conflict" }],
    confidence: "medium",
    trustState: "contested"
  },
  {
    ...makeSmokePost({
      id: "deep-card-bad",
      title: "Rejected RAG roundup",
      concepts: ["RAG"]
    }),
    sources: [deepReadSources[3]],
    citations: [{ sourceId: "deep-source-bad", chunkId: "deep-chunk-bad" }],
    confidence: "low",
    trustState: "emerging"
  }
];
const deepReadInput = {
  topic: "RAG",
  userId: "local-user",
  cards: deepReadCards,
  sourceRegistries: [
    {
      id: "deep-registry",
      sourceId: "deep-source-a",
      registry: deepReadRegistry,
      createdAt: "2026-07-08T00:00:00.000Z"
    }
  ],
  sourceQualityVerdicts: [
    {
      url: "https://example.com/rag-bad",
      sourceId: "deep-source-bad",
      sourceTitle: "Rejected RAG roundup",
      score: 0.1,
      verdict: "reject",
      reasons: ["unsupported claims"],
      runnerKind: "deterministic",
      evaluatedAt: "2026-07-08T00:00:00.000Z"
    }
  ],
  knownConcepts: ["Retrieval"],
  libraryVersion: "2026-07-08T00:00:00.000Z",
  contentLanguage: "zh"
};
const deepSelection = selectDeepReadMaterials(deepReadInput);

assert.ok(deepSelection.materials.length >= 3, "deep-read selection should admit qualified closure materials");
assert.ok(
  deepSelection.discardedMaterials.some((item) => item.cardId === "deep-card-bad"),
  "deep-read selection should record rejected material in the discard list"
);
assert.ok(deepSelection.conflicts.length >= 1, "deep-read conflict precheck should catch changed numeric facts");

const deepOutline = await createDeepReadOutlineContracts(deepSelection, { contentLanguage: "zh" });

assert.ok(deepOutline.contracts.length >= 2, "deep-read outline should produce chapter contracts");
assert.ok(
  deepOutline.contracts.some((contract) => contract.materialPointers.length > 0 && contract.keyFacts.length > 0),
  "deep-read chapter contracts should include material pointers and key facts"
);
assert.ok(
  deepOutline.contracts.some((contract) => contract.materialPointers.length === 0 && contract.gapStatement),
  "deep-read outline should turn no-material nodes into gap chapters"
);

const deepContext = createDeepReadMaterialContext(deepSelection.materials);
const firstContractWithMaterial = deepOutline.contracts.find((contract) => contract.materialPointers.length > 0);

assert.ok(firstContractWithMaterial, "deep-read fixture should have a material-backed contract");

const danglingCitationReport = await gateDeepReadParagraph(
  {
    id: "dangling",
    kind: "fact",
    text: "Source chunk states: RAG retrieval uses 3 steps in 2024.",
    citations: [{ sourceId: "missing-source", chunkId: "missing-chunk" }]
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(danglingCitationReport.passed, false, "deep-read existence gate should reject dangling citations");

const changedNumberReport = await gateDeepReadParagraph(
  {
    id: "changed-number",
    kind: "fact",
    text: "Source chunk states: RAG retrieval uses 9 steps in 2024.",
    citations: [firstContractWithMaterial.materialPointers[0]]
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(changedNumberReport.passed, false, "deep-read key fact gate should reject altered numbers");

const judgePointer = firstContractWithMaterial.materialPointers[0];
const judgeSupportedText =
  deepContext.chunkByPointerKey.get(`${judgePointer.sourceId}|${judgePointer.chunkId}`)?.content ?? "";
const noClientJudgeReport = await gateDeepReadParagraph(
  {
    id: "judge-no-client",
    kind: "fact",
    text: judgeSupportedText,
    citations: [judgePointer]
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(noClientJudgeReport.passed, true, "without a model client, conservative deterministic support should still work");
assert.ok(
  noClientJudgeReport.issues.every((issue) => !/judge/i.test(issue)),
  "a no-client deterministic pass must not be represented as a model-judge pass"
);

const noClientHallucinationReport = await gateDeepReadParagraph(
  {
    id: "judge-no-client-hallucination",
    kind: "fact",
    text: "RAG cures cancer.",
    citations: [judgePointer]
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  noClientHallucinationReport.passed,
  false,
  "without a model client, one shared entity must not support an unrelated predicate"
);
assert.ok(
  noClientHallucinationReport.issues.some((issue) => /deterministic support gate/.test(issue)),
  "no-client hallucinations should fail in the deterministic support layer"
);

const noClientTwoAnchorHallucinationReport = await gateDeepReadParagraph(
  {
    id: "judge-no-client-two-anchor-hallucination",
    kind: "fact",
    text: "RAG retrieval guarantees immortality.",
    citations: [judgePointer]
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  noClientTwoAnchorHallucinationReport.passed,
  false,
  "two lexical anchors must not make a no-client DeepRead hallucination pass"
);

const noClientHighCopyHallucinationReport = await gateDeepReadParagraph(
  {
    id: "judge-no-client-high-copy-hallucination",
    kind: "fact",
    text: `${judgeSupportedText.replace(/[.!?。！？]+$/u, "")} guaranteeing immortality.`,
    citations: [judgePointer]
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  noClientHighCopyHallucinationReport.passed,
  false,
  "a no-client DeepRead fact must reject an unsupported tail after copied evidence"
);

let normalJudgeCalls = 0;
const normalJudgeReport = await gateDeepReadParagraph(
  {
    id: "judge-normal",
    kind: "fact",
    text: judgeSupportedText,
    citations: [judgePointer]
  },
  firstContractWithMaterial,
  deepContext,
  {
    checkedAt: "2026-07-08T00:00:00.000Z",
    client: {
      async complete() {
        normalJudgeCalls += 1;
        return { content: JSON.stringify({ passed: true, issues: [] }) };
      }
    }
  }
);

assert.equal(normalJudgeCalls, 1, "a configured deep-read judge should be called after deterministic checks pass");
assert.equal(normalJudgeReport.passed, true, "only an explicit passed:true judge decision should pass");

const throwingJudgeReport = await gateDeepReadParagraph(
  {
    id: "judge-throws",
    kind: "fact",
    text: judgeSupportedText,
    citations: [judgePointer]
  },
  firstContractWithMaterial,
  deepContext,
  {
    checkedAt: "2026-07-08T00:00:00.000Z",
    client: {
      async complete() {
        throw new Error("judge timeout fixture");
      }
    }
  }
);

assert.equal(throwingJudgeReport.passed, false, "a configured judge exception must fail closed");
assert.ok(
  throwingJudgeReport.issues.some((issue) => /judge gate error.*timeout fixture/i.test(issue)),
  "judge exceptions should remain observable as gate errors"
);

const invalidJudgeReport = await gateDeepReadParagraph(
  {
    id: "judge-invalid",
    kind: "fact",
    text: judgeSupportedText,
    citations: [judgePointer]
  },
  firstContractWithMaterial,
  deepContext,
  {
    checkedAt: "2026-07-08T00:00:00.000Z",
    client: {
      async complete() {
        return { content: JSON.stringify({ passed: true }) };
      }
    }
  }
);

assert.equal(invalidJudgeReport.passed, false, "an invalid judge structure must fail closed");
assert.ok(
  invalidJudgeReport.issues.some((issue) => /judge gate error.*invalid decision/i.test(issue)),
  "invalid judge structures should be reported as gate errors"
);

const mlaPointer = { cardId: "deep-card-mla", sourceId: "deep-source-mla", chunkId: "deep-chunk-mla" };
const mlaMaterial = {
  pointer: mlaPointer,
  cardTitle: "MLA basics",
  cardSummary: "MLA basics",
  cardConcepts: ["Multi-head Latent Attention"],
  sourceTitle: "MLA paper notes",
  sourceUrl: "https://example.com/mla",
  sourceType: "paper",
  chunkText: "Multi-head Latent Attention uses latent vectors to reduce attention state.",
  admissionScore: 0.9,
  admissionReasons: ["fixture"],
  keyFacts: []
};
const mlaContext = createDeepReadMaterialContext([mlaMaterial], {
  topic: "Multi-head Latent Attention",
  conceptAliases: [
    {
      canonical: "Multi-head Latent Attention",
      aliases: ["MLA"],
      decidedBy: "user",
      decidedAt: "2026-07-08T00:00:00.000Z"
    }
  ]
});
const mlaContract = {
  id: "chapter-mla",
  title: "Multi-head Latent Attention",
  question: "What does the cited source support about MLA?",
  materialPointers: [mlaPointer],
  keyFacts: [],
  conflictInstructions: [],
  singleSource: true,
  readerPositioning: { masteredConcepts: [], gapConcepts: [] }
};
const mlaAbbreviationReport = await gateDeepReadParagraph(
  {
    id: "mla-abbreviation",
    kind: "fact",
    text: "MLA uses latent vectors.",
    citations: [mlaPointer]
  },
  mlaContract,
  mlaContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  mlaAbbreviationReport.passed,
  true,
  "deep-read literal gate should exempt a topic abbreviation backed by a cited full name"
);

const mlaFullNameOnlyReport = await gateDeepReadParagraph(
  {
    id: "mla-full-name-only",
    kind: "fact",
    text: "MLA uses latent vectors.",
    citations: [mlaPointer]
  },
  mlaContract,
  createDeepReadMaterialContext([mlaMaterial], { topic: "Attention" }),
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  mlaFullNameOnlyReport.passed,
  true,
  "deep-read literal gate should match paragraph abbreviations against cited full names without requiring an alias"
);

const keyFactPointer = { cardId: "deep-card-keyfact", sourceId: "deep-source-keyfact", chunkId: "deep-chunk-keyfact" };
const keyFactContext = createDeepReadMaterialContext([
  {
    ...mlaMaterial,
    pointer: keyFactPointer,
    cardTitle: "Retrieval component",
    cardConcepts: ["Retrieval"],
    sourceTitle: "Retrieval notes",
    sourceUrl: "https://example.com/keyfact",
    chunkText: "The retrieval component handles lookup.",
    keyFacts: []
  }
]);
const keyFactContract = {
  ...mlaContract,
  id: "chapter-keyfact",
  title: "Retrieval component",
  materialPointers: [keyFactPointer],
  keyFacts: [
    {
      id: "keyfact-alpha",
      kind: "proper_noun",
      value: "AlphaSearch",
      normalizedValue: "alphasearch",
      fieldKey: "proper_noun:identity",
      sourceId: keyFactPointer.sourceId,
      chunkId: keyFactPointer.chunkId,
      cardId: keyFactPointer.cardId
    }
  ]
};
const keyFactExemptionReport = await gateDeepReadParagraph(
  {
    id: "keyfact-exemption",
    kind: "fact",
    text: "AlphaSearch handles lookup.",
    citations: [keyFactPointer]
  },
  keyFactContract,
  keyFactContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  keyFactExemptionReport.passed,
  true,
  "deep-read literal gate should exempt proper nouns already present in the chapter contract keyFacts"
);

const downgradedFactChapter = await gateDeepReadChapter(
  {
    contract: firstContractWithMaterial,
    paragraphs: [
      {
        id: "proper-noun-only",
        kind: "fact",
        text: "BetaSearch changes retrieval.",
        citations: [firstContractWithMaterial.materialPointers[0]]
      }
    ]
  },
  deepContext,
  { contentLanguage: "zh", now: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  downgradedFactChapter.chapter.status,
  "gap",
  "deep-read should fail closed when an unsupported proper noun is the chapter's only fact"
);
assert.ok(
  downgradedFactChapter.chapter.paragraphs.every((paragraph) => !paragraph.text.includes("BetaSearch")),
  "an unsupported proper noun must not be laundered from fact into synthesis"
);
// Strict numeric literals apply to synthesis prose too: a digit must not dodge
// the gate by riding in a synthesis paragraph.
const synthesisNumberMismatch = await gateDeepReadParagraph(
  {
    id: "synthesis-number-mismatch",
    kind: "synthesis",
    text: "Read together, retrieval uses 9 steps.",
    citations: [firstContractWithMaterial.materialPointers[0]]
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  synthesisNumberMismatch.passed,
  false,
  "deep-read gate should reject synthesis paragraphs whose numbers are absent from cited chunks"
);

const synthesisNumberUncited = await gateDeepReadParagraph(
  {
    id: "synthesis-number-uncited",
    kind: "synthesis",
    text: "Read together, retrieval uses 3 steps.",
    citations: []
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  synthesisNumberUncited.passed,
  false,
  "deep-read gate should reject synthesis paragraphs that state numbers without citing evidence"
);

const threeStepsPointer = deepSelection.materials.find((material) => material.chunkText.includes("3 steps"))?.pointer;

assert.ok(threeStepsPointer, "deep-read fixture should include the 3-steps chunk material");

const synthesisNumberGrounded = await gateDeepReadParagraph(
  {
    id: "synthesis-number-grounded",
    kind: "synthesis",
    text: "Retrieval uses 3 steps in 2024.",
    citations: [threeStepsPointer]
  },
  firstContractWithMaterial,
  deepContext,
  { checkedAt: "2026-07-08T00:00:00.000Z" }
);

assert.equal(
  synthesisNumberGrounded.passed,
  true,
  "deep-read gate should keep synthesis paragraphs whose numbers are literally present in cited chunks"
);

assert.equal(
  downgradedFactChapter.deletedParagraphLog.length,
  1,
  "deep-read should audit the removed unsupported proper-noun paragraph"
);
assert.ok(
  downgradedFactChapter.deletedParagraphLog[0].reasons.some((reason) => /proper-noun tokens absent/.test(reason)),
  "the deletion audit should name the unsupported proper-noun failure"
);

const degradedChapter = await gateDeepReadChapter(
  {
    contract: firstContractWithMaterial,
    paragraphs: [
      {
        id: "bad-1",
        kind: "fact",
        text: "值得注意的是 RAG retrieval uses 9 steps in 2024.",
        citations: [firstContractWithMaterial.materialPointers[0]]
      },
      {
        id: "bad-2",
        kind: "fact",
        text: "Source chunk states: RAG retrieval uses 8 steps in 2024.",
        citations: [firstContractWithMaterial.materialPointers[0]]
      },
      {
        id: "bad-3",
        kind: "fact",
        text: "Source chunk states: RAG retrieval uses 7 steps in 2024.",
        citations: [firstContractWithMaterial.materialPointers[0]]
      }
    ]
  },
  deepContext,
  { contentLanguage: "zh", now: "2026-07-08T00:00:00.000Z" }
);

assert.equal(degradedChapter.chapter.status, "gap", "deep-read chapter should degrade when more than half is deleted");
assert.ok(
  degradedChapter.deletedParagraphLog.length >= 2,
  "deep-read deleted paragraph log should record removed paragraphs"
);

let retryDraftCalls = 0;
const retryPointer = firstContractWithMaterial.materialPointers[0];
const retrySupportedText =
  deepContext.chunkByPointerKey.get(`${retryPointer.sourceId}|${retryPointer.chunkId}`)?.content ??
  "RAG retrieval uses 3 steps in 2024.";
const retryClient = {
  async complete(request) {
    const system = request.messages[0]?.content ?? "";

    if (system.includes("Write one readable article chapter")) {
      retryDraftCalls += 1;
      assert.ok(
        request.messages[1]?.content.includes("gateFeedback"),
        "deep-read chapter retry should pass gate feedback into the regenerated model draft"
      );

      return {
        content: JSON.stringify({
          takeaway: retrySupportedText,
          paragraphs: [
            {
              text: retrySupportedText,
              kind: "fact",
              citations: [retryPointer]
            }
          ]
        })
      };
    }

    if (system.includes("Rewrite one paragraph to satisfy the gate")) {
      return {
        content: JSON.stringify({
          text: "RAG retrieval uses 9 steps in 2024.",
          kind: "fact",
          citations: [retryPointer]
        })
      };
    }

    if (system.includes("Judge whether every factual sentence")) {
      return { content: JSON.stringify({ passed: true, issues: [] }) };
    }

    if (system.includes("Detect overstatement in synthesis")) {
      return { content: JSON.stringify({ passed: true, issues: [] }) };
    }

    return { content: JSON.stringify({ passed: true, issues: [] }) };
  }
};
const retriedChapter = await gateDeepReadChapter(
  {
    contract: firstContractWithMaterial,
    paragraphs: [
      {
        id: "retry-bad-1",
        kind: "fact",
        text: "RAG retrieval uses 9 steps in 2024.",
        citations: [retryPointer]
      },
      {
        id: "retry-bad-2",
        kind: "fact",
        text: "RAG retrieval uses 8 steps in 2024.",
        citations: [retryPointer]
      },
      {
        id: "retry-bad-3",
        kind: "fact",
        text: "RAG retrieval uses 7 steps in 2024.",
        citations: [retryPointer]
      }
    ]
  },
  deepContext,
  { client: retryClient, contentLanguage: "zh", now: "2026-07-08T00:00:00.000Z" }
);

assert.equal(retryDraftCalls, 1, "deep-read chapter gate should regenerate once after deleting more than one third");
assert.equal(retriedChapter.chapter.status, "complete", "deep-read chapter retry should use the regenerated gated chapter");
assert.equal(
  retriedChapter.chapter.paragraphs[0]?.text,
  retrySupportedText,
  "deep-read chapter retry should keep the regenerated supported paragraph"
);

const fallbackArticleA = await createDeepReadArticle(deepReadInput, { now: "2026-07-08T00:00:00.000Z" });
const fallbackArticleB = await createDeepReadArticle(deepReadInput, { now: "2026-07-08T00:00:00.000Z" });

assert.equal(fallbackArticleA.runnerKind, "deterministic_fallback", "network-free smoke should use fallback article");
assert.deepEqual(fallbackArticleA, fallbackArticleB, "deep-read fallback should be deterministic for identical input");
assert.ok(fallbackArticleA.discardedMaterials.length > 0, "fallback article should persist discard list");
assert.ok(
  Array.isArray(fallbackArticleA.deletedParagraphLog),
  "fallback article should persist deleted paragraph log field"
);
const fallbackGapChapters = fallbackArticleA.chapters.filter((chapter) => chapter.status === "gap");

assert.equal(fallbackGapChapters.length, 1, "deep-read gaps should be aggregated into one final gap chapter");
assert.equal(
  fallbackArticleA.chapters.at(-1)?.title,
  "本文来源覆盖不到的部分",
  "deep-read aggregated gap chapter should be appended at the end"
);
assert.ok(
  fallbackArticleA.chapters.slice(0, -1).every((chapter) => chapter.status === "complete" && chapter.contract.materialPointers.length > 0),
  "deep-read body should keep only material-backed complete chapters before the aggregate gap"
);
assert.ok(
  fallbackArticleA.chapters.at(-1)?.paragraphs.some((paragraph) => paragraph.text.includes("Evaluation")),
  "deep-read aggregate gap should preserve the original no-material chapter explanation"
);

const dedupedParagraphs = dedupeArticleParagraphs([
  {
    id: "dedupe-a",
    title: "A",
    question: "A?",
    status: "complete",
    singleSource: false,
    contract: firstContractWithMaterial,
    paragraphs: [
      {
        id: "dedupe-a-cited",
        kind: "fact",
        text: "Repeated cited paragraph.",
        citations: [firstContractWithMaterial.materialPointers[0]]
      },
      {
        id: "dedupe-a-statement",
        kind: "synthesis",
        text: "Repeated no-citation statement.",
        citations: []
      }
    ],
    sources: []
  },
  {
    id: "dedupe-b",
    title: "B",
    question: "B?",
    status: "complete",
    singleSource: false,
    contract: firstContractWithMaterial,
    paragraphs: [
      {
        id: "dedupe-b-cited",
        kind: "fact",
        text: "Repeated cited paragraph.",
        citations: [firstContractWithMaterial.materialPointers[0]]
      },
      {
        id: "dedupe-b-statement",
        kind: "synthesis",
        text: "Repeated no-citation statement.",
        citations: []
      }
    ],
    sources: []
  }
]);

assert.equal(
  dedupedParagraphs.flatMap((chapter) => chapter.paragraphs).filter((paragraph) => paragraph.text === "Repeated cited paragraph.").length,
  1,
  "deep-read dedupe should still remove duplicate cited body paragraphs"
);
assert.equal(
  dedupedParagraphs
    .flatMap((chapter) => chapter.paragraphs)
    .filter((paragraph) => paragraph.text === "Repeated no-citation statement.").length,
  2,
  "deep-read dedupe should not remove duplicate no-citation declaration paragraphs"
);

// The en fallback templates must survive the literal fact gate: template words
// extracted as proper nouns once wiped every chapter into a gap chapter.
const fallbackArticleEn = await createDeepReadArticle(
  { ...deepReadInput, contentLanguage: "en" },
  { now: "2026-07-08T00:00:00.000Z" }
);

assert.ok(
  fallbackArticleEn.chapters.some((chapter) => chapter.status === "complete"),
  "en deterministic fallback should keep material-backed chapters complete"
);
assert.equal(
  fallbackArticleEn.deletedParagraphLog.length,
  0,
  "en deterministic fallback should not have paragraphs deleted by its own gates"
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
