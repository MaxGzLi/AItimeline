import type {
  BackgroundCurationJob,
  BackgroundCurationJobKind,
  BackgroundCurationPlan,
  BackgroundSourceCandidate
} from "./backgroundCuration.js";
import { createFollowupSourceImportPlan, type FollowupGenerationProtocol } from "../harness/followupHarness.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import type { SourceImportWorker, SourceImportWorkerResult } from "../source/sourceImportWorker.js";
import type {
  AgentHarnessUserContext,
  ConceptBrief,
  DeepReadArticleRecord,
  KnowledgeChunk,
  KnowledgePost,
  SourceAsset,
  SourceQualityVerdict,
  SourceRegistry
} from "../types.js";
import { normalizeConceptKey } from "../graph/conceptAliases.js";
import { getDayKey } from "../time/calendarKeys.js";
import {
  decodeJson,
  decodeRecordCollection,
  deepClone,
  expectArray,
  expectEnum,
  expectFiniteNumber,
  expectIsoDate,
  expectNonEmptyString,
  expectNonNegativeInteger,
  expectObject,
  expectString,
  PersistenceDecodeError,
  type PersistenceLoadIssue
} from "../storage/runtimeDecoder.js";
import {
  commitWithRetry,
  createMemoryRevisionedStorageAdapter,
  type RevisionedStorageAdapter
} from "../storage/revisionedStorage.js";

export type BackgroundCurationJobStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export interface BackgroundCurationJobResult {
  kind: BackgroundCurationJobKind;
  message?: string;
  sourceImport?: SourceImportWorkerResult;
  sourceImports?: SourceImportWorkerResult[];
  materializationPlan?: unknown;
  discoveredSourceCandidates?: BackgroundSourceCandidate[];
  ideaResearchQueries?: {
    support: string[];
    challenge: string[];
  };
  followupProtocol?: FollowupGenerationProtocol;
  conceptBrief?: ConceptBrief;
  deepReadArticle?: DeepReadArticleRecord;
}

export interface BackgroundCurationJobRecord {
  id: string;
  job: BackgroundCurationJob;
  status: BackgroundCurationJobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
  result?: BackgroundCurationJobResult;
  originalJobId: string;
  attempt: number;
  claimedAt?: string;
  leaseUntil?: string;
  workerId?: string;
  materializedAt?: string;
}

export interface BackgroundCurationJobStore {
  enqueuePlan(plan: BackgroundCurationPlan, enqueuedAt?: string | Date): BackgroundCurationJobRecord[];
  list(status?: BackgroundCurationJobStatus): BackgroundCurationJobRecord[];
  get(jobId: string): BackgroundCurationJobRecord | undefined;
  getDueJobs(now?: string | Date, options?: { limit?: number; kinds?: BackgroundCurationJobKind[] }): BackgroundCurationJobRecord[];
  claimNextDueJob(
    now: string | Date,
    options: { kinds?: BackgroundCurationJobKind[]; workerId: string; leaseDurationMs: number }
  ): BackgroundCurationJobRecord | undefined;
  renewLease(
    jobId: string,
    owner: { workerId: string; claimGeneration: number },
    now: string | Date,
    leaseDurationMs: number
  ): BackgroundCurationJobRecord;
  completeClaim(
    jobId: string,
    owner: { workerId: string; claimGeneration: number },
    terminal: {
      status: "succeeded" | "failed" | "skipped";
      completedAt: string | Date;
      result?: BackgroundCurationJobResult;
      lastError?: string;
    }
  ): BackgroundCurationJobRecord;
  recoverExpiredLeases(now: string | Date): BackgroundCurationJobRecord[];
  enqueueRetry(jobId: string, retriedAt: string | Date): BackgroundCurationJobRecord;
  updateTerminalResult(jobId: string, result: BackgroundCurationJobResult): BackgroundCurationJobRecord;
  markMaterialized(jobIds: string[], at: string | Date): BackgroundCurationJobRecord[];
  flushMigration(savedAt?: string | Date): boolean;
  close(): void;
}

export interface BackgroundCurationJobStoreSnapshot {
  version: 2;
  revision: number;
  records: BackgroundCurationJobRecord[];
}

export interface DecodedBackgroundCurationJobStoreSnapshot {
  snapshot: {
    version: 2;
    revision: number;
    records: BackgroundCurationJobRecord[];
  };
  issues: PersistenceLoadIssue[];
  needsFlushMigration: boolean;
}

export type BackgroundCurationJobStorageAdapter = RevisionedStorageAdapter;

export class BackgroundCurationTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackgroundCurationTransitionError";
  }
}

export interface SourceCandidateIngestionResult {
  assets?: SourceAsset[];
  chunks: KnowledgeChunk[];
  sourceRegistry?: SourceRegistry;
  recommendedBecause?: string;
}

export interface BackgroundCurationExecutionHandlers {
  contentLanguage?: ContentLanguage;
  sourceImportWorker?: SourceImportWorker;
  ingestSourceCandidate?: (
    candidate: BackgroundSourceCandidate,
    job: BackgroundCurationJob
  ) => Promise<SourceCandidateIngestionResult> | SourceCandidateIngestionResult;
  discoverSources?: (
    job: BackgroundCurationJob
  ) => Promise<BackgroundSourceCandidate[]> | BackgroundSourceCandidate[];
  loadSeedPost?: (job: BackgroundCurationJob) => Promise<KnowledgePost | undefined> | KnowledgePost | undefined;
  loadSourceQualityVerdicts?: () => Promise<SourceQualityVerdict[]> | SourceQualityVerdict[];
  loadSourceQualityUserContext?: () => Promise<AgentHarnessUserContext | undefined> | AgentHarnessUserContext | undefined;
  generateFollowup?: BackgroundCurationJobHandler;
  scheduleReview?: BackgroundCurationJobHandler;
  askClarifyingQuestion?: BackgroundCurationJobHandler;
  cooldownTopic?: BackgroundCurationJobHandler;
  researchQuestion?: BackgroundCurationJobHandler;
  researchIdea?: BackgroundCurationJobHandler;
  conceptBrief?: BackgroundCurationJobHandler;
  deepReadArticle?: BackgroundCurationJobHandler;
}

export interface BackgroundCurationExecutionContext {
  readonly recordId: string;
  readonly originalJobId: string;
  readonly attempt: number;
  readonly effectAt: string;
}

