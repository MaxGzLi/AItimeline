import { Bot, FileText, LoaderCircle, Send, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import { formatBoundaryZone } from "../lib/format";
import type { AgentAskApiResponse } from "../lib/types";

export function AgentAskPanel({
  isAsking,
  message,
  onOpenCard,
  onQuestionChange,
  onSubmit,
  question,
  response
}: {
  isAsking: boolean;
  message: string;
  onOpenCard: (cardId: string) => void;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  question: string;
  response: AgentAskApiResponse | null;
}) {
  const turn = response?.turn ?? null;

  return (
    <section className="context-section agent-ask-section">
      <div className="rail-heading">
        <div>
          <p className="section-label">Agent</p>
          <h2>问你的知识库</h2>
        </div>
        <button className="icon-button compact" title="Agent 入口">
          <Bot size={18} />
        </button>
      </div>

      <form className="candidate-form" onSubmit={onSubmit}>
        <label className="candidate-input">
          <Sparkles size={16} />
          <input
            aria-label="向 Agent 提问"
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="问任何你正在学的内容"
            value={question}
          />
        </label>
        <button className="primary-action candidate-submit" disabled={isAsking} type="submit">
          {isAsking ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
          <span>{isAsking ? "提问中" : "提问"}</span>
        </button>
      </form>

      {message ? <div className="candidate-message">{message}</div> : null}

      {turn ? (
        <div className="agent-turn">
          <div className="signal-chip-list">
            <span>{formatBoundaryZone(turn.zone)}</span>
            {turn.matchedConcepts.slice(0, 3).map((concept) => (
              <span key={concept}>{concept}</span>
            ))}
          </div>

          {turn.answer ? (
            <>
              <p className="agent-answer">{turn.answer.answer}</p>
              {turn.answer.citations.slice(0, 2).map((citation) => (
                <p className="agent-citation" key={`${citation.sourceTitle}-${citation.quote.slice(0, 24)}`}>
                  {citation.sourceTitle}: “{citation.quote}”
                </p>
              ))}
              {turn.answerCardId ? (
                <button
                  className="secondary-action agent-open-card"
                  onClick={() => onOpenCard(turn.answerCardId as string)}
                  type="button"
                >
                  <FileText size={16} />
                  <span>打开引用的卡片</span>
                </button>
              ) : null}
            </>
          ) : (
            turn.notes.map((note) => (
              <p className="agent-answer" key={note}>
                {note}
              </p>
            ))
          )}

          {response && response.discoveredCandidates.length > 0 ? (
            <div className="candidate-message">
              已发现 {response.discoveredCandidates.length} 个来源候选，等待后台整理。
            </div>
          ) : null}

          {turn.actions.length > 0 ? (
            <div className="signal-chip-list agent-actions">
              {turn.actions.map((action) => (
                <span key={action.kind}>{action.label}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
