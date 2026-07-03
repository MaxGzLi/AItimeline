import type { CardConnection, InteractionSignal, LearningFeedback, RankedKnowledgeCard } from "@aitimeline/core";
import {
  Bookmark,
  Brain,
  ChevronDown,
  CircleHelp,
  Heart,
  MessageCircle,
  Quote,
  Route,
  Sparkles,
  XCircle
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  formatCardSource,
  formatConnectionKind,
  formatDifficulty,
  formatFullTimestamp,
  formatLearningState,
  formatNextAction,
  formatRelativeTime,
  formatThreadKind,
  formatTrustState,
  getAgentInitials,
  getAgentName,
  getReadBlock,
  getTimelineThreadPreview,
  slugConcept
} from "../lib/format";

export function KnowledgeCardView({
  card,
  connections,
  feedback,
  isFocused,
  onDwell,
  onLike,
  onOpen,
  onOpenCardId,
  onOpenConcept,
  onSave,
  onSkip,
  signal
}: {
  card: RankedKnowledgeCard;
  connections: CardConnection[];
  feedback?: LearningFeedback;
  isFocused?: boolean;
  onDwell: (card: RankedKnowledgeCard, dwellTimeMs: number) => void;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpen: (card: RankedKnowledgeCard) => void;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onSave: (card: RankedKnowledgeCard) => void;
  onSkip: (card: RankedKnowledgeCard) => void;
  signal?: InteractionSignal;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const visibleSince = useRef<number | null>(null);
  const reportedDwellMs = useRef(0);
  const threadPreview = getTimelineThreadPreview(card);
  const [threadExpanded, setThreadExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const fullThread = card.thread ?? [];
  const visibleThread = threadExpanded ? fullThread : threadPreview;
  const canExpandThread = fullThread.length > threadPreview.length;
  const readBlock = getReadBlock(card);
  const learnPrompts = card.reviewPrompts?.slice(0, 2) ?? [];
  const topConnection = connections[0];
  const primaryConcept = card.concepts[0] ?? "知识";
  const source = card.sources[0];

  useEffect(() => {
    const node = cardRef.current;

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
      <article className="knowledge-card dismissed" ref={cardRef}>
        <div className="card-dismissed">
          <p>不感兴趣 —— 以后会少推这类卡片。</p>
          <button className="card-dismissed-undo" onClick={() => setDismissed(false)} type="button">
            撤销
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className={`knowledge-card${isFocused ? " focused" : ""}`} ref={cardRef}>
      <div className="post-avatar" aria-hidden="true">
        {getAgentInitials(primaryConcept)}
      </div>

      <div className="post-main">
        <div className="social-post-header">
          <div className="post-author-line">
            <strong>{getAgentName(primaryConcept)}</strong>
            <span>@{slugConcept(primaryConcept)}</span>
            <span title={formatFullTimestamp(card.createdAt)}>{formatRelativeTime(card.createdAt)}</span>
            <span>阅读 {card.estimatedReadMinutes} 分钟</span>
          </div>
          <div className="post-header-badges">
            <span className={`trust-badge ${card.trustState}`}>{formatTrustState(card.trustState)}</span>
            {card.difficulty ? <span>{formatDifficulty(card.difficulty)}</span> : null}
          </div>
        </div>

        <button className="post-open-button" onClick={() => onOpen(card)} type="button">
          <h2>{card.title}</h2>
          {card.hook ? <p className="post-hook">{card.hook}</p> : null}
          <p className="summary">{card.shortBody ?? card.summary}</p>
        </button>

        {card.thesis || readBlock.body ? (
          <button className="post-claim-card" onClick={() => onOpen(card)} type="button">
            <span>
              <Sparkles size={15} />
              智能体观点
            </span>
            <p>{card.thesis ?? readBlock.body}</p>
          </button>
        ) : null}

        <div className={`social-thread-preview${threadExpanded ? " expanded" : ""}`}>
          {visibleThread.map((block) => (
            <button className="social-thread-reply" key={block.id} onClick={() => onOpen(card)} type="button">
              <div className="reply-avatar">{formatThreadKind(block.kind).slice(0, 2)}</div>
              <div>
                <span>{formatThreadKind(block.kind)}</span>
                <strong>{block.title}</strong>
                <p>{block.body}</p>
              </div>
            </button>
          ))}
          {canExpandThread ? (
            <button
              aria-expanded={threadExpanded}
              className="thread-count-button"
              onClick={() => setThreadExpanded((value) => !value)}
              type="button"
            >
              <ChevronDown className={`thread-chevron${threadExpanded ? " open" : ""}`} size={16} />
              <span>{threadExpanded ? "收起" : `展开这条 · ${fullThread.length} 条回应`}</span>
            </button>
          ) : (
            <button className="thread-count-button" onClick={() => onOpen(card)} type="button">
              <MessageCircle size={16} />
              <span>
                展开卡片 · {fullThread.length} 条回应 · {card.reviewPrompts?.length ?? 0} 个小测
              </span>
            </button>
          )}
        </div>

        {learnPrompts.length > 0 || topConnection ? (
          <div className="feed-prompt-row">
            {learnPrompts[0] ? (
              <button className="feed-prompt" onClick={() => onSave(card)} type="button">
                <Brain size={16} />
                <span>复习</span>
                <strong>{learnPrompts[0].prompt}</strong>
              </button>
            ) : null}
            {topConnection ? (
              <button
                className="feed-prompt"
                onClick={() => onOpenCardId(topConnection.cardId)}
                title={`${formatConnectionKind(topConnection.kind)} · 通过「${topConnection.concept}」`}
                type="button"
              >
                <Route size={16} />
                <span>{formatConnectionKind(topConnection.kind)}</span>
                <strong>{topConnection.title}</strong>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="post-social-context">
          <span>为你推荐:{card.recommendedBecause}</span>
          <span>{formatCardSource(card)}</span>
          {source?.author ? <span>{source.author}</span> : null}
        </div>

        {feedback ? (
          <div className={`feedback-strip ${feedback.inferredState}`}>
            <span>{formatLearningState(feedback.inferredState)}</span>
            <strong>{formatNextAction(feedback.nextAction)}</strong>
          </div>
        ) : null}

        {card.scoreReasons.length > 0 ? (
          <div className="recommendation-reasons" aria-label="推荐理由">
            {card.scoreReasons.slice(0, 3).map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
        ) : null}

        <div className="concept-list">
          {card.concepts.slice(0, 3).map((concept) => (
            <button
              className="concept-chip"
              key={concept}
              onClick={() => onOpenConcept(concept)}
              title={`查看「${concept}」的全部碎片`}
              type="button"
            >
              {concept}
            </button>
          ))}
          {card.concepts.length > 3 ? <span>+{card.concepts.length - 3}</span> : null}
        </div>

        <footer className="card-footer">
          <div className="social-metrics">
            <span>{Math.max(12, Math.round(card.score))} 有用</span>
            <span>{card.thread?.length ?? 0} 条回应</span>
            <span>{card.reviewPrompts?.length ?? 0} 个小测</span>
          </div>
          <div className="card-actions">
            <button className={`icon-button compact ${signal?.liked ? "selected" : ""}`} onClick={() => onLike(card)} title="点赞">
              <Heart size={18} />
            </button>
            <button className={`icon-button compact ${signal?.saved ? "selected" : ""}`} onClick={() => onSave(card)} title="收藏">
              <Bookmark size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="问 AI">
              <MessageCircle size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="查看来源">
              <Quote size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="讲解">
              <CircleHelp size={18} />
            </button>
            <button
              className={`icon-button compact ${signal?.skippedQuickly ? "negative" : ""}`}
              onClick={() => {
                onSkip(card);
                setDismissed(true);
              }}
              title="不感兴趣"
            >
              <XCircle size={18} />
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}
