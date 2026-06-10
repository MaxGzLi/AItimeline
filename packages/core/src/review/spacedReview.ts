import type { KnowledgeCard, ReviewItem, UserSignal } from "../types.js";

export function createReviewQueue(cards: KnowledgeCard[], signals: UserSignal[], now = new Date()): ReviewItem[] {
  const savedCardIds = new Set(
    signals
      .filter((signal) => signal.type === "like" || signal.type === "save" || signal.type === "review")
      .map((signal) => signal.cardId)
  );

  return cards
    .filter((card) => savedCardIds.has(card.id))
    .flatMap((card) =>
      card.concepts.slice(0, 2).map((concept, index) => ({
        cardId: card.id,
        concept,
        dueAt: addDays(now, index + 1).toISOString(),
        intervalDays: index + 1,
        strength: 0.35
      }))
    );
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

