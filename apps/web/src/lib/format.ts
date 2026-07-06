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
import { getDateLocale, getI18nLanguage, t } from "./i18n";
import type { AgentBoundaryZone, AskApiResult, GroundingStatus, SourceCandidateStatus } from "./types";

export function scrollMotion(): ScrollBehavior {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

export function formatBoundaryZone(zone: AgentBoundaryZone): string {
  if (zone === "inside") {
    return t("boundary.inside");
  }

  if (zone === "learning") {
    return t("boundary.learning");
  }

  if (zone === "frontier") {
    return t("boundary.frontier");
  }

  return t("boundary.dark");
}

export function getTimelineThreadPreview(card: KnowledgeCard): NonNullable<KnowledgeCard["thread"]> {
  return (
    card.thread
      ?.filter((block) => block.kind === "example" || block.kind === "contrast" || block.kind === "extension")
      .slice(0, 1) ?? []
  );
}

export function getAgentName(concept: string): string {
  if (concept === "RAG") return t("format.agent.rag");
  if (concept === "\u667a\u80fd\u4f53") return t("format.agent.smartAgent");
  if (concept === "\u4ea7\u54c1\u7b56\u7565") return t("format.agent.product");
  if (concept === "\u77e5\u8bc6\u56fe\u8c31") return t("format.agent.graph");
  if (concept === "\u8bc4\u4f30") return t("format.agent.evaluation");

  return t("format.agent.default", { concept });
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
    title: explainBlock?.title ?? t("format.readBlockTitle"),
    body: explainBlock?.body ?? card.thesis ?? card.shortBody ?? card.summary
  };
}

export function getTopicId(card: KnowledgeCard): string {
  return slugConcept(card.concepts[0] ?? "general");
}

export function slugConcept(concept: string): string {
  return concept.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "");
}

export function formatTrustState(state: TrustState): string {
  const labels: Record<TrustState, string> = {
    emerging: t("format.trust.emerging"),
    supported: t("format.trust.supported"),
    contested: t("format.trust.contested")
  };
  return labels[state];
}

export function formatStatus(status: TransformationStatus): string {
  const labels: Record<TransformationStatus, string> = {
    queued: t("format.status.queued"),
    extracting: t("format.status.extracting"),
    transforming: t("format.status.transforming"),
    ready: t("format.status.ready"),
    failed: t("format.status.failed")
  };

  return labels[status];
}

export function formatCandidateStatus(status: SourceCandidateStatus): string {
  const labels: Record<SourceCandidateStatus, string> = {
    pending: t("format.candidate.pending"),
    queued: t("format.candidate.queued"),
    imported: t("format.candidate.imported"),
    dismissed: t("format.candidate.dismissed")
  };

  return labels[status];
}

export function formatLearningState(state: LearningFeedback["inferredState"]): string {
  const labels: Record<LearningFeedback["inferredState"], string> = {
    interested: t("format.learning.interested"),
    confused: t("format.learning.confused"),
    fatigued: t("format.learning.fatigued"),
    not_relevant: t("format.learning.not_relevant"),
    needs_review: t("format.learning.needs_review")
  };

  return labels[state];
}

export function formatSignalChips(signal: InteractionSignal): string[] {
  const chips = [t("format.signal.exposure")];

  if (signal.dwellTimeMs > 0) chips.push(t("format.signal.dwell", { seconds: Math.round(signal.dwellTimeMs / 1000) }));
  if (signal.openedThread) chips.push(t("format.signal.openThread"));
  if (signal.liked) chips.push(t("format.signal.like"));
  if (signal.saved) chips.push(t("format.signal.save"));
  if (signal.askedQuestion) chips.push(t("format.signal.ask"));
  if (signal.reviewed) chips.push(t("format.signal.reviewed"));
  if (signal.skippedQuickly) chips.push(t("format.signal.skip"));

  return chips;
}

export function formatDifficulty(value: NonNullable<KnowledgeCard["difficulty"]>): string {
  const labels: Record<NonNullable<KnowledgeCard["difficulty"]>, string> = {
    beginner: t("format.difficulty.beginner"),
    intermediate: t("format.difficulty.intermediate"),
    advanced: t("format.difficulty.advanced")
  };

  return labels[value];
}

export function formatConnectionKind(kind: CardConnection["kind"]): string {
  const labels: Record<CardConnection["kind"], string> = {
    builds_on: t("format.connection.builds_on"),
    leads_to: t("format.connection.leads_to"),
    contrast: t("format.connection.contrast"),
    related: t("format.connection.related")
  };

  return labels[kind];
}

export type ConceptDigestRole = ConceptDigest["entries"][number]["role"];

export function formatConceptRole(role: ConceptDigestRole): string {
  const labels: Record<ConceptDigestRole, string> = {
    foundation: t("format.digest.foundation"),
    builds: t("format.digest.builds"),
    applies: t("format.digest.applies"),
    contrast: t("format.digest.contrast")
  };

  return labels[role];
}

export function formatConfidence(value: NonNullable<KnowledgeCard["confidence"]>): string {
  const labels: Record<NonNullable<KnowledgeCard["confidence"]>, string> = {
    low: t("format.confidence.low"),
    medium: t("format.confidence.medium"),
    high: t("format.confidence.high")
  };

  return labels[value];
}

