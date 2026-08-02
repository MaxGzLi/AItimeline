import type { CardConnection, InteractionSignal, KnowledgeCard, LinkedKnowledgeGraph, RankedKnowledgeCard } from "@aitimeline/core";
import {
  BadgeCheck,
  Bookmark,
  CheckCircle2,
  Clock,
  Heart,
  MessageCircle,
  Plus,
  Repeat2,
  RotateCcw,
  Share2,
  XCircle
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCardMedia, resolveMediaUrl } from "../lib/api";
import { formatConnectionKind, formatDaysAgo, formatRelativeTime, getAgentInitials, getAgentName, slugConcept } from "../lib/format";
import { t } from "../lib/i18n";
import { renderMathInText } from "../lib/math";
import { renderWithWikilinks } from "../lib/wikilinks";
import { PostReplyThread } from "./PostReplyThread";
import { ShareCardModal } from "./ShareCardModal";
import type { WikilinkAutocompleteCandidate } from "./WikilinkAutocomplete";

type RecommendReasonInfo = {
  label: string;
  beyondSource: boolean;
  detail: string | null;
};

// 持久化的推荐理由是生成侧的长句(含降级说明/行为信号),按已知模板归成收益导向短理由;
// 原句收进可展开的「为什么推荐」,超出来源标记转为徽章而不是裸前缀。
function summarizeRecommendReason(reason: string | undefined, concept: string): RecommendReasonInfo | null {
  if (!reason) {
    return null;
  }

  const text = reason.replace(/^\s*\[(?:超出来源|beyond source)\]\s*/i, "");
  const beyondSource = text !== reason;
  const rules: Array<{ pattern: RegExp; key: string }> = [
    { pattern: /没找到可用的新来源|同源跟进/, key: "post.reason.sameSource" },
    { pattern: /你提了问题/, key: "post.reason.question" },
    { pattern: /停留了很久|展开了讨论串|表现出了兴趣|跟进卡片|兴趣 [0-9.]+|理解 [0-9.]+/, key: "post.reason.followup" },
    { pattern: /你导入了这篇文章/, key: "post.reason.imported" },
    { pattern: /点了深入/, key: "post.reason.deepDive" },
    { pattern: /background curation|背景筛选|背景策展|通过搜索「/i, key: "post.reason.curated" }
  ];
  const matched = rules.find((rule) => rule.pattern.test(text));

  if (!matched) {
    return { label: text, beyondSource, detail: null };
  }

  return { label: t(matched.key, { concept }), beyondSource, detail: text };
}

