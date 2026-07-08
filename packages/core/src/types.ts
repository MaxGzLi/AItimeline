export type SourceType =
  | "youtube"
  | "article"
  | "paper"
  | "blog"
  | "news"
  | "repo"
  | "pdf"
  | "audio"
  | "manual"
  | "user_note";

export type TrustState = "emerging" | "supported" | "contested";

export type UserSignalType = "like" | "save" | "ask" | "review";

export type KnowledgeCardKind = "knowledge" | "connection_note" | "idea";

export type ConceptAliasDecisionBy = "auto" | "user";

export interface ConceptAliasRecord {
  canonical: string;
  aliases: string[];
  decidedBy: ConceptAliasDecisionBy;
  decidedAt: string;
}

export type ConceptMergeSuggestionStatus = "pending" | "merged" | "separate";

export interface ConceptMergeSuggestion {
  id: string;
  left: string;
  right: string;
  leftExcerpt?: string;
  rightExcerpt?: string;
  createdAt: string;
  status: ConceptMergeSuggestionStatus;
  decidedBy?: "user";
  decidedAt?: string;
}

export type SourceAssetKind = "transcript" | "text" | "metadata" | "image";

export type TransformationStatus = "queued" | "extracting" | "transforming" | "ready" | "failed";

export type SourceQualityVerdictStatus = "accept" | "reject";

export type SourceQualityGateRunnerKind = "deterministic" | "model";

export type SourceSnapshotKind = SourceAssetKind;

export type SubscriptionKind = "rss" | "youtube_channel";

export type SubscriptionFilterMode = "all" | "relevant" | "listOnly";

export type LearningGoalStatus = "active" | "achieved" | "archived";

export type KnowledgeDifficulty = "beginner" | "intermediate" | "advanced";

export type KnowledgeConfidence = "low" | "medium" | "high";

export type ThreadBlockKind =
  | "explain"
  | "example"
  | "contrast"
  | "extension"
  | "quiz"
  | "user_comment"
  | "agent_reply";

export type KnowledgeEdgeRelation =
  | "requires"
  | "extends"
  | "contrasts"
  | "applies"
  | "evaluates"
  | "summarizes";

export type ReviewPromptKind = "recall" | "compare" | "apply" | "explain";

export type NextActionPolicy =
  | "continue_deeper"
  | "expand_broader"
  | "reframe_simpler"
  | "cooldown_topic"
  | "schedule_review"
  | "ask_clarifying_question";

export type AgentHarnessRunnerKind = "deterministic" | "model";

export type AgentHarnessObjective = "source_import" | "followup_generation" | "review_reinforcement";

export type AgentHarnessRunStatus = "succeeded" | "failed";

export type HarnessValidationSeverity = "error" | "warning";

export type ExpansionJobKind = "generate_followup" | "schedule_review" | "cooldown_topic" | "ask_clarifying_question";

export type SourceClaimKind = "source_fact" | "interpretation" | "example" | "question";

export type GroundingCheckStatus = "passed" | "warning" | "failed";

export type InferredLearningState =
  | "interested"
  | "confused"
  | "fatigued"
  | "not_relevant"
  | "needs_review";

export interface Source {
  id: string;
  title: string;
  url: string;
  type: SourceType;
  author?: string;
  publishedAt?: string;
  durationSeconds?: number;
  origin?: SourceOrigin;
}

export interface SourceOrigin {
  turnId: string;
  question: string;
  createdAt: string;
}

export interface SourceTextAsset {
  id: string;
  sourceId: string;
  kind: Exclude<SourceAssetKind, "image">;
  content: string;
  createdAt: string;
}

export interface SourceImageAsset {
  id: string;
  sourceId: string;
  kind: "image";
  content?: never;
  url: string;
  caption: string;
  figureLabel: string;
  createdAt: string;
}

export type SourceAsset = SourceTextAsset | SourceImageAsset;

