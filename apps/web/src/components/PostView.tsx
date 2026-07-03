import type { CardConnection, InteractionSignal, RankedKnowledgeCard } from "@aitimeline/core";
import { BadgeCheck, Bookmark, Clock, Heart, MessageCircle, Plus, Repeat2, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatConnectionKind, formatRelativeTime, getAgentInitials, getAgentName, slugConcept } from "../lib/format";

export function PostView({
  card,
  connections,
  isFocused,
  onDwell,
  onLike,
  onOpen,
  onOpenCardId,
  onOpenConcept,
  onReply,
  onSave,
  onSkip,
  quoteText,
  signal
}: {
  card: RankedKnowledgeCard;
  connections: CardConnection[];
  isFocused?: boolean;
  onDwell: (card: RankedKnowledgeCard, dwellTimeMs: number) => void;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpen: (card: RankedKnowledgeCard) => void;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onReply: (card: RankedKnowledgeCard, text: string) => Promise<void>;
  onSave: (card: RankedKnowledgeCard) => void;
  onSkip: (card: RankedKnowledgeCard) => void;
  quoteText?: string;
  signal?: InteractionSignal;
}) {
  const postRef = useRef<HTMLElement | null>(null);
  const visibleSince = useRef<number | null>(null);
  const reportedDwellMs = useRef(0);
  const [dismissed, setDismissed] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const primaryConcept = card.concepts[0] ?? "知识";
  const source = card.sources[0];
  const isUserNote = source?.type === "user_note";
  const topConnection = connections[0];
  // The in-post thread shows only the public comment blocks; knowledge blocks
  // (explain/example/…) stay in the detail drawer.
  const commentBlocks = (card.thread ?? []).filter(
    (block) => block.kind === "user_comment" || block.kind === "agent_reply"
  );
  const replyCount = commentBlocks.length;
  const reviewDueDays = card.reviewPrompts?.[0]?.dueInDays;

  async function handleReplySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = replyText.trim();

    if (!text || sending) {
      return;
    }

    setSending(true);
    setReplyError(null);

    try {
      await onReply(card, text);
      setReplyText("");
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "回复失败,请稍后再试。");
    } finally {
      setSending(false);
    }
  }

  // Viewport dwell tracking: report when the post has been ≥60% visible long
  // enough, so ranking learns from real reading instead of impressions.
  useEffect(() => {
    const node = postRef.current;

    if (!node || !("IntersectionObserver" in window)) {
      return;
    }

    const flushDwell = () => {
      if (visibleSince.current === null) {
        return;
      }

      const dwellTimeMs = Math.round(performance.now() - visibleSince.current);
      visibleSince.current = null;

      if (dwellTimeMs >= 1200 && dwellTimeMs > reportedDwellMs.current + 800) {
        reportedDwellMs.current = dwellTimeMs;
        onDwell(card, dwellTimeMs);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.6) {
          visibleSince.current ??= performance.now();
          return;
        }

        flushDwell();
      },
      { threshold: [0, 0.6, 1] }
    );
    const interval = window.setInterval(() => {
      if (visibleSince.current === null) {
        return;
      }

      const dwellTimeMs = Math.round(performance.now() - visibleSince.current);

      if (dwellTimeMs >= 9000 && dwellTimeMs > reportedDwellMs.current + 3500) {
        reportedDwellMs.current = dwellTimeMs;
        onDwell(card, dwellTimeMs);
      }
    }, 3000);

    observer.observe(node);

    return () => {
      window.clearInterval(interval);
      flushDwell();
      observer.disconnect();
    };
  }, [card, onDwell]);

  if (dismissed) {
    return (
      <div className="x-dismissed">
        <span>不感兴趣 —— 以后会少推这类内容。</span>
        <button onClick={() => setDismissed(false)} type="button">
          撤销
        </button>
      </div>
    );
  }

  return (
    <>
      {card.recommendedBecause && !isUserNote ? (
        <div className="x-ctx">
          <span className="x-ctxicon">
            <Plus size={15} />
          </span>
          为你推荐 · {card.recommendedBecause}
        </div>
      ) : null}
      <article className={`x-post${isFocused ? " focused" : ""}`} ref={postRef}>
        <span className={`x-avatar${isUserNote ? "" : " agent"}`} aria-hidden="true">
          {isUserNote ? "你" : getAgentInitials(primaryConcept)}
        </span>
        <div className="x-post-main">
          <div className="x-head">
            <span className="x-name">{isUserNote ? "你的笔记" : getAgentName(primaryConcept)}</span>
            {isUserNote ? null : <BadgeCheck aria-label="有出处" className="x-verified" size={17} />}
            <span className="x-meta">@{isUserNote ? "you" : slugConcept(primaryConcept)}</span>
            <span className="x-meta">·</span>
            <span className="x-meta">{formatRelativeTime(card.createdAt)}</span>
            <span className="x-meta">·</span>
            <span className="x-meta">{isUserNote ? "笔记" : `${card.estimatedReadMinutes} 分钟读完`}</span>
          </div>

          <button className="x-open" onClick={() => onOpen(card)} type="button">
            {isUserNote ? null : <p className="x-title">{card.title}</p>}
            <p className="x-body">{card.shortBody ?? card.summary}</p>
          </button>

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
                <span className="x-name">原文出处</span>
                <span className="x-meta">· {source?.title ?? "未知来源"}</span>
              </span>
              <p className="x-qtext">“{quoteText}”</p>
            </button>
          ) : null}

          <div className="x-acts">
            <button
              aria-expanded={threadOpen}
              className={`x-act${threadOpen ? " on" : ""}`}
              onClick={() => setThreadOpen((open) => !open)}
              title="回复"
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
                  : "还没有关联卡片"
              }
              type="button"
            >
              <Repeat2 size={18} />
              {connections.length > 0 ? connections.length : null}
            </button>
            <button
              className={`x-act like${signal?.liked ? " on" : ""}`}
              onClick={() => onLike(card)}
              title="赞"
              type="button"
            >
              <Heart size={18} />
            </button>
            <button
              className={`x-act${signal?.saved ? " on" : ""}`}
              onClick={() => onSave(card)}
              title="收藏"
              type="button"
            >
              <Bookmark size={18} />
            </button>
            <button className="x-act" onClick={() => onOpen(card)} title="复习计划" type="button">
              <Clock size={18} />
              {reviewDueDays !== undefined ? `${reviewDueDays} 天` : null}
            </button>
            <button
              className="x-act"
              onClick={() => {
                onSkip(card);
                setDismissed(true);
              }}
              title="不感兴趣"
              type="button"
            >
              <XCircle size={18} />
            </button>
          </div>

          {threadOpen ? (
            <div className="x-replies" aria-label="评论线程">
              {commentBlocks.map((block) => {
                const isAgent = block.kind === "agent_reply";

                return (
                  <div className="x-reply" key={block.id}>
                    <span className={`x-avatar x-reply-avatar${isAgent ? " agent" : ""}`} aria-hidden="true">
                      {isAgent ? "AI" : "你"}
                    </span>
                    <div className="x-reply-main">
                      <div className="x-head">
                        <span className="x-name">{block.title}</span>
                        {isAgent ? <BadgeCheck aria-label="有出处" className="x-verified" size={15} /> : null}
                      </div>
                      <p className="x-body">{block.body}</p>
                    </div>
                  </div>
                );
              })}

              <form className="x-reply-form" onSubmit={handleReplySubmit}>
                <span className="x-avatar x-reply-avatar" aria-hidden="true">
                  你
                </span>
                <input
                  aria-label="回复"
                  className="x-reply-input"
                  disabled={sending}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="回复…"
                  value={replyText}
                />
                <button className="x-pill" disabled={sending || !replyText.trim()} type="submit">
                  {sending ? "发送中" : "发送"}
                </button>
              </form>

              {replyError ? <p className="x-reply-error">{replyError}</p> : null}
            </div>
          ) : null}
        </div>
      </article>
    </>
  );
}
