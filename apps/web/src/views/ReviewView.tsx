import type { RankedKnowledgeCard, ReviewItem } from "@aitimeline/core";
import { useState } from "react";
import { formatDueDate } from "../lib/format";

// One-question-at-a-time spaced review. Grading calls onReviewed, which the
// parent uses to complete the review on the server; the queue comes from the
// server's due list.
export function ReviewView({
  cardsById,
  onReviewed,
  queue
}: {
  cardsById: Record<string, RankedKnowledgeCard>;
  onReviewed: (card: RankedKnowledgeCard) => void;
  queue: ReviewItem[];
}) {
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const item = queue[position];
  const card = item ? cardsById[item.cardId] : undefined;

  if (!item) {
    return (
      <div className="x-reviewwrap">
        <p className="x-reviewdone">
          {queue.length === 0 ? "复习队列是空的 —— 收藏或点赞过的卡片才会进入复习。" : "今天的复习完成了 🎉"}
        </p>
      </div>
    );
  }

  const prompt = card?.reviewPrompts?.[0];
  const question = prompt?.prompt ?? `回忆一下：「${item.concept}」的核心观点是什么？`;
  const answer = card?.keyTakeaway ?? card?.summary ?? "打开原卡片查看答案。";

  const grade = () => {
    if (card) {
      onReviewed(card);
    }

    setRevealed(false);
    setPosition((current) => current + 1);
  };

  return (
    <div className="x-reviewwrap">
      <p className="x-reviewcount">
        第 {position + 1} / {queue.length} 题 · {formatDueDate(item.dueAt)} 到期 · 间隔 {item.intervalDays} 天
      </p>
      <p className="x-reviewq">{question}</p>
      <p className="x-reviewfrom">
        #{item.concept.replace(/\s+/g, "")}
        {card ? ` · 来自《${card.title}》` : ""}
      </p>

      {revealed ? (
        <>
          <p className="x-reviewa">{answer}</p>
          <div className="x-reviewbtns">
            <button className="x-grade good" onClick={grade} type="button">
              记得
            </button>
            <button className="x-grade mid" onClick={grade} type="button">
              模糊
            </button>
            <button className="x-grade" onClick={grade} type="button">
              忘了
            </button>
          </div>
        </>
      ) : (
        <div className="x-reviewbtns">
          <button className="x-grade" onClick={() => setRevealed(true)} type="button">
            显示答案
          </button>
        </div>
      )}
    </div>
  );
}