export interface SourceSnapshot {
  id: string;
  sourceId: string;
  assetId?: string;
  kind: SourceSnapshotKind;
  version: number;
  contentHash: string;
  contentLength: number;
  createdAt: string;
}

export interface KnowledgeChunk {
  id: string;
  sourceId: string;
  content: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  conceptHints?: string[];
}

export interface SourceChunkVersion {
  id: string;
  chunkId: string;
  sourceId: string;
  snapshotId?: string;
  version: number;
  contentHash: string;
  contentLength: number;
  createdAt: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  conceptHints?: string[];
}

export interface SourceRegistry {
  sources: Source[];
  assets: SourceAsset[];
  snapshots: SourceSnapshot[];
  chunks: KnowledgeChunk[];
  chunkVersions: SourceChunkVersion[];
}

export interface Citation {
  sourceId: string;
  chunkId?: string;
  url?: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
}

export interface EvidenceSpan {
  sourceId: string;
  chunkId: string;
  quote: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
}

export type KnowledgePostMediaOrigin = "paper" | "derived";

export interface KnowledgePostMedia {
  assetId: string;
  caption: string;
  origin: KnowledgePostMediaOrigin;
}

export interface SourceClaim {
  id: string;
  postId: string;
  fieldPath: string;
  kind: SourceClaimKind;
  claim: string;
  evidence: EvidenceSpan[];
}

export interface KnowledgeCard {
  kind?: KnowledgeCardKind;
  id: string;
  title: string;
  hook?: string;
  thesis?: string;
  shortBody?: string;
  summary: string;
  keyTakeaway: string;
  concepts: string[];
  sources: Source[];
  citations?: Citation[];
  recommendedBecause: string;
  trustState: TrustState;
  createdAt: string;
  estimatedReadMinutes: number;
  difficulty?: KnowledgeDifficulty;
  confidence?: KnowledgeConfidence;
  thread?: KnowledgeThreadBlock[];
  graphEdges?: KnowledgeGraphEdge[];
  reviewPrompts?: KnowledgeReviewPrompt[];
  nextActions?: NextActionPolicy[];
  harnessVersion?: string;
  connectionNote?: ConnectionNoteDetails;
}

export interface KnowledgePost extends KnowledgeCard {
  hook: string;
  thesis: string;
  shortBody: string;
  media?: KnowledgePostMedia[];
  difficulty: KnowledgeDifficulty;
  confidence: KnowledgeConfidence;
  thread: KnowledgeThreadBlock[];
  graphEdges: KnowledgeGraphEdge[];
  reviewPrompts: KnowledgeReviewPrompt[];
  nextActions: NextActionPolicy[];
  harnessVersion: string;
}

export interface KnowledgeThreadBlock {
  id: string;
  kind: ThreadBlockKind;
  title: string;
  body: string;
  prompt?: string;
}

export interface KnowledgeGraphEdge {
  id: string;
  sourceConcept: string;
  relation: KnowledgeEdgeRelation;
  targetConcept: string;
  evidence: string;
  weight: number;
}

export type ConnectionNoteReason = "distant_cluster" | "wake_dormant" | "wake_dismissed";

export interface ConnectionNoteDetails {
  oldPostId: string;
  oldPostTitle: string;
  newPostId: string;
  newPostTitle: string;
  evidence: string;
  relation: KnowledgeEdgeRelation;
  sourceConcept: string;
  targetConcept: string;
  reason: ConnectionNoteReason;
  daysSinceOldCard: number;
  restorePostId?: string;
}

export interface KnowledgeReviewPrompt {
  id: string;
  kind: ReviewPromptKind;
  prompt: string;
  answerHint: string;
  dueInDays: number;
}

export interface UserProfile {
  interests: string[];
  knownConcepts: string[];
  savedConcepts: string[];
  weakConcepts: string[];
}

export interface RankedKnowledgeCard extends KnowledgeCard {
  score: number;
  scoreReasons: string[];
}