export function formatThreadKind(value: NonNullable<KnowledgeCard["thread"]>[number]["kind"]): string {
  const labels: Record<NonNullable<KnowledgeCard["thread"]>[number]["kind"], string> = {
    explain: t("format.thread.explain"),
    example: t("format.thread.example"),
    contrast: t("format.thread.contrast"),
    extension: t("format.thread.extension"),
    quiz: t("format.thread.quiz"),
    user_comment: t("format.thread.user_comment"),
    agent_reply: t("format.thread.agent_reply")
  };

  return labels[value];
}

export function formatNextAction(action: NonNullable<KnowledgeCard["nextActions"]>[number]): string {
  const labels: Record<NonNullable<KnowledgeCard["nextActions"]>[number], string> = {
    continue_deeper: t("format.next.continue_deeper"),
    expand_broader: t("format.next.expand_broader"),
    reframe_simpler: t("format.next.reframe_simpler"),
    cooldown_topic: t("format.next.cooldown_topic"),
    schedule_review: t("format.next.schedule_review"),
    ask_clarifying_question: t("format.next.ask_clarifying_question")
  };

  return labels[action];
}

export function formatGroundingStatus(status: GroundingStatus): string {
  const labels: Record<GroundingStatus, string> = {
    passed: t("format.grounding.passed"),
    warning: t("format.grounding.warning"),
    failed: t("format.grounding.failed")
  };

  return labels[status];
}

export function formatEdgeRelation(relation: NonNullable<KnowledgeCard["graphEdges"]>[number]["relation"]): string {
  const labels: Record<NonNullable<KnowledgeCard["graphEdges"]>[number]["relation"], string> = {
    requires: t("format.edge.requires"),
    extends: t("format.edge.extends"),
    contrasts: t("format.edge.contrasts"),
    applies: t("format.edge.applies"),
    evaluates: t("format.edge.evaluates"),
    summarizes: t("format.edge.summarizes")
  };

  return labels[relation];
}

export function formatReviewPromptKind(kind: NonNullable<KnowledgeCard["reviewPrompts"]>[number]["kind"]): string {
  const labels: Record<NonNullable<KnowledgeCard["reviewPrompts"]>[number]["kind"], string> = {
    recall: t("format.review.recall"),
    compare: t("format.review.compare"),
    apply: t("format.review.apply"),
    explain: t("format.review.explain")
  };

  return labels[kind];
}

export function formatEvidenceFieldPath(path: string): string {
  if (path.startsWith("$.thread")) {
    return t("format.evidence.thread");
  }

  if (path.startsWith("$.graphEdges")) {
    return t("format.evidence.graph");
  }

  return path.replace(/^\$\./, "").replace(/([A-Z])/g, " $1");
}

export function formatCardSource(card: KnowledgeCard): string {
  const source = card.sources[0];
  const citation = card.citations?.[0];

  if (!source) {
    return t("format.unknownSource");
  }

  if (source.type === "youtube" && citation?.startTimeSeconds !== undefined) {
    return `${source.title} · ${formatTimestamp(citation.startTimeSeconds)}`;
  }

  return source.title;
}

export function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat(getDateLocale(), {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function formatShortTime(value: string): string {
  return new Intl.DateTimeFormat(getDateLocale(), {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return "";
  }

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) {
    return t("format.relative.justNow");
  }
  if (minutes < 60) {
    return t("format.relative.minute", { count: minutes });
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("format.relative.hour", { count: hours });
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return t("format.relative.day", { count: days });
  }

  const date = new Date(value);
  return new Intl.DateTimeFormat(getDateLocale(), {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" })
  }).format(date);
}

export function formatFullTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(getDateLocale(), { dateStyle: "full", timeStyle: "short" }).format(date);
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

  return `${result.answer}\n\n${t("format.ask.sources")}\n${sources}`;
}

export function buildGroundedAnswer(card: KnowledgeCard, chunks: KnowledgeChunk[], prompt: string): string {
  const citation = card.citations?.[0];
  const source = card.sources[0];
  const groundedChunk =
    chunks.find((chunk) => chunk.id === citation?.chunkId) ?? chunks.find((chunk) => chunk.sourceId === source?.id);
  const timestamp =
    citation?.startTimeSeconds !== undefined ? `(${formatTimestamp(citation.startTimeSeconds)})` : "";
  const separator = getI18nLanguage() === "en" ? ", " : "、";
  const conceptLine = card.concepts.length > 0
    ? t("format.groundedAnswer.concepts", { concepts: card.concepts.join(separator) })
    : "";

  return [
    t("format.groundedAnswer.summary", {
      title: source?.title ?? t("format.unknownSource"),
      timestamp,
      takeaway: card.keyTakeaway
    }),
    t("format.groundedAnswer.evidence", { evidence: groundedChunk ? groundedChunk.content : card.summary }),
    card.nextActions?.length
      ? t("format.groundedAnswer.next", { actions: card.nextActions.map(formatNextAction).join(separator) })
      : "",
    `${conceptLine}${t("format.groundedAnswer.question", { prompt })}`
  ]
    .filter(Boolean)
    .join("\n\n");
}