export type BackgroundCurationJobHandler = (
  job: BackgroundCurationJob,
  context: BackgroundCurationExecutionContext
) => Promise<BackgroundCurationJobResult> | BackgroundCurationJobResult;

export interface RunBackgroundCurationJobsOptions {
  now?: string | Date;
  limit?: number;
  kinds?: BackgroundCurationJobKind[];
  workerId: string;
  clock?: () => Date;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
}

export interface BackgroundCurationExecutionBatch {
  startedAt: string;
  completedAt: string;
  records: BackgroundCurationJobRecord[];
}

export function createInMemoryBackgroundCurationJobStore(
  initialRecords: BackgroundCurationJobRecord[] = []
): BackgroundCurationJobStore {
  const normalized = initialRecords.map(withQueueLineageDefaults);
  const adapter = createMemoryRevisionedStorageAdapter(JSON.stringify({ version: 2, revision: 0, records: normalized }));
  return createPersistentBackgroundCurationJobStore(adapter);
}

export function createPersistentBackgroundCurationJobStore(
  storage: BackgroundCurationJobStorageAdapter,
  initialRecords: BackgroundCurationJobRecord[] = [],
  options: {
    now?: string | Date;
    timeZone?: string;
    onLoadIssue?: (issue: PersistenceLoadIssue) => void;
  } = {}
): BackgroundCurationJobStore {
  const initialRaw = storage.read();
  const initialDecoded = initialRaw
    ? decodeBackgroundCurationJobStoreSnapshot(initialRaw, { timeZone: options.timeZone })
    : {
        snapshot: {
          version: 2 as const,
          revision: 0,
          records: initialRecords.map(withQueueLineageDefaults)
        },
        issues: [],
        needsFlushMigration: initialRecords.length > 0
      };
  const reportedLoadIssues = new Set<string>();
  const reportLoadIssues = (issues: PersistenceLoadIssue[]) => {
    for (const issue of issues) {
      const key = `${issue.collection}|${issue.index}|${issue.jsonPath}|${issue.message}`;
      if (reportedLoadIssues.has(key)) continue;
      reportedLoadIssues.add(key);
      options.onLoadIssue?.(issue);
    }
  };
  reportLoadIssues(initialDecoded.issues);
  let snapshot = initialDecoded.snapshot;
  let needsFlushMigration = initialDecoded.needsFlushMigration;

  const readLatest = (): BackgroundCurationJobStoreSnapshot => {
    const raw = storage.read();
    if (!raw) return deepClone(snapshot);
    const decoded = decodeBackgroundCurationJobStoreSnapshot(raw, { timeZone: options.timeZone });
    reportLoadIssues(decoded.issues);
    return decoded.snapshot;
  };
  const commit = (
    mutate: (base: BackgroundCurationJobStoreSnapshot) => BackgroundCurationJobStoreSnapshot | undefined
  ): BackgroundCurationJobStoreSnapshot => {
    const result = commitWithRetry({
      readAndDecode: readLatest,
      mutate,
      serialize: JSON.stringify,
      compareAndSwap: storage.compareAndSwap.bind(storage)
    });
    snapshot = result.value;
    if (result.committed) needsFlushMigration = false;
    return deepClone(snapshot);
  };

  return {
    enqueuePlan(plan, enqueuedAt = plan.generatedAt) {
      const now = normalizeDate(enqueuedAt).toISOString();
      const selectedIds: string[] = [];
      const next = commit((base) => {
        selectedIds.length = 0;
        const recordsById = new Map(base.records.map((record) => [record.id, record]));
        let changed = false;
        for (const job of plan.jobs) {
          const existing = recordsById.get(job.id) ?? findActiveEquivalentJob(recordsById, job);
          if (existing) {
            selectedIds.push(existing.id);
            continue;
          }
          const record: BackgroundCurationJobRecord = {
            id: job.id,
            job: deepClone(job),
            originalJobId: job.id,
            attempt: 0,
            status: "queued",
            attempts: 0,
            createdAt: now,
            updatedAt: now
          };
          recordsById.set(record.id, record);
          selectedIds.push(record.id);
          changed = true;
        }
        return changed ? { ...base, records: Array.from(recordsById.values()) } : undefined;
      });
      return selectedIds.map((id) => cloneRecord(requireRecord(next.records, id)));
    },
    list(status) {
      const records = readLatest().records;
      return records.filter((record) => !status || record.status === status).map(cloneRecord).sort(compareRecords);
    },
    get(jobId) {
      const record = readLatest().records.find((candidate) => candidate.id === jobId);
      return record ? cloneRecord(record) : undefined;
    },
    getDueJobs(now = new Date(), dueOptions = {}) {
      return selectDueRecords(readLatest().records, now, dueOptions).map(cloneRecord);
    },
    claimNextDueJob(now, claimOptions) {
      const claimedAt = normalizeDate(now).toISOString();
      let claimedId: string | undefined;
      const next = commit((base) => {
        claimedId = undefined;
        const recovered = recoverExpiredRecords(base.records, claimedAt);
        const due = selectDueRecords(recovered.records, claimedAt, {
          limit: 1,
          kinds: claimOptions.kinds
        })[0];
        if (!due) return recovered.changed ? { ...base, records: recovered.records } : undefined;
        claimedId = due.id;
        const leaseUntil = new Date(normalizeDate(claimedAt).getTime() + claimOptions.leaseDurationMs).toISOString();
        return {
          ...base,
          records: recovered.records.map((record) =>
            record.id === due.id
              ? {
                  ...record,
                  status: "running" as const,
                  attempts: record.attempts + 1,
                  startedAt: record.startedAt ?? claimedAt,
                  claimedAt,
                  leaseUntil,
                  workerId: claimOptions.workerId,
                  updatedAt: claimedAt,
                  lastError: undefined
                }
              : record
          )
        };
      });
      return claimedId ? cloneRecord(requireRecord(next.records, claimedId)) : undefined;
    },
    renewLease(jobId, owner, now, leaseDurationMs) {
      const renewedAt = normalizeDate(now).toISOString();
      const next = commit((base) => {
        const current = requireRecord(base.records, jobId);
        assertActiveOwner(current, owner, renewedAt);
        const renewed = {
          ...current,
          leaseUntil: new Date(normalizeDate(renewedAt).getTime() + leaseDurationMs).toISOString(),
          updatedAt: renewedAt
        };
        return { ...base, records: replaceRecord(base.records, renewed) };
      });
      return cloneRecord(requireRecord(next.records, jobId));
    },
    completeClaim(jobId, owner, terminal) {
      const completedAt = normalizeDate(terminal.completedAt).toISOString();
      const next = commit((base) => {
        const current = requireRecord(base.records, jobId);
        assertActiveOwner(current, owner, completedAt);
        const completed: BackgroundCurationJobRecord = {
          ...current,
          status: terminal.status,
          completedAt,
          updatedAt: completedAt,
          result: terminal.result ? deepClone(terminal.result) : undefined,
          lastError: terminal.lastError
        };
        return { ...base, records: replaceRecord(base.records, completed) };
      });
      return cloneRecord(requireRecord(next.records, jobId));
    },
    recoverExpiredLeases(now) {
      const recoveredAt = normalizeDate(now).toISOString();
      const recoveredIds: string[] = [];
      const next = commit((base) => {
        recoveredIds.length = 0;
        const recovered = recoverExpiredRecords(base.records, recoveredAt);
        recoveredIds.push(...recovered.recoveredIds);
        return recovered.changed ? { ...base, records: recovered.records } : undefined;
      });
      return recoveredIds.map((id) => cloneRecord(requireRecord(next.records, id)));
    },
    enqueueRetry(jobId, retriedAt) {
      const at = normalizeDate(retriedAt).toISOString();
      let retryId = "";
      const next = commit((base) => {
        const current = requireRecord(base.records, jobId);
        if (current.status !== "failed") {
          throw new BackgroundCurationTransitionError(`Retry requires a failed terminal record: ${jobId}`);
        }
        const active = base.records.find(
          (record) => record.originalJobId === current.originalJobId && (record.status === "queued" || record.status === "running")
        );
        if (active) {
          retryId = active.id;
          return undefined;
        }
        const nextAttempt = 1 + Math.max(
          ...base.records.filter((record) => record.originalJobId === current.originalJobId).map((record) => record.attempt),
          current.attempt
        );
        const baseId = `${current.originalJobId}|retry-${nextAttempt}`;
        retryId = baseId;
        let suffix = 1;
        while (base.records.some((record) => record.id === retryId)) retryId = `${baseId}-${suffix++}`;
        const job = deepClone(current.job);
        job.id = retryId;
        job.createdAt = at;
        job.runAfter = at;
        const retry: BackgroundCurationJobRecord = {
          id: retryId,
          job,
          originalJobId: current.originalJobId,
          attempt: nextAttempt,
          status: "queued",
          attempts: 0,
          createdAt: at,
          updatedAt: at
        };
        return { ...base, records: [...base.records, retry] };
      });
      return cloneRecord(requireRecord(next.records, retryId));
    },
    updateTerminalResult(jobId, result) {
      const next = commit((base) => {
        const current = requireRecord(base.records, jobId);
        if (!isTerminalStatus(current.status) || current.materializedAt) {
          throw new BackgroundCurationTransitionError(`Result update requires an unmaterialized terminal record: ${jobId}`);
        }
        if (JSON.stringify(current.result) === JSON.stringify(result)) return undefined;
        return { ...base, records: replaceRecord(base.records, { ...current, result: deepClone(result) }) };
      });
      return cloneRecord(requireRecord(next.records, jobId));
    },
    markMaterialized(jobIds, at) {
      const materializedAt = normalizeDate(at).toISOString();
      const ids = new Set(jobIds);
      const next = commit((base) => {
        let changed = false;
        const records = base.records.map((record) => {
          if (!ids.has(record.id)) return record;
          if (!isTerminalStatus(record.status)) {
            throw new BackgroundCurationTransitionError(`Materialization marker requires a terminal record: ${record.id}`);
          }
          if (record.materializedAt) return record;
          changed = true;
          return { ...record, materializedAt, updatedAt: materializedAt };
        });
        for (const id of ids) requireRecord(base.records, id);
        return changed ? { ...base, records } : undefined;
      });
      return jobIds.map((id) => cloneRecord(requireRecord(next.records, id)));
    },
    flushMigration() {
      if (!needsFlushMigration) return false;
      commit((base) => ({ ...base }));
      return true;
    },
    close() {
      storage.close?.();
    }
  };
}

