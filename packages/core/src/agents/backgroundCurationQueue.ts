import type {
  BackgroundCurationJob,
  BackgroundCurationJobKind,
  BackgroundCurationPlan,
  BackgroundSourceCandidate
} from "./backgroundCuration.js";
import type { SourceImportWorker, SourceImportWorkerResult } from "../source/sourceImportWorker.js";
import type { KnowledgeChunk, SourceAsset, SourceRegistry } from "../types.js";

export type BackgroundCurationJobStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export interface BackgroundCurationJobResult {
  kind: BackgroundCurationJobKind;
  message?: string;
  sourceImport?: SourceImportWorkerResult;
  discoveredSourceCandidates?: BackgroundSourceCandidate[];
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
}

export interface BackgroundCurationJobStore {
  enqueuePlan(plan: BackgroundCurationPlan, enqueuedAt?: string | Date): BackgroundCurationJobRecord[];
  list(status?: BackgroundCurationJobStatus): BackgroundCurationJobRecord[];
  get(jobId: string): BackgroundCurationJobRecord | undefined;
  getDueJobs(now?: string | Date, options?: { limit?: number; kinds?: BackgroundCurationJobKind[] }): BackgroundCurationJobRecord[];
  update(record: BackgroundCurationJobRecord): BackgroundCurationJobRecord;
}

export interface SourceCandidateIngestionResult {
  assets?: SourceAsset[];
  chunks: KnowledgeChunk[];
  sourceRegistry?: SourceRegistry;
  recommendedBecause?: string;
}

export interface BackgroundCurationExecutionHandlers {
  sourceImportWorker?: SourceImportWorker;
  ingestSourceCandidate?: (
    candidate: BackgroundSourceCandidate,
    job: BackgroundCurationJob
  ) => Promise<SourceCandidateIngestionResult> | SourceCandidateIngestionResult;
  discoverSources?: (
    job: BackgroundCurationJob
  ) => Promise<BackgroundSourceCandidate[]> | BackgroundSourceCandidate[];
  generateFollowup?: (job: BackgroundCurationJob) => Promise<BackgroundCurationJobResult> | BackgroundCurationJobResult;
  scheduleReview?: (job: BackgroundCurationJob) => Promise<BackgroundCurationJobResult> | BackgroundCurationJobResult;
  askClarifyingQuestion?: (job: BackgroundCurationJob) => Promise<BackgroundCurationJobResult> | BackgroundCurationJobResult;
  cooldownTopic?: (job: BackgroundCurationJob) => Promise<BackgroundCurationJobResult> | BackgroundCurationJobResult;
}

export interface RunBackgroundCurationJobsOptions {
  now?: string | Date;
  limit?: number;
  kinds?: BackgroundCurationJobKind[];
}

export interface BackgroundCurationExecutionBatch {
  startedAt: string;
  completedAt: string;
  records: BackgroundCurationJobRecord[];
}

export function createInMemoryBackgroundCurationJobStore(
  initialRecords: BackgroundCurationJobRecord[] = []
): BackgroundCurationJobStore {
  const recordsById = new Map(initialRecords.map((record) => [record.id, cloneRecord(record)]));

  return {
    enqueuePlan(plan, enqueuedAt = plan.generatedAt) {
      const now = normalizeDate(enqueuedAt).toISOString();
      const records: BackgroundCurationJobRecord[] = [];

      for (const job of plan.jobs) {
        const existing = recordsById.get(job.id);

        if (existing) {
          records.push(cloneRecord(existing));
          continue;
        }

        const record: BackgroundCurationJobRecord = {
          id: job.id,
          job,
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now
        };

        recordsById.set(record.id, cloneRecord(record));
        records.push(cloneRecord(record));
      }

      return records;
    },
    list(status) {
      const records = Array.from(recordsById.values());
      const filtered = status ? records.filter((record) => record.status === status) : records;

      return filtered.map(cloneRecord).sort(compareRecords);
    },
    get(jobId) {
      const record = recordsById.get(jobId);

      return record ? cloneRecord(record) : undefined;
    },
    getDueJobs(now = new Date(), options = {}) {
      const nowDate = normalizeDate(now);
      const allowedKinds = options.kinds ? new Set(options.kinds) : undefined;

      return Array.from(recordsById.values())
        .filter((record) => record.status === "queued")
        .filter((record) => !allowedKinds || allowedKinds.has(record.job.kind))
        .filter((record) => !record.job.runAfter || new Date(record.job.runAfter) <= nowDate)
        .sort(compareRecords)
        .slice(0, options.limit ?? Number.POSITIVE_INFINITY)
        .map(cloneRecord);
    },
    update(record) {
      recordsById.set(record.id, cloneRecord(record));

      return cloneRecord(record);
    }
  };
}

