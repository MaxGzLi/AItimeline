import type { BackgroundSourceCandidate } from "../agents/backgroundCuration.js";
import type { BackgroundCurationJobRecord } from "../agents/backgroundCurationQueue.js";
import type { SourcePostReleasePlan } from "../ranking/postReleasePlan.js";
import type { SourceImportWorkerResult } from "../source/sourceImportWorker.js";
import type {
  AgentHarnessRun,
  HarnessValidationResult,
  KnowledgePost,
  SourceImport,
  SourceRegistry,
  UserMemory
} from "../types.js";
import type { UserMemoryEditEvent } from "../memory/userMemoryControls.js";

export interface PersistenceStorageAdapter {
  read(): string | null | undefined;
  write(serialized: string): void;
}

export interface SourceRegistryRecord {
  id: string;
  sourceId: string;
  registry: SourceRegistry;
  createdAt: string;
}

export interface HarnessValidationRecord {
  id: string;
  runId: string;
  postId?: string;
  result: HarnessValidationResult;
  createdAt: string;
}

export interface UserMemoryRecord {
  userId: string;
  memory: UserMemory;
  updatedAt: string;
}

export interface UserMemoryEditEventRecord {
  userId: string;
  event: UserMemoryEditEvent;
}

export type SourceCandidateRecordStatus = "pending" | "queued" | "imported" | "dismissed";

export type SourceCandidateIntakeKind = "user_paste" | "browser_share" | "agent_discovery" | "manual";

export interface SourceCandidateRecord {
  id: string;
  candidate: BackgroundSourceCandidate;
  status: SourceCandidateRecordStatus;
  intakeKind: SourceCandidateIntakeKind;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  notes?: string;
  lastQueuedAt?: string;
  importedAt?: string;
  dismissedAt?: string;
}

export interface AITimelinePersistenceSnapshot {
  version: 1;
  updatedAt: string;
  sourceImports: SourceImport[];
  sourceRegistries: SourceRegistryRecord[];
  posts: KnowledgePost[];
  harnessRuns: AgentHarnessRun[];
  validation: HarnessValidationRecord[];
  curationJobs: BackgroundCurationJobRecord[];
  releasePlans: SourcePostReleasePlan[];
  userMemories: UserMemoryRecord[];
  memoryEvents: UserMemoryEditEventRecord[];
  sourceCandidates: SourceCandidateRecord[];
}