export async function runDueBackgroundCurationJobs(
  store: BackgroundCurationJobStore,
  handlers: BackgroundCurationExecutionHandlers,
  options: RunBackgroundCurationJobsOptions
): Promise<BackgroundCurationExecutionBatch> {
  const wallStartedAt = Date.now();
  const logicalStartedAt = normalizeDate(options.now).getTime();
  let lastLogicalClock = logicalStartedAt - 1;
  const clock = options.clock ?? (() => {
    lastLogicalClock = Math.max(logicalStartedAt + (Date.now() - wallStartedAt), lastLogicalClock + 1);
    return new Date(lastLogicalClock);
  });
  const startedAt = new Date(logicalStartedAt).toISOString();
  const leaseDurationMs = options.leaseDurationMs ?? 15 * 60 * 1000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? Math.max(1, Math.floor(leaseDurationMs / 3));
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const records: BackgroundCurationJobRecord[] = [];

  while (records.length < limit) {
    const claimed = store.claimNextDueJob(clock(), {
      kinds: options.kinds,
      workerId: options.workerId,
      leaseDurationMs
    });
    if (!claimed) break;
    const owner = { workerId: options.workerId, claimGeneration: claimed.attempts };
    let heartbeatFailure: unknown;
    const heartbeat = setInterval(() => {
      try {
        store.renewLease(claimed.id, owner, clock(), leaseDurationMs);
      } catch (error) {
        heartbeatFailure = error;
        clearInterval(heartbeat);
      }
    }, heartbeatIntervalMs);
    const terminal = await executeBackgroundCurationJob(claimed, handlers, clock);
    clearInterval(heartbeat);
    if (heartbeatFailure) throw heartbeatFailure;

    records.push(store.completeClaim(claimed.id, owner, {
      status: terminal.status as "succeeded" | "failed" | "skipped",
      completedAt: terminal.completedAt ?? clock(),
      result: terminal.result,
      lastError: terminal.lastError
    }));
  }

  return {
    startedAt,
    completedAt: clock().toISOString(),
    records
  };
}

