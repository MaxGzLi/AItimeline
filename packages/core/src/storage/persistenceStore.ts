import type { BackgroundCurationPlan, BackgroundSourceCandidate } from "../agents/backgroundCuration.js";
import {
  decodeBackgroundCurationJobRecord,
  type BackgroundCurationJobRecord
} from "../agents/backgroundCurationQueue.js";
import type { SourcePostReleasePlan } from "../ranking/postReleasePlan.js";
import type { SourceImportWorkerResult } from "../source/sourceImportWorker.js";
import type {
  AgentHarnessRun,
  AgentNotificationCitation,
  AgentNotificationKind,
  AgentTurnStatus,
  ConceptBrief,
  ConceptAliasRecord,
  ConceptMergeSuggestion,
  DailyAutoJobBudgetRecord,
  DeepReadArticleRecord,
  HarnessValidationResult,
  InteractionSignal,
  KnowledgePost,
  LearningFeedback,
  LearningGoalRecord,
  MergedSourceRecord,
  ReviewState,
  SubscriptionFilterMode,
  SubscriptionBacklogState,
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
import { normalizeConceptAliases, normalizeConceptKey } from "../graph/conceptAliases.js";
import type { WeeklyRecapRecord } from "../recap/weeklyRecap.js";
import {
  decodeJson,
  decodeRecordCollection,
  deepClone,
  expectArray,
  expectBoolean,
  expectEnum,
  expectFiniteNumber,
  expectIsoDate,
  expectNonEmptyString,
  expectNonNegativeInteger,
  expectObject,
  expectString,
  PersistenceDecodeError,
  type PersistenceLoadIssue
} from "./runtimeDecoder.js";
import { commitWithRetry, type RevisionedStorageAdapter } from "./revisionedStorage.js";

export type PersistenceStorageAdapter = RevisionedStorageAdapter;

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
  signalResult?: {
    topicState: TopicStateRecord | null;
    plan: BackgroundCurationPlan;
    records: BackgroundCurationJobRecord[];
  };
  reviewEventId?: string;
  reviewGrade?: "remembered" | "fuzzy" | "forgot";
  reviewResult?: {
    reviewState: ReviewState;
    masteryPromotions: unknown[];
    learningGoalAchievements: unknown[];
  };
}

export interface TopicStateRecord extends TopicState {
  updatedAt: string;
}

export type SourceCandidateRecordStatus =
  | "pending"
  | "queued"
  | "imported"
  | "dismissed"
  | "rejected_source"
  | "unreachable"
  | "skipped";

export type SourceCandidateIntakeKind =
  | "user_paste"
  | "browser_share"
  | "agent_discovery"
  | "manual"
  | "subscription"
  | "agent_capture";

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

export type { AgentTurnStatus, AgentNotificationKind, AgentNotificationCitation } from "../types.js";

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
  subscriptionId?: string;
  backlogOrder?: number;
  prioritizedAt?: string;
}

export interface AITimelinePersistenceSnapshot {
  version: 2;
  revision: number;
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
  deepReadArticles: DeepReadArticleRecord[];
  weeklyRecaps: WeeklyRecapRecord[];
  subscriptions: SubscriptionRecord[];
  learningGoals: LearningGoalRecord[];
}