export interface AITimelinePersistenceStore {
  getSnapshot(): AITimelinePersistenceSnapshot;
  saveSourceImportResult(result: SourceImportWorkerResult, savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveCurationJobRecords(records: BackgroundCurationJobRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveReleasePlan(plan: SourcePostReleasePlan, savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveSourceCandidateRecords(
    records: SourceCandidateRecord[],
    savedAt?: string | Date
  ): AITimelinePersistenceSnapshot;
  saveUserMemory(
    userId: string,
    memory: UserMemory,
    events?: UserMemoryEditEvent[],
    savedAt?: string | Date
  ): AITimelinePersistenceSnapshot;
}

export function createAITimelinePersistenceStore(
  storage: PersistenceStorageAdapter,
  initialSnapshot?: Partial<AITimelinePersistenceSnapshot>
): AITimelinePersistenceStore {
  let snapshot = createSnapshot({
    ...readSnapshot(storage),
    ...initialSnapshot
  });

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    saveSourceImportResult(result, savedAt = new Date()) {
      const updatedAt = normalizeDate(savedAt).toISOString();

      snapshot = {
        ...snapshot,
        updatedAt,
        sourceImports: upsertById(snapshot.sourceImports, result.importRecord),
        sourceRegistries: upsertById(snapshot.sourceRegistries, {
          id: buildSourceRegistryRecordId(result.importRecord.source.id, updatedAt),
          sourceId: result.importRecord.source.id,
          registry: result.sourceRegistry,
          createdAt: updatedAt
        }),
        posts: upsertManyById(snapshot.posts, result.posts),
        harnessRuns: result.harnessRun ? upsertById(snapshot.harnessRuns, result.harnessRun) : snapshot.harnessRuns,
        validation: result.harnessRun
          ? upsertManyById(snapshot.validation, createValidationRecords(result.harnessRun, result.validation, updatedAt))
          : snapshot.validation
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveCurationJobRecords(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        curationJobs: upsertManyById(snapshot.curationJobs, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveReleasePlan(plan, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        releasePlans: upsertById(snapshot.releasePlans.map(withReleasePlanId), withReleasePlanId(plan)).map(
          withoutReleasePlanId
        )
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveSourceCandidateRecords(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        sourceCandidates: upsertManyById(snapshot.sourceCandidates, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveUserMemory(userId, memory, events = [], savedAt = new Date()) {
      const updatedAt = normalizeDate(savedAt).toISOString();

      snapshot = {
        ...snapshot,
        updatedAt,
        userMemories: upsertUserMemory(snapshot.userMemories, {
          userId,
          memory,
          updatedAt
        }),
        memoryEvents: [
          ...snapshot.memoryEvents,
          ...events.map((event) => ({
            userId,
            event
          }))
        ]
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    }
  };
}

function readSnapshot(storage: PersistenceStorageAdapter): Partial<AITimelinePersistenceSnapshot> {
  const serialized = storage.read();

  if (!serialized) {
    return {};
  }

  const parsed = JSON.parse(serialized) as unknown;

  if (!isRecord(parsed) || parsed.version !== 1) {
    throw new Error("AITimeline persistence snapshot is invalid.");
  }

  return parsed as Partial<AITimelinePersistenceSnapshot>;
}

function createSnapshot(input: Partial<AITimelinePersistenceSnapshot> = {}): AITimelinePersistenceSnapshot {
  return {
    version: 1,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    sourceImports: input.sourceImports ?? [],
    sourceRegistries: input.sourceRegistries ?? [],
    posts: input.posts ?? [],
    harnessRuns: input.harnessRuns ?? [],
    validation: input.validation ?? [],
    curationJobs: input.curationJobs ?? [],
    releasePlans: input.releasePlans ?? [],
    userMemories: input.userMemories ?? [],
    memoryEvents: input.memoryEvents ?? [],
    sourceCandidates: input.sourceCandidates ?? []
  };
}

function createValidationRecords(
  run: AgentHarnessRun,
  validation: HarnessValidationResult[],
  createdAt: string
): HarnessValidationRecord[] {
  return validation.map((result, index) => ({
    id: `${run.id}-validation-${result.postId ?? index + 1}`,
    runId: run.id,
    postId: result.postId,
    result,
    createdAt
  }));
}

function buildSourceRegistryRecordId(sourceId: string, createdAt: string): string {
  return `${sourceId}-registry-${createdAt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function persist(storage: PersistenceStorageAdapter, snapshot: AITimelinePersistenceSnapshot): void {
  storage.write(JSON.stringify(snapshot));
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  return upsertManyById(items, [item]);
}

function upsertManyById<T extends { id: string }>(items: T[], nextItems: T[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));

  for (const item of nextItems) {
    byId.set(item.id, item);
  }

  return Array.from(byId.values());
}

function upsertUserMemory(items: UserMemoryRecord[], item: UserMemoryRecord): UserMemoryRecord[] {
  const byUserId = new Map(items.map((record) => [record.userId, record]));

  byUserId.set(item.userId, item);

  return Array.from(byUserId.values());
}

function withReleasePlanId(plan: SourcePostReleasePlan): SourcePostReleasePlan & { id: string } {
  return {
    ...plan,
    id: `release-plan-${plan.generatedAt}`
  };
}

function withoutReleasePlanId(plan: SourcePostReleasePlan & { id: string }): SourcePostReleasePlan {
  const { id: _id, ...releasePlan } = plan;

  return releasePlan;
}

function cloneSnapshot(snapshot: AITimelinePersistenceSnapshot): AITimelinePersistenceSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AITimelinePersistenceSnapshot;
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
