import type {
  Backlink,
  CardConnection,
  InteractionSignal,
  KnowledgeCard,
  KnowledgeChunk,
  LearningFeedback,
  RankedKnowledgeCard,
  SourceAsset
} from "@aitimeline/core";
import {
  BadgeCheck,
  Bookmark,
  Brain,
  CheckCircle2,
  FileText,
  GitBranch,
  GraduationCap,
  Heart,
  Link2,
  ListChecks,
  MessageCircle,
  Quote,
  Repeat2,
  Route,
  Send,
  Sparkles
} from "lucide-react";
import type { FormEvent } from "react";
import {
  buildTimestampUrl,
  formatConnectionKind,
  formatEdgeRelation,
  formatEvidenceFieldPath,
  formatFullTimestamp,
  formatGroundingStatus,
  formatLearningState,
  formatNextAction,
  formatReviewPromptKind,
  formatSignalChips,
  formatThreadKind,
  formatTimestamp,
  getAgentInitials,
  getAgentName,
  slugConcept
} from "../lib/format";
import type { AiMessage, EvidenceLedger } from "../lib/types";
import { renderWithWikilinks } from "../lib/wikilinks";
import { PostReplyThread } from "./PostReplyThread";
import type { WikilinkAutocompleteCandidate } from "./WikilinkAutocomplete";