export interface AITimelinePersistenceStore {
  getSnapshot(): AITimelinePersistenceSnapshot;
  appendThreadBlocks(
    postId: string,
    blocks: KnowledgePost["thread"],
    options?: { expectedRevision?: number; savedAt?: string | Date }
  ): AITimelinePersistenceSnapshot;
  savePosts(posts: KnowledgePost[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveSourceImportResult(result: SourceImportWorkerResult, savedAt?: string | Date): AITimelinePersistenceSnapshot;
  saveCurationJobRecords(records: BackgroundCurationJobRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
  replaceCurationJobRecords(records: BackgroundCurationJobRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
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
  saveDeepReadArticles(records: DeepReadArticleRecord[], savedAt?: string | Date): AITimelinePersistenceSnapshot;
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
  flushMigration(savedAt?: string | Date): boolean;
  close(): void;
}

export function createAITimelinePersistenceStore(
  storage: PersistenceStorageAdapter,
  initialSnapshot?: AITimelinePersistenceSnapshotInput,
  options: { onLoadIssue?: (issue: PersistenceLoadIssue) => void } = {}
): AITimelinePersistenceStore {
  const initialRaw = storage.read();
  const initialDecoded = initialRaw
    ? decodeAITimelinePersistenceSnapshot(initialRaw)
    : decodeAITimelinePersistenceSnapshot({ version: 1, updatedAt: new Date().toISOString(), ...initialSnapshot });
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
  // 解码缓存:快照文件几十 MB 时,逐请求整篇 JSON.parse + 校验是主要的事件循环
  // 阻塞源。序列化串未变(引用比较为主,底层文件适配器未变化时返回同一字符串)
  // 就复用上次的解码结果;提交成功后用内存里的新快照直接播种,不再回头重解。
  let decodeMemo: { serialized: string; snapshot: AITimelinePersistenceSnapshot } | null = initialRaw
    ? { serialized: initialRaw, snapshot: initialDecoded.snapshot }
    : null;

  const readLatest = (): AITimelinePersistenceSnapshot => {
    const serialized = storage.read();
    if (!serialized) {
      return cloneSnapshot(snapshot);
    }
    if (decodeMemo && decodeMemo.serialized === serialized) {
      return decodeMemo.snapshot;
    }
    const decoded = decodeAITimelinePersistenceSnapshot(serialized);
    reportLoadIssues(decoded.issues);
    decodeMemo = { serialized, snapshot: decoded.snapshot };
    return decoded.snapshot;
  };
  const commit = (
    mutate: (base: AITimelinePersistenceSnapshot) => AITimelinePersistenceSnapshot | undefined,
    savedAt: string | Date
  ): AITimelinePersistenceSnapshot => {
    const updatedAt = normalizeDate(savedAt).toISOString();
    const result = commitWithRetry({
      readAndDecode: readLatest,
      mutate(base) {
        const next = mutate(base);
        return next ? { ...next, version: 2, updatedAt } : undefined;
      },
      serialize: JSON.stringify,
      compareAndSwap: storage.compareAndSwap.bind(storage)
    });
    snapshot = result.value;
    if (result.committed) {
      needsFlushMigration = false;
      const written = storage.read();
      if (written) {
        decodeMemo = { serialized: written, snapshot: result.value };
      }
    }
    return cloneSnapshot(snapshot);
  };

  return {
    getSnapshot() {
      snapshot = readLatest();
      return cloneSnapshot(snapshot);
    },
    appendThreadBlocks(postId, blocks, appendOptions = {}) {
      const stableBlocks = blocks.map((block, index) =>
        decodeThreadBlock(deepClone(block), `$.appendThreadBlocks.blocks[${index}]`, false)
      );
      const inputIds = new Set<string>();
      for (const block of stableBlocks) {
        if (inputIds.has(block.id)) {
          throw new Error(`Duplicate thread block id in append input: ${block.id}`);
        }
        inputIds.add(block.id);
      }
      return commit((base) => {
        const postIndex = base.posts.findIndex((post) => post.id === postId);
        if (postIndex < 0) {
          throw new Error(`Post not found for appendThreadBlocks: ${postId}`);
        }
        const post = base.posts[postIndex];
        const byId = new Map(post.thread.map((block) => [block.id, block]));
        const additions = stableBlocks.filter((block) => {
          const current = byId.get(block.id);
          if (!current) {
            return true;
          }
          if (JSON.stringify(current) !== JSON.stringify(block)) {
            throw new Error(`Thread block collision for id: ${block.id}`);
          }
          return false;
        });
        if (!additions.length) {
          return undefined;
        }
        const posts = [...base.posts];
        posts[postIndex] = { ...post, thread: [...post.thread, ...deepClone(additions)] };
        return { ...base, posts };
      }, appendOptions.savedAt ?? new Date());
    },
    savePosts(posts, savedAt = new Date()) {
      return commit((base) => ({ ...base, posts: upsertManyById(base.posts, posts) }), savedAt);
    },
    saveSourceImportResult(result, savedAt = new Date()) {
      const updatedAt = normalizeDate(savedAt).toISOString();
      const stableResult = deepClone(result);
      return commit((base) => applySourceImportResultToSnapshot(base, stableResult, updatedAt).nextSnapshot, savedAt);
    },
    saveCurationJobRecords(records, savedAt = new Date()) {
      const canonicalRecords = records.map(withQueueLineageDefaults);
      return commit((base) => ({ ...base, curationJobs: upsertManyById(base.curationJobs, canonicalRecords) }), savedAt);
    },
    replaceCurationJobRecords(records, savedAt = new Date()) {
      const canonicalRecords = deepClone(records.map(withQueueLineageDefaults));
      return commit((base) =>
        JSON.stringify(base.curationJobs) === JSON.stringify(canonicalRecords)
          ? undefined
          : { ...base, curationJobs: canonicalRecords }, savedAt);
    },
    saveReleasePlan(plan, savedAt = new Date()) {
      return commit((base) => ({
        ...base,
        releasePlans: upsertById(base.releasePlans.map(withReleasePlanId), withReleasePlanId(plan)).map(
          withoutReleasePlanId
        )
      }), savedAt);
    },
    saveSourceCandidateRecords(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, sourceCandidates: upsertManyById(base.sourceCandidates, records) }), savedAt);
    },
    saveSourceQualityVerdicts(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, sourceQualityVerdicts: upsertSourceQualityVerdicts(base.sourceQualityVerdicts, records) }), savedAt);
    },
    saveMergedSourceRecords(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, mergedSources: upsertManyById(base.mergedSources, records) }), savedAt);
    },
    saveDailyAutoJobBudgetRecords(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, autoJobBudget: upsertDailyAutoJobBudgetRecords(base.autoJobBudget, records) }), savedAt);
    },
    saveConceptBriefs(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, conceptBriefs: upsertConceptBriefs(base.conceptBriefs, records) }), savedAt);
    },
    saveDeepReadArticles(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, deepReadArticles: upsertDeepReadArticles(base.deepReadArticles, records) }), savedAt);
    },
    saveWeeklyRecaps(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, weeklyRecaps: upsertWeeklyRecaps(base.weeklyRecaps, records) }), savedAt);
    },
    saveSubscriptions(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, subscriptions: upsertSubscriptions(base.subscriptions, records) }), savedAt);
    },
    deleteSubscription(id, savedAt = new Date()) {
      return commit((base) => ({ ...base, subscriptions: base.subscriptions.filter((record) => record.id !== id) }), savedAt);
    },
    saveLearningGoals(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, learningGoals: upsertLearningGoals(base.learningGoals, records) }), savedAt);
    },
    deleteLearningGoal(id, savedAt = new Date()) {
      return commit((base) => ({ ...base, learningGoals: base.learningGoals.filter((record) => record.id !== id) }), savedAt);
    },
    saveInteractionSignalRecords(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, interactionSignals: upsertManyById(base.interactionSignals, records) }), savedAt);
    },
    saveTopicStateRecords(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, topicStates: upsertTopicStateRecords(base.topicStates, records) }), savedAt);
    },
    saveDismissedPosts(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, dismissedPosts: upsertDismissedPosts([], records) }), savedAt);
    },
    saveReviewStates(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, reviewStates: upsertReviewStates(base.reviewStates, records) }), savedAt);
    },
    saveAgentTurnRecords(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, agentTurns: upsertManyById(base.agentTurns, records.map((record) => normalizeAgentTurnRecord(record))) }), savedAt);
    },
    saveNotifications(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, notifications: upsertManyById(base.notifications, records.map(normalizeNotificationRecord)) }), savedAt);
    },
    saveUserSettings(settings, savedAt = new Date()) {
      return commit((base) => ({ ...base, userSettings: normalizeUserSettings(settings) }), savedAt);
    },
    saveConceptAliases(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, conceptAliases: normalizeConceptAliasesInput(records) }), savedAt);
    },
    saveConceptMergeSuggestions(records, savedAt = new Date()) {
      return commit((base) => ({ ...base, conceptMergeSuggestions: normalizeConceptMergeSuggestions(records) }), savedAt);
    },
    saveUserMemory(userId, memory, events = [], savedAt = new Date()) {
      const updatedAt = normalizeDate(savedAt).toISOString();
      return commit((base) => ({
        ...base,
        userMemories: upsertUserMemory(base.userMemories, {
          userId,
          memory,
          updatedAt
        }),
        memoryEvents: [
          ...base.memoryEvents,
          ...events.map((event) => ({
            userId,
            event
          }))
        ]
      }), savedAt);
    },
    flushMigration(savedAt = new Date()) {
      if (!needsFlushMigration) {
        return false;
      }
      commit((base) => ({ ...base }), savedAt);
      return true;
    },
    close() {
      storage.close?.();
    }
  };
}

