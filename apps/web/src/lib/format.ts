import type {
  CardConnection,
  ConceptDigest,
  InteractionSignal,
  KnowledgeCard,
  KnowledgeChunk,
  LearningFeedback,
  TransformationStatus,
  TrustState
} from "@aitimeline/core";
import type { AgentBoundaryZone, AskApiResult, GroundingStatus, SourceCandidateStatus } from "./types";

// JS smooth-scroll ignores prefers-reduced-motion (unlike CSS, which we honor
// everywhere). Fall back to an instant jump when the user asked for reduced motion.
export function scrollMotion(): ScrollBehavior {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

export function formatBoundaryZone(zone: AgentBoundaryZone): string {
  if (zone === "inside") {
    return "已在你的知识边界内";
  }

  if (zone === "learning") {
    return "在你的学习区";
  }

  if (zone === "frontier") {
    return "在你的知识前沿";
  }

  return "在你的知识库之外";
}

export function getTimelineThreadPreview(card: KnowledgeCard): NonNullable<KnowledgeCard["thread"]> {
  return (
    card.thread
      ?.filter((block) => block.kind === "example" || block.kind === "contrast" || block.kind === "extension")
      .slice(0, 1) ?? []
  );
}

export function getAgentName(concept: string): string {
  if (concept === "RAG") return "RAG 实战笔记";
  if (concept === "智能体") return "智能体实验室";
  if (concept === "产品策略") return "产品闭环";
  if (concept === "知识图谱") return "图谱工作台";
  if (concept === "评估") return "评估台";

  return `${concept} 观察员`;
}

export function getAgentInitials(concept: string): string {
  return concept
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function getReadBlock(card: KnowledgeCard): { title: string; body: string } {
  const explainBlock = card.thread?.find((block) => block.kind === "explain");

  return {
    title: explainBlock?.title ?? "核心观点",
    body: explainBlock?.body ?? card.thesis ?? card.shortBody ?? card.summary
  };
}

export function getTopicId(card: KnowledgeCard): string {
  return slugConcept(card.concepts[0] ?? "general");
}

export function slugConcept(concept: string): string {
  // Keep Unicode letters/digits so non-ASCII concepts (e.g. Chinese) slug to a distinct key.
  return concept.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "");
}

export function formatTrustState(state: TrustState): string {
  const labels: Record<TrustState, string> = {
    emerging: "萌芽",
    supported: "已支撑",
    contested: "有争议"
  };
  return labels[state];
}

export function formatStatus(status: TransformationStatus): string {
  const labels: Record<TransformationStatus, string> = {
    queued: "排队中",
    extracting: "抽取中",
    transforming: "转化中",
    ready: "就绪",
    failed: "失败"
  };

  return labels[status];
}

export function formatCandidateStatus(status: SourceCandidateStatus): string {
  const labels: Record<SourceCandidateStatus, string> = {
    pending: "待处理",
    queued: "已排队",
    imported: "已导入",
    dismissed: "已忽略"
  };

  return labels[status];
}

export function formatLearningState(state: LearningFeedback["inferredState"]): string {
  const labels: Record<LearningFeedback["inferredState"], string> = {
    interested: "感兴趣",
    confused: "有困惑",
    fatigued: "疲劳",
    not_relevant: "信号弱",
    needs_review: "待复习"
  };

  return labels[state];
}

export function formatSignalChips(signal: InteractionSignal): string[] {
  const chips = ["曝光"];

  if (signal.dwellTimeMs > 0) chips.push(`停留 ${Math.round(signal.dwellTimeMs / 1000)} 秒`);
  if (signal.openedThread) chips.push("展开了卡");
  if (signal.liked) chips.push("点赞");
  if (signal.saved) chips.push("收藏");
  if (signal.askedQuestion) chips.push("追问");
  if (signal.reviewed) chips.push("已复习");
  if (signal.skippedQuickly) chips.push("划走");

  return chips;
}

export function formatDifficulty(value: NonNullable<KnowledgeCard["difficulty"]>): string {
  const labels: Record<NonNullable<KnowledgeCard["difficulty"]>, string> = {
    beginner: "入门",
    intermediate: "进阶",
    advanced: "高级"
  };

  return labels[value];
}

export function formatConnectionKind(kind: CardConnection["kind"]): string {
  const labels: Record<CardConnection["kind"], string> = {
    builds_on: "承接自",
    leads_to: "延伸到",
    contrast: "对比",
    related: "相关"
  };

  return labels[kind];
}

export type ConceptDigestRole = ConceptDigest["entries"][number]["role"];

export function formatConceptRole(role: ConceptDigestRole): string {
  const labels: Record<ConceptDigestRole, string> = {
    foundation: "基础",
    builds: "递进",
    applies: "应用",
    contrast: "对比"
  };

  return labels[role];
}

export function formatConfidence(value: NonNullable<KnowledgeCard["confidence"]>): string {
  const labels: Record<NonNullable<KnowledgeCard["confidence"]>, string> = {
    low: "Low confidence",
    medium: "Medium confidence",
    high: "High confidence"
  };

  return labels[value];
}

export function formatThreadKind(value: NonNullable<KnowledgeCard["thread"]>[number]["kind"]): string {
  const labels: Record<NonNullable<KnowledgeCard["thread"]>[number]["kind"], string> = {
    explain: "讲解",
    example: "例子",
    contrast: "对比",
    extension: "延伸",
    quiz: "小测"
  };

  return labels[value];
}

export function formatNextAction(action: NonNullable<KnowledgeCard["nextActions"]>[number]): string {
  const labels: Record<NonNullable<KnowledgeCard["nextActions"]>[number], string> = {
    continue_deeper: "深入",
    expand_broader: "拓宽",
    reframe_simpler: "简化",
    cooldown_topic: "降温",
    schedule_review: "复习",
    ask_clarifying_question: "追问澄清"
  };

  return labels[action];
}

export function formatGroundingStatus(status: GroundingStatus): string {
  const labels: Record<GroundingStatus, string> = {
    passed: "通过",
    warning: "警告",
    failed: "失败"
  };

  return labels[status];
}

export function formatEdgeRelation(relation: NonNullable<KnowledgeCard["graphEdges"]>[number]["relation"]): string {
  const labels: Record<NonNullable<KnowledgeCard["graphEdges"]>[number]["relation"], string> = {
    requires: "需要",
    extends: "延伸",
    contrasts: "对比",
    applies: "应用",
    evaluates: "评估",
    summarizes: "总结"
  };

  return labels[relation];
}

export function formatReviewPromptKind(kind: NonNullable<KnowledgeCard["reviewPrompts"]>[number]["kind"]): string {
  const labels: Record<NonNullable<KnowledgeCard["reviewPrompts"]>[number]["kind"], string> = {
    recall: "回忆",
    compare: "比较",
    apply: "应用",
    explain: "解释"
  };

  return labels[kind];
}

export function formatEvidenceFieldPath(path: string): string {
  if (path.startsWith("$.thread")) {
    return "延展";
  }

  if (path.startsWith("$.graphEdges")) {
    return "图谱";
  }

  return path.replace(/^\$\./, "").replace(/([A-Z])/g, " $1");
}

export function formatCardSource(card: KnowledgeCard): string {
  const source = card.sources[0];
  const citation = card.citations?.[0];

  if (!source) {
    return "未知来源";
  }

  if (source.type === "youtube" && citation?.startTimeSeconds !== undefined) {
    return `${source.title} · ${formatTimestamp(citation.startTimeSeconds)}`;
  }

  return source.title;
}

export function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function formatShortTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

// 类微博的相对时间:"刚刚" / "5分钟" / "3小时" / "2天",更早的显示日期。
export function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return "";
  }

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes}分钟`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}小时`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}天`;
  }

  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" })
  }).format(date);
}

// 鼠标悬停在时间上时显示的完整时间戳(相对时间会丢失精度)。
export function formatFullTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeStyle: "short" }).format(date);
}

export function buildTimestampUrl(url: string | undefined, seconds: number): string {
  if (!url) {
    return "#";
  }

  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.set("t", `${Math.floor(seconds)}s`);
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

export function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

export function formatAskAnswer(result: AskApiResult): string {
  if (!result.citations?.length) {
    return result.answer;
  }

  const sources = Array.from(
    new Map(
      result.citations.map((citation) => [
        citation.chunkId,
        `· ${citation.sourceTitle}${
          citation.startTimeSeconds !== undefined ? ` (${formatTimestamp(citation.startTimeSeconds)})` : ""
        }`
      ])
    ).values()
  ).join("\n");

  return `${result.answer}\n\n来源:\n${sources}`;
}

export function buildGroundedAnswer(card: KnowledgeCard, chunks: KnowledgeChunk[], prompt: string): string {
  const citation = card.citations?.[0];
  const source = card.sources[0];
  const groundedChunk =
    chunks.find((chunk) => chunk.id === citation?.chunkId) ?? chunks.find((chunk) => chunk.sourceId === source?.id);
  const timestamp =
    citation?.startTimeSeconds !== undefined ? `(${formatTimestamp(citation.startTimeSeconds)})` : "";
  const conceptLine = card.concepts.length > 0 ? `涉及概念:${card.concepts.join("、")}。` : "";

  return [
    `根据《${source?.title ?? "这个来源"}》${timestamp},这张卡片想说的是:${card.keyTakeaway}`,
    groundedChunk ? `依据:${groundedChunk.content}` : `依据:${card.summary}`,
    card.nextActions?.length ? `下一步建议:${card.nextActions.map(formatNextAction).join("、")}。` : "",
    `${conceptLine}你的问题是:「${prompt}」。`
  ]
    .filter(Boolean)
    .join("\n\n");
}
