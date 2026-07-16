import type {
  Backlink,
  CardConnection,
  InteractionSignal,
  KnowledgeCard,
  KnowledgeChunk,
  LearningFeedback,
  LinkedKnowledgeGraph,
  RankedKnowledgeCard,
  SourceAsset
} from "@aitimeline/core";
import {
  BadgeCheck,
  Bookmark,
  Brain,
  CheckCircle2,
  ExternalLink,
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
  Share2,
  Sparkles
} from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
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
import { getCardMedia, resolveMediaUrl } from "../lib/api";
import { t } from "../lib/i18n";
import { renderMathInText } from "../lib/math";
import type { AiMessage, EvidenceLedger } from "../lib/types";
import { renderWithWikilinks } from "../lib/wikilinks";
import { PostReplyThread } from "./PostReplyThread";
import { ShareCardModal } from "./ShareCardModal";
import type { WikilinkAutocompleteCandidate } from "./WikilinkAutocomplete";

export function PostDetailView({
  asset,
  backlinks,
  card,
  cards,
  chunks,
  connections,
  evidenceError,
  evidenceLedger,
  feedback,
  graph,
  messages,
  onAsk,
  onAskThreadBlock,
  onLike,
  onOpenCardId,
  onOpenConcept,
  onPromptChange,
  onReply,
  onRetryEvidence,
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
  evidenceError?: boolean;
  evidenceLedger?: EvidenceLedger | null;
  feedback?: LearningFeedback;
  graph?: LinkedKnowledgeGraph;
  messages: AiMessage[];
  onAsk: (event: FormEvent<HTMLFormElement>) => void;
  onAskThreadBlock: (text: string) => void;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onPromptChange: (value: string) => void;
  onReply: (card: RankedKnowledgeCard, text: string) => Promise<void>;
  onRetryEvidence?: () => void;
  onSave: (card: RankedKnowledgeCard) => void;
  prompt: string;
  quoteText?: string;
  signal?: InteractionSignal;
  wikilinkCandidates: WikilinkAutocompleteCandidate[];
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const [showAllChunks, setShowAllChunks] = useState(false);
  const handlers = { onOpenConcept, onOpenCardId };
  const citation = card.citations?.[0];
  const source = card.sources[0];
  const primaryConcept = card.concepts[0] ?? t("common.concept");
  const isUserNote = source?.type === "user_note";
  const isConversation = source?.type === "conversation";
  const commentCount =
    card.thread?.filter((block) => block.kind === "user_comment" || block.kind === "agent_reply").length ?? 0;
  const knowledgeBlocks = (card.thread ?? [])
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.kind !== "user_comment" && block.kind !== "agent_reply");
  const sourceQuote = quoteText ?? chunks[0]?.content ?? asset?.content;
  const cardMedia = getCardMedia(card);
  const topConnection = connections[0];

  return (
    <article className="x-detail">
      <section className="x-detail-post">
        <span className={`x-avatar${isUserNote ? "" : " agent"}`} aria-hidden="true">
          {isUserNote ? t("common.you") : getAgentInitials(primaryConcept)}
        </span>
        <div className="x-detail-main">
          <div className="x-head">
            <span className="x-name">
              {isUserNote
                ? t("post.userNote")
                : isConversation
                  ? (source?.author ?? t("post.conversation"))
                  : getAgentName(primaryConcept)}
            </span>
            {isUserNote || isConversation ? null : (
              <BadgeCheck aria-label={t("post.hasSource")} className="x-verified" size={17} />
            )}
            {isConversation ? <span className="x-conversation">{t("post.conversation")}</span> : null}
            <span className="x-meta">@{isUserNote ? "you" : slugConcept(primaryConcept)}</span>
          </div>

          {isUserNote ? null : (
            <div className="x-detail-title" role="heading" aria-level={2}>
              {renderMathInText(card.title)}
            </div>
          )}
          <div className="x-detail-body">{renderWithWikilinks(card.summary, cards, handlers)}</div>

          {cardMedia.length ? (
            <div className="x-detail-media">
              {cardMedia.map((item) => {
                const mediaUrl = resolveMediaUrl(item.url ?? "");
                const captionText =
                  item.figureLabel && item.caption.toLowerCase().startsWith(item.figureLabel.toLowerCase())
                    ? item.caption.slice(item.figureLabel.length).replace(/^[:.\s]+/, "")
                    : item.caption;

                return (
                  <figure className="x-mediafig" key={item.assetId}>
                    <a href={mediaUrl} rel="noreferrer" target="_blank">
                      <img alt={item.caption} loading="lazy" src={mediaUrl} />
                    </a>
                    <figcaption>
                      <span className="x-mediatag">
                        {item.origin === "derived"
                          ? t("detail.derivedImage")
                          : item.figureLabel
                            ? t("detail.figureSource", { label: item.figureLabel })
                            : t("detail.figureSourceNoLabel")}
                      </span>
                      {captionText}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          ) : null}

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
              <span className="x-name">{isConversation ? t("detail.conversationQuote") : t("detail.sourceQuote")}</span>
              {isExternalSourceUrl(source?.url) ? (
                <a
                  className="x-meta x-srclink"
                  href={source?.url}
                  rel="noreferrer noopener"
                  target="_blank"
                  title={t("detail.openSource")}
                >
                  · {source?.title ?? t("format.unknownSource")}
                  <ExternalLink size={13} />
                </a>
              ) : (
                <span className="x-meta">
                  · {source?.title ?? t("format.unknownSource")}
                  {isConversation && source?.author ? ` · ${source.author}` : ""}
                </span>
              )}
            </div>
            {source?.type === "youtube" && citation?.startTimeSeconds !== undefined ? (
              <a className="x-detail-time" href={buildTimestampUrl(source?.url, citation.startTimeSeconds)}>
                {formatTimestamp(citation.startTimeSeconds)}-
                {formatTimestamp(citation.endTimeSeconds ?? citation.startTimeSeconds)}
              </a>
            ) : null}
            <div className="x-detail-quote-text">
              {renderMathInText(sourceQuote ?? t("detail.noTranscript"))}
            </div>
          </div>

          <div className="x-detail-meta">
            <time dateTime={card.createdAt}>{formatFullTimestamp(card.createdAt)}</time>
            <span>·</span>
            <span>{t("detail.readMinutes", { count: card.estimatedReadMinutes })}</span>
          </div>

          <div className="x-detail-acts">
            <button
              className="x-act"
              onClick={() => document.querySelector<HTMLInputElement>(".x-detail-replies input")?.focus()}
              title={t("detail.comments")}
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
                  : t("post.link.none")
              }
              type="button"
            >
              <Repeat2 size={19} />
              {connections.length > 0 ? connections.length : null}
            </button>
            <button
              className={`x-act like${signal?.liked ? " on" : ""}`}
              onClick={() => onLike(card)}
              title={t("post.like")}
              type="button"
            >
              <Heart size={19} />
            </button>
            <button
              className={`x-act${signal?.saved ? " on" : ""}`}
              onClick={() => onSave(card)}
              title={t("post.save")}
              type="button"
            >
              <Bookmark size={19} />
            </button>
            <button className="x-act" onClick={() => setShareOpen(true)} title={t("share.open")} type="button">
              <Share2 size={19} />
            </button>
          </div>
        </div>
      </section>

      <PostReplyThread
        card={card}
        cards={cards}
        className="x-detail-replies"
        emptyMessage={t("reply.empty")}
        onOpenCardId={onOpenCardId}
        onOpenConcept={onOpenConcept}
        onReply={onReply}
        wikilinkCandidates={wikilinkCandidates}
      />

      <section className="x-detail-sec">
        <div className="x-detail-sechead">
          <GraduationCap size={18} />
          <h3>{t("detail.ai")}</h3>
        </div>
        <div className="x-detail-chat" aria-label={t("detail.aiDialog")}>
          {messages.length > 0 ? (
            messages.map((message) => (
              <div className={`x-detail-msg ${message.role}`} key={message.id}>
                <span className={`x-avatar x-reply-avatar${message.role === "assistant" ? " agent" : ""}`}>
                  {message.role === "assistant" ? t("common.ai") : t("common.you")}
                </span>
                <div className="x-detail-msg-main">
                  <div className="x-head">
                    <span className="x-name">{message.role === "assistant" ? "AITimeline" : t("common.you")}</span>
                    {message.role === "assistant" ? (
                      <BadgeCheck aria-label={t("post.hasSource")} className="x-verified" size={15} />
                    ) : null}
                  </div>
                  <div className="x-detail-msg-text">{renderWithWikilinks(message.content, cards, handlers)}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="x-muted-copy">{t("detail.askHint")}</p>
          )}
        </div>

        <form className="x-detail-ask" onSubmit={onAsk}>
          <input
            aria-label={t("detail.aiPrompt")}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={t("detail.aiPromptPlaceholder")}
            value={prompt}
          />
          <button className="x-iconbtn" title={t("detail.sendQuestion")} type="submit">
            <Send size={18} />
          </button>
        </form>
      </section>

      <section className="x-detail-sec">
        <div className="x-detail-sechead">
          <Sparkles size={18} />
          <h3>{t("detail.agentTakeaway")}</h3>
        </div>
        <div className="x-detail-sec-text">{renderWithWikilinks(card.keyTakeaway, cards, handlers)}</div>
      </section>

      {knowledgeBlocks.length ? (
        <section className="x-detail-sec">
          <div className="x-detail-sechead">
            <MessageCircle size={18} />
            <h3>{t("detail.threadBlocks")}</h3>
          </div>
          <div className="x-detail-blocks">
            {knowledgeBlocks.map(({ block, index }) => {
              const claim = evidenceLedger?.claims.find((item) => item.fieldPath === `$.thread[${index}].body`);
              const badgeStatus = claim?.status === "passed" ? "passed" : claim ? "warning" : undefined;

              return (
                <div className="x-detail-block" key={block.id}>
                  <div className="x-detail-blocktop">
                    <span>{formatThreadKind(block.kind)}</span>
                    {badgeStatus ? (
                      <button
                        className={`x-grounding-badge ${badgeStatus}`}
                        onClick={() => {
                          document.getElementById(`evidence-${claim?.id}`)?.scrollIntoView({
                            block: "center",
                            behavior: "smooth"
                          });
                        }}
                        type="button"
                      >
                        {badgeStatus === "passed" ? t("detail.sourceGrounded") : t("detail.beyondSource")}
                      </button>
                    ) : null}
                  </div>
                  <h4>{block.title}</h4>
                  <div className="x-detail-block-body">{renderWithWikilinks(block.body, cards, handlers)}</div>
                  {block.kind === "extension" ? (
                    <button className="x-thread-ask" onClick={() => onAskThreadBlock(block.body)} type="button">
                      <Send size={14} />
                      {t("detail.askThisPoint")}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="x-detail-sec">
        <div className="x-detail-sechead">
          <FileText size={18} />
          <h3>{t("detail.sourceChunks")}</h3>
        </div>
        <div className="x-detail-chunks">
          {chunks.length > 0 ? (
            (showAllChunks ? chunks : chunks.slice(0, 2)).map((chunk, index) => (
              <div className="x-detail-chunk" key={chunk.id}>
                <span>{formatSourceChunkLabel(chunk, index, source?.type)}</span>
                <div className="x-detail-chunk-body">{renderMathInText(chunk.content)}</div>
              </div>
            ))
          ) : (
            <div className="x-muted-copy x-richtext">
              {renderMathInText(asset?.content ?? t("detail.noTranscript"))}
            </div>
          )}
          {chunks.length > 2 && !showAllChunks ? (
            <button className="x-expand-chunks" onClick={() => setShowAllChunks(true)} type="button">
              {t("detail.expandChunks", { count: chunks.length })}
            </button>
          ) : null}
        </div>
      </section>

      {card.graphEdges?.length ? (
        <section className="x-detail-sec">
          <div className="x-detail-sechead">
            <Route size={18} />
            <h3>{t("detail.graphRelations")}</h3>
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
            <h3>{t("detail.reviewAndNext")}</h3>
          </div>
          <div className="x-detail-prompts">
            {card.reviewPrompts?.map((reviewPrompt) => (
              <div className="x-detail-prompt" key={reviewPrompt.id}>
                <span>
                  {t("detail.reviewDue", {
                    kind: formatReviewPromptKind(reviewPrompt.kind),
                    days: reviewPrompt.dueInDays
                  })}
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

      <EvidenceLedgerPanel error={evidenceError} ledger={evidenceLedger} onRetry={onRetryEvidence} />

      <section className="x-detail-sec">
        <div className="x-detail-sechead">
          <Brain size={18} />
          <h3>{t("detail.feedback")}</h3>
        </div>
        {feedback ? (
          <div className={`x-detail-fb ${feedback.inferredState}`}>
            <div className="x-detail-fbtop">
              <span>{formatLearningState(feedback.inferredState)}</span>
              <strong>{formatNextAction(feedback.nextAction)}</strong>
            </div>
            <p>{feedback.reason}</p>
            <small>{t("detail.signalStrength", { value: feedback.signalStrength })}</small>
          </div>
        ) : (
          <p className="x-muted-copy">{t("detail.feedbackHint")}</p>
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
            <h3>{t("detail.linked")}</h3>
          </div>
          <p className="x-muted-copy">{t("detail.cardConnections")}</p>
          <div className="x-detail-conns">
            {connections.map((connection) => (
              <button
                className="x-detail-conn"
                key={`${connection.kind}-${connection.cardId}`}
                onClick={() => onOpenCardId(connection.cardId)}
                title={t("detail.openTitle", { title: connection.title })}
                type="button"
              >
                <span className="x-detail-connkind">{formatConnectionKind(connection.kind)}</span>
                <strong>{connection.title}</strong>
                <small>{t("detail.connectionVia", { concept: connection.concept })}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {backlinks.length > 0 ? (
        <section className="x-detail-sec">
          <div className="x-detail-sechead">
            <Link2 size={18} />
            <h3>{t("detail.backlinks")}</h3>
          </div>
          <p className="x-muted-copy">{t("detail.backlinksHint")}</p>
          <div className="x-backlinks">
            {backlinks.map((backlink) => (
              <button
                className="x-backlink"
                key={`${backlink.fromPostId}-${backlink.snippet}`}
                onClick={() => onOpenCardId(backlink.fromPostId)}
                title={t("detail.openTitle", { title: backlink.fromTitle })}
                type="button"
              >
                <span className="x-backlink-from">{backlink.fromTitle}</span>
                <span className="x-backlink-snip">{backlink.snippet}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {shareOpen ? <ShareCardModal card={card} graph={graph} onClose={() => setShareOpen(false)} /> : null}
    </article>
  );
}

// Only genuinely external URLs open in a new tab; synthetic local sources
// (follow-ups, notes) have nothing to open.
function isExternalSourceUrl(url: string | undefined): url is string {
  if (!url || !/^https?:\/\//i.test(url)) {
    return false;
  }

  return !url.includes("aitimeline.local");
}

function formatSourceChunkLabel(chunk: KnowledgeChunk, index: number, sourceType: string | undefined): string {
  if (sourceType === "youtube" && chunk.startTimeSeconds !== undefined) {
    return `${formatTimestamp(chunk.startTimeSeconds)}-${formatTimestamp(chunk.endTimeSeconds ?? chunk.startTimeSeconds)}`;
  }

  return t("detail.chunkIndex", { index: index + 1 });
}

function EvidenceLedgerPanel({
  error,
  ledger,
  onRetry
}: {
  error?: boolean;
  ledger?: EvidenceLedger | null;
  onRetry?: () => void;
}) {
  return (
    <section className="x-detail-sec x-detail-ev">
      <div className="x-detail-sechead">
        <CheckCircle2 size={18} />
        <h3>{t("detail.evidence")}</h3>
      </div>

      {error && ledger === undefined ? (
        <p className="x-muted-copy">
          {t("detail.evidenceError")}
          {onRetry ? (
            <button className="x-linklike" onClick={onRetry} type="button">
              {t("detail.evidenceRetry")}
            </button>
          ) : null}
        </p>
      ) : ledger === undefined ? (
        <p className="x-muted-copy">{t("detail.evidenceLoading")}</p>
      ) : ledger === null ? (
        <p className="x-muted-copy">{t("detail.evidenceEmpty")}</p>
      ) : (
        <>
          <div className="x-ev-summary">
            <span className="x-ev-stat passed">{t("detail.passed", { count: ledger.summary.passed })}</span>
            <span className="x-ev-stat warning">{t("detail.warning", { count: ledger.summary.warnings })}</span>
            <span className="x-ev-stat failed">{t("detail.failed", { count: ledger.summary.failed })}</span>
          </div>
          <div className="x-ev-meta">
            <span>{t("detail.sourceCount", { count: ledger.summary.citedSources })}</span>
            <span>{t("detail.chunkCount", { count: ledger.summary.citedChunks })}</span>
            <span>{t("detail.claims", { count: ledger.summary.totalClaims })}</span>
          </div>
          <div className="x-ev-claims">
            {ledger.claims.map((claim) => (
              <div className={`x-ev-claim ${claim.status}`} id={`evidence-${claim.id}`} key={claim.id}>
                <div className="x-ev-claimtop">
                  <span>{formatEvidenceFieldPath(claim.fieldPath)}</span>
                  <strong>{formatGroundingStatus(claim.status)}</strong>
                </div>
                <p>{claim.claim}</p>
                {claim.evidence[0] ? (
                  <small>
                    {t("detail.overlap", {
                      title: claim.evidence[0].sourceTitle,
                      score: Math.round(claim.evidence[0].overlapScore * 100)
                    })}
                  </small>
                ) : (
                  <small>{t("detail.missingEvidence")}</small>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
