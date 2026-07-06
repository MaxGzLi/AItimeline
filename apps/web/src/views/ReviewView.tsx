import type { RankedKnowledgeCard, ReviewItem } from "@aitimeline/core";
import { useState } from "react";
import { formatDueDate } from "../lib/format";
import { renderMathInText } from "../lib/math";

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
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const [revealed, setRevealed] = useState(false);
  // 队列由服务端到期列表驱动:评分后条目会随刷新异步消失,所以不能用 position 自增
  // 前进(会和队列缩短叠加成双重前进,隔一张跳一张)。改为过滤掉本地已评分的条目,
  // 永远出第一题;缺卡片本体的条目不出题,留在服务端等下次。
  const remaining = queue.filter((entry) => !completedIds.has(entry.cardId) && cardsById[entry.cardId]);
  const item = remaining[0];
  const card = item ? cardsById[item.cardId] : undefined;

  if (!item || !card) {
    return (
      <div className="x-reviewwrap">
        <p className="x-reviewdone">
          {completedIds.size > 0 ? "今天的复习完成了 🎉" : "复习队列是空的 —— 收藏或点赞过的卡片才会进入复习。"}
        </p>
      </div>
    );
  }

  const prompt = card.reviewPrompts?.[0];
  const question = prompt?.prompt ?? `回忆一下：「${item.concept}」的核心观点是什么？`;
  const answer = card.keyTakeaway ?? card.summary ?? "打开原卡片查看答案。";

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
        第 {completedIds.size + 1} / {completedIds.size + remaining.length} 题 · {formatDueDate(item.dueAt)} 到期 ·
        间隔 {item.intervalDays} 天
      </p>
      <p className="x-reviewq">{question}</p>
      <p className="x-reviewfrom">
        #{item.concept.replace(/\s+/g, "")}
        {card ? ` · 来自《${card.title}》` : ""}
      </p>

      {revealed ? (
        <>
          <div className="x-reviewa">{renderMathInText(answer)}</div>
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
