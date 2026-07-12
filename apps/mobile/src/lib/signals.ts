// 互动信号构造。来源:apps/web/src/lib/state.ts 的 createInteractionSignal /
// deriveTopicState —— 逻辑与 web 端一致,发给 POST /api/signals。
import type { InteractionSignal, KnowledgeCard, TopicState } from "@aitimeline/core";

import { getTopicId } from "./format";

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