export function PostView({
  card,
  cards,
  connections,
  dismissedPostIds,
  graph,
  isFocused,
  onDwell,
  onImpression,
  onLike,
  onOpen,
  onOpenCardId,
  onOpenConcept,
  onReply,
  onRestorePost,
  onReviewComplete,
  onSave,
  onSkip,
  quoteText,
  reviewDueAt,
  signal,
  wikilinkCandidates
}: {
  card: RankedKnowledgeCard;
  cards: KnowledgeCard[];
  connections: CardConnection[];
  dismissedPostIds?: ReadonlySet<string>;
  graph?: LinkedKnowledgeGraph;
  isFocused?: boolean;
  onDwell: (card: RankedKnowledgeCard, dwellTimeMs: number) => void;
  onImpression?: (card: RankedKnowledgeCard) => void;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpen: (card: RankedKnowledgeCard) => void;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onReply: (card: RankedKnowledgeCard, text: string) => Promise<void>;
  onRestorePost?: (postId: string) => Promise<void>;
  onReviewComplete?: (card: RankedKnowledgeCard) => void;
  onSave: (card: RankedKnowledgeCard) => void;
  onSkip: (card: RankedKnowledgeCard) => void;
  quoteText?: string;
  reviewDueAt?: string;
  signal?: InteractionSignal;
  wikilinkCandidates: WikilinkAutocompleteCandidate[];
}) {
  const postRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const visibleSince = useRef<number | null>(null);
  const accumulatedVisibleMs = useRef(0);
  const reportedDwellMs = useRef(0);
  const impressionFired = useRef(false);
  const impressionCard = useRef(card);
  impressionCard.current = card;
  const [threadOpen, setThreadOpen] = useState(false);
  const [bodyOverflows, setBodyOverflows] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const primaryConcept = card.concepts[0] ?? t("common.concept");
  const reasonInfo = summarizeRecommendReason(card.recommendedBecause, primaryConcept);
  const source = card.sources[0];
  const isUserNote = source?.type === "user_note";
  // Conversation captures cite their own excerpt: agent-said content, so they
  // get the explicit conversation label instead of the source check badge.
  const isConversation = source?.type === "conversation";
  // Derived content (follow-ups, connection notes) cites synthetic local
  // sources; the check badge is reserved for cards with real external grounding.
  const isDerivedContent =
    card.kind === "connection_note" ||
    Boolean(source && (source.id.startsWith("followup-") || source.url.includes("aitimeline.local")));
  const isSourceCertified = !isUserNote && !isConversation && !isDerivedContent && (card.citations?.length ?? 0) > 0;
  const topConnection = connections[0];
  const cardMedia = getCardMedia(card);
  const leadMedia = cardMedia[0];
  const commentBlocks = (card.thread ?? []).filter(
    (block) => block.kind === "user_comment" || block.kind === "agent_reply"
  );
  const replyCount = commentBlocks.length;
  const reviewDueDays = card.reviewPrompts?.[0]?.dueInDays;
  const note = card.kind === "connection_note" ? card.connectionNote : undefined;

  useEffect(() => {
    visibleSince.current = null;
    accumulatedVisibleMs.current = 0;
    reportedDwellMs.current = 0;
    impressionFired.current = false;
  }, [card.id]);

  useEffect(() => {
    const node = postRef.current;

    if (!node || !("IntersectionObserver" in window)) {
      return;
    }

    // Connection notes are system-derived: passive dwell on them must not feed
    // back into production (dwell triggers follow-up generation server-side).
    if (card.kind === "connection_note") {
      return;
    }

    const getCurrentDwellMs = () => {
      const activeVisibleMs = visibleSince.current === null ? 0 : performance.now() - visibleSince.current;

      return Math.min(120000, Math.round(accumulatedVisibleMs.current + activeVisibleMs));
    };
    const flushDwell = () => {
      if (visibleSince.current !== null) {
        accumulatedVisibleMs.current = getCurrentDwellMs();
        visibleSince.current = null;
      }

      const dwellTimeMs = Math.min(120000, Math.round(accumulatedVisibleMs.current));

      if (dwellTimeMs >= 1200 && dwellTimeMs > reportedDwellMs.current + 800) {
        reportedDwellMs.current = dwellTimeMs;
        onDwell(impressionCard.current, dwellTimeMs);
      }
    };

    // Track intersection so a tab switch can resume timing: the observer only
    // fires on intersection changes, not on visibility changes.
    let isIntersecting = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.6) {
          isIntersecting = true;
          if (!document.hidden) {
            visibleSince.current ??= performance.now();
          }
          return;
        }

        isIntersecting = false;
        flushDwell();
      },
      { threshold: [0, 0.6, 1] }
    );
    const interval = window.setInterval(() => {
      if (visibleSince.current === null) {
        return;
      }

      const dwellTimeMs = getCurrentDwellMs();

      if (dwellTimeMs >= 9000 && dwellTimeMs > reportedDwellMs.current + 3500) {
        reportedDwellMs.current = dwellTimeMs;
        onDwell(impressionCard.current, dwellTimeMs);
      }
    }, 3000);
    const handleVisibilityChange = () => {
      if (document.hidden) {
        flushDwell();
        return;
      }

      // Coming back to a card still in the viewport restarts the clock.
      if (isIntersecting) {
        visibleSince.current ??= performance.now();
      }
    };

    observer.observe(node);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushDwell();
      observer.disconnect();
    };
  }, [card.id, onDwell]);

  useEffect(() => {
    if (!onImpression) {
      return;
    }

    const node = postRef.current;

    if (!node || !("IntersectionObserver" in window)) {
      return;
    }

    let timer: number | null = null;
    let isIntersecting = false;
    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    // Impressions require the tab to be visible: a background tab still gets
    // intersection callbacks but the user never saw the card.
    const armTimer = () => {
      if (timer !== null || impressionFired.current || document.hidden) {
        return;
      }

      timer = window.setTimeout(() => {
        timer = null;

        if (document.hidden) {
          return;
        }

        impressionFired.current = true;
        onImpression(impressionCard.current);
      }, 1000);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];

        if (impressionFired.current) {
          return;
        }

        if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
          isIntersecting = true;
          armTimer();
          return;
        }

        isIntersecting = false;
        clearTimer();
      },
      { threshold: [0, 0.5] }
    );
    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearTimer();
        return;
      }

      if (isIntersecting) {
        armTimer();
      }
    };

    observer.observe(node);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, onImpression]);

  useEffect(() => {
    const node = bodyRef.current;

    if (!node) {
      return;
    }

    const measure = () => {
      setBodyOverflows(node.scrollHeight > node.clientHeight + 1);
    };
    const frame = window.requestAnimationFrame(measure);

    const ResizeObserverCtor = globalThis.ResizeObserver;

    if (typeof ResizeObserverCtor === "function") {
      const observer = new ResizeObserverCtor(measure);
      observer.observe(node);

      return () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }

    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [card.id, card.shortBody, card.summary]);

  if (note) {
    return (
      <>
        <article className={`x-post x-connection-note${isFocused ? " focused" : ""}`} ref={postRef}>
          <span className="x-avatar agent" aria-hidden="true">
            {t("connection.avatar")}
          </span>
          <div className="x-post-main">
            <div className="x-head">
              <span className="x-name">{t("connection.title")}</span>
              <span className="x-derived">{t("post.derived")}</span>
              <span className="x-meta">·</span>
              <span className="x-meta">{formatRelativeTime(card.createdAt)}</span>
            </div>
            <div className="x-connection-body">
              {t("connection.body", {
                days: note.daysSinceOldCard,
                when: formatDaysAgo(note.daysSinceOldCard),
                oldTitle: note.oldPostTitle,
                newTitle: note.newPostTitle,
                evidence: note.evidence
              })}
            </div>
            <div className="x-connection-links">
              {dismissedPostIds?.has(note.oldPostId) ? null : (
                <button onClick={() => onOpenCardId(note.oldPostId)} type="button">
                  {t("connection.openOld", { title: note.oldPostTitle })}
                </button>
              )}
              <button onClick={() => onOpenCardId(note.newPostId)} type="button">
                {t("connection.openNew", { title: note.newPostTitle })}
              </button>
              {note.restorePostId && onRestorePost && dismissedPostIds?.has(note.restorePostId) ? (
                <button onClick={() => void onRestorePost(note.restorePostId ?? "")} type="button">
                  {t("connection.restore")}
                </button>
              ) : null}
            </div>
            <div className="x-acts">
              <button className="x-act" onClick={() => setShareOpen(true)} title={t("share.open")} type="button">
                <Share2 size={18} />
              </button>
              <button className="x-act" onClick={() => onSkip(card)} title={t("post.notInterested")} type="button">
                <XCircle size={18} />
              </button>
            </div>
          </div>
        </article>
        {shareOpen ? <ShareCardModal card={card} graph={graph} onClose={() => setShareOpen(false)} /> : null}
      </>
    );
  }

  return (
    <>
      {reviewDueAt ? (
        <div className="x-ctx">
          <span className="x-ctxicon">
            <RotateCcw size={15} />
          </span>
          {t("post.review")}
        </div>
      ) : reasonInfo && !isUserNote ? (
        <div className="x-ctx">
          <span className="x-ctxicon">
            <Plus size={15} />
          </span>
          <span className="x-ctxmain">
            <span className="x-ctxline">
              {t("post.recommend", { reason: reasonInfo.label })}
              {reasonInfo.beyondSource ? <span className="x-beyond">{t("post.beyondSource")}</span> : null}
              {reasonInfo.detail ? (
                <button
                  aria-expanded={reasonOpen}
                  className="x-ctxwhy"
                  onClick={() => setReasonOpen((open) => !open)}
                  type="button"
                >
                  {t("post.reasonWhy")}
                </button>
              ) : null}
            </span>
            {reasonOpen && reasonInfo.detail ? <span className="x-ctxdetail">{reasonInfo.detail}</span> : null}
          </span>
        </div>
      ) : null}
      <article
        className={`x-post${leadMedia?.url ? " has-media" : ""}${isFocused ? " focused" : ""}`}
        ref={postRef}
      >
        <span className={`x-avatar${isUserNote ? "" : " agent"}`} aria-hidden="true">
          {isUserNote ? t("common.you") : getAgentInitials(primaryConcept)}
        </span>
        <div className="x-post-main">
          <div className="x-head">
            <span className="x-name">
              {isUserNote
                ? t("post.userNote")
                : isConversation
                  ? (source?.author ?? t("post.conversation"))
                  : getAgentName(primaryConcept)}
            </span>
            {isSourceCertified ? (
              <BadgeCheck aria-label={t("post.hasSource")} className="x-verified" size={17} />
            ) : null}
            {isConversation ? <span className="x-conversation">{t("post.conversation")}</span> : null}
            {isDerivedContent ? <span className="x-derived">{t("post.derived")}</span> : null}
            <span className="x-meta">@{isUserNote ? "you" : slugConcept(primaryConcept)}</span>
            <span className="x-meta">·</span>
            <span className="x-meta">{formatRelativeTime(card.createdAt)}</span>
            <span className="x-meta">·</span>
            <span className="x-meta">
              {isUserNote ? t("post.note") : t("post.readMinutes", { count: card.estimatedReadMinutes })}
            </span>
          </div>

          <button className="x-open" onClick={() => onOpen(card)} type="button">
            {isUserNote ? null : <div className="x-title">{renderMathInText(card.title)}</div>}
            <div className="x-body x-body-clamp" ref={bodyRef}>
              {renderWithWikilinks(card.shortBody ?? card.summary, cards, { onOpenConcept, onOpenCardId })}
            </div>
            {bodyOverflows ? <span className="x-showmore">{t("post.showMore")}</span> : null}
          </button>

          {leadMedia?.url ? (
            <a
              className="x-media"
              href={resolveMediaUrl(leadMedia.url)}
              rel="noreferrer"
              target="_blank"
              title={leadMedia.caption}
            >
              <img alt={leadMedia.caption} loading="lazy" src={resolveMediaUrl(leadMedia.url)} />
            </a>
          ) : null}

          <div className="x-tags">
            {card.concepts.slice(0, 3).map((concept) => (
              <button className="x-tag" key={concept} onClick={() => onOpenConcept(concept)} type="button">
                #{concept.replace(/\s+/g, "")}
              </button>
            ))}
          </div>

          {quoteText && !isUserNote ? (
            <button className="x-quote" onClick={() => onOpen(card)} type="button">
              <span className="x-qhead">
                <span className="x-name">{isConversation ? t("post.conversationExcerpt") : t("post.originalSource")}</span>
                <span className="x-meta">· {source?.title ?? t("format.unknownSource")}</span>
              </span>
              <div className="x-qtext">“{renderMathInText(quoteText)}”</div>
            </button>
          ) : null}

          <div className="x-acts">
            <button
              aria-expanded={threadOpen}
              className={`x-act${threadOpen ? " on" : ""}`}
              onClick={() => setThreadOpen((open) => !open)}
              title={t("post.reply")}
              type="button"
            >
              <MessageCircle size={18} />
              {replyCount > 0 ? replyCount : null}
            </button>
            <button
              className="x-act repost"
              disabled={!topConnection}
              onClick={() => topConnection && onOpenCardId(topConnection.cardId)}
              title={
                topConnection
                  ? `${formatConnectionKind(topConnection.kind)} · ${topConnection.title}`
                  : t("post.link.none")
              }
              type="button"
            >
              <Repeat2 size={18} />
              {connections.length > 0 ? connections.length : null}
            </button>
            <button
              className={`x-act like${signal?.liked ? " on" : ""}`}
              onClick={() => onLike(card)}
              title={t("post.like")}
              type="button"
            >
              <Heart size={18} />
            </button>
            <button
              className={`x-act${signal?.saved ? " on" : ""}`}
              onClick={() => onSave(card)}
              title={t("post.save")}
              type="button"
            >
              <Bookmark size={18} />
            </button>
            <button className="x-act" onClick={() => setShareOpen(true)} title={t("share.open")} type="button">
              <Share2 size={18} />
            </button>
            <button className="x-act" onClick={() => onOpen(card)} title={t("post.reviewPlan")} type="button">
              <Clock size={18} />
              {reviewDueDays !== undefined ? t("post.reviewDays", { days: reviewDueDays }) : null}
            </button>
            {reviewDueAt && onReviewComplete ? (
              <button
                className="x-act review"
                onClick={() => onReviewComplete(card)}
                title={t("post.reviewCompleteTitle")}
                type="button"
              >
                <CheckCircle2 size={18} />
                {t("post.reviewComplete")}
              </button>
            ) : null}
            <button className="x-act" onClick={() => onSkip(card)} title={t("post.notInterested")} type="button">
              <XCircle size={18} />
            </button>
          </div>

          {threadOpen ? (
            <PostReplyThread
              card={card}
              cards={cards}
              onOpenCardId={onOpenCardId}
              onOpenConcept={onOpenConcept}
              onReply={onReply}
              wikilinkCandidates={wikilinkCandidates}
            />
          ) : null}
        </div>
      </article>
      {shareOpen ? <ShareCardModal card={card} graph={graph} onClose={() => setShareOpen(false)} /> : null}
    </>
  );
}
