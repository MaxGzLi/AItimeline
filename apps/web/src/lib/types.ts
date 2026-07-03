import type {
  BackgroundSourceCandidate,
  InteractionSignal,
  KnowledgeCard,
  KnowledgeChunk,
  LearningFeedback,
  RankedKnowledgeCard,
  SourceAsset,
  SourceImport,
  SourceRegistry,
  TopicState
} from "@aitimeline/core";

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type AiThreads = Record<string, AiMessage[]>;
export type InteractionSignals = Record<string, InteractionSignal>;
export type LearningFeedbackByPost = Record<string, LearningFeedback>;
export type ApiStatus = "checking" | "connected" | "offline";
export type SourceCandidateStatus = "pending" | "queued" | "imported" | "dismissed";
export type GroundingStatus = "passed" | "warning" | "failed";

export type EvidenceLedger = {
  postId: string;
  valid: boolean;
  generatedAt: string;
  summary: {
    totalClaims: number;
    passed: number;
    warnings: number;
    failed: number;
    citedSources: number;
    citedChunks: number;
  };
  claims: Array<{
    id: string;
    fieldPath: string;
    kind: string;
    claim: string;
    status: GroundingStatus;
    overlapScore: number;
    reason: string;
    evidence: Array<{
      sourceId: string;
      sourceTitle: string;
      chunkId: string;
      quote: string;
      startTimeSeconds?: number;
      endTimeSeconds?: number;
      overlapScore: number;
    }>;
  }>;
};

export type PersistedMvpState = {
  sourceImports: SourceImport[];
  importedCards: KnowledgeCard[];
  sourceAssets: SourceAsset[];
  sourceChunks: KnowledgeChunk[];
  aiThreads: AiThreads;
  interactionSignals: InteractionSignals;
  learningFeedback: LearningFeedbackByPost;
};

export type ApiImportResponse = {
  importRecord: SourceImport;
  assets?: SourceAsset[];
  chunks?: KnowledgeChunk[];
  posts?: KnowledgeCard[];
};

export type ApiSnapshot = {
  sourceImports: SourceImport[];
  sourceRegistries: Array<{
    id: string;
    sourceId: string;
    registry: SourceRegistry;
    createdAt: string;
  }>;
  posts: KnowledgeCard[];
  sourceCandidates: SourceCandidateRecord[];
};

export type ApiTimelineResponse = {
  posts: RankedKnowledgeCard[];
  sourceImports: SourceImport[];
  topicStates?: TopicState[];
  recommendationSummary?: {
    total: number;
    byIntent: Record<string, number>;
    topReasons: string[];
  };
};

export type ApiEvidenceResponse = {
  ledger: EvidenceLedger;
};

export type ApiCurationRunResponse = {
  records: Array<{
    id: string;
    status: string;
    result?: {
      sourceImport?: ApiImportResponse;
    };
  }>;
};

export type ApiCurationJobsResponse = {
  jobs: Array<{
    id: string;
    status: string;
  }>;
};

export type MemoryAction = "like" | "save" | "ask";

export type AgentBoundaryZone = "inside" | "learning" | "frontier" | "dark";

export type AgentAskApiResponse = {
  turn: {
    question: string;
    intent: string;
    tier: string;
    zone: AgentBoundaryZone;
    matchedConcepts: string[];
    answer: {
      answer: string;
      citations: Array<{ sourceTitle: string; quote: string }>;
      grounded: boolean;
      runnerKind: "model" | "deterministic";
    } | null;
    answerCardId?: string;
    actions: Array<{ kind: string; label: string; concepts: string[]; queries?: string[] }>;
    notes: string[];
  };
  discoveredCandidates: Array<{ id: string }>;
};

export type SourceCandidateRecord = {
  id: string;
  candidate: BackgroundSourceCandidate;
  status: SourceCandidateStatus;
  intakeKind: "user_paste" | "browser_share" | "agent_discovery" | "manual";
  createdAt: string;
  updatedAt: string;
};

export type AskCitation = {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  quote: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
};

export type AskApiResult = {
  answer: string;
  citations: AskCitation[];
  grounded: boolean;
  runnerKind: string;
};
