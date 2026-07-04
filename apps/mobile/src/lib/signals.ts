// 互动信号构造。来源:apps/web/src/lib/state.ts 的 createInteractionSignal /
// deriveTopicState —— 逻辑与 web 端一致,发给 POST /api/signals。
import type { InteractionSignal, KnowledgeCard, TopicState, UserSignal } from "@aitimeline/core";

import { getTopicId } from "./format";
import type { InteractionSignals } from "./types";

export function createInteractionSignal(card: KnowledgeCard): InteractionSignal {
  return {
    postId: card.id,
    topicId: getTopicId(card),
    conceptIds: card.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: new Date().toISOString()
  };
}

export function deriveTopicState(signal: InteractionSignal): TopicState {
  const positiveSignals = [
    signal.openedThread,
    signal.liked,
    signal.saved,
    signal.askedQuestion,
    signal.reviewed
  ].filter(Boolean).length;

  return {
    topicId: signal.topicId,
    interestScore: Math.min(1, positiveSignals / 4),
    fatigueScore: signal.skippedQuickly ? 0.85 : 0.15,
    comprehensionScore: signal.askedQuestion ? 0.35 : signal.reviewed || signal.saved ? 0.78 : 0.55
  };
}

// 把本地累积的互动信号摊平成 createReviewQueue 需要的 UserSignal[]。
// 与 web 端 App.tsx 的 interactionUserSignals 推导保持一致。
export function toReviewSignals(signals: InteractionSignals): UserSignal[] {
  return Object.values(signals).flatMap((signal) => {
    const out: UserSignal[] = [];

    if (signal.liked) {
      out.push({ id: `interaction-like-${signal.postId}`, cardId: signal.postId, type: "like", createdAt: signal.createdAt });
    }
    if (signal.saved) {
      out.push({ id: `interaction-save-${signal.postId}`, cardId: signal.postId, type: "save", createdAt: signal.createdAt });
    }
    if (signal.askedQuestion) {
      out.push({ id: `interaction-ask-${signal.postId}`, cardId: signal.postId, type: "ask", createdAt: signal.createdAt });
    }

    return out;
  });
}
