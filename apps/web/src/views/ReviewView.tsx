import type { RankedKnowledgeCard, ReviewItem } from "@aitimeline/core";
import { useState } from "react";
import type { ApiReviewCompleteResponse, ReviewGrade } from "../lib/types";
import { formatDueDate } from "../lib/format";
import { t } from "../lib/i18n";
import { renderMathInText } from "../lib/math";

export type ReviewQueueEntry = ReviewItem & {
  prompt: { id: string; prompt: string; answerHint: string } | null;
};

type SaveState =
  | { status: "idle" }
  | { status: "saving"; grade: ReviewGrade }
  | { status: "error"; grade: ReviewGrade; eventId: string };

type GradeTally = Record<ReviewGrade, number>;

const emptyTally: GradeTally = { remembered: 0, fuzzy: 0, forgot: 0 };

export function ReviewView({
  cardsById,
  onReviewed,
  queue
}: {
  cardsById: Record<string, RankedKnowledgeCard>;
  onReviewed: (card: RankedKnowledgeCard, grade: ReviewGrade, reviewEventId: string) => Promise<ApiReviewCompleteResponse>;
  queue: ReviewQueueEntry[];
}) {
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  // 上一题的保存结果,显示在下一题上方,直到再次评分。
  const [lastSaved, setLastSaved] = useState<{ grade: ReviewGrade; nextDueAt?: string } | null>(null);
  const [tally, setTally] = useState<GradeTally>(emptyTally);
  const [earliestNextDueAt, setEarliestNextDueAt] = useState<string | null>(null);
  const remaining = queue.filter((entry) => !completedIds.has(entry.cardId) && cardsById[entry.cardId]);
  const item = remaining[0];
  const card = item ? cardsById[item.cardId] : undefined;
  const completedCount = tally.remembered + tally.fuzzy + tally.forgot;

  if (!item || !card) {
    return (
      <div className="x-reviewwrap">
        {completedCount > 0 ? (
          <>
            <p className="x-reviewdone">{t("review.complete")}</p>
            <p className="x-reviewsummary">
              {t("review.summary", {
                total: completedCount,
                remembered: tally.remembered,
                fuzzy: tally.fuzzy,
                forgot: tally.forgot
              })}
            </p>
            {earliestNextDueAt ? (
              <p className="x-reviewsummary">{t("review.summaryNext", { date: formatDueDate(earliestNextDueAt) })}</p>
            ) : null}
          </>
        ) : (
          <p className="x-reviewdone">{t("review.empty")}</p>
        )}
      </div>
    );
  }

  const question = item.prompt?.prompt ?? t("review.questionFallback", { concept: item.concept });
  // 答案绑定当前这道题的 answerHint;老卡片没有 prompt 时才退回卡片要点。
  const answer = item.prompt?.answerHint ?? card.keyTakeaway ?? card.summary ?? t("review.answerFallback");
  const saving = saveState.status === "saving";

  const submitGrade = async (grade: ReviewGrade, reuseEventId?: string) => {
    const eventId = reuseEventId ?? `${item.cardId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    setSaveState({ status: "saving", grade });

    try {
      const result = await onReviewed(card, grade, eventId);

      setTally((current) => ({ ...current, [grade]: current[grade] + 1 }));

      if (result.nextDueAt) {
        const nextDueAt = result.nextDueAt;

        setEarliestNextDueAt((current) => (!current || nextDueAt < current ? nextDueAt : current));
      }

      setLastSaved({ grade, nextDueAt: result.nextDueAt });
      setSaveState({ status: "idle" });
      setRevealed(false);
      setCompletedIds((ids) => {
        const next = new Set(ids);
        next.add(item.cardId);
        return next;
      });
    } catch {
      // 保存失败:题目留在原地,不计完成,不庆祝。
      setSaveState({ status: "error", grade, eventId });
    }
  };

  return (
    <div className="x-reviewwrap">
      {lastSaved ? (
        <p className="x-reviewfeedback">
          {t(`review.saved.${lastSaved.grade}`)}
          {lastSaved.nextDueAt ? t("review.savedNextDue", { date: formatDueDate(lastSaved.nextDueAt) }) : ""}
        </p>
      ) : null}
      <p className="x-reviewcount">
        {t("review.count", {
          current: completedCount + 1,
          total: completedCount + remaining.length,
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
          {saveState.status === "error" ? (
            <p className="x-reviewfeedback error">
              {t("review.saveFailed")}
              <button
                className="x-grade x-retry"
                onClick={() => void submitGrade(saveState.grade, saveState.eventId)}
                type="button"
              >
                {t("review.retry")}
              </button>
            </p>
          ) : null}
          <div className="x-reviewbtns">
            <button className="x-grade good" disabled={saving} onClick={() => void submitGrade("remembered")} type="button">
              {saving && saveState.grade === "remembered" ? t("review.saving") : t("review.remembered")}
            </button>
            <button className="x-grade mid" disabled={saving} onClick={() => void submitGrade("fuzzy")} type="button">
              {saving && saveState.grade === "fuzzy" ? t("review.saving") : t("review.fuzzy")}
            </button>
            <button className="x-grade" disabled={saving} onClick={() => void submitGrade("forgot")} type="button">
              {saving && saveState.grade === "forgot" ? t("review.saving") : t("review.forgot")}
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