export type AITimelinePersistenceSnapshotInput = Omit<Partial<AITimelinePersistenceSnapshot>, "version"> & {
  version?: 1 | 2;
  dismissedPostIds?: string[];
};

export interface DecodedAITimelinePersistenceSnapshot {
  snapshot: AITimelinePersistenceSnapshot;
  issues: PersistenceLoadIssue[];
  needsFlushMigration: boolean;
}

const snapshotCollections = [
  "sourceImports", "sourceRegistries", "posts", "harnessRuns", "validation", "curationJobs", "releasePlans",
  "userMemories", "memoryEvents", "interactionSignals", "topicStates", "dismissedPosts", "reviewStates",
  "sourceCandidates", "agentTurns", "notifications", "conceptAliases", "conceptMergeSuggestions",
  "sourceQualityVerdicts", "mergedSources", "autoJobBudget", "conceptBriefs", "deepReadArticles", "weeklyRecaps",
  "subscriptions", "learningGoals"
] as const;

export function decodeAITimelinePersistenceSnapshot(input: string | unknown): DecodedAITimelinePersistenceSnapshot {
  const parsed = typeof input === "string" ? decodeJson(input, "aitimeline") : deepClone(input);
  const root = expectObject(parsed, "$");
  const version = root.version;
  if (version !== 1 && version !== 2) {
    throw new PersistenceDecodeError("$.version", "expected supported snapshot version 1 or 2");
  }
  const updatedAt = expectIsoDate(root.updatedAt, "$.updatedAt");
  const revision = version === 2 ? expectNonNegativeInteger(root.revision, "$.revision") : 0;
  const issues: PersistenceLoadIssue[] = [];
  const migrated: Record<string, unknown> = { ...root, version: 2, revision, updatedAt };

  for (const collection of snapshotCollections) {
    const value = root[collection];
    if (value === undefined) {
      if (version === 2) {
        throw new PersistenceDecodeError(`$.${collection}`, "canonical v2 snapshot is missing a required collection");
      }
      migrated[collection] = [];
      continue;
    }
    migrated[collection] = decodeRecordCollection({
      snapshotKind: "aitimeline",
      collection,
      value,
      issues,
      decodeRecord: (record, path) => decodeSnapshotOwnerRecord(collection, record, path, version)
    });
  }

  if (version === 1 && root.dismissedPosts === undefined && root.dismissedPostIds !== undefined) {
    migrated.dismissedPosts = expectArray(root.dismissedPostIds, "$.dismissedPostIds").map((value, index) => ({
      postId: expectNonEmptyString(value, `$.dismissedPostIds[${index}]`),
      dismissedAt: updatedAt,
      mode: "hard"
    }));
  }

  if (root.userSettings === undefined) {
    if (version === 2) {
      throw new PersistenceDecodeError("$.userSettings", "canonical v2 snapshot is missing userSettings");
    }
    migrated.userSettings = {};
  } else {
    const settings = expectObject(root.userSettings, "$.userSettings");
    if (settings.contentLanguage !== undefined) {
      expectEnum(settings.contentLanguage, ["zh", "en"], "$.userSettings.contentLanguage");
    }
    migrated.userSettings = deepClone(settings);
  }

  const snapshot = createSnapshot(migrated as AITimelinePersistenceSnapshotInput);
  return { snapshot, issues, needsFlushMigration: version === 1 || issues.length > 0 };
}