export interface UserSignal {
  id: string;
  cardId: string;
  type: UserSignalType;
  createdAt: string;
  concept?: string;
  prompt?: string;
}

export interface InteractionSignal {
  postId: string;
  topicId: string;
  conceptIds: string[];
  impression: boolean;
  dwellTimeMs: number;
  openedThread: boolean;
  liked: boolean;
  saved: boolean;
  askedQuestion: boolean;
  reviewed: boolean;
  skippedQuickly: boolean;
  createdAt: string;
}

export interface TopicState {
  topicId: string;
  interestScore: number;
  fatigueScore: number;
  comprehensionScore: number;
  cooldownUntil?: string;
}

export interface LearningFeedback {
  postId: string;
  topicId: string;
  conceptIds: string[];
  signalStrength: number;
  inferredState: InferredLearningState;
  nextAction: NextActionPolicy;
  reason: string;
}

export interface AgentExpansionPolicyConfig {
  noInteractionDwellTimeMs: number;
  softInterestDwellTimeMs: number;
  cooldownHours: number;
  maxJobsPerTopic: number;
}

export interface AgentExpansionJob {
  id: string;
  kind: ExpansionJobKind;
  postId: string;
  topicId: string;
  conceptIds: string[];
  nextAction: NextActionPolicy;
  priority: number;
  reason: string;
  createdAt: string;
  runAfter?: string;
  cooldownUntil?: string;
}

export interface AgentExpansionSuppression {
  postId: string;
  topicId: string;
  reason: string;
}

export interface AgentExpansionPlan {
  generatedAt: string;
  jobs: AgentExpansionJob[];
  suppressions: AgentExpansionSuppression[];
  cooledTopicIds: string[];
}

export interface AgentHarnessConfig {
  id: string;
  version: string;
  runnerKind: AgentHarnessRunnerKind;
  objective: AgentHarnessObjective;
  maxPostsPerRun: number;
  threadPolicy: {
    requiredKinds: ThreadBlockKind[];
    maxBlocksPerPost: number;
  };
  graphPolicy: {
    maxEdgesPerPost: number;
    minEdgeWeight: number;
  };
  reviewPolicy: {
    enabled: boolean;
    dueInDays: number[];
  };
}

export interface AgentHarnessUserContext {
  memory?: UserMemory;
  knownConcepts?: string[];
  savedConcepts?: string[];
  weakConcepts?: string[];
  recentSignals?: InteractionSignal[];
  topicStates?: TopicState[];
}

export type PaperDigestBucketKind = "motivation" | "method" | "experiment" | "result" | "conclusion" | "other";

export interface PaperDigestBucket {
  kind: PaperDigestBucketKind;
  title: string;
  chunkIds: string[];
}

export interface PaperDigestFigure {
  assetId: string;
  figureLabel: string;
  caption: string;
}

export interface PaperDigestInput {
  buckets: PaperDigestBucket[];
  figures: PaperDigestFigure[];
}

export interface AgentHarnessRunInput {
  id?: string;
  source: Source;
  chunks: KnowledgeChunk[];
  sourceRegistry?: SourceRegistry;
  paperDigest?: PaperDigestInput;
  contentLanguage?: import("./harness/contentLanguage.js").ContentLanguage;
  createdAt?: string;
  recommendedBecause?: string;
  config?: AgentHarnessConfig;
  userContext?: AgentHarnessUserContext;
}

export interface HarnessValidationIssue {
  path: string;
  message: string;
  severity: HarnessValidationSeverity;
}

export interface GroundingClaimCheck {
  claimId: string;
  fieldPath: string;
  kind: SourceClaimKind;
  status: GroundingCheckStatus;
  evidenceChunkIds: string[];
  overlapScore: number;
  reason: string;
}

export interface GroundingCheck {
  postId: string;
  valid: boolean;
  checks: GroundingClaimCheck[];
  issues: HarnessValidationIssue[];
}

