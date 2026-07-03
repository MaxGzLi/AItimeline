import type {
  CardConnection,
  InteractionSignal,
  KnowledgeChunk,
  LearningFeedback,
  RankedKnowledgeCard,
  SourceAsset
} from "@aitimeline/core";
import {
  Brain,
  CheckCircle2,
  FileText,
  GitBranch,
  GraduationCap,
  ListChecks,
  MessageCircle,
  Quote,
  Route,
  Send,
  Sparkles,
  XCircle
} from "lucide-react";
import { useEffect, useRef, type FormEvent } from "react";
import {
  buildTimestampUrl,
  formatConnectionKind,
  formatEdgeRelation,
  formatEvidenceFieldPath,
  formatGroundingStatus,
  formatLearningState,
  formatNextAction,
  formatReviewPromptKind,
  formatSignalChips,
  formatThreadKind,
  formatTimestamp
} from "../lib/format";
import type { AiMessage, EvidenceLedger } from "../lib/types";

export function SourceDetailDrawer({
  asset,
  card,
  chunks,
  connections,
  evidenceLedger,
  feedback,
  messages,
  onAsk,
  onClose,
  onOpenCardId,
  onPromptChange,
  prompt,
  signal
}: {
  asset?: SourceAsset;
  card: RankedKnowledgeCard;
  chunks: KnowledgeChunk[];
  connections: CardConnection[];
  evidenceLedger?: EvidenceLedger | null;
  feedback?: LearningFeedback;
  messages: AiMessage[];
  onAsk: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onOpenCardId: (cardId: string) => void;
  onPromptChange: (value: string) => void;
  prompt: string;
  signal?: InteractionSignal;
}) {
  const citation = card.citations?.[0];
  const source = card.sources[0];
  const drawerRef = useRef<HTMLElement>(null);
  // Comment threads live inline on the post; the drawer keeps only the
  // knowledge blocks (explain/example/…).
  const knowledgeBlocks = (card.thread ?? []).filter(
    (block) => block.kind !== "user_comment" && block.kind !== "agent_reply"
  );

  // Modal focus management: move focus into the dialog on open and return it to
  // the element that opened it on close, so keyboard/screen-reader users are taken
  // to the new content and back to their place in the feed.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    return () => {
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  return (
    <aside
      aria-label="来源详情"
      aria-modal="true"
      className="x-drawer"
      ref={drawerRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="x-drawer-head">
        <div>
          <p className="x-label">有据可查的卡片</p>
          <h2>{card.title}</h2>
        </div>
        <button className="x-iconbtn" onClick={onClose} title="关闭">
          <XCircle size={18} />
        </button>
      </div>

      <section className="x-drawer-sec">
        <div className="x-drawer-sechead">
          <Quote size={18} />
          <h3>引用出处</h3>
        </div>
        <p>{source?.title ?? "未知来源"}</p>
        {citation?.startTimeSeconds !== undefined ? (
          <a className="x-drawer-time" href={buildTimestampUrl(source?.url, citation.startTimeSeconds)}>
            {formatTimestamp(citation.startTimeSeconds)}-{formatTimestamp(citation.endTimeSeconds ?? citation.startTimeSeconds)}
          </a>
        ) : (
          <span className="x-muted-copy">暂无引用</span>
        )}
      </section>

      <EvidenceLedgerPanel ledger={evidenceLedger} />

      <section className="x-drawer-sec">
        <div className="x-drawer-sechead">
          <Sparkles size={18} />
          <h3>智能体要点</h3>
        </div>
        <p>{card.keyTakeaway}</p>
      </section>

      {knowledgeBlocks.length ? (
        <section className="x-drawer-sec">
          <div className="x-drawer-sechead">
            <MessageCircle size={18} />
            <h3>延展</h3>
          </div>
          <div className="x-drawer-blocks">
            {knowledgeBlocks.map((block) => (
              <div className="x-drawer-block" key={block.id}>
                <span>{formatThreadKind(block.kind)}</span>
                <h4>{block.title}</h4>
                <p>{block.body}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="x-drawer-sec">
        <div className="x-drawer-sechead">
          <FileText size={18} />
          <h3>来源片段</h3>
        </div>
        <div className="x-drawer-chunks">
          {chunks.length > 0 ? (
            chunks.map((chunk) => (
              <div className="x-drawer-chunk" key={chunk.id}>
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
        <section className="x-drawer-sec">
          <div className="x-drawer-sechead">
            <Route size={18} />
            <h3>图谱关系</h3>
          </div>
          <div className="x-drawer-edges">
            {card.graphEdges.map((edge) => (
              <div className="x-drawer-edge" key={edge.id}>
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
        <section className="x-drawer-sec">
          <div className="x-drawer-sechead">
            <ListChecks size={18} />
            <h3>复习与下一步</h3>
          </div>
          <div className="x-drawer-prompts">
            {card.reviewPrompts?.map((prompt) => (
              <div className="x-drawer-prompt" key={prompt.id}>
                <span>{formatReviewPromptKind(prompt.kind)} · {prompt.dueInDays} 天后</span>
                <p>{prompt.prompt}</p>
                <small>{prompt.answerHint}</small>
              </div>
            ))}
          </div>
          {card.nextActions?.length ? (
            <div className="x-drawer-acts">
              {card.nextActions.map((action) => (
                <span key={action}>{formatNextAction(action)}</span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="x-drawer-sec">
        <div className="x-drawer-sechead">
          <Brain size={18} />
          <h3>反馈闭环</h3>
        </div>
        {feedback ? (
          <div className={`x-drawer-fb ${feedback.inferredState}`}>
            <div className="x-drawer-fbtop">
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
          <div className="x-drawer-signals">
            {formatSignalChips(signal).map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        ) : null}
      </section>

      {connections.length > 0 ? (
        <section className="x-drawer-sec">
          <div className="x-drawer-sechead">
            <GitBranch size={18} />
            <h3>关联</h3>
          </div>
          <p className="x-muted-copy">这张碎片和你收集过的卡片怎么连起来。</p>
          <div className="x-drawer-conns">
            {connections.map((connection) => (
              <button
                className="x-drawer-conn"
                key={`${connection.kind}-${connection.cardId}`}
                onClick={() => onOpenCardId(connection.cardId)}
                title={`打开「${connection.title}」`}
                type="button"
              >
                <span className={`x-drawer-connkind ${connection.kind}`}>{formatConnectionKind(connection.kind)}</span>
                <strong>{connection.title}</strong>
                <small>通过「{connection.concept}」</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="x-drawer-sec">
        <div className="x-drawer-sechead">
          <GraduationCap size={18} />
          <h3>问 AI</h3>
        </div>
        <div className="x-drawer-chat">
          {messages.length > 0 ? (
            messages.map((message) => (
              <div className={`x-drawer-msg ${message.role}`} key={message.id}>
                <span>{message.role === "assistant" ? "AI" : "你"}</span>
                <p>{message.content}</p>
              </div>
            ))
          ) : (
            <p className="x-muted-copy">问问它和你的记忆、图谱或复习队列怎么连起来。</p>
          )}
        </div>

        <form className="x-drawer-ask" onSubmit={onAsk}>
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
    </aside>
  );
}

function EvidenceLedgerPanel({ ledger }: { ledger?: EvidenceLedger | null }) {
  return (
    <section className="x-drawer-sec x-drawer-ev">
      <div className="x-drawer-sechead">
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