export async function executeBackgroundCurationJob(
  record: BackgroundCurationJobRecord,
  handlers: BackgroundCurationExecutionHandlers,
  clock: () => Date = () => new Date()
): Promise<BackgroundCurationJobRecord> {
  const context: BackgroundCurationExecutionContext = Object.freeze({
    recordId: record.id,
    originalJobId: record.originalJobId,
    attempt: record.attempt,
    effectAt: record.startedAt ?? record.claimedAt ?? record.updatedAt
  });

  try {
    const result = await runJob(record.job, handlers, context);
    const completedAt = clock().toISOString();
    const status: BackgroundCurationJobStatus = result.message?.startsWith("Skipped") ? "skipped" : "succeeded";

    return {
      ...record,
      status,
      completedAt,
      updatedAt: completedAt,
      result
    };
  } catch (error) {
    const completedAt = clock().toISOString();
    return {
      ...record,
      status: "failed",
      completedAt,
      updatedAt: completedAt,
      lastError: error instanceof Error ? error.message : "Unknown background curation job error."
    };
  }
}

async function runJob(
  job: BackgroundCurationJob,
  handlers: BackgroundCurationExecutionHandlers,
  context: BackgroundCurationExecutionContext
): Promise<BackgroundCurationJobResult> {
  const now = context.effectAt;
  if (job.kind === "import_source") {
    return runImportSourceJob(job, handlers, now);
  }

  if (job.kind === "discover_sources") {
    return runDiscoverSourcesJob(job, handlers, now);
  }

  if (job.kind === "research_question") {
    return handlers.researchQuestion
      ? handlers.researchQuestion(job, context)
      : skippedResult(job, "research question handler is not configured.");
  }

  if (job.kind === "research_idea") {
    return handlers.researchIdea
      ? handlers.researchIdea(job, context)
      : skippedResult(job, "idea research handler is not configured.");
  }

  if (job.kind === "generate_followup") {
    return handlers.generateFollowup ? handlers.generateFollowup(job, context) : runGenerateFollowupJob(job, handlers, now);
  }

  if (job.kind === "concept_brief") {
    return handlers.conceptBrief
      ? handlers.conceptBrief(job, context)
      : skippedResult(job, "concept brief handler is not configured.");
  }

  if (job.kind === "deep_read_article") {
    return handlers.deepReadArticle
      ? handlers.deepReadArticle(job, context)
      : skippedResult(job, "deep-read article handler is not configured.");
  }

  if (job.kind === "schedule_review") {
    return handlers.scheduleReview
      ? handlers.scheduleReview(job, context)
      : skippedResult(job, "review scheduling handler is not configured.");
  }

  if (job.kind === "ask_clarifying_question") {
    return handlers.askClarifyingQuestion
      ? handlers.askClarifyingQuestion(job, context)
      : skippedResult(job, "clarifying question handler is not configured.");
  }

  if (job.kind === "cooldown_topic") {
    return handlers.cooldownTopic
      ? handlers.cooldownTopic(job, context)
      : {
          kind: job.kind,
          message: "Topic cooldown recorded."
        };
  }

  return skippedResult(job, "background curation job kind is not supported.");
}

async function runGenerateFollowupJob(
  job: BackgroundCurationJob,
  handlers: BackgroundCurationExecutionHandlers,
  now: string
): Promise<BackgroundCurationJobResult> {
  if (job.nextAction === "continue_deeper" && handlers.discoverSources) {
    return runDeepDiveSourceJob(job, handlers, now);
  }

  return runSameSourceFollowupJob(job, handlers, now);
}

async function runSameSourceFollowupJob(
  job: BackgroundCurationJob,
  handlers: BackgroundCurationExecutionHandlers,
  now: string,
  fallbackReason?: string
): Promise<BackgroundCurationJobResult> {
  const seedPost = await handlers.loadSeedPost?.(job);

  if (!seedPost) {
    return runMissingSeedFollowupJob(job, handlers);
  }

  if (!handlers.sourceImportWorker) {
    return skippedResult(job, "follow-up generation requires a sourceImportWorker.");
  }

  const plan = createFollowupSourceImportPlan({
    job,
    seedPost,
    createdAt: now,
    contentLanguage: handlers.contentLanguage
  });
  plan.input.skipQualityGate = true;

  if (fallbackReason) {
    // System-context sentence with failure detail: mark beyond-source so the
    // grounding gate does not treat it as a source-backed claim.
    plan.input.recommendedBecause =
      handlers.contentLanguage === "en"
        ? `[beyond source] No better source was found, so this same-source follow-up was generated after "${seedPost.title}". ${fallbackReason}`
        : `[超出来源] 没找到更好的来源,所以先基于《${seedPost.title}》生成同源跟进卡。${fallbackReason}`;
  }

  const sourceImport = await handlers.sourceImportWorker.run(plan.input);

  if (sourceImport.importRecord.status === "failed") {
    throw new Error(sourceImport.errorMessage ?? "Follow-up source import worker failed.");
  }

  sourceImport.posts = sourceImport.posts.map((post) => ({
    ...post,
    derivedFromPostId: plan.derivedFromPostId,
    citations: [
      ...(post.citations ?? []),
      ...plan.rootCitations.filter((root) =>
        !(post.citations ?? []).some((citation) =>
          citation.sourceId === root.sourceId &&
          citation.chunkId === root.chunkId &&
          citation.chunkVersionId === root.chunkVersionId
        )
      )
    ]
  }));

  return {
    kind: job.kind,
    sourceImport,
    followupProtocol: plan.protocol,
    message: fallbackReason
      ? "Generated a same-source fallback follow-up because deep-dive discovery found no qualified source."
      : "Generated a grounded follow-up post for the timeline."
  };
}

async function runDiscoverSourcesJob(
  job: BackgroundCurationJob,
  handlers: BackgroundCurationExecutionHandlers,
  now: string
): Promise<BackgroundCurationJobResult> {
  if (!handlers.discoverSources) {
    return skippedResult(job, "source discovery handler is not configured.");
  }

  if (job.nextAction === "continue_deeper" && job.postId) {
    return runDeepDiveSourceJob(job, handlers, now);
  }

  return {
    kind: job.kind,
    discoveredSourceCandidates: await handlers.discoverSources(job),
    message: "Discovered source candidates for background curation."
  };
}

