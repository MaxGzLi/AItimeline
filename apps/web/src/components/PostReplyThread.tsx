import type { KnowledgeCard, RankedKnowledgeCard } from "@aitimeline/core";
import { BadgeCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { t } from "../lib/i18n";
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
      setReplyError(error instanceof Error ? error.message : t("reply.error"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`x-replies${className ? ` ${className}` : ""}`} aria-label={t("reply.thread")}>
      {commentBlocks.length === 0 && emptyMessage ? (
        <p className="x-muted-copy x-replies-empty">{emptyMessage}</p>
      ) : null}

      {commentBlocks.map((block) => {
        const isAgent = block.kind === "agent_reply";
        const blockCitation = block.citations?.[0];
        const isBlockCertified = isAgent && block.grounded === true && Boolean(blockCitation);

        return (
          <div className="x-reply" key={block.id}>
            <span className={`x-avatar x-reply-avatar${isAgent ? " agent" : ""}`} aria-hidden="true">
              {isAgent ? t("common.ai") : t("common.you")}
            </span>
            <div className="x-reply-main">
              <div className="x-head">
                <span className="x-name">{block.title}</span>
                {isBlockCertified ? (
                  <BadgeCheck aria-label={t("post.hasSource")} className="x-verified" size={15} />
                ) : null}
              </div>
              <div className="x-body">
                {renderWithWikilinks(block.body, cards, { onOpenConcept, onOpenCardId })}
              </div>
              {blockCitation ? (
                <div className="x-quote" role="note">
                  <span className="x-qhead">
                    <span className="x-name">{t("agent.citationLabel")}</span>
                    <span className="x-meta">· {blockCitation.sourceTitle}</span>
                  </span>
                  <p className="x-qtext">“{blockCitation.quote}”</p>
                </div>
              ) : null}
              {isAgent && block.runnerKind === "deterministic" ? (
                <p className="x-meta x-runner-note">{t("agent.deterministicNote")}</p>
              ) : null}
            </div>
          </div>
        );
      })}

      <form className="x-reply-form" onSubmit={handleReplySubmit}>
        <span className="x-avatar x-reply-avatar" aria-hidden="true">
          {t("common.you")}
        </span>
        <WikilinkInput
          aria-label={t("reply.form")}
          candidates={wikilinkCandidates}
          className="x-reply-input"
          disabled={sending}
          onValueChange={setReplyText}
          placeholder={t("reply.placeholder")}
          value={replyText}
        />
        <button className="x-pill" disabled={sending || !replyText.trim()} type="submit">
          {sending ? t("reply.sending") : t("reply.send")}
        </button>
      </form>

      {replyError ? <p className="x-reply-error">{replyError}</p> : null}
    </div>
  );
}
