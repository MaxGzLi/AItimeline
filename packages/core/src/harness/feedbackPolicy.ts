import type {
  InferredLearningState,
  InteractionSignal,
  LearningFeedback,
  NextActionPolicy,
  TopicState
} from "../types.js";

export function evaluateInteraction(signal: InteractionSignal, topicState: TopicState): LearningFeedback {
  const signalStrength = scoreInteraction(signal);
  const inferredState = inferLearningState(signal, topicState, signalStrength);
  const nextAction = chooseNextAction(inferredState, signal, topicState);

  return {
    postId: signal.postId,
    topicId: signal.topicId,
    conceptIds: signal.conceptIds,
    signalStrength,
    inferredState,
    nextAction,
    reason: buildReason(inferredState, nextAction)
  };
}

export function scoreInteraction(signal: InteractionSignal): number {
  let score = 0;

  if (signal.impression) score += 1;
  if (signal.dwellTimeMs > 8000) score += 2;
  if (signal.openedThread) score += 3;
  if (signal.liked) score += 4;
  if (signal.saved) score += 5;
  if (signal.askedQuestion) score += 6;
  if (signal.reviewed) score += 4;
  if (signal.skippedQuickly) score -= 5;

  return score;
}

export function inferLearningState(
  signal: InteractionSignal,
  topicState: TopicState,
  signalStrength: number
): InferredLearningState {
  if (signal.askedQuestion) {
    return "confused";
  }

  if (signal.reviewed || signal.saved) {
    return "needs_review";
  }

  if (topicState.fatigueScore > 0.7 || signal.skippedQuickly) {
    return "fatigued";
  }

  if (signalStrength >= 5 || signal.liked || signal.openedThread) {
    return "interested";
  }

  return "not_relevant";
}

export function chooseNextAction(
  state: InferredLearningState,
  signal: InteractionSignal,
  topicState: TopicState
): NextActionPolicy {
  if (state === "confused") {
    return "reframe_simpler";
  }

  if (state === "needs_review") {
    return "schedule_review";
  }

  if (state === "fatigued") {
    return "cooldown_topic";
  }

  if (state === "interested" && signal.askedQuestion) {
    return "continue_deeper";
  }

  if (state === "interested" && topicState.comprehensionScore > 0.7) {
    return "expand_broader";
  }

  if (state === "interested") {
    return "continue_deeper";
  }

  return "ask_clarifying_question";
}

function buildReason(state: InferredLearningState, nextAction: NextActionPolicy): string {
  const reasons: Record<InferredLearningState, string> = {
    interested: "你表现出了兴趣,所以继续这条学习路径。",
    confused: "你提了问题,所以先讲得更简单些,补上这块缺口。",
    fatigued: "你划走或显得有些疲劳,所以这个话题先降降温。",
    not_relevant: "信号还比较弱,所以先请你说清楚,再决定要不要多推。",
    needs_review: "你收藏或复习过,所以安排一次巩固记忆的复习。"
  };

  return reasons[state];
}