async function runDeepDiveSourceJob(
  job: BackgroundCurationJob,
  handlers: BackgroundCurationExecutionHandlers,
  now: string
): Promise<BackgroundCurationJobResult> {
  if (!handlers.discoverSources) {
    return runSameSourceFollowupJob(job, handlers, now, "Source discovery handler is not configured.");
  }

  const seedPost = await handlers.loadSeedPost?.(job);
  const discoveredSourceCandidates = await handlers.discoverSources(job);
  const rankedCandidates = rankDeepDiveCandidates(discoveredSourceCandidates);
  const remainingCandidates: BackgroundSourceCandidate[] = [];
  const importFailures: string[] = [];

  if (!seedPost) {
    return {
      kind: job.kind,
      discoveredSourceCandidates: rankedCandidates.slice(0, 1),
      message: "Discovered a source candidate for deep-dive grounding because the seed post is unavailable."
    };
  }

  if (!rankedCandidates.length) {
    return runSameSourceFollowupJob(job, handlers, now, "Deep-dive discovery returned no new candidates.");
  }

  if (!handlers.sourceImportWorker || !handlers.ingestSourceCandidate) {
    return {
      kind: job.kind,
      discoveredSourceCandidates: rankedCandidates,
      message: "Discovered deep-dive source candidates; import handlers are not configured."
    };
  }

  for (const candidate of rankedCandidates) {
    try {
      const ingested = await handlers.ingestSourceCandidate(candidate, job);
      const sourceImport = await handlers.sourceImportWorker.run({
        source: candidate.source,
        assets: ingested.assets,
        chunks: ingested.chunks,
        sourceRegistry: ingested.sourceRegistry,
        createdAt: now,
        contentLanguage: handlers.contentLanguage,
        recommendedBecause: formatDeepDiveRecommendedBecause(seedPost, candidate, handlers.contentLanguage),
        userContext: await handlers.loadSourceQualityUserContext?.(),
        qualityGateConceptHints: mergeUnique(job.conceptIds, candidate.conceptIds),
        sourceQualityVerdicts: await handlers.loadSourceQualityVerdicts?.()
      });

      if (sourceImport.qualityGate?.verdict === "reject") {
        importFailures.push(sourceImport.errorMessage ?? "Source quality gate rejected the candidate.");
        remainingCandidates.push(candidate);
        continue;
      }

      if (sourceImport.importRecord.status === "failed" || sourceImport.posts.length === 0) {
        importFailures.push(sourceImport.errorMessage ?? "Deep-dive source import worker produced no posts.");
        remainingCandidates.push(candidate);
        continue;
      }

      sourceImport.posts = sourceImport.posts.map((post) =>
        frameDeepDivePost(post, seedPost, candidate, handlers.contentLanguage)
      );

      return {
        kind: job.kind,
        sourceImport,
        discoveredSourceCandidates: remainingCandidates,
        message: "Imported a qualified new source for a deep-dive follow-up."
      };
    } catch (error) {
      importFailures.push(error instanceof Error ? error.message : "Unknown deep-dive source import error.");
      remainingCandidates.push(candidate);
    }
  }

  return runSameSourceFollowupJob(
    job,
    handlers,
    now,
    importFailures.slice(0, 3).join("; ") || "No qualified deep-dive source passed the quality gate."
  );
}

async function runMissingSeedFollowupJob(
  job: BackgroundCurationJob,
  handlers: BackgroundCurationExecutionHandlers
): Promise<BackgroundCurationJobResult> {
  if (!handlers.discoverSources) {
    return skippedResult(job, "follow-up generation requires a seed post or a source discovery handler.");
  }

  const discoveredSourceCandidates = (await handlers.discoverSources(job)).slice(0, 1);

  if (!discoveredSourceCandidates.length) {
    return skippedResult(job, "follow-up seed post was unavailable and source discovery produced no candidates.");
  }

  return {
    kind: job.kind,
    discoveredSourceCandidates,
    message: "Discovered a source candidate for follow-up grounding because the seed post is unavailable."
  };
}

async function runImportSourceJob(
  job: BackgroundCurationJob,
  handlers: BackgroundCurationExecutionHandlers,
  now: string
): Promise<BackgroundCurationJobResult> {
  if (!job.sourceCandidate) {
    throw new Error("import_source job requires a sourceCandidate.");
  }

  if (!handlers.sourceImportWorker) {
    throw new Error("import_source job requires a sourceImportWorker.");
  }

  if (!handlers.ingestSourceCandidate) {
    throw new Error("import_source job requires an ingestSourceCandidate handler.");
  }

  const ingested = await handlers.ingestSourceCandidate(job.sourceCandidate, job);
  const sourceImport = await handlers.sourceImportWorker.run({
    source: job.sourceCandidate.source,
    assets: ingested.assets,
    chunks: ingested.chunks,
    sourceRegistry: ingested.sourceRegistry,
    createdAt: now,
    contentLanguage: handlers.contentLanguage,
    recommendedBecause: ingested.recommendedBecause ?? job.reason,
    userContext: await handlers.loadSourceQualityUserContext?.(),
    qualityGateConceptHints: mergeUnique(job.conceptIds, job.sourceCandidate.conceptIds),
    sourceQualityVerdicts: await handlers.loadSourceQualityVerdicts?.(),
    // browser_share = the user clipped this content by hand, and that explicit
    // save is the quality signal, so the depth/quality gate is skipped (D1
    // decision, 2026-08-04). Every other lane still runs the gate, and the
    // anchor grounding gate on generated cards applies to all lanes.
    skipQualityGate: job.sourceCandidate.intakeKind === "browser_share"
  });

  if (sourceImport.qualityGate?.verdict === "reject") {
    if (job.nextAction === "continue_deeper") {
      return runSameSourceFollowupJob(job, handlers, now, sourceImport.errorMessage);
    }

    return {
      kind: job.kind,
      sourceImport,
      message: "Source quality gate rejected the candidate; no card was generated."
    };
  }

  if (sourceImport.importRecord.status === "failed") {
    throw new Error(sourceImport.errorMessage ?? "Source import worker failed.");
  }

  return {
    kind: job.kind,
    sourceImport,
    message: "Imported source candidate into timeline-ready knowledge posts."
  };
}