export async function runDueBackgroundCurationJobs(
  store: BackgroundCurationJobStore,
  handlers: BackgroundCurationExecutionHandlers,
  options: RunBackgroundCurationJobsOptions = {}
): Promise<BackgroundCurationExecutionBatch> {
  const startedAt = normalizeDate(options.now).toISOString();
  const dueJobs = store.getDueJobs(startedAt, {
    limit: options.limit,
    kinds: options.kinds
  });
  const records: BackgroundCurationJobRecord[] = [];

  for (const record of dueJobs) {
    const runningRecord = store.update({
      ...record,
      status: "running",
      attempts: record.attempts + 1,
      startedAt,
      updatedAt: startedAt,
      lastError: undefined
    });
    const completedRecord = await executeBackgroundCurationJob(runningRecord, handlers, startedAt);

    records.push(store.update(completedRecord));
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    records
  };
}

export async function executeBackgroundCurationJob(
  record: BackgroundCurationJobRecord,
  handlers: BackgroundCurationExecutionHandlers,
  now: string | Date = new Date()
): Promise<BackgroundCurationJobRecord> {
  const completedAt = normalizeDate(now).toISOString();

  try {
    const result = await runJob(record.job, handlers, completedAt);
    const status: BackgroundCurationJobStatus = result.message?.startsWith("Skipped") ? "skipped" : "succeeded";

    return {
      ...record,
      status,
      completedAt,
      updatedAt: completedAt,
      result
    };
  } catch (error) {
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
  now: string
): Promise<BackgroundCurationJobResult> {
  if (job.kind === "import_source") {
    return runImportSourceJob(job, handlers, now);
  }

  if (job.kind === "discover_sources") {
    if (!handlers.discoverSources) {
      return skippedResult(job, "source discovery handler is not configured.");
    }

    return {
      kind: job.kind,
      discoveredSourceCandidates: await handlers.discoverSources(job),
      message: "Discovered source candidates for background curation."
    };
  }

  if (job.kind === "generate_followup") {
    return handlers.generateFollowup
      ? handlers.generateFollowup(job)
      : skippedResult(job, "follow-up generation handler is not configured.");
  }

  if (job.kind === "schedule_review") {
    return handlers.scheduleReview
      ? handlers.scheduleReview(job)
      : skippedResult(job, "review scheduling handler is not configured.");
  }

  if (job.kind === "ask_clarifying_question") {
    return handlers.askClarifyingQuestion
      ? handlers.askClarifyingQuestion(job)
      : skippedResult(job, "clarifying question handler is not configured.");
  }

  if (job.kind === "cooldown_topic") {
    return handlers.cooldownTopic
      ? handlers.cooldownTopic(job)
      : {
          kind: job.kind,
          message: "Topic cooldown recorded."
        };
  }

  return skippedResult(job, "background curation job kind is not supported.");
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
    recommendedBecause: ingested.recommendedBecause ?? job.reason
  });

  if (sourceImport.importRecord.status === "failed") {
    throw new Error(sourceImport.errorMessage ?? "Source import worker failed.");
  }

  return {
    kind: job.kind,
    sourceImport,
    message: "Imported source candidate into timeline-ready knowledge posts."
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

function compareRecords(left: BackgroundCurationJobRecord, right: BackgroundCurationJobRecord): number {
  const leftRunAfter = left.job.runAfter ? new Date(left.job.runAfter).getTime() : 0;
  const rightRunAfter = right.job.runAfter ? new Date(right.job.runAfter).getTime() : 0;

  if (leftRunAfter !== rightRunAfter) {
    return leftRunAfter - rightRunAfter;
  }

  return right.job.priority - left.job.priority;
}

function cloneRecord(record: BackgroundCurationJobRecord): BackgroundCurationJobRecord {
  return {
    ...record,
    job: {
      ...record.job,
      conceptIds: [...record.job.conceptIds],
      sourceCandidate: record.job.sourceCandidate
        ? {
            ...record.job.sourceCandidate,
            conceptIds: [...record.job.sourceCandidate.conceptIds],
            source: { ...record.job.sourceCandidate.source }
          }
        : undefined
    },
    result: record.result
      ? {
          ...record.result,
          discoveredSourceCandidates: record.result.discoveredSourceCandidates?.map((candidate) => ({
            ...candidate,
            conceptIds: [...candidate.conceptIds],
            source: { ...candidate.source }
          }))
        }
      : undefined
  };
}
