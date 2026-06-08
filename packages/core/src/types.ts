export type SourceType =
  | "youtube"
  | "article"
  | "paper"
  | "blog"
  | "news"
  | "repo"
  | "pdf"
  | "audio"
  | "manual";

export type TrustState = "emerging" | "supported" | "contested";

export type UserSignalType = "like" | "save" | "ask" | "review";

export type SourceAssetKind = "transcript" | "text" | "metadata";

export type TransformationStatus = "queued" | "extracting" | "transforming" | "ready" | "failed";

export interface Source {
  id: string;
  title: string;
  url: string;
  type: SourceType;
  author?: string;
  publishedAt?: string;
  durationSeconds?: number;
}

export interface SourceAsset {
  id: string;
  sourceId: string;
  kind: SourceAssetKind;
  content: string;
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

export interface Citation {
  sourceId: string;
  chunkId?: string;
  url?: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
}

export interface KnowledgeCard {
  id: string;
  title: string;
  summary: string;
  keyTakeaway: string;
  concepts: string[];
  sources: Source[];
  citations?: Citation[];
  recommendedBecause: string;
  trustState: TrustState;
  createdAt: string;
  estimatedReadMinutes: number;
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

export interface SourceImport {
  id: string;
  source: Source;
  status: TransformationStatus;
  createdAt: string;
  errorMessage?: string;
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