function rankDeepDiveCandidates(candidates: BackgroundSourceCandidate[]): BackgroundSourceCandidate[] {
  return [...candidates].sort((left, right) => scoreDeepDiveCandidate(right) - scoreDeepDiveCandidate(left));
}

function scoreDeepDiveCandidate(candidate: BackgroundSourceCandidate): number {
  const sourceTypeBoost =
    candidate.source.type === "paper"
      ? 0.18
      : candidate.source.type === "repo"
        ? 0.12
        : candidate.source.type === "article" || candidate.source.type === "blog"
          ? 0.06
          : 0;
  const officialBoost = /(^|\.)docs\.|(^|\.)developer\.|github\.com|arxiv\.org/i.test(candidate.source.url) ? 0.08 : 0;

  return (
    candidate.qualityScore * 0.38 +
    candidate.relevanceScore * 0.34 +
    candidate.noveltyScore * 0.16 +
    sourceTypeBoost +
    officialBoost
  );
}

function formatDeepDiveRecommendedBecause(
  seedPost: KnowledgePost,
  candidate: BackgroundSourceCandidate,
  contentLanguage: ContentLanguage | undefined
): string {
  if (contentLanguage === "en") {
    return `You clicked go deeper on "${seedPost.title}", so this new source was imported: ${candidate.reason}`;
  }

  return `你在《${seedPost.title}》点了深入,所以导入这个新来源:${candidate.reason}`;
}

function frameDeepDivePost(
  post: KnowledgePost,
  seedPost: KnowledgePost,
  candidate: BackgroundSourceCandidate,
  contentLanguage: ContentLanguage | undefined
): KnowledgePost {
  const knownConcept = seedPost.concepts[0] ?? seedPost.title;
  const nextConcept = post.concepts.find((concept) => !seedPost.concepts.includes(concept)) ?? post.concepts[0] ?? candidate.conceptIds[0] ?? knownConcept;
  const bridge =
    contentLanguage === "en"
      ? `You already know ${knownConcept}; this card goes under it into ${nextConcept}.`
      : `你已经知道 ${knownConcept},这张讲 ${knownConcept} 底下的 ${nextConcept}。`;

  return {
    ...post,
    hook: post.hook.startsWith(bridge) ? post.hook : `${bridge} ${post.hook}`,
    recommendedBecause: formatDeepDiveRecommendedBecause(seedPost, candidate, contentLanguage)
  };
}

function skippedResult(job: BackgroundCurationJob, reason: string): BackgroundCurationJobResult {
  return {
    kind: job.kind,
    message: `Skipped: ${reason}`
  };
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}

function mergeUnique(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].map((value) => value.trim()).filter(Boolean)));
}

function withQueueLineageDefaults(record: BackgroundCurationJobRecord): BackgroundCurationJobRecord {
  return deepClone({
    ...record,
    originalJobId: record.originalJobId ?? record.id,
    attempt: record.attempt ?? 0
  });
}

function selectDueRecords(
  records: BackgroundCurationJobRecord[],
  now: string | Date,
  options: { limit?: number; kinds?: BackgroundCurationJobKind[] }
): BackgroundCurationJobRecord[] {
  const nowDate = normalizeDate(now);
  const allowedKinds = options.kinds ? new Set(options.kinds) : undefined;
  return records
    .filter((record) => record.status === "queued")
    .filter((record) => !allowedKinds || allowedKinds.has(record.job.kind))
    .filter((record) => !record.job.runAfter || new Date(record.job.runAfter) <= nowDate)
    .sort(compareRecords)
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);
}

function recoverExpiredRecords(
  records: BackgroundCurationJobRecord[],
  now: string
): { records: BackgroundCurationJobRecord[]; recoveredIds: string[]; changed: boolean } {
  const nowMs = normalizeDate(now).getTime();
  const recoveredIds: string[] = [];
  const recovered = records.map((record) => {
    if (
      record.status !== "running" ||
      (record.claimedAt && record.workerId && record.leaseUntil && new Date(record.leaseUntil).getTime() > nowMs)
    ) {
      return record;
    }
    recoveredIds.push(record.id);
    const { claimedAt: _claimedAt, leaseUntil: _leaseUntil, workerId: _workerId, ...rest } = record;
    return { ...rest, status: "queued" as const, updatedAt: now };
  });
  return { records: recovered, recoveredIds, changed: recoveredIds.length > 0 };
}

function assertActiveOwner(
  record: BackgroundCurationJobRecord,
  owner: { workerId: string; claimGeneration: number },
  now: string
): void {
  if (record.status !== "running") {
    throw new BackgroundCurationTransitionError(`Job is not running: ${record.id}`);
  }
  if (record.workerId !== owner.workerId || record.attempts !== owner.claimGeneration) {
    throw new BackgroundCurationTransitionError(`Claim owner or generation mismatch for job: ${record.id}`);
  }
  if (!record.leaseUntil || new Date(record.leaseUntil).getTime() <= normalizeDate(now).getTime()) {
    throw new BackgroundCurationTransitionError(`Claim lease expired for job: ${record.id}`);
  }
}

function requireRecord(records: BackgroundCurationJobRecord[], jobId: string): BackgroundCurationJobRecord {
  const record = records.find((candidate) => candidate.id === jobId);
  if (!record) throw new BackgroundCurationTransitionError(`Unknown background curation job: ${jobId}`);
  return record;
}

function replaceRecord(
  records: BackgroundCurationJobRecord[],
  replacement: BackgroundCurationJobRecord
): BackgroundCurationJobRecord[] {
  return records.map((record) => record.id === replacement.id ? replacement : record);
}

function isTerminalStatus(status: BackgroundCurationJobStatus): status is "succeeded" | "failed" | "skipped" {
  return status === "succeeded" || status === "failed" || status === "skipped";
}

function compareRecords(left: BackgroundCurationJobRecord, right: BackgroundCurationJobRecord): number {
  const leftRunAfter = left.job.runAfter ? new Date(left.job.runAfter).getTime() : 0;
  const rightRunAfter = right.job.runAfter ? new Date(right.job.runAfter).getTime() : 0;

  if (leftRunAfter !== rightRunAfter) {
    return leftRunAfter - rightRunAfter;
  }

  return right.job.priority - left.job.priority;
}