export interface HarnessValidationResult {
  postId?: string;
  valid: boolean;
  issues: HarnessValidationIssue[];
  grounding?: GroundingCheck;
}

export interface AgentHarnessRun {
  id: string;
  sourceId: string;
  harnessVersion: string;
  runnerKind: AgentHarnessRunnerKind;
  objective: AgentHarnessObjective;
  status: AgentHarnessRunStatus;
  createdAt: string;
  completedAt: string;
  sourceSnapshotIds: string[];
  inputChunkIds: string[];
  outputPostIds: string[];
  validation: HarnessValidationResult[];
}

export interface AgentHarnessRunResult {
  run: AgentHarnessRun;
  posts: KnowledgePost[];
  validation: HarnessValidationResult[];
  sourceRegistry?: SourceRegistry;
}

export interface KnowledgePostAgentRunner {
  id: string;
  kind: AgentHarnessRunnerKind;
  run(input: AgentHarnessRunInput): AgentHarnessRunResult | Promise<AgentHarnessRunResult>;
}

export type ConceptBriefRunnerKind = "deterministic" | "model";

export type DeepReadArticleRunnerKind = "deterministic_fallback" | "model";

export type DeepReadParagraphKind = "fact" | "synthesis";

export type DeepReadChapterStatus = "complete" | "gap";

export interface ConceptBriefSentence {
  id: string;
  text: string;
  cardId: string;
}

export interface ConceptBriefAdjacentConcept {
  concept: string;
  relation: KnowledgeEdgeRelation;
  cardId: string;
}

export interface ConceptBrief {
  id: string;
  concept: string;
  version: "concept-brief-v0";
  runnerKind: ConceptBriefRunnerKind;
  generatedAt: string;
  cardCount: number;
  reviewCount: number;
  sourceCardIds: string[];
  adjacentConcepts: ConceptBriefAdjacentConcept[];
  sentences: ConceptBriefSentence[];
}

export interface DeepReadMaterialPointer {
  cardId: string;
  sourceId: string;
  chunkId: string;
}

export interface DeepReadKeyFact {
  id: string;
  kind: "number" | "date" | "version" | "proper_noun";
  value: string;
  normalizedValue: string;
  fieldKey: string;
  sourceId: string;
  chunkId: string;
  cardId?: string;
}

export interface DeepReadConflictPair {
  id: string;
  fieldKey: string;
  kind: DeepReadKeyFact["kind"];
  left: DeepReadKeyFact;
  right: DeepReadKeyFact;
}

export interface DeepReadDiscardedMaterial {
  cardId?: string;
  sourceId?: string;
  chunkId?: string;
  title?: string;
  score: number;
  reasons: string[];
}

export interface DeepReadChapterContract {
  id: string;
  title: string;
  question: string;
  materialPointers: DeepReadMaterialPointer[];
  keyFacts: DeepReadKeyFact[];
  gapStatement?: string;
  conflictInstructions: string[];
  singleSource: boolean;
  readerPositioning: {
    masteredConcepts: string[];
    gapConcepts: string[];
  };
}

export interface DeepReadCitation {
  sourceId: string;
  chunkId: string;
  cardId?: string;
}

export interface DeepReadParagraphGateReport {
  passed: boolean;
  issues: string[];
  checkedAt: string;
}

export interface DeepReadParagraph {
  id: string;
  kind: DeepReadParagraphKind;
  text: string;
  citations: DeepReadCitation[];
  gate?: DeepReadParagraphGateReport;
}

export interface DeepReadDeletedParagraphLog {
  chapterId: string;
  paragraphId: string;
  kind: DeepReadParagraphKind;
  text: string;
  reasons: string[];
  deletedAt: string;
}

export interface DeepReadChapterSource {
  sourceId: string;
  sourceTitle: string;
  chunkIds: string[];
  cardIds: string[];
}

