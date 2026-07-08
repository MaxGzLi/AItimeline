import type { BackgroundSourceCandidate } from "../agents/backgroundCuration.js";
import type { BackgroundCurationJobRecord } from "../agents/backgroundCurationQueue.js";
import type { SourcePostReleasePlan } from "../ranking/postReleasePlan.js";
import type { SourceImportWorkerResult } from "../source/sourceImportWorker.js";
import type {
  AgentHarnessRun,
  ConceptBrief,
  ConceptAliasRecord,
  ConceptMergeSuggestion,
  DailyAutoJobBudgetRecord,
  HarnessValidationResult,
  InteractionSignal,
  KnowledgePost,
  LearningFeedback,
  LearningGoalRecord,
  MergedSourceRecord,
  ReviewState,
  SubscriptionFilterMode,
  SubscriptionKind,
  SubscriptionRecord,
  SourceImport,
  SourceRegistry,
  SourceQualityVerdict,
  TopicState,
  UserMemory
} from "../types.js";
import type { UserMemoryEditEvent } from "../memory/userMemoryControls.js";
import { parseContentLanguage, type ContentLanguage } from "../harness/contentLanguage.js";
import type { WeeklyRecapRecord } from "../recap/weeklyRecap.js";

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

export type SourceCandidateRecordStatus = "pending" | "queued" | "imported" | "dismissed" | "rejected_source";

export type SourceCandidateIntakeKind = "user_paste" | "browser_share" | "agent_discovery" | "manual" | "subscription";

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