function findActiveEquivalentJob(
  recordsById: Map<string, BackgroundCurationJobRecord>,
  job: BackgroundCurationJob
): BackgroundCurationJobRecord | undefined {
  const jobKey = createSemanticJobKey(job);

  return Array.from(recordsById.values()).find(
    (record) =>
      (record.status === "queued" || record.status === "running") &&
      createSemanticJobKey(record.job) === jobKey
  );
}

function createSemanticJobKey(job: BackgroundCurationJob): string {
  return [
    job.kind,
    job.postId ?? "",
    job.topicId,
    [...job.conceptIds].sort().join(","),
    job.nextAction ?? "",
    job.sourceCandidate?.id ?? "",
    job.researchQuestion?.turnId ?? ""
  ].join("|");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(record: BackgroundCurationJobRecord): BackgroundCurationJobRecord {
  return deepClone(record);
}

export function decodeBackgroundCurationJobStoreSnapshot(
  input: string | unknown,
  options: { timeZone?: string } = {}
): DecodedBackgroundCurationJobStoreSnapshot {
  const parsed = typeof input === "string" ? decodeJson(input, "curation-jobs") : deepClone(input);
  const root = expectObject(parsed, "$");
  if (root.version !== 1 && root.version !== 2) {
    throw new PersistenceDecodeError("$.version", "expected supported queue snapshot version 1 or 2");
  }
  const version = root.version;
  const revision = version === 2 ? expectNonNegativeInteger(root.revision, "$.revision") : 0;
  const issues: PersistenceLoadIssue[] = [];
  const records = decodeRecordCollection({
    snapshotKind: "curation-jobs",
    collection: "records",
    value: root.records,
    issues,
    decodeRecord: (value, path) => decodeBackgroundCurationJobRecord(value, path, version, issues, options.timeZone)
  });
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new PersistenceDecodeError("$.records", `duplicate queue record id: ${record.id}`);
    }
    seen.add(record.id);
  }
  return {
    snapshot: { version: 2, revision, records },
    issues,
    needsFlushMigration: version === 1 || issues.length > 0
  };
}

export function decodeBackgroundCurationJobRecord(
  value: unknown,
  path: string,
  version: 1 | 2,
  issues: PersistenceLoadIssue[] = [],
  _timeZone?: string
): BackgroundCurationJobRecord {
  const record = expectObject(value, path);
  const id = expectNonEmptyString(record.id, `${path}.id`);
  const job = expectObject(record.job, `${path}.job`);
  const jobId = expectNonEmptyString(job.id, `${path}.job.id`);
  expectEnum(job.kind, ["generate_followup", "deep_read_article", "concept_brief", "discover_sources", "research_question", "research_idea", "import_source", "schedule_review", "ask_clarifying_question", "cooldown_topic"], `${path}.job.kind`);
  expectNonEmptyString(job.topicId, `${path}.job.topicId`);
  expectArray(job.conceptIds, `${path}.job.conceptIds`).forEach((item, index) => expectString(item, `${path}.job.conceptIds[${index}]`));
  expectFiniteNumber(job.priority, `${path}.job.priority`);
  expectString(job.reason, `${path}.job.reason`);
  expectIsoDate(job.createdAt, `${path}.job.createdAt`);
  if (job.runAfter !== undefined) expectIsoDate(job.runAfter, `${path}.job.runAfter`);
  if (job.postId !== undefined) expectString(job.postId, `${path}.job.postId`);
  if (job.sourceCandidate !== undefined) decodeBackgroundCandidate(job.sourceCandidate, `${path}.job.sourceCandidate`);
  if (job.researchQuestion !== undefined) decodeResearchPayload(job.researchQuestion, `${path}.job.researchQuestion`);
  if (job.researchIdea !== undefined) decodeResearchPayload(job.researchIdea, `${path}.job.researchIdea`);
  if (job.deepReadArticle !== undefined) {
    const deepRead = expectObject(job.deepReadArticle, `${path}.job.deepReadArticle`);
    expectNonEmptyString(deepRead.userId, `${path}.job.deepReadArticle.userId`);
  }
  expectEnum(record.status, ["queued", "running", "succeeded", "failed", "skipped"], `${path}.status`);
  expectNonNegativeInteger(record.attempts, `${path}.attempts`);
  expectIsoDate(record.createdAt, `${path}.createdAt`);
  expectIsoDate(record.updatedAt, `${path}.updatedAt`);
  for (const key of ["startedAt", "completedAt", "claimedAt", "leaseUntil", "materializedAt"] as const) {
    if (record[key] !== undefined) expectIsoDate(record[key], `${path}.${key}`);
  }
  if (record.workerId !== undefined) expectNonEmptyString(record.workerId, `${path}.workerId`);
  if (record.lastError !== undefined) expectString(record.lastError, `${path}.lastError`);
  if (record.result !== undefined) validateQueueResult(record.result, `${path}.result`);

  let originalJobId: string;
  let attempt: number;
  let materializedAt = record.materializedAt as string | undefined;
  if (version === 2) {
    originalJobId = expectNonEmptyString(record.originalJobId, `${path}.originalJobId`);
    attempt = expectNonNegativeInteger(record.attempt, `${path}.attempt`);
  } else {
    const parsedRetry =
      parseLegacyRetryLineage(id) ??
      parseLegacyRetryLineage(jobId) ??
      inferOpaqueDeepReadLineage(id, job, record, _timeZone);
    originalJobId = parsedRetry?.originalJobId ?? id;
    attempt = parsedRetry?.attempt ?? 0;
    if (!parsedRetry && id.startsWith("deep-read-")) {
      issues.push({
        snapshotKind: "curation-jobs",
        collection: "records",
        index: Number(path.match(/\[(\d+)\]/)?.[1] ?? -1),
        recordId: id,
        jsonPath: `${path}.id`,
        message: "opaque deep-read lineage could not be proven; conservatively mapped to itself/attempt 0",
        severity: "warning"
      });
    }
    // v1 history is settled at the migration boundary: the legacy writer applied
    // terminal results inline (and later cleanups may have pruned their artifacts),
    // so backfill the marker instead of letting startup replay resurrect them.
    if (materializedAt === undefined && ["succeeded", "failed", "skipped"].includes(record.status as string)) {
      materializedAt = (record.completedAt ?? record.updatedAt) as string;
    }
  }

  return deepClone({
    ...record,
    id,
    job: { ...job, id: jobId },
    originalJobId,
    attempt,
    ...(materializedAt !== undefined ? { materializedAt } : {})
  } as unknown as BackgroundCurationJobRecord);
}