export function PostDetailView({
  asset,
  backlinks,
  card,
  cards,
  chunks,
  connections,
  evidenceLedger,
  feedback,
  messages,
  onAsk,
  onLike,
  onOpenCardId,
  onOpenConcept,
  onPromptChange,
  onReply,
  onSave,
  prompt,
  quoteText,
  signal,
  wikilinkCandidates
}: {
  asset?: SourceAsset;
  backlinks: Backlink[];
  card: RankedKnowledgeCard;
  cards: KnowledgeCard[];
  chunks: KnowledgeChunk[];
  connections: CardConnection[];
  evidenceLedger?: EvidenceLedger | null;
  feedback?: LearningFeedback;
  messages: AiMessage[];
  onAsk: (event: FormEvent<HTMLFormElement>) => void;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onPromptChange: (value: string) => void;
  onReply: (card: RankedKnowledgeCard, text: string) => Promise<void>;
  onSave: (card: RankedKnowledgeCard) => void;
  prompt: string;
  quoteText?: string;
  signal?: InteractionSignal;
  wikilinkCandidates: WikilinkAutocompleteCandidate[];
}) {
  const handlers = { onOpenConcept, onOpenCardId };
  const citation = card.citations?.[0];
  const source = card.sources[0];
  const primaryConcept = card.concepts[0] ?? "知识";
  const isUserNote = source?.type === "user_note";
  const commentCount =
    card.thread?.filter((block) => block.kind === "user_comment" || block.kind === "agent_reply").length ?? 0;
  const knowledgeBlocks = (card.thread ?? []).filter(
    (block) => block.kind !== "user_comment" && block.kind !== "agent_reply"
  );
  const sourceQuote = quoteText ?? chunks[0]?.content ?? asset?.content;
  const topConnection = connections[0];

  return (
    <article className="x-detail">
      <section className="x-detail-post">
        <span className={`x-avatar${isUserNote ? "" : " agent"}`} aria-hidden="true">
          {isUserNote ? "你" : getAgentInitials(primaryConcept)}
        </span>
        <div className="x-detail-main">
          <div className="x-head">
            <span className="x-name">{isUserNote ? "你的笔记" : getAgentName(primaryConcept)}</span>
            {isUserNote ? null : <BadgeCheck aria-label="有出处" className="x-verified" size={17} />}
            <span className="x-meta">@{isUserNote ? "you" : slugConcept(primaryConcept)}</span>
          </div>

          {isUserNote ? null : <h2 className="x-detail-title">{card.title}</h2>}
          <p className="x-detail-body">{renderWithWikilinks(card.summary, cards, handlers)}</p>

          <div className="x-tags x-detail-tags">
            {card.concepts.map((concept) => (
              <button className="x-tag" key={concept} onClick={() => onOpenConcept(concept)} type="button">
                #{concept.replace(/\s+/g, "")}
              </button>
            ))}
          </div>

          <div className="x-detail-quote">
            <div className="x-detail-quote-head">
              <Quote size={17} />
              <span className="x-name">原文出处</span>
              <span className="x-meta">· {source?.title ?? "未知来源"}</span>
            </div>
            {citation?.startTimeSeconds !== undefined ? (
              <a className="x-detail-time" href={buildTimestampUrl(source?.url, citation.startTimeSeconds)}>
                {formatTimestamp(citation.startTimeSeconds)}-
                {formatTimestamp(citation.endTimeSeconds ?? citation.startTimeSeconds)}
              </a>
            ) : null}
            <p>{sourceQuote ?? "这张示例卡片还没有导入转录文本。"}</p>
          </div>

          <div className="x-detail-meta">
            <time dateTime={card.createdAt}>{formatFullTimestamp(card.createdAt)}</time>
            <span>·</span>
            <span>{card.estimatedReadMinutes} 分钟读完</span>
          </div>

          <div className="x-detail-acts">
            <button
              className="x-act"
              onClick={() => document.querySelector<HTMLInputElement>(".x-detail-replies input")?.focus()}
              title="评论"
              type="button"
            >
              <MessageCircle size={19} />
              {commentCount > 0 ? commentCount : null}
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
              <Repeat2 size={19} />
              {connections.length > 0 ? connections.length : null}
            </button>
            <button
              className={`x-act like${signal?.liked ? " on" : ""}`}
              onClick={() => onLike(card)}
              title="赞"
              type="button"
            >
              <Heart size={19} />
            </button>
            <button
              className={`x-act${signal?.saved ? " on" : ""}`}
              onClick={() => onSave(card)}
              title="收藏"
              type="button"
            >
              <Bookmark size={19} />
            </button>
          </div>
        </div>
      </section>

      <PostReplyThread
        card={card}
        cards={cards}
        className="x-detail-replies"
        emptyMessage="还没有评论。"
        onOpenCardId={onOpenCardId}
        onOpenConcept={onOpenConcept}
        onReply={onReply}
        wikilinkCandidates={wikilinkCandidates}
      />

      <section className="x-detail-sec">
        <div className="x-detail-sechead">
          <GraduationCap size={18} />
          <h3>问 AI</h3>
        </div>
        <div className="x-detail-chat" aria-label="问 AI 对话">
          {messages.length > 0 ? (
            messages.map((message) => (
              <div className={`x-detail-msg ${message.role}`} key={message.id}>
                <span className={`x-avatar x-reply-avatar${message.role === "assistant" ? " agent" : ""}`}>
                  {message.role === "assistant" ? "AI" : "你"}
                </span>
                <div className="x-detail-msg-main">
                  <div className="x-head">
                    <span className="x-name">{message.role === "assistant" ? "AITimeline" : "你"}</span>
                    {message.role === "assistant" ? (
                      <BadgeCheck aria-label="有出处" className="x-verified" size={15} />
                    ) : null}
                  </div>
                  <p>{renderWithWikilinks(message.content, cards, handlers)}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="x-muted-copy">问问它和你的记忆、图谱或复习队列怎么连起来。</p>
          )}
        </div>

        <form className="x-detail-ask" onSubmit={onAsk}>
          <input
            aria-label="就这张卡片问 AI"
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="就这个来源提问"
            value={prompt}
          />
          <button className="x-iconbtn" title="发送问题" type="submit">
            <Send size={18} />
          </button>
        </form>
      </section>

      <section className="x-detail-sec">
        <div className="x-detail-sechead">
          <Sparkles size={18} />
          <h3>智能体要点</h3>
        </div>
        <p>{renderWithWikilinks(card.keyTakeaway, cards, handlers)}</p>
      </section>

      {knowledgeBlocks.length ? (
        <section className="x-detail-sec">
          <div className="x-detail-sechead">
            <MessageCircle size={18} />
            <h3>知识块</h3>
          </div>
          <div className="x-detail-blocks">
            {knowledgeBlocks.map((block) => (
              <div className="x-detail-block" key={block.id}>
                <span>{formatThreadKind(block.kind)}</span>
                <h4>{block.title}</h4>
                <p>{renderWithWikilinks(block.body, cards, handlers)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="x-detail-sec">
        <div className="x-detail-sechead">
          <FileText size={18} />
          <h3>来源片段</h3>
        </div>
        <div className="x-detail-chunks">
          {chunks.length > 0 ? (
            chunks.map((chunk) => (
              <div className="x-detail-chunk" key={chunk.id}>
                <span>{formatTimestamp(chunk.startTimeSeconds ?? 0)}</span>
                <p>{chunk.content}</p>
              </div>
            ))
          ) : (
            <p className="x-muted-copy">{asset?.content ?? "这张示例卡片还没有导入转录文本。"}</p>
          )}
        </div>
      </section>

      {card.graphEdges?.length ? (
        <section className="x-detail-sec">
          <div className="x-detail-sechead">
            <Route size={18} />
            <h3>图谱关系</h3>
          </div>
          <div className="x-detail-edges">
            {card.graphEdges.map((edge) => (
              <div className="x-detail-edge" key={edge.id}>
                <strong>
                  {edge.sourceConcept} → {edge.targetConcept}
                </strong>
                <span>{formatEdgeRelation(edge.relation)}</span>
                <p>{edge.evidence}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {card.reviewPrompts?.length || card.nextActions?.length ? (
        <section className="x-detail-sec">
          <div className="x-detail-sechead">
            <ListChecks size={18} />
            <h3>复习与下一步</h3>
          </div>
          <div className="x-detail-prompts">
            {card.reviewPrompts?.map((reviewPrompt) => (
              <div className="x-detail-prompt" key={reviewPrompt.id}>
                <span>
                  {formatReviewPromptKind(reviewPrompt.kind)} · {reviewPrompt.dueInDays} 天后
                </span>
                <p>{reviewPrompt.prompt}</p>
                <small>{reviewPrompt.answerHint}</small>
              </div>
            ))}
          </div>
          {card.nextActions?.length ? (
            <div className="x-detail-next">
              {card.nextActions.map((action) => (
                <span key={action}>{formatNextAction(action)}</span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <EvidenceLedgerPanel ledger={evidenceLedger} />

      <section className="x-detail-sec">
        <div className="x-detail-sechead">
          <Brain size={18} />
          <h3>反馈闭环</h3>
        </div>
        {feedback ? (
          <div className={`x-detail-fb ${feedback.inferredState}`}>
            <div className="x-detail-fbtop">
              <span>{formatLearningState(feedback.inferredState)}</span>
              <strong>{formatNextAction(feedback.nextAction)}</strong>
            </div>
            <p>{feedback.reason}</p>
            <small>信号强度 {feedback.signalStrength}</small>
          </div>
        ) : (
          <p className="x-muted-copy">展开、点赞、收藏、追问或划走这张卡,都会生成反馈。</p>
        )}
        {signal ? (
          <div className="x-detail-signals">
            {formatSignalChips(signal).map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        ) : null}
      </section>

      {connections.length > 0 ? (
        <section className="x-detail-sec">
          <div className="x-detail-sechead">
            <GitBranch size={18} />
            <h3>关联</h3>
          </div>
          <p className="x-muted-copy">这张碎片和你收集过的卡片怎么连起来。</p>
          <div className="x-detail-conns">
            {connections.map((connection) => (
              <button
                className="x-detail-conn"
                key={`${connection.kind}-${connection.cardId}`}
                onClick={() => onOpenCardId(connection.cardId)}
                title={`打开「${connection.title}」`}
                type="button"
              >
                <span className="x-detail-connkind">{formatConnectionKind(connection.kind)}</span>
                <strong>{connection.title}</strong>
                <small>通过「{connection.concept}」</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {backlinks.length > 0 ? (
        <section className="x-detail-sec">
          <div className="x-detail-sechead">
            <Link2 size={18} />
            <h3>反向链接</h3>
          </div>
          <p className="x-muted-copy">哪些笔记和评论用 [[…]] 提到了这张卡或它的概念。</p>
          <div className="x-backlinks">
            {backlinks.map((backlink) => (
              <button
                className="x-backlink"
                key={`${backlink.fromPostId}-${backlink.snippet}`}
                onClick={() => onOpenCardId(backlink.fromPostId)}
                title={`打开「${backlink.fromTitle}」`}
                type="button"
              >
                <span className="x-backlink-from">{backlink.fromTitle}</span>
                <span className="x-backlink-snip">{backlink.snippet}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function EvidenceLedgerPanel({ ledger }: { ledger?: EvidenceLedger | null }) {
  return (
    <section className="x-detail-sec x-detail-ev">
      <div className="x-detail-sechead">
        <CheckCircle2 size={18} />
        <h3>证据账本</h3>
      </div>

      {ledger === undefined ? (
        <p className="x-muted-copy">正在核对来源依据……</p>
      ) : ledger === null ? (
        <p className="x-muted-copy">这张卡片暂时还没有证据账本。</p>
      ) : (
        <>
          <div className="x-ev-summary">
            <span className="x-ev-stat passed">{ledger.summary.passed} 通过</span>
            <span className="x-ev-stat warning">{ledger.summary.warnings} 警告</span>
            <span className="x-ev-stat failed">{ledger.summary.failed} 失败</span>
          </div>
          <div className="x-ev-meta">
            <span>{ledger.summary.citedSources} 个来源</span>
            <span>{ledger.summary.citedChunks} 个片段</span>
            <span>{ledger.summary.totalClaims} 条主张</span>
          </div>
          <div className="x-ev-claims">
            {ledger.claims.slice(0, 5).map((claim) => (
              <div className={`x-ev-claim ${claim.status}`} key={claim.id}>
                <div className="x-ev-claimtop">
                  <span>{formatEvidenceFieldPath(claim.fieldPath)}</span>
                  <strong>{formatGroundingStatus(claim.status)}</strong>
                </div>
                <p>{claim.claim}</p>
                {claim.evidence[0] ? (
                  <small>
                    {claim.evidence[0].sourceTitle} · 重叠 {Math.round(claim.evidence[0].overlapScore * 100)}%
                  </small>
                ) : (
                  <small>没有匹配到来源片段</small>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