export type AgentNotificationKind = "agent_answer" | "research_progress" | "mastery_promotion" | "learning_goal_achieved";

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
  qualityGate?: SourceQualityVerdict;
  rejectionReasons?: string[];
  lastQueuedAt?: string;
  importedAt?: string;
  dismissedAt?: string;
  rejectedAt?: string;
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
  sourceQualityVerdicts: SourceQualityVerdict[];
  mergedSources: MergedSourceRecord[];
  autoJobBudget: DailyAutoJobBudgetRecord[];
  conceptBriefs: ConceptBrief[];
  weeklyRecaps: WeeklyRecapRecord[];
  subscriptions: SubscriptionRecord[];
  learningGoals: LearningGoalRecord[];
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
  saveSourceQualityVerdicts(records: SourceQualityVerdict[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveMergedSourceRecords(records: MergedSourceRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveDailyAutoJobBudgetRecords(
    records: DailyAutoJobBudgetRecord[],
    savedAt?: string | Date
  ): AITimelinePersistenceSnapshot;
  saveConceptBriefs(records: ConceptBrief[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveWeeklyRecaps(records: WeeklyRecapRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveSubscriptions(records: SubscriptionRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  deleteSubscription(id: string, savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveLearningGoals(records: LearningGoalRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  deleteLearningGoal(id: string, savedAt?: string | Date): AITimelinePersistenceSnapshot;
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
      const prepared = prepareSourceImportResultForPersistence(snapshot.posts, result, updatedAt);

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
        posts: upsertManyById(snapshot.posts, prepared.postsToSave),
        harnessRuns: result.harnessRun ? upsertById(snapshot.harnessRuns, result.harnessRun) : snapshot.harnessRuns,
        validation: result.harnessRun
          ? upsertManyById(snapshot.validation, createValidationRecords(result.harnessRun, result.validation, updatedAt))
          : snapshot.validation,
        sourceQualityVerdicts: result.qualityGate
          ? upsertSourceQualityVerdicts(snapshot.sourceQualityVerdicts, [result.qualityGate])
          : snapshot.sourceQualityVerdicts,
        mergedSources: upsertManyById(snapshot.mergedSources, prepared.mergedSources)
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
    saveSourceQualityVerdicts(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        sourceQualityVerdicts: upsertSourceQualityVerdicts(snapshot.sourceQualityVerdicts, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveMergedSourceRecords(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        mergedSources: upsertManyById(snapshot.mergedSources, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveDailyAutoJobBudgetRecords(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        autoJobBudget: upsertDailyAutoJobBudgetRecords(snapshot.autoJobBudget, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveConceptBriefs(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        conceptBriefs: upsertConceptBriefs(snapshot.conceptBriefs, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveWeeklyRecaps(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        weeklyRecaps: upsertWeeklyRecaps(snapshot.weeklyRecaps, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveSubscriptions(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        subscriptions: upsertSubscriptions(snapshot.subscriptions, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    deleteSubscription(id, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        subscriptions: snapshot.subscriptions.filter((record) => record.id !== id)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    saveLearningGoals(records, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        learningGoals: upsertLearningGoals(snapshot.learningGoals, records)
      };
      persist(storage, snapshot);

      return cloneSnapshot(snapshot);
    },
    deleteLearningGoal(id, savedAt = new Date()) {
      snapshot = {
        ...snapshot,
        updatedAt: normalizeDate(savedAt).toISOString(),
        learningGoals: snapshot.learningGoals.filter((record) => record.id !== id)
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
    conceptMergeSuggestions: normalizeConceptMergeSuggestions(input.conceptMergeSuggestions ?? []),
    sourceQualityVerdicts: normalizeSourceQualityVerdicts(input.sourceQualityVerdicts ?? []),
    mergedSources: normalizeMergedSourceRecords(input.mergedSources ?? []),
    autoJobBudget: normalizeDailyAutoJobBudgetRecords(input.autoJobBudget ?? []),
    conceptBriefs: normalizeConceptBriefs(input.conceptBriefs ?? []),
    weeklyRecaps: normalizeWeeklyRecaps(input.weeklyRecaps ?? []),
    subscriptions: normalizeSubscriptions(input.subscriptions ?? []),
    learningGoals: normalizeLearningGoals(input.learningGoals ?? [])
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
  const kind =
    value.kind === "research_progress" || value.kind === "mastery_promotion" || value.kind === "learning_goal_achieved"
      ? value.kind
      : "agent_answer";

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

function normalizeSourceQualityVerdicts(value: unknown): SourceQualityVerdict[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((record): SourceQualityVerdict[] => {
    if (
      !isRecord(record) ||
      typeof record.url !== "string" ||
      typeof record.sourceId !== "string" ||
      typeof record.sourceTitle !== "string" ||
      typeof record.score !== "number" ||
      (record.verdict !== "accept" && record.verdict !== "reject") ||
      (record.runnerKind !== "deterministic" && record.runnerKind !== "model") ||
      typeof record.evaluatedAt !== "string"
    ) {
      return [];
    }

    return [
      {
        url: record.url,
        sourceId: record.sourceId,
        sourceTitle: record.sourceTitle,
        score: clampScore(record.score),
        verdict: record.verdict,
        reasons: Array.isArray(record.reasons)
          ? record.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
          : [],
        runnerKind: record.runnerKind,
        evaluatedAt: record.evaluatedAt
      }
    ];
  });
}

function normalizeMergedSourceRecords(value: unknown): MergedSourceRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((record): MergedSourceRecord[] => {
    if (
      !isRecord(record) ||
      typeof record.id !== "string" ||
      typeof record.sourceImportId !== "string" ||
      typeof record.sourcePostId !== "string" ||
      typeof record.mergedIntoPostId !== "string" ||
      typeof record.similarity !== "number" ||
      typeof record.createdAt !== "string" ||
      typeof record.reason !== "string"
    ) {
      return [];
    }

    return [
      {
        id: record.id,
        sourceImportId: record.sourceImportId,
        sourcePostId: record.sourcePostId,
        mergedIntoPostId: record.mergedIntoPostId,
        sourceIds: Array.isArray(record.sourceIds)
          ? record.sourceIds.filter((sourceId): sourceId is string => typeof sourceId === "string" && sourceId.trim().length > 0)
          : [],
        similarity: clampScore(record.similarity),
        createdAt: record.createdAt,
        reason: record.reason
      }
    ];
  });
}

function normalizeDailyAutoJobBudgetRecords(value: unknown): DailyAutoJobBudgetRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((record): DailyAutoJobBudgetRecord[] => {
    if (!isRecord(record) || typeof record.date !== "string" || typeof record.updatedAt !== "string") {
      return [];
    }

    return [
      {
        date: record.date,
        used: normalizeNonNegativeInteger(record.used),
        limit: normalizeNonNegativeInteger(record.limit),
        discarded: normalizeNonNegativeInteger(record.discarded),
        updatedAt: record.updatedAt
      }
    ];
  });
}

function normalizeConceptBriefs(value: unknown): ConceptBrief[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((record): ConceptBrief[] => {
    if (
      !isRecord(record) ||
      typeof record.id !== "string" ||
      typeof record.concept !== "string" ||
      record.version !== "concept-brief-v0" ||
      (record.runnerKind !== "deterministic" && record.runnerKind !== "model") ||
      typeof record.generatedAt !== "string" ||
      !Array.isArray(record.sentences)
    ) {
      return [];
    }

    const sentences = record.sentences.flatMap((sentence, index) => {
      if (
        !isRecord(sentence) ||
        typeof sentence.text !== "string" ||
        typeof sentence.cardId !== "string" ||
        !sentence.text.trim() ||
        !sentence.cardId.trim()
      ) {
        return [];
      }

      return [
        {
          id: typeof sentence.id === "string" && sentence.id ? sentence.id : `${record.id}-sentence-${index + 1}`,
          text: sentence.text,
          cardId: sentence.cardId
        }
      ];
    });

    if (!sentences.length) {
      return [];
    }

    return [
      {
        id: record.id,
        concept: normalizeConceptText(record.concept),
        version: "concept-brief-v0",
        runnerKind: record.runnerKind,
        generatedAt: record.generatedAt,
        cardCount: normalizeNonNegativeInteger(record.cardCount),
        reviewCount: normalizeNonNegativeInteger(record.reviewCount),
        sourceCardIds: Array.isArray(record.sourceCardIds)
          ? record.sourceCardIds.filter((cardId): cardId is string => typeof cardId === "string" && cardId.trim().length > 0)
          : [],
        adjacentConcepts: Array.isArray(record.adjacentConcepts)
          ? record.adjacentConcepts.flatMap((item) => {
              if (
                !isRecord(item) ||
                typeof item.concept !== "string" ||
                typeof item.cardId !== "string" ||
                !isKnowledgeEdgeRelation(item.relation)
              ) {
                return [];
              }

              return [
                {
                  concept: item.concept,
                  relation: item.relation,
                  cardId: item.cardId
                }
              ];
            })
          : [],
        sentences
      }
    ];
  });
}

function normalizeWeeklyRecaps(value: unknown): WeeklyRecapRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map<string, WeeklyRecapRecord>();

  for (const record of value) {
    if (
      !isRecord(record) ||
      typeof record.id !== "string" ||
      typeof record.weekStart !== "string" ||
      typeof record.weekEnd !== "string" ||
      !isRecord(record.stats) ||
      !isRecord(record.conceptTrend) ||
      !isRecord(record.narrative)
    ) {
      continue;
    }

    const stats = normalizeWeeklyRecapStats(record.stats);
    const conceptTrend = normalizeWeeklyConceptTrend(record.conceptTrend);
    const narrative = normalizeWeeklyRecapNarrative(record.narrative);

    if (!stats || !conceptTrend || !narrative) {
      continue;
    }

    byId.set(record.id, {
      id: record.id,
      weekStart: record.weekStart,
      weekEnd: record.weekEnd,
      stats,
      conceptTrend,
      narrative,
      seenAt: typeof record.seenAt === "string" ? record.seenAt : undefined,
      dismissedAt: typeof record.dismissedAt === "string" ? record.dismissedAt : undefined
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.weekStart.localeCompare(right.weekStart));
}

function normalizeWeeklyRecapStats(value: Record<string, unknown>): WeeklyRecapRecord["stats"] | null {
  if (!Array.isArray(value.topConcepts)) {
    return null;
  }

  return {
    newCardCount: normalizeNonNegativeInteger(value.newCardCount),
    newConceptCount: normalizeNonNegativeInteger(value.newConceptCount),
    reviewCompletedCount: normalizeNonNegativeInteger(value.reviewCompletedCount),
    reviewDueCount: normalizeNonNegativeInteger(value.reviewDueCount),
    topConcepts: value.topConcepts.flatMap((item): WeeklyRecapRecord["stats"]["topConcepts"] => {
      if (!isRecord(item) || typeof item.concept !== "string") {
        return [];
      }

      return [
        {
          concept: item.concept,
          count: normalizeNonNegativeInteger(item.count),
          score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 0
        }
      ];
    })
  };
}

function normalizeWeeklyConceptTrend(value: Record<string, unknown>): WeeklyRecapRecord["conceptTrend"] | null {
  if (!Array.isArray(value.points)) {
    return null;
  }

  const points = value.points.flatMap((point): WeeklyRecapRecord["conceptTrend"]["points"] => {
    if (!isRecord(point) || typeof point.date !== "string") {
      return [];
    }

    return [
      {
        date: point.date,
        totalConcepts: normalizeNonNegativeInteger(point.totalConcepts)
      }
    ];
  });

  return {
    points,
    weekStartIndex: normalizeNonNegativeInteger(value.weekStartIndex)
  };
}

function normalizeWeeklyRecapNarrative(value: Record<string, unknown>): WeeklyRecapRecord["narrative"] | null {
  const zh = normalizeStringArray(value.zh);
  const en = normalizeStringArray(value.en);
  const language = parseContentLanguage(value.language) ?? "zh";
  const sentences = normalizeStringArray(value.sentences);

  if (!zh.length || !en.length) {
    return null;
  }

  return {
    en,
    language,
    sentences: sentences.length ? sentences : language === "en" ? en : zh,
    zh
  };
}

function normalizeSubscriptions(value: unknown): SubscriptionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map<string, SubscriptionRecord>();

  for (const record of value) {
    if (
      !isRecord(record) ||
      typeof record.id !== "string" ||
      typeof record.feedUrl !== "string" ||
      typeof record.title !== "string" ||
      typeof record.createdAt !== "string"
    ) {
      continue;
    }

    const id = record.id.trim();
    const feedUrl = record.feedUrl.trim();
    const title = record.title.trim();

    if (!id || !feedUrl || !title) {
      continue;
    }

    byId.set(id, {
      id,
      kind: normalizeSubscriptionKind(record.kind),
      feedUrl,
      siteUrl: typeof record.siteUrl === "string" && record.siteUrl.trim() ? record.siteUrl.trim() : undefined,
      title,
      filterMode: normalizeSubscriptionFilterMode(record.filterMode),
      createdAt: record.createdAt,
      lastPolledAt:
        typeof record.lastPolledAt === "string" && record.lastPolledAt.trim() ? record.lastPolledAt : undefined,
      lastItemPublishedAt:
        typeof record.lastItemPublishedAt === "string" && record.lastItemPublishedAt.trim()
          ? record.lastItemPublishedAt
          : undefined,
      lastError: typeof record.lastError === "string" && record.lastError.trim() ? record.lastError : undefined
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function normalizeSubscriptionKind(value: unknown): SubscriptionKind {
  return value === "youtube_channel" ? "youtube_channel" : "rss";
}

function normalizeSubscriptionFilterMode(value: unknown): SubscriptionFilterMode {
  return value === "all" || value === "listOnly" || value === "relevant" ? value : "relevant";
}

function normalizeLearningGoals(value: unknown): LearningGoalRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map<string, LearningGoalRecord>();

  for (const record of value) {
    if (
      !isRecord(record) ||
      typeof record.id !== "string" ||
      typeof record.concept !== "string" ||
      typeof record.createdAt !== "string"
    ) {
      continue;
    }

    const id = record.id.trim();
    const concept = normalizeConceptText(record.concept);

    if (!id || !normalizeConceptKey(concept)) {
      continue;
    }

    byId.set(id, {
      id,
      concept,
      createdAt: record.createdAt,
      status: normalizeLearningGoalStatus(record.status),
      achievedAt: typeof record.achievedAt === "string" && record.achievedAt.trim() ? record.achievedAt : undefined
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function normalizeLearningGoalStatus(value: unknown): LearningGoalRecord["status"] {
  return value === "achieved" || value === "archived" ? value : "active";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

interface PreparedSourceImportForPersistence {
  postsToSave: KnowledgePost[];
  mergedSources: MergedSourceRecord[];
}

function prepareSourceImportResultForPersistence(
  existingPosts: KnowledgePost[],
  result: SourceImportWorkerResult,
  createdAt: string
): PreparedSourceImportForPersistence {
  const postsById = new Map(existingPosts.map((post) => [post.id, post]));
  const postsToSaveById = new Map<string, KnowledgePost>();
  const mergedSources: MergedSourceRecord[] = [];
  const acceptedImportPosts: KnowledgePost[] = [];
  const skippedPostIds = new Set<string>();

  for (const post of result.posts) {
    const duplicate = findNearDuplicatePost(post, Array.from(postsById.values()));

    if (duplicate) {
      const mergedPost = mergePostSources(duplicate.post, post);

      postsById.set(mergedPost.id, mergedPost);
      postsToSaveById.set(mergedPost.id, mergedPost);
      skippedPostIds.add(post.id);
      mergedSources.push({
        id: `merged-source-${hashText(`${result.importRecord.id}|${post.id}|${duplicate.post.id}`)}`,
        sourceImportId: result.importRecord.id,
        sourcePostId: post.id,
        mergedIntoPostId: duplicate.post.id,
        sourceIds: post.sources.map((source) => source.id),
        similarity: duplicate.similarity,
        createdAt,
        reason: "merged_into"
      });
      continue;
    }

    postsById.set(post.id, post);
    postsToSaveById.set(post.id, post);
    acceptedImportPosts.push(post);
  }

  if (skippedPostIds.size) {
    result.posts = acceptedImportPosts;
    result.validation = result.validation.filter((record) => !record.postId || !skippedPostIds.has(record.postId));

    if (result.harnessRun) {
      result.harnessRun = {
        ...result.harnessRun,
        outputPostIds: result.harnessRun.outputPostIds.filter((postId) => !skippedPostIds.has(postId)),
        validation: result.harnessRun.validation.filter(
          (record) => !record.postId || !skippedPostIds.has(record.postId)
        )
      };
    }
  }

  return {
    postsToSave: Array.from(postsToSaveById.values()),
    mergedSources
  };
}

function findNearDuplicatePost(
  post: KnowledgePost,
  candidates: KnowledgePost[]
): { post: KnowledgePost; similarity: number } | undefined {
  return candidates
    .filter((candidate) => candidate.id !== post.id)
    .map((candidate) => ({
      post: candidate,
      similarity: scorePostLexicalSimilarity(post, candidate)
    }))
    .filter((candidate) => candidate.similarity >= 0.8)
    .sort((left, right) => right.similarity - left.similarity)[0];
}

function scorePostLexicalSimilarity(left: KnowledgePost, right: KnowledgePost): number {
  const leftTokens = tokenizeSimilarityText(`${left.summary} ${left.keyTakeaway}`);
  const rightTokens = tokenizeSimilarityText(`${right.summary} ${right.keyTakeaway}`);

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;

  return roundScore((2 * intersection) / (leftTokens.size + rightTokens.size));
}

function tokenizeSimilarityText(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
}

function mergePostSources(target: KnowledgePost, duplicate: KnowledgePost): KnowledgePost {
  return {
    ...target,
    sources: mergeByKey(target.sources, duplicate.sources, (source) => source.id),
    citations: mergeByKey(target.citations ?? [], duplicate.citations ?? [], (citation) =>
      [
        citation.sourceId,
        citation.chunkId ?? "",
        citation.url ?? "",
        citation.startTimeSeconds ?? "",
        citation.endTimeSeconds ?? ""
      ].join("|")
    )
  };
}

function mergeByKey<T>(left: T[], right: T[], getKey: (item: T) => string): T[] {
  const byKey = new Map<string, T>();

  for (const item of [...left, ...right]) {
    byKey.set(getKey(item), item);
  }

  return Array.from(byKey.values());
}

function isConceptMergeSuggestionStatus(value: unknown): value is ConceptMergeSuggestion["status"] {
  return value === "pending" || value === "merged" || value === "separate";
}

function isKnowledgeEdgeRelation(value: unknown): value is ConceptBrief["adjacentConcepts"][number]["relation"] {
  return (
    value === "requires" ||
    value === "extends" ||
    value === "contrasts" ||
    value === "applies" ||
    value === "evaluates" ||
    value === "summarizes"
  );
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

function upsertSourceQualityVerdicts(
  items: SourceQualityVerdict[],
  nextItems: SourceQualityVerdict[]
): SourceQualityVerdict[] {
  const byUrl = new Map(items.map((item) => [normalizeUrlKey(item.url), item]));

  for (const item of nextItems) {
    byUrl.set(normalizeUrlKey(item.url), item);
  }

  return Array.from(byUrl.values());
}

function upsertDailyAutoJobBudgetRecords(
  items: DailyAutoJobBudgetRecord[],
  nextItems: DailyAutoJobBudgetRecord[]
): DailyAutoJobBudgetRecord[] {
  const byDate = new Map(items.map((item) => [item.date, item]));

  for (const item of nextItems) {
    byDate.set(item.date, item);
  }

  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function upsertConceptBriefs(items: ConceptBrief[], nextItems: ConceptBrief[]): ConceptBrief[] {
  const byConcept = new Map(items.map((item) => [normalizeConceptKey(item.concept), item]));

  for (const item of nextItems) {
    byConcept.set(normalizeConceptKey(item.concept), item);
  }

  return Array.from(byConcept.values()).sort((left, right) => left.concept.localeCompare(right.concept));
}

function upsertWeeklyRecaps(items: WeeklyRecapRecord[], nextItems: WeeklyRecapRecord[]): WeeklyRecapRecord[] {
  return upsertManyById(items, nextItems).sort((left, right) => left.weekStart.localeCompare(right.weekStart));
}

function upsertSubscriptions(items: SubscriptionRecord[], nextItems: SubscriptionRecord[]): SubscriptionRecord[] {
  return normalizeSubscriptions(upsertManyById(items, nextItems));
}

function upsertLearningGoals(items: LearningGoalRecord[], nextItems: LearningGoalRecord[]): LearningGoalRecord[] {
  return normalizeLearningGoals(upsertManyById(items, nextItems));
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

function normalizeUrlKey(value: string): string {
  try {
    const url = new URL(value);

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    for (const param of Array.from(url.searchParams.keys())) {
      if (/^(utm_|ref$|fbclid$|gclid$)/i.test(param)) {
        url.searchParams.delete(param);
      }
    }

    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
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

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(clampScore(value) * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
