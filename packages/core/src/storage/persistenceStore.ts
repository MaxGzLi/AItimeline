import type { BackgroundSourceCandidate } from "../agents/backgroundCuration.js";
import type { BackgroundCurationJobRecord } from "../agents/backgroundCurationQueue.js";
import type { SourcePostReleasePlan } from "../ranking/postReleasePlan.js";
import type { SourceImportWorkerResult } from "../source/sourceImportWorker.js";
import type {
  AgentHarnessRun,
  ConceptAliasRecord,
  ConceptMergeSuggestion,
  HarnessValidationResult,
  InteractionSignal,
  KnowledgePost,
  LearningFeedback,
  ReviewState,
  SourceImport,
  SourceRegistry,
  TopicState,
  UserMemory
} from "../types.js";
import type { UserMemoryEditEvent } from "../memory/userMemoryControls.js";
import { parseContentLanguage, type ContentLanguage } from "../harness/contentLanguage.js";

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

export interface InteractionSignalRecord {
  id: string;
  signal: InteractionSignal;
  feedback: LearningFeedback;
  createdAt: string;
}

export interface TopicStateRecord extends TopicState {
  updatedAt: string;
}

export type SourceCandidateRecordStatus = "pending" | "queued" | "imported" | "dismissed";

export type SourceCandidateIntakeKind = "user_paste" | "browser_share" | "agent_discovery" | "manual";

export interface AgentTurnRecord {
  id: string;
  userId: string;
  question: string;
  intent: string;
  tier: string;
  zone: string;
  status: AgentTurnStatus;
  threadId: string;
  answerCardId?: string;
  createdAt: string;
}

export type AgentTurnStatus = "answered" | "pending_confirmation" | "researching" | "closed";

export type AgentNotificationKind = "agent_answer" | "research_progress";

export interface AgentNotificationCitation {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  quote: string;
}

export interface AgentNotificationRecord {
  id: string;
  kind: AgentNotificationKind;
  turnId: string;
  postIds: string[];
  body: string;
  createdAt: string;
  readAt?: string;
  question?: string;
  citations?: AgentNotificationCitation[];
}

export interface UserSettings {
  contentLanguage?: ContentLanguage;
}

export type DismissedPostMode = "soft" | "hard";

export interface DismissedPostRecord {
  postId: string;
  dismissedAt: string;
  mode: DismissedPostMode;
}

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
  interactionSignals: InteractionSignalRecord[];
  topicStates: TopicStateRecord[];
  dismissedPosts: DismissedPostRecord[];
  reviewStates: ReviewState[];
  sourceCandidates: SourceCandidateRecord[];
  agentTurns: AgentTurnRecord[];
  notifications: AgentNotificationRecord[];
  userSettings: UserSettings;
  conceptAliases: ConceptAliasRecord[];
  conceptMergeSuggestions: ConceptMergeSuggestion[];
}