function createSnapshot(input: AITimelinePersistenceSnapshotInput = {}): AITimelinePersistenceSnapshot {
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  return {
    version: 2,
    revision: input.revision ?? 0,
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
    dismissedPosts: input.dismissedPosts ?? normalizeDismissedPosts(input, updatedAt),
    reviewStates: input.reviewStates ?? [],
    sourceCandidates: input.sourceCandidates ?? [],
    agentTurns: input.agentTurns ?? [],
    notifications: input.notifications ?? [],
    userSettings: input.userSettings ?? {},
    conceptAliases: input.conceptAliases ?? [],
    conceptMergeSuggestions: input.conceptMergeSuggestions ?? [],
    sourceQualityVerdicts: input.sourceQualityVerdicts ?? [],
    mergedSources: input.mergedSources ?? [],
    autoJobBudget: input.autoJobBudget ?? [],
    conceptBriefs: input.conceptBriefs ?? [],
    deepReadArticles: input.deepReadArticles ?? [],
    weeklyRecaps: input.weeklyRecaps ?? [],
    subscriptions: input.subscriptions ?? [],
    learningGoals: input.learningGoals ?? []
  };
}

function decodeSnapshotOwnerRecord(
  collection: typeof snapshotCollections[number],
  value: unknown,
  path: string,
  version: 1 | 2
): unknown {
  const record = expectObject(value, path);
  if (collection === "curationJobs") {
    return decodeBackgroundCurationJobRecord(record, path, version);
  }
  validateKnownTree(record, path);

  if (collection === "posts") {
    expectNonEmptyString(record.id, `${path}.id`);
    for (const key of ["title", "hook", "thesis", "shortBody", "summary", "keyTakeaway", "recommendedBecause", "harnessVersion"] as const) {
      expectString(record[key], `${path}.${key}`);
    }
    const thread = expectArray(record.thread, `${path}.thread`).map((block, index) =>
      decodeThreadBlock(block, `${path}.thread[${index}]`, version === 1)
    );
    return { ...record, thread };
  }

  if (collection === "interactionSignals") {
    expectNonEmptyString(record.id, `${path}.id`);
    const createdAt = expectIsoDate(record.createdAt, `${path}.createdAt`);
    const signal = expectObject(record.signal, `${path}.signal`);
    for (const key of ["postId", "topicId"] as const) expectNonEmptyString(signal[key], `${path}.signal.${key}`);
    expectArray(signal.conceptIds, `${path}.signal.conceptIds`).forEach((item, index) => expectString(item, `${path}.signal.conceptIds[${index}]`));
    expectFiniteNumber(signal.dwellTimeMs, `${path}.signal.dwellTimeMs`);
    const migratedSignal = { ...signal };
    if (signal.impression === undefined && version === 1) migratedSignal.impression = false;
    else expectBoolean(signal.impression, `${path}.signal.impression`);
    if (signal.createdAt === undefined && version === 1) migratedSignal.createdAt = createdAt;
    else expectIsoDate(signal.createdAt, `${path}.signal.createdAt`);
    for (const key of ["openedThread", "liked", "saved", "askedQuestion", "reviewed", "skippedQuickly"] as const) {
      expectBoolean(signal[key], `${path}.signal.${key}`);
    }
    expectObject(record.feedback, `${path}.feedback`);
    if (record.reviewGrade !== undefined) expectEnum(record.reviewGrade, ["remembered", "fuzzy", "forgot"], `${path}.reviewGrade`);
    if (record.reviewEventId !== undefined) expectString(record.reviewEventId, `${path}.reviewEventId`);
    return { ...record, signal: migratedSignal };
  }

  if (collection === "agentTurns") {
    for (const key of ["id", "userId", "question", "intent", "tier", "zone", "threadId"] as const) {
      expectNonEmptyString(record[key], `${path}.${key}`);
    }
    expectEnum(record.status, ["answered", "pending_confirmation", "researching", "closed"], `${path}.status`);
    expectIsoDate(record.createdAt, `${path}.createdAt`);
    if (record.answerCardId !== undefined) expectString(record.answerCardId, `${path}.answerCardId`);
    return deepClone(record);
  }

  if (collection === "notifications") {
    for (const key of ["id", "turnId", "body"] as const) expectString(record[key], `${path}.${key}`);
    expectEnum(record.kind, ["agent_answer", "research_progress", "mastery_promotion", "learning_goal_achieved", "supply_drought"], `${path}.kind`);
    expectArray(record.postIds, `${path}.postIds`).forEach((item, index) => expectString(item, `${path}.postIds[${index}]`));
    expectIsoDate(record.createdAt, `${path}.createdAt`);
    return deepClone(record);
  }

  if (collection === "sourceCandidates") {
    const status = record.status === undefined && version === 1 ? "pending" : record.status;
    const intakeKind = record.intakeKind === undefined && version === 1 ? "user_paste" : record.intakeKind;
    expectEnum(
      status,
      ["pending", "queued", "imported", "dismissed", "rejected_source", "unreachable", "skipped"],
      `${path}.status`
    );
    expectEnum(
      intakeKind,
      ["user_paste", "browser_share", "agent_discovery", "manual", "subscription", "agent_capture"],
      `${path}.intakeKind`
    );
    return deepClone({ ...record, status, intakeKind });
  }

  const primaryIdKeys: Partial<Record<typeof snapshotCollections[number], string>> = {
    sourceImports: "id", sourceRegistries: "id", harnessRuns: "id", validation: "id", curationJobs: "id",
    sourceCandidates: "id", agentTurns: "id", notifications: "id", mergedSources: "id", conceptBriefs: "id",
    deepReadArticles: "id", weeklyRecaps: "id", subscriptions: "id", learningGoals: "id"
  };
  const primaryId = primaryIdKeys[collection];
  if (primaryId) expectNonEmptyString(record[primaryId], `${path}.${primaryId}`);
  if (collection === "userMemories" || collection === "memoryEvents") expectNonEmptyString(record.userId, `${path}.userId`);
  if (collection === "topicStates") expectNonEmptyString(record.topicId, `${path}.topicId`);
  if (collection === "dismissedPosts" || collection === "reviewStates") expectNonEmptyString(record.postId, `${path}.postId`);
  if (collection === "autoJobBudget") expectString(record.date, `${path}.date`);
  if (collection === "conceptAliases") expectNonEmptyString(record.canonical, `${path}.canonical`);
  return deepClone(record);
}