export interface DeepReadChapter {
  id: string;
  title: string;
  question: string;
  status: DeepReadChapterStatus;
  singleSource: boolean;
  gapStatement?: string;
  contract: DeepReadChapterContract;
  paragraphs: DeepReadParagraph[];
  sources: DeepReadChapterSource[];
}

export interface DeepReadArticleSource {
  sourceId: string;
  title: string;
  url: string;
  type: SourceType;
  chunkIds: string[];
  cardIds: string[];
}

export interface DeepReadQualityReport {
  runnerKind: DeepReadArticleRunnerKind;
  generatedAt: string;
  newReaderTest: {
    runnerKind: DeepReadArticleRunnerKind;
    answers: Array<{
      chapterId: string;
      question: string;
      answer: string;
    }>;
    contradictions: string[];
    ambiguities: string[];
  };
  density: {
    atomicPointCount: number;
    characterCount: number;
    pointsPerThousandChars: number;
  };
  notes: string[];
}

export interface DeepReadArticleRecord {
  id: string;
  version: "deep-read-article-v0";
  status: "ready" | "failed";
  runnerKind: DeepReadArticleRunnerKind;
  topic: string;
  topicKey: string;
  goalId?: string;
  userId: string;
  title: string;
  introduction: string;
  conclusion: string;
  chapters: DeepReadChapter[];
  sources: DeepReadArticleSource[];
  sourceCardIds: string[];
  sourceChunkIds: string[];
  discardedMaterials: DeepReadDiscardedMaterial[];
  conflicts: DeepReadConflictPair[];
  deletedParagraphLog: DeepReadDeletedParagraphLog[];
  qualityReport: DeepReadQualityReport;
  libraryVersion: string;
  budget: {
    maxTokens: number;
    truncated: boolean;
    notes: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface ConceptNode {
  id: string;
  label: string;
  weight: number;
  cardIds: string[];
}

export interface ConceptEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  cardIds: string[];
}

export interface KnowledgeGraph {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

export interface ReviewItem {
  cardId: string;
  concept: string;
  dueAt: string;
  intervalDays: number;
  strength: number;
}

export interface ReviewState {
  postId: string;
  intervalDays: number;
  dueAt: string;
  lastReviewedAt?: string;
}

export interface SourceImport {
  id: string;
  source: Source;
  status: TransformationStatus;
  createdAt: string;
  errorMessage?: string;
}

export interface SourceQualityVerdict {
  url: string;
  sourceId: string;
  sourceTitle: string;
  score: number;
  verdict: SourceQualityVerdictStatus;
  reasons: string[];
  runnerKind: SourceQualityGateRunnerKind;
  evaluatedAt: string;
}

export interface MergedSourceRecord {
  id: string;
  sourceImportId: string;
  sourcePostId: string;
  mergedIntoPostId: string;
  sourceIds: string[];
  similarity: number;
  createdAt: string;
  reason: string;
}

export interface DailyAutoJobBudgetRecord {
  date: string;
  used: number;
  limit: number;
  discarded: number;
  updatedAt: string;
}

export interface SubscriptionRecord {
  id: string;
  kind: SubscriptionKind;
  feedUrl: string;
  siteUrl?: string;
  title: string;
  filterMode: SubscriptionFilterMode;
  createdAt: string;
  lastPolledAt?: string;
  lastItemPublishedAt?: string;
  lastError?: string;
}

export interface LearningGoalRecord {
  id: string;
  concept: string;
  createdAt: string;
  status: LearningGoalStatus;
  achievedAt?: string;
}

export interface UserMemory {
  profile: {
    interests: string[];
    goals: string[];
    explanationStyle?: "brief" | "example-first" | "deep";
  };
  knowledge: {
    knownConcepts: string[];
    weakConcepts: string[];
    savedConcepts: string[];
  };
  interaction: {
    recentCardIds: string[];
    recentQuestions: string[];
  };
  agent: {
    topicAgents: string[];
    preferredSourceTypes: SourceType[];
  };
}