export interface AITimelinePersistenceStore {
  getSnapshot(): AITimelinePersistenceSnapshot;
  savePosts(posts: KnowledgePost[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveSourceImportResult(result: SourceImportWorkerResult, savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveCurationJobRecords(records: BackgroundCurationJobRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveReleasePlan(plan: SourcePostReleasePlan, savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveSourceCandidateRecords(
    records: SourceCandidateRecord[],
    savedAt?: string | Date
  ): AITimelinePersistenceSnapshot;
  saveInteractionSignalRecords(
    records: InteractionSignalRecord[],
    savedAt?: string | Date
  ): AITimelinePersistenceSnapshot;
  saveTopicStateRecords(records: TopicStateRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveDismissedPosts(records: DismissedPostRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveReviewStates(records: ReviewState[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveAgentTurnRecords(records: AgentTurnRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveNotifications(records: AgentNotificationRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveUserSettings(settings: UserSettings, savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveConceptAliases(records: ConceptAliasRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveConceptMergeSuggestions(
    records: ConceptMergeSuggestion[],
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
  initialSnapshot?: AITimelinePersistenceSnapshotInput
): AITimelinePersistenceStore {
  let snapshot = createSnapshot({
    ...readSnapshot(storage),
    ...initialSnapshot
  });

  return {
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    savePosts(posts, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        posts: upsertManyById(snapshot.posts, posts)
      };
      persist(storage, snapshot);

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
    saveInteractionSignalRecords(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        interactionSignals: upsertManyById(snapshot.interactionSignals, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveTopicStateRecords(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        topicStates: upsertTopicStateRecords(snapshot.topicStates, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveDismissedPosts(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        dismissedPosts: upsertDismissedPosts([], records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveReviewStates(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        reviewStates: upsertReviewStates(snapshot.reviewStates, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveAgentTurnRecords(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        agentTurns: upsertManyById(snapshot.agentTurns, records.map((record) => normalizeAgentTurnRecord(record)))
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveNotifications(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        notifications: upsertManyById(snapshot.notifications, records.map(normalizeNotificationRecord))
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveUserSettings(settings, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        userSettings: normalizeUserSettings(settings)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveConceptAliases(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        conceptAliases: normalizeConceptAliasesInput(records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveConceptMergeSuggestions(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        conceptMergeSuggestions: normalizeConceptMergeSuggestions(records)
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

export type AITimelinePersistenceSnapshotInput = Partial<AITimelinePersistenceSnapshot> & {
  dismissedPostIds?: string[];
};

function readSnapshot(storage: PersistenceStorageAdapter): AITimelinePersistenceSnapshotInput {
  const serialized = storage.read();

  if (!serialized) {
    return {};
  }

  const parsed = JSON.parse(serialized) as unknown;

  if (!isRecord(parsed) || parsed.version !== 1) {
    throw new Error("AITimeline persistence snapshot is invalid.");
  }

  return parsed as AITimelinePersistenceSnapshotInput;
}

function createSnapshot(input: AITimelinePersistenceSnapshotInput = {}): AITimelinePersistenceSnapshot {
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  return {
    version: 1,
    updatedAt,
    sourceImports: input.sourceImports ?? [],
    sourceRegistries: input.sourceRegistries ?? [],
    posts: input.posts ?? [],
    harnessRuns: input.harnessRuns ?? [],
    validation: input.validation ?? [],
    curationJobs: input.curationJobs ?? [],
    releasePlans: input.releasePlans ?? [],
    userMemories: input.userMemories ?? [],
    memoryEvents: input.memoryEvents ?? [],
    interactionSignals: input.interactionSignals ?? [],
    topicStates: input.topicStates ?? [],
    dismissedPosts: normalizeDismissedPosts(input, updatedAt),
    reviewStates: input.reviewStates ?? [],
    sourceCandidates: input.sourceCandidates ?? [],
    agentTurns: (input.agentTurns ?? []).map((record) => normalizeAgentTurnRecord(record)),
    notifications: (input.notifications ?? []).map(normalizeNotificationRecord),
    userSettings: normalizeUserSettings(input.userSettings),
    conceptAliases: normalizeConceptAliasesInput(input.conceptAliases ?? []),
    conceptMergeSuggestions: normalizeConceptMergeSuggestions(input.conceptMergeSuggestions ?? [])
  };
}

function normalizeAgentTurnRecord(value: AgentTurnRecord | (Partial<AgentTurnRecord> & { id: string })): AgentTurnRecord {
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  const question = typeof value.question === "string" ? value.question : "";
  const userId = typeof value.userId === "string" ? value.userId : "local-user";
  const status = isAgentTurnStatus(value.status) ? value.status : "answered";

  return {
    id: value.id,
    userId,
    question,
    intent: typeof value.intent === "string" ? value.intent : "unknown",
    tier: typeof value.tier === "string" ? value.tier : "free",
    zone: typeof value.zone === "string" ? value.zone : "dark",
    status,
    threadId: typeof value.threadId === "string" && value.threadId ? value.threadId : value.id,
    answerCardId: typeof value.answerCardId === "string" ? value.answerCardId : undefined,
    createdAt
  };
}

function isAgentTurnStatus(value: unknown): value is AgentTurnStatus {
  return value === "answered" || value === "pending_confirmation" || value === "researching" || value === "closed";
}

function normalizeNotificationRecord(
  value: AgentNotificationRecord | (Partial<AgentNotificationRecord> & { id: string })
): AgentNotificationRecord {
  const kind = value.kind === "research_progress" ? "research_progress" : "agent_answer";

  return {
    id: value.id,
    kind,
    turnId: typeof value.turnId === "string" ? value.turnId : "",
    postIds: Array.isArray(value.postIds)
      ? value.postIds.filter((postId): postId is string => typeof postId === "string")
      : [],
    body: typeof value.body === "string" ? value.body : "",
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    readAt: typeof value.readAt === "string" ? value.readAt : undefined,
    question: typeof value.question === "string" ? value.question : undefined,
    citations: Array.isArray(value.citations)
      ? value.citations
          .filter(
            (citation): citation is AgentNotificationCitation =>
              isRecord(citation) &&
              typeof citation.sourceId === "string" &&
              typeof citation.sourceTitle === "string" &&
              typeof citation.chunkId === "string" &&
              typeof citation.quote === "string"
          )
          .map((citation) => ({
            sourceId: citation.sourceId,
            sourceTitle: citation.sourceTitle,
            chunkId: citation.chunkId,
            quote: citation.quote
          }))
      : undefined
  };
}

function normalizeDismissedPosts(
  input: AITimelinePersistenceSnapshotInput,
  fallbackDismissedAt: string
): DismissedPostRecord[] {
  const migratedPosts =
    input.dismissedPostIds
      ?.filter((postId): postId is string => typeof postId === "string" && postId.length > 0)
      .map((postId) => ({
        postId,
        dismissedAt: fallbackDismissedAt,
        mode: "hard" as const
      })) ?? [];
  const records =
    input.dismissedPosts
      ?.filter(
        (record): record is DismissedPostRecord =>
          isRecord(record) &&
          typeof record.postId === "string" &&
          record.postId.length > 0 &&
          typeof record.dismissedAt === "string" &&
          (record.mode === "soft" || record.mode === "hard")
      )
      .map((record) => ({
        postId: record.postId,
        dismissedAt: record.dismissedAt,
        mode: record.mode
      })) ?? [];

  return upsertDismissedPosts(migratedPosts, records);
}

function normalizeUserSettings(value: unknown): UserSettings {
  if (!isRecord(value)) {
    return {};
  }

  const contentLanguage = parseContentLanguage(value.contentLanguage);

  return contentLanguage ? { contentLanguage } : {};
}

function normalizeConceptAliasesInput(value: unknown): ConceptAliasRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byCanonical = new Map<string, ConceptAliasRecord>();

  for (const record of value) {
    if (
      !isRecord(record) ||
      typeof record.canonical !== "string" ||
      !Array.isArray(record.aliases) ||
      (record.decidedBy !== "auto" && record.decidedBy !== "user") ||
      typeof record.decidedAt !== "string"
    ) {
      continue;
    }

    const canonical = normalizeConceptText(record.canonical);
    const canonicalKey = normalizeConceptKey(canonical);

    if (!canonicalKey) {
      continue;
    }

    const existing = byCanonical.get(canonicalKey);
    const aliases = new Map<string, string>();

    for (const alias of existing?.aliases ?? []) {
      aliases.set(alias, alias);
    }

    for (const alias of record.aliases) {
      if (typeof alias !== "string") {
        continue;
      }

      const label = normalizeConceptText(alias);
      const key = normalizeConceptKey(label);

      if (key && label !== canonical) {
        aliases.set(label, label);
      }
    }

    byCanonical.set(canonicalKey, {
      canonical: existing?.canonical ?? canonical,
      aliases: Array.from(aliases.values()).sort((left, right) => left.localeCompare(right)),
      decidedBy: existing?.decidedBy === "user" || record.decidedBy === "user" ? "user" : "auto",
      decidedAt:
        existing?.decidedAt && existing.decidedAt.localeCompare(record.decidedAt) < 0
          ? existing.decidedAt
          : record.decidedAt
    });
  }

  return Array.from(byCanonical.values())
    .filter((record) => record.aliases.length > 0)
    .sort((left, right) => left.canonical.localeCompare(right.canonical));
}

function normalizeConceptMergeSuggestions(value: unknown): ConceptMergeSuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map<string, ConceptMergeSuggestion>();

  for (const record of value) {
    if (
      !isRecord(record) ||
      typeof record.id !== "string" ||
      typeof record.left !== "string" ||
      typeof record.right !== "string" ||
      typeof record.createdAt !== "string" ||
      !isConceptMergeSuggestionStatus(record.status)
    ) {
      continue;
    }

    byId.set(record.id, {
      id: record.id,
      left: normalizeConceptText(record.left),
      right: normalizeConceptText(record.right),
      leftExcerpt: typeof record.leftExcerpt === "string" ? record.leftExcerpt : undefined,
      rightExcerpt: typeof record.rightExcerpt === "string" ? record.rightExcerpt : undefined,
      createdAt: record.createdAt,
      status: record.status,
      decidedBy: record.decidedBy === "user" ? "user" : undefined,
      decidedAt: typeof record.decidedAt === "string" ? record.decidedAt : undefined
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function isConceptMergeSuggestionStatus(value: unknown): value is ConceptMergeSuggestion["status"] {
  return value === "pending" || value === "merged" || value === "separate";
}

function normalizeConceptText(value: string): string {
  return value.trim();
}

function normalizeConceptKey(value: string): string {
  return normalizeConceptText(value).toLowerCase();
}

function createValidationRecords(
  run: AgentHarnessRun,
  validation: HarnessValidationResult[],
  createdAt: string
): HarnessValidationRecord[] {
  return validation.map((result, index) => ({
    id: `${run.id}-validation-${index + 1}-${result.postId ?? "post"}`,
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

function upsertTopicStateRecords(items: TopicStateRecord[], nextItems: TopicStateRecord[]): TopicStateRecord[] {
  const byTopicId = new Map(items.map((record) => [record.topicId, record]));

  for (const item of nextItems) {
    byTopicId.set(item.topicId, item);
  }

  return Array.from(byTopicId.values());
}

function upsertReviewStates(items: ReviewState[], nextItems: ReviewState[]): ReviewState[] {
  const byPostId = new Map(items.map((record) => [record.postId, record]));

  for (const item of nextItems) {
    byPostId.set(item.postId, item);
  }

  return Array.from(byPostId.values());
}

function upsertDismissedPosts(items: DismissedPostRecord[], nextItems: DismissedPostRecord[]): DismissedPostRecord[] {
  const byPostId = new Map(items.map((record) => [record.postId, record]));

  for (const item of nextItems) {
    byPostId.set(item.postId, item);
  }

  return Array.from(byPostId.values());
}

function withReleasePlanId(plan: SourcePostReleasePlan): SourcePostReleasePlan & { id: string } {
  const itemKey = plan.items
    .map((item) => item.postId)
    .sort()
    .join("|");

  return {
    ...plan,
    id: `release-plan-${plan.generatedAt}-${hashText(itemKey)}`
  };
}

function hashText(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
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