function decodeThreadBlock(value: unknown, path: string, migrateLegacy: boolean): KnowledgePost["thread"][number] {
  const block = expectObject(value, path);
  expectNonEmptyString(block.id, `${path}.id`);
  expectEnum(block.kind, ["explain", "example", "contrast", "extension", "quiz", "user_comment", "agent_reply"], `${path}.kind`);
  expectString(block.title, `${path}.title`);
  expectString(block.body, `${path}.body`);
  if (block.prompt !== undefined) expectString(block.prompt, `${path}.prompt`);
  const citations = block.citations === undefined && migrateLegacy
    ? []
    : expectArray(block.citations ?? [], `${path}.citations`).map((citation, index) => decodeThreadCitation(citation, `${path}.citations[${index}]`));
  const grounded = block.grounded === undefined && migrateLegacy ? false : block.grounded;
  if (grounded !== undefined) expectBoolean(grounded, `${path}.grounded`);
  if (block.runnerKind !== undefined) expectEnum(block.runnerKind, ["model", "deterministic"], `${path}.runnerKind`);
  if (grounded === true && citations.length === 0) throw new PersistenceDecodeError(`${path}.citations`, "grounded block requires citations");
  return { ...block, citations, grounded } as unknown as KnowledgePost["thread"][number];
}

function decodeThreadCitation(value: unknown, path: string): unknown {
  const citation = expectObject(value, path);
  for (const key of ["sourceId", "sourceTitle", "chunkId", "quote"] as const) expectString(citation[key], `${path}.${key}`);
  if (citation.startTimeSeconds !== undefined) expectFiniteNumber(citation.startTimeSeconds, `${path}.startTimeSeconds`);
  if (citation.endTimeSeconds !== undefined) expectFiniteNumber(citation.endTimeSeconds, `${path}.endTimeSeconds`);
  if (citation.origin !== undefined) {
    const origin = expectObject(citation.origin, `${path}.origin`);
    expectString(origin.turnId, `${path}.origin.turnId`);
    expectString(origin.question, `${path}.origin.question`);
    expectIsoDate(origin.createdAt, `${path}.origin.createdAt`);
  }
  return deepClone(citation);
}

const dateKeys = new Set(["createdAt", "updatedAt", "startedAt", "completedAt", "runAfter", "releaseAt", "generatedAt", "evaluatedAt", "decidedAt", "dismissedAt", "dueAt", "lastReviewedAt", "readAt", "importedAt", "rejectedAt", "lastQueuedAt", "cooldownUntil", "achievedAt", "publishedAt", "prioritizedAt", "catalogedAt"]);
const finiteNumberKeys = new Set(["priority", "score", "weight", "similarity", "interestScore", "fatigueScore", "comprehensionScore", "signalStrength", "dwellTimeMs", "relevanceScore", "noveltyScore", "qualityScore", "estimatedReadMinutes", "durationSeconds", "overlapScore"]);
const integerKeys = new Set(["attempts", "attempt", "version", "contentLength", "used", "limit", "discarded", "intervalDays", "dueInDays", "cardCount", "reviewCount", "backlogOrder", "videoCount"]);

function validateKnownTree(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateKnownTree(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (child === undefined) continue;
    if (dateKeys.has(key)) expectIsoDate(child, childPath);
    else if (integerKeys.has(key) && key !== "version") {
      if (key === "intervalDays" && Array.isArray(child)) {
        child.forEach((item, index) => expectNonNegativeInteger(item, `${childPath}[${index}]`));
      } else {
        expectNonNegativeInteger(child, childPath);
      }
    }
    else if (key === "version" && typeof child === "number") expectNonNegativeInteger(child, childPath);
    else if (key === "version" && typeof child !== "string") throw new PersistenceDecodeError(childPath, "expected a string or non-negative integer version");
    else if (finiteNumberKeys.has(key)) expectFiniteNumber(child, childPath);
    else if ((key === "id" || key.endsWith("Id")) && typeof child !== "string") throw new PersistenceDecodeError(childPath, "expected a string id");
    validateKnownTree(child, childPath);
  }
}

function withQueueLineageDefaults(record: BackgroundCurationJobRecord): BackgroundCurationJobRecord {
  return {
    ...record,
    originalJobId: record.originalJobId ?? record.id,
    attempt: record.attempt ?? 0
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
    value.kind === "research_progress" ||
    value.kind === "mastery_promotion" ||
    value.kind === "learning_goal_achieved" ||
    value.kind === "supply_drought"
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

  const records: ConceptAliasRecord[] = [];

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

    records.push({
      canonical: record.canonical,
      aliases: record.aliases.filter((alias): alias is string => typeof alias === "string"),
      decidedBy: record.decidedBy,
      decidedAt: record.decidedAt
    });
  }

  return normalizeConceptAliases(records);
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
        ...normalizeOptionalCount("produced", record.produced),
        ...normalizeOptionalCount("gateRejected", record.gateRejected),
        ...normalizeOptionalCount("importFailed", record.importFailed),
        ...normalizeOptionalCount("refunded", record.refunded),
        updatedAt: record.updatedAt
      }
    ];
  });
}