function parseLegacyRetryLineage(id: string): { originalJobId: string; attempt: number } | undefined {
  const match = /^(.*?)(?:\|retry-|:retry-|-retry-)(\d+)$/.exec(id);
  if (!match || !match[1]) return undefined;
  return { originalJobId: match[1], attempt: Number(match[2]) };
}

function inferOpaqueDeepReadLineage(
  id: string,
  job: Record<string, unknown>,
  record: Record<string, unknown>,
  timeZone = "UTC"
): { originalJobId: string; attempt: number } | undefined {
  if (job.kind !== "deep_read_article" || !id.startsWith("deep-read-")) return undefined;
  const payload = isRecord(job.deepReadArticle) ? job.deepReadArticle : undefined;
  if (typeof payload?.userId !== "string" || typeof job.topicId !== "string") return undefined;
  const dateValues = [job.createdAt, record.createdAt, record.updatedAt, record.completedAt]
    .filter((value): value is string => typeof value === "string");
  const dates = new Set<string>();
  for (const value of dateValues) {
    dates.add(value.slice(0, 10));
    try { dates.add(getDayKey(value, timeZone)); } catch { /* validated elsewhere */ }
  }
  const topicKeys = new Set([job.topicId.trim().toLowerCase(), normalizeConceptKey(job.topicId)]);
  for (const topicKey of topicKeys) {
    if (!topicKey) continue;
    for (const date of dates) {
      for (let retryAttempt = 0; retryAttempt <= 64; retryAttempt += 1) {
        const suffix = retryAttempt > 0 ? `|retry-${retryAttempt}` : "";
        const candidate = `deep-read-${queueHashText(`${payload.userId}|${topicKey}|${date}${suffix}`)}`;
        if (candidate === id || candidate === job.id) {
          return {
            originalJobId: `deep-read-${queueHashText(`${payload.userId}|${topicKey}|${date}`)}`,
            attempt: retryAttempt
          };
        }
      }
    }
  }
  return undefined;
}

function queueHashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function decodeBackgroundCandidate(value: unknown, path: string): void {
  const candidate = expectObject(value, path);
  expectNonEmptyString(candidate.id, `${path}.id`);
  const source = expectObject(candidate.source, `${path}.source`);
  for (const key of ["id", "title", "url"] as const) expectNonEmptyString(source[key], `${path}.source.${key}`);
  expectEnum(source.type, ["youtube", "article", "paper", "blog", "news", "repo", "pdf", "audio", "manual", "user_note"], `${path}.source.type`);
  expectArray(candidate.conceptIds, `${path}.conceptIds`).forEach((item, index) => expectString(item, `${path}.conceptIds[${index}]`));
  for (const key of ["relevanceScore", "noveltyScore", "qualityScore"] as const) expectFiniteNumber(candidate[key], `${path}.${key}`);
  expectString(candidate.reason, `${path}.reason`);
  expectIsoDate(candidate.discoveredAt, `${path}.discoveredAt`);
}

function decodeResearchPayload(value: unknown, path: string): void {
  const payload = expectObject(value, path);
  for (const key of ["turnId", "threadId", "userId", "question"] as const) expectNonEmptyString(payload[key], `${path}.${key}`);
  if (payload.choices !== undefined) expectObject(payload.choices, `${path}.choices`);
  for (const key of ["supportQueries", "challengeQueries"] as const) {
    if (payload[key] !== undefined) expectArray(payload[key], `${path}.${key}`).forEach((item, index) => expectString(item, `${path}.${key}[${index}]`));
  }
}

function validateQueueResult(value: unknown, path: string): void {
  const result = expectObject(value, path);
  expectEnum(result.kind, ["generate_followup", "deep_read_article", "concept_brief", "discover_sources", "research_question", "research_idea", "import_source", "schedule_review", "ask_clarifying_question", "cooldown_topic"], `${path}.kind`);
  if (result.message !== undefined) expectString(result.message, `${path}.message`);
  if (result.discoveredSourceCandidates !== undefined) {
    expectArray(result.discoveredSourceCandidates, `${path}.discoveredSourceCandidates`).forEach((item, index) => decodeBackgroundCandidate(item, `${path}.discoveredSourceCandidates[${index}]`));
  }
  if (result.sourceImport !== undefined) validateSourceImportResult(result.sourceImport, `${path}.sourceImport`);
  if (result.sourceImports !== undefined) expectArray(result.sourceImports, `${path}.sourceImports`).forEach((item, index) => validateSourceImportResult(item, `${path}.sourceImports[${index}]`));
  validateQueueKnownTree(result, path);
}

function validateSourceImportResult(value: unknown, path: string): void {
  const sourceImport = expectObject(value, path);
  const importRecord = expectObject(sourceImport.importRecord, `${path}.importRecord`);
  expectNonEmptyString(importRecord.id, `${path}.importRecord.id`);
  expectObject(importRecord.source, `${path}.importRecord.source`);
  expectEnum(importRecord.status, ["queued", "extracting", "transforming", "ready", "failed"], `${path}.importRecord.status`);
  expectIsoDate(importRecord.createdAt, `${path}.importRecord.createdAt`);
  expectArray(sourceImport.posts, `${path}.posts`);
  expectArray(sourceImport.validation, `${path}.validation`);
  expectObject(sourceImport.sourceRegistry, `${path}.sourceRegistry`);
}

function validateQueueKnownTree(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateQueueKnownTree(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (child === undefined) continue;
    if (key.endsWith("At") || key === "runAfter" || key === "publishedAt") expectIsoDate(child, childPath);
    else if (["priority", "score", "weight", "overlapScore", "relevanceScore", "noveltyScore", "qualityScore"].includes(key)) expectFiniteNumber(child, childPath);
    else if (["attempt", "attempts", "contentLength"].includes(key)) expectNonNegativeInteger(child, childPath);
    else if (key === "version" && typeof child === "number") expectNonNegativeInteger(child, childPath);
    else if (key === "version" && typeof child !== "string") throw new PersistenceDecodeError(childPath, "expected a string or non-negative integer version");
    validateQueueKnownTree(child, childPath);
  }
}
