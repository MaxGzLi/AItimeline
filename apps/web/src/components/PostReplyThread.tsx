import type { KnowledgeCard, RankedKnowledgeCard } from "@aitimeline/core";
import { BadgeCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { renderWithWikilinks } from "../lib/wikilinks";
import { WikilinkInput, type WikilinkAutocompleteCandidate } from "./WikilinkAutocomplete";

export function PostReplyThread({
  card,
  cards,
  className,
  emptyMessage,
  onOpenCardId,
  onOpenConcept,
  onReply,
  wikilinkCandidates
}: {
  card: RankedKnowledgeCard;
  cards: KnowledgeCard[];
  className?: string;
  emptyMessage?: string;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onReply: (card: RankedKnowledgeCard, text: string) => Promise<void>;
  wikilinkCandidates: WikilinkAutocompleteCandidate[];
}) {
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const commentBlocks = (card.thread ?? []).filter(
    (block) => block.kind === "user_comment" || block.kind === "agent_reply"
  );

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

  return (
    <div className={`x-replies${className ? ` ${className}` : ""}`} aria-label="评论线程">
      {commentBlocks.length === 0 && emptyMessage ? (
        <p className="x-muted-copy x-replies-empty">{emptyMessage}</p>
      ) : null}

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
              <p className="x-body">
                {renderWithWikilinks(block.body, cards, { onOpenConcept, onOpenCardId })}
              </p>
            </div>
          </div>
        );
      })}

      <form className="x-reply-form" onSubmit={handleReplySubmit}>
        <span className="x-avatar x-reply-avatar" aria-hidden="true">
          你
        </span>
        <WikilinkInput
          aria-label="回复"
          candidates={wikilinkCandidates}
          className="x-reply-input"
          disabled={sending}
          onValueChange={setReplyText}
          placeholder="回复…"
          value={replyText}
        />
        <button className="x-pill" disabled={sending || !replyText.trim()} type="submit">
          {sending ? "发送中" : "发送"}
        </button>
      </form>

      {replyError ? <p className="x-reply-error">{replyError}</p> : null}
    </div>
  );
}