// Ledger counters were added after the first budget records were written, so an
// absent field stays absent instead of decoding into a fabricated 0.
function normalizeOptionalCount(key: string, value: unknown): Record<string, number> {
  return value === undefined ? {} : { [key]: normalizeNonNegativeInteger(value) };
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
      lastError: typeof record.lastError === "string" && record.lastError.trim() ? record.lastError : undefined,
      backlog: normalizeSubscriptionBacklog(record.backlog)
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function normalizeSubscriptionBacklog(value: unknown): SubscriptionBacklogState | undefined {
  if (
    !isRecord(value) ||
    typeof value.catalogedAt !== "string" ||
    !value.catalogedAt.trim() ||
    typeof value.videoCount !== "number" ||
    !Number.isFinite(value.videoCount)
  ) {
    return undefined;
  }

  return {
    catalogedAt: value.catalogedAt,
    videoCount: Math.max(0, Math.floor(value.videoCount)),
    truncated: value.truncated === true ? true : undefined
  };
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

function normalizeDeepReadArticles(value: unknown): DeepReadArticleRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map<string, DeepReadArticleRecord>();

  for (const record of value) {
    if (
      !isRecord(record) ||
      typeof record.id !== "string" ||
      typeof record.topic !== "string" ||
      typeof record.createdAt !== "string"
    ) {
      continue;
    }

    const id = record.id.trim();

    if (!id) {
      continue;
    }

    const createdAt = record.createdAt;
    const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;

    byId.set(id, {
      ...(record as unknown as DeepReadArticleRecord),
      id,
      version: record.version === "deep-read-article-v0" ? record.version : "deep-read-article-v0",
      status: record.status === "failed" ? "failed" : "ready",
      runnerKind: record.runnerKind === "model" ? "model" : "deterministic_fallback",
      userId: typeof record.userId === "string" && record.userId.trim() ? record.userId : "local-user",
      topic: record.topic.trim(),
      topicKey:
        typeof record.topicKey === "string" && record.topicKey.trim()
          ? record.topicKey
          : normalizeConceptKey(record.topic),
      title: typeof record.title === "string" && record.title.trim() ? record.title : record.topic.trim(),
      introduction: typeof record.introduction === "string" ? record.introduction : "",
      conclusion: typeof record.conclusion === "string" ? record.conclusion : "",
      chapters: Array.isArray(record.chapters) ? (record.chapters as DeepReadArticleRecord["chapters"]) : [],
      sources: Array.isArray(record.sources) ? (record.sources as DeepReadArticleRecord["sources"]) : [],
      sourceCardIds: normalizeStringArray(record.sourceCardIds),
      sourceChunkIds: normalizeStringArray(record.sourceChunkIds),
      discardedMaterials: Array.isArray(record.discardedMaterials)
        ? (record.discardedMaterials as DeepReadArticleRecord["discardedMaterials"])
        : [],
      conflicts: Array.isArray(record.conflicts) ? (record.conflicts as DeepReadArticleRecord["conflicts"]) : [],
      deletedParagraphLog: Array.isArray(record.deletedParagraphLog)
        ? (record.deletedParagraphLog as DeepReadArticleRecord["deletedParagraphLog"])
        : [],
      qualityReport: isRecord(record.qualityReport)
        ? (record.qualityReport as unknown as DeepReadArticleRecord["qualityReport"])
        : {
            runnerKind: "deterministic_fallback",
            generatedAt: createdAt,
            newReaderTest: {
              runnerKind: "deterministic_fallback",
              answers: [],
              contradictions: [],
              ambiguities: []
            },
            density: {
              atomicPointCount: 0,
              characterCount: 0,
              pointsPerThousandChars: 0
            },
            notes: []
          },
      libraryVersion: typeof record.libraryVersion === "string" ? record.libraryVersion : updatedAt,
      budget: isRecord(record.budget)
        ? (record.budget as unknown as DeepReadArticleRecord["budget"])
        : { maxTokens: 100000, truncated: false, notes: [] },
      createdAt,
      updatedAt
    });
  }

  return Array.from(byId.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function normalizeSourceCandidateRecords(value: unknown): SourceCandidateRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byId = new Map<string, SourceCandidateRecord>();

  for (const record of value) {
    if (!isRecord(record) || typeof record.id !== "string" || !isRecord(record.candidate)) {
      continue;
    }

    const id = record.id.trim();
    const candidate = record.candidate as unknown as BackgroundSourceCandidate;

    if (!id || typeof candidate.id !== "string" || !isRecord(candidate.source)) {
      continue;
    }

    const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString();
    const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;

    byId.set(id, {
      id,
      candidate,
      status: normalizeSourceCandidateRecordStatus(record.status),
      intakeKind: normalizeSourceCandidateIntakeKind(record.intakeKind),
      createdAt,
      updatedAt,
      userId: typeof record.userId === "string" ? record.userId : undefined,
      notes: typeof record.notes === "string" ? record.notes : undefined,
      qualityGate: isSourceQualityVerdict(record.qualityGate) ? record.qualityGate : undefined,
      rejectionReasons: normalizeStringArray(record.rejectionReasons),
      lastQueuedAt: typeof record.lastQueuedAt === "string" ? record.lastQueuedAt : undefined,
      importedAt: typeof record.importedAt === "string" ? record.importedAt : undefined,
      dismissedAt: typeof record.dismissedAt === "string" ? record.dismissedAt : undefined,
      rejectedAt: typeof record.rejectedAt === "string" ? record.rejectedAt : undefined,
      subscriptionId:
        typeof record.subscriptionId === "string" && record.subscriptionId.trim() ? record.subscriptionId : undefined,
      backlogOrder:
        typeof record.backlogOrder === "number" && Number.isFinite(record.backlogOrder)
          ? record.backlogOrder
          : undefined,
      prioritizedAt: typeof record.prioritizedAt === "string" ? record.prioritizedAt : undefined
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function normalizeSourceCandidateRecordStatus(value: unknown): SourceCandidateRecordStatus {
  return value === "queued" ||
    value === "imported" ||
    value === "dismissed" ||
    value === "rejected_source" ||
    value === "unreachable" ||
    value === "skipped"
    ? value
    : "pending";
}

function normalizeSourceCandidateIntakeKind(value: unknown): SourceCandidateIntakeKind {
  return value === "browser_share" ||
    value === "agent_discovery" ||
    value === "manual" ||
    value === "subscription" ||
    value === "agent_capture"
    ? value
    : "user_paste";
}

function isSourceQualityVerdict(value: unknown): value is SourceQualityVerdict {
  return (
    isRecord(value) &&
    typeof value.url === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.sourceTitle === "string" &&
    typeof value.score === "number" &&
    (value.verdict === "accept" || value.verdict === "reject") &&
    (value.runnerKind === "deterministic" || value.runnerKind === "model") &&
    typeof value.evaluatedAt === "string" &&
    Array.isArray(value.reasons)
  );
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export interface PreviewSourceImportApplicationsResult {
  preparedResults: SourceImportWorkerResult[];
  effectivePosts: KnowledgePost[];
  nextSnapshot: AITimelinePersistenceSnapshot;
}

export function previewSourceImportApplications(
  snapshot: AITimelinePersistenceSnapshot,
  results: SourceImportWorkerResult[],
  savedAt: string | Date
): PreviewSourceImportApplicationsResult {
  const updatedAt = normalizeDate(savedAt).toISOString();
  let nextSnapshot = deepClone(snapshot);
  const preparedResults: SourceImportWorkerResult[] = [];
  const effectivePosts: KnowledgePost[] = [];
  for (const result of results) {
    const applied = applySourceImportResultToSnapshot(nextSnapshot, result, updatedAt);
    nextSnapshot = applied.nextSnapshot;
    preparedResults.push(applied.prepared.preparedResult);
    effectivePosts.push(...applied.prepared.postsToSave);
  }
  return { preparedResults, effectivePosts, nextSnapshot };
}

function applySourceImportResultToSnapshot(
  base: AITimelinePersistenceSnapshot,
  result: SourceImportWorkerResult,
  updatedAt: string
): { nextSnapshot: AITimelinePersistenceSnapshot; prepared: PreparedSourceImportForPersistence } {
  const prepared = prepareSourceImportResultForPersistence(base.posts, result, updatedAt);
  const stableResult = prepared.preparedResult;
  return {
    prepared,
    nextSnapshot: {
      ...base,
      sourceImports: upsertById(base.sourceImports, stableResult.importRecord),
      sourceRegistries: upsertById(base.sourceRegistries, {
        id: buildSourceRegistryRecordId(stableResult.importRecord.source.id, updatedAt),
        sourceId: stableResult.importRecord.source.id,
        registry: stableResult.sourceRegistry,
        createdAt: updatedAt
      }),
      posts: upsertManyById(base.posts, prepared.postsToSave),
      harnessRuns: stableResult.harnessRun ? upsertById(base.harnessRuns, stableResult.harnessRun) : base.harnessRuns,
      validation: stableResult.harnessRun
        ? upsertManyById(base.validation, createValidationRecords(stableResult.harnessRun, stableResult.validation, updatedAt))
        : base.validation,
      sourceQualityVerdicts: stableResult.qualityGate
        ? upsertSourceQualityVerdicts(base.sourceQualityVerdicts, [stableResult.qualityGate])
        : base.sourceQualityVerdicts,
      mergedSources: upsertManyById(base.mergedSources, prepared.mergedSources)
    }
  };
}

interface PreparedSourceImportForPersistence {
  preparedResult: SourceImportWorkerResult;
  postsToSave: KnowledgePost[];
  mergedSources: MergedSourceRecord[];
}

function prepareSourceImportResultForPersistence(
  existingPosts: KnowledgePost[],
  result: SourceImportWorkerResult,
  createdAt: string
): PreparedSourceImportForPersistence {
  const preparedResult = deepClone(result);
  const postsById = new Map(existingPosts.map((post) => [post.id, post]));
  const postsToSaveById = new Map<string, KnowledgePost>();
  const mergedSources: MergedSourceRecord[] = [];
  const acceptedImportPosts: KnowledgePost[] = [];
  const skippedPostIds = new Set<string>();
  const validationRejectedPostIds = new Set<string>();
  const renamedPostIds = new Map<string, string>();

  for (const [index, post] of preparedResult.posts.entries()) {
    if (!shouldPersistImportedPost(preparedResult, post, index)) {
      validationRejectedPostIds.add(post.id);
      continue;
    }

    const collidingPost = postsById.get(post.id);

    // Re-importing the same source regenerates the same card, so replacing by id is right.
    if (collidingPost && sharesSourceId(collidingPost, post)) {
      postsById.set(post.id, post);
      postsToSaveById.set(post.id, post);
      acceptedImportPosts.push(post);
      continue;
    }

    const duplicate = findNearDuplicatePost(post, Array.from(postsById.values()));

    if (duplicate) {
      const mergedPost = mergePostSources(duplicate.post, post);

      postsById.set(mergedPost.id, mergedPost);
      postsToSaveById.set(mergedPost.id, mergedPost);
      skippedPostIds.add(post.id);
      mergedSources.push({
        id: `merged-source-${hashText(`${preparedResult.importRecord.id}|${post.id}|${duplicate.post.id}`)}`,
        sourceImportId: preparedResult.importRecord.id,
        sourcePostId: post.id,
        mergedIntoPostId: duplicate.post.id,
        sourceIds: post.sources.map((source) => source.id),
        similarity: duplicate.similarity,
        createdAt,
        reason: "merged_into"
      });
      continue;
    }

    // Models pick the card id themselves and reuse generic ones (`post-001`) across unrelated
    // sources. Replacing by id destroyed the earlier card, so the newcomer gets a different id
    // derived from its own sources: deterministic, so re-applying the same import stays idempotent.
    const accepted = collidingPost ? { ...post, id: buildCollisionFreePostId(post, preparedResult) } : post;

    if (accepted.id !== post.id) {
      renamedPostIds.set(post.id, accepted.id);
    }

    postsById.set(accepted.id, accepted);
    postsToSaveById.set(accepted.id, accepted);
    acceptedImportPosts.push(accepted);
  }

  const removedPostIds = new Set([...skippedPostIds, ...validationRejectedPostIds]);
  const renamePostId = (postId: string): string => renamedPostIds.get(postId) ?? postId;
  const renameValidationPostId = <T extends { postId?: string }>(record: T): T =>
    record.postId && renamedPostIds.has(record.postId) ? { ...record, postId: renamePostId(record.postId) } : record;

  if (removedPostIds.size || renamedPostIds.size) {
    preparedResult.posts = acceptedImportPosts;

    // Near-duplicate cards are represented by the merge record, while failed validation must
    // remain in the ledger for audit even though its post is refused.
    if (Array.isArray(preparedResult.validation)) {
      preparedResult.validation = preparedResult.validation
        .filter((record) => !record.postId || !skippedPostIds.has(record.postId))
        .map(renameValidationPostId);
    }

    if (preparedResult.harnessRun) {
      preparedResult.harnessRun = {
        ...preparedResult.harnessRun,
        outputPostIds: preparedResult.harnessRun.outputPostIds
          .filter((postId) => !removedPostIds.has(postId))
          .map(renamePostId),
        validation: preparedResult.harnessRun.validation
          .filter((record) => !record.postId || !skippedPostIds.has(record.postId))
          .map(renameValidationPostId)
      };
    }
  }

  return {
    preparedResult,
    postsToSave: Array.from(postsToSaveById.values()),
    mergedSources
  };
}

function shouldPersistImportedPost(
  result: SourceImportWorkerResult,
  post: KnowledgePost,
  index: number
): boolean {
  if (result.importRecord.status === "failed" || result.harnessRun?.status === "failed") {
    return false;
  }

  if (result.posts.filter((candidate) => candidate.id === post.id).length !== 1) {
    return false;
  }

  const resultValidation = Array.isArray(result.validation) ? result.validation : [];
  const runValidation = Array.isArray(result.harnessRun?.validation) ? result.harnessRun.validation : [];

  // Non-harness imports (for example local notes) predate validation records and remain valid.
  // Once a harness run or any validation is present, missing validation fails closed.
  if (!resultValidation.length && !runValidation.length) {
    return !result.harnessRun;
  }

  const resultMatches = findPersistenceValidation(resultValidation, result.posts, post.id, index);

  if (!result.harnessRun) {
    return isAcceptedPersistenceValidation(resultMatches);
  }

  const outputIdCount = result.harnessRun.outputPostIds.filter((postId) => postId === post.id).length;
  const runMatches = findPersistenceValidation(runValidation, result.posts, post.id, index);

  return (
    outputIdCount === 1 &&
    isAcceptedPersistenceValidation(resultMatches) &&
    isAcceptedPersistenceValidation(runMatches)
  );
}

function findPersistenceValidation(
  validation: readonly HarnessValidationResult[],
  posts: readonly KnowledgePost[],
  postId: string,
  index: number
): HarnessValidationResult[] {
  const globalRecords = validation.filter((record) => !record.postId);
  const idMatches = validation.filter((record) => record.postId === postId);

  if (idMatches.length) {
    return [...globalRecords, ...idMatches];
  }

  const indexMatch = validation.length === posts.length ? validation[index] : undefined;

  return indexMatch ? [...globalRecords, indexMatch] : globalRecords;
}

function isAcceptedPersistenceValidation(validation: readonly HarnessValidationResult[]): boolean {
  return (
    validation.length > 0 &&
    validation.every(
      (record) => record.valid && !record.issues.some((issue) => issue.severity === "error")
    )
  );
}

function sharesSourceId(left: KnowledgePost, right: KnowledgePost): boolean {
  const leftSourceIds = new Set(left.sources.map((source) => source.id));

  return right.sources.some((source) => leftSourceIds.has(source.id));
}

function buildCollisionFreePostId(post: KnowledgePost, result: SourceImportWorkerResult): string {
  const sourceIds = post.sources.length
    ? post.sources.map((source) => source.id)
    : [result.importRecord.source.id];

  return `${post.id}-${hashText(sourceIds.slice().sort().join("|"))}`;
}

// Same-id candidates are kept in scope on purpose: a card colliding with an unrelated card is
// re-id'd rather than replaced, so the collision must still be able to resolve as a content merge.
function findNearDuplicatePost(
  post: KnowledgePost,
  candidates: KnowledgePost[]
): { post: KnowledgePost; similarity: number } | undefined {
  return candidates
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

function upsertDeepReadArticles(
  items: DeepReadArticleRecord[],
  nextItems: DeepReadArticleRecord[]
): DeepReadArticleRecord[] {
  return normalizeDeepReadArticles(upsertManyById(items, nextItems));
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
  // structuredClone 比 JSON 往返快数倍且不产生几十 MB 的中间字符串;快照本身
  // 是纯 JSON 形状(解码产物),两种克隆语义等价。
  return structuredClone(snapshot);
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
