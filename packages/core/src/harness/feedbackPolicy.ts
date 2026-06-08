import type {
  InferredLearningState,
  InteractionSignal,
  LearningFeedback,
  NextActionPolicy,
  TopicState
} from "../types";

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
    interested: "The user showed pull, so continue the learning path.",
    confused: "The user asked a question, so simplify and explain the gap.",
    fatigued: "The topic is cooling down because the user skipped or shows fatigue.",
    not_relevant: "The signal was weak, so ask for clarification before pushing more.",
    needs_review: "The user saved or reviewed, so schedule durable recall."
  };

  return `${reasons[state]} Next action: ${nextAction}.`;
}

