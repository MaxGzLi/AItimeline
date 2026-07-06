import type { RankedKnowledgeCard, ReviewItem } from "@aitimeline/core";
import { useState } from "react";
import { formatDueDate } from "../lib/format";
import { t } from "../lib/i18n";
import { renderMathInText } from "../lib/math";

export function ReviewView({
  cardsById,
  onReviewed,
  queue
}: {
  cardsById: Record<string, RankedKnowledgeCard>;
  onReviewed: (card: RankedKnowledgeCard) => void;
  queue: ReviewItem[];
}) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState(false);
  const remaining = queue.filter((entry) => !completedIds.has(entry.cardId) && cardsById[entry.cardId]);
  const item = remaining[0];
  const card = item ? cardsById[item.cardId] : undefined;

  if (!item || !card) {
    return (
      <div className="x-reviewwrap">
        <p className="x-reviewdone">
          {completedIds.size > 0 ? t("review.complete") : t("review.empty")}
        </p>
      </div>
    );
  }

  const prompt = card.reviewPrompts?.[0];
  const question = prompt?.prompt ?? t("review.questionFallback", { concept: item.concept });
  const answer = card.keyTakeaway ?? card.summary ?? t("review.answerFallback");

  const grade = () => {
    onReviewed(card);
    setRevealed(false);
    setCompletedIds((ids) => {
      const next = new Set(ids);
      next.add(item.cardId);
      return next;
    });
  };

  return (
    <div className="x-reviewwrap">
      <p className="x-reviewcount">
        {t("review.count", {
          current: completedIds.size + 1,
          total: completedIds.size + remaining.length,
          date: formatDueDate(item.dueAt),
          days: item.intervalDays
        })}
      </p>
      <p className="x-reviewq">{question}</p>
      <p className="x-reviewfrom">
        #{item.concept.replace(/\s+/g, "")}
        {card ? t("review.from", { title: card.title }) : ""}
      </p>

      {revealed ? (
        <>
          <div className="x-reviewa">{renderMathInText(answer)}</div>
          <div className="x-reviewbtns">
            <button className="x-grade good" onClick={grade} type="button">
              {t("review.remembered")}
            </button>
            <button className="x-grade mid" onClick={grade} type="button">
              {t("review.fuzzy")}
            </button>
            <button className="x-grade" onClick={grade} type="button">
              {t("review.forgot")}
            </button>
          </div>
        </>
      ) : (
        <div className="x-reviewbtns">
          <button className="x-grade" onClick={() => setRevealed(true)} type="button">
            {t("review.showAnswer")}
          </button>
        </div>
      )}
    </div>
  );
}
