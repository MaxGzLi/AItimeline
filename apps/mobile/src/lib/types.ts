// API 响应类型。来源:apps/web/src/lib/types.ts —— 两端 UI 层各自维护一份,
// 这里只保留手机端 v1 用到的子集(时间线、快照、来源候选、发帖/回复响应)。
// 底层领域类型仍从 @aitimeline/core 复用,不重复定义。
import type {
  BackgroundSourceCandidate,
  InteractionSignal,
  KnowledgeCard,
  RankedKnowledgeCard,
  SourceImport,
  TopicState
} from "@aitimeline/core";

export type ApiStatus = "checking" | "connected" | "offline";
export type SourceCandidateStatus = "pending" | "queued" | "imported" | "dismissed";

export type SourceCandidateRecord = {
  id: string;
  candidate: BackgroundSourceCandidate;
  status: SourceCandidateStatus;
  intakeKind: "user_paste" | "browser_share" | "agent_discovery" | "manual";
  createdAt: string;
  updatedAt: string;
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

export type ApiSnapshot = {
  sourceImports: SourceImport[];
  posts: KnowledgeCard[];
  sourceCandidates: SourceCandidateRecord[];
};

export type ApiNoteResponse = {
  post: KnowledgeCard;
};

export type ApiReplyResponse = {
  post: KnowledgeCard;
};

export type ApiCurationRunResponse = {
  records: Array<{ id: string; status: string }>;
};

export type InteractionSignals = Record<string, InteractionSignal>;
