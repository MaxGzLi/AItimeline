import { scoreInteraction } from "./feedbackPolicy";
import type {
  AgentExpansionJob,
  AgentExpansionPlan,
  AgentExpansionPolicyConfig,
  AgentExpansionSuppression,
  ExpansionJobKind,
  InteractionSignal,
  LearningFeedback,
  NextActionPolicy,
  TopicState
} from "../types";

export interface CreateExpansionPlanInput {
  signals: InteractionSignal[];
  feedback: LearningFeedback[];
  topicStates?: TopicState[];
  generatedAt?: string | Date;
  config?: Partial<AgentExpansionPolicyConfig>;
}

export const defaultAgentExpansionPolicyConfig: AgentExpansionPolicyConfig = {
  noInteractionDwellTimeMs: 2400,
  softInterestDwellTimeMs: 9000,
  cooldownHours: 36,
  maxJobsPerTopic: 2
};

export function createExpansionPlan(input: CreateExpansionPlanInput): AgentExpansionPlan {
  const config = { ...defaultAgentExpansionPolicyConfig, ...input.config };
  const generatedAt = normalizeDate(input.generatedAt);
  const feedbackByPost = new Map(input.feedback.map((feedback) => [feedback.postId, feedback]));
  const topicStateById = new Map((input.topicStates ?? []).map((topicState) => [topicState.topicId, topicState]));
  const jobs: AgentExpansionJob[] = [];
  const suppressions: AgentExpansionSuppression[] = [];
  const jobsPerTopic = new Map<string, number>();

  for (const signal of input.signals) {
    const feedback = feedbackByPost.get(signal.postId) ?? createFallbackFeedback(signal);
    const topicState = topicStateById.get(signal.topicId);
    const suppression = getSuppression(signal, topicState, generatedAt, config);

    if (suppression) {
      suppressions.push(suppression);
      continue;
    }

    const job = createExpansionJob(signal, feedback, topicState, generatedAt, config);

    if (!job) {
      suppressions.push({
        postId: signal.postId,
        topicId: signal.topicId,
        reason: "Signal was too weak to justify another post in this series."
      });
      continue;
    }

    const topicJobCount = jobsPerTopic.get(job.topicId) ?? 0;

    if (topicJobCount >= config.maxJobsPerTopic && job.kind !== "cooldown_topic") {
      suppressions.push({
        postId: signal.postId,
        topicId: signal.topicId,
        reason: "Topic already has enough follow-up jobs queued."
      });
      continue;
    }

    jobs.push(job);
    jobsPerTopic.set(job.topicId, topicJobCount + 1);
  }

  const sortedJobs = jobs.sort((left, right) => right.priority - left.priority);

  return {
    generatedAt: generatedAt.toISOString(),
    jobs: sortedJobs,
    suppressions,
    cooledTopicIds: sortedJobs
      .filter((job) => job.kind === "cooldown_topic")
      .map((job) => job.topicId)
      .filter(unique)
  };
}

export function shouldContinueSeries(signal: InteractionSignal, feedback?: LearningFeedback): boolean {
  if (signal.skippedQuickly) {
    return false;
  }

  if (signal.openedThread || signal.liked || signal.saved || signal.askedQuestion || signal.reviewed) {
    return true;
  }

  if (signal.dwellTimeMs >= defaultAgentExpansionPolicyConfig.softInterestDwellTimeMs) {
    return true;
  }

  return feedback?.nextAction === "continue_deeper" || feedback?.nextAction === "expand_broader";
}

function createExpansionJob(
  signal: InteractionSignal,
  feedback: LearningFeedback,
  topicState: TopicState | undefined,
  generatedAt: Date,
  config: AgentExpansionPolicyConfig
): AgentExpansionJob | null {
  const nextAction = chooseExpansionAction(signal, feedback, topicState, config);

  if (!nextAction) {
    return null;
  }

  const kind = getJobKind(nextAction);
  const cooldownUntil =
    kind === "cooldown_topic" ? addHours(generatedAt, config.cooldownHours).toISOString() : undefined;
  const runAfter = kind === "cooldown_topic" ? cooldownUntil : generatedAt.toISOString();

  return {
    id: buildExpansionJobId(signal.postId, nextAction, generatedAt),
    kind,
    postId: signal.postId,
    topicId: signal.topicId,
    conceptIds: signal.conceptIds,
    nextAction,
    priority: scoreExpansionPriority(signal, feedback, kind, config, topicState),
    reason: buildExpansionReason(signal, feedback, nextAction, kind, config),
    createdAt: generatedAt.toISOString(),
    runAfter,
    cooldownUntil
  };
}

function chooseExpansionAction(
  signal: InteractionSignal,
  feedback: LearningFeedback,
  topicState: TopicState | undefined,
  config: AgentExpansionPolicyConfig
): NextActionPolicy | null {
  if (signal.skippedQuickly || (topicState?.fatigueScore ?? 0) >= 0.7) {
    return "cooldown_topic";
  }

  if (signal.saved || signal.reviewed || feedback.nextAction === "schedule_review") {
    return "schedule_review";
  }

  if (signal.askedQuestion || feedback.nextAction === "reframe_simpler") {
    return "reframe_simpler";
  }

  if (signal.liked) {
    return topicState && topicState.comprehensionScore >= 0.65 ? "expand_broader" : "continue_deeper";
  }

  if (signal.openedThread) {
    return feedback.nextAction === "expand_broader" ? "expand_broader" : "continue_deeper";
  }

  if (signal.dwellTimeMs >= config.softInterestDwellTimeMs) {
    return "continue_deeper";
  }

  return null;
}

function getSuppression(
  signal: InteractionSignal,
  topicState: TopicState | undefined,
  generatedAt: Date,
  config: AgentExpansionPolicyConfig
): AgentExpansionSuppression | null {
  const hasExplicitInteraction =
    signal.openedThread || signal.liked || signal.saved || signal.askedQuestion || signal.reviewed || signal.skippedQuickly;
  const cooldownUntil = topicState?.cooldownUntil ? new Date(topicState.cooldownUntil) : null;

  if (cooldownUntil && cooldownUntil > generatedAt && !hasExplicitInteraction) {
    return {
      postId: signal.postId,
      topicId: signal.topicId,
      reason: "Topic is already cooling down, so passive impressions should not restart the series."
    };
  }

  if (!hasExplicitInteraction && signal.dwellTimeMs < config.noInteractionDwellTimeMs) {
    return {
      postId: signal.postId,
      topicId: signal.topicId,
      reason: "Cold impression with short dwell; do not continue pushing this series."
    };
  }

  if (!hasExplicitInteraction && signal.dwellTimeMs < config.softInterestDwellTimeMs) {
    return {
      postId: signal.postId,
      topicId: signal.topicId,
      reason: "Passive dwell was not strong enough to infer interest."
    };
  }

  return null;
}

function getJobKind(nextAction: NextActionPolicy): ExpansionJobKind {
  if (nextAction === "schedule_review") {
    return "schedule_review";
  }

  if (nextAction === "cooldown_topic") {
    return "cooldown_topic";
  }

  if (nextAction === "ask_clarifying_question") {
    return "ask_clarifying_question";
  }

  return "generate_followup";
}

function scoreExpansionPriority(
  signal: InteractionSignal,
  feedback: LearningFeedback,
  kind: ExpansionJobKind,
  config: AgentExpansionPolicyConfig,
  topicState?: TopicState
): number {
  let priority = 0.25 + Math.max(0, Math.min(feedback.signalStrength, 16)) / 24;

  if (signal.openedThread) priority += 0.12;
  if (signal.liked) priority += 0.16;
  if (signal.saved) priority += 0.2;
  if (signal.askedQuestion) priority += 0.18;
  if (signal.reviewed) priority += 0.16;
  if (signal.dwellTimeMs >= config.softInterestDwellTimeMs) priority += 0.08;
  if (kind === "cooldown_topic") priority += 0.12;
  if (kind === "schedule_review") priority += 0.08;
  if (topicState?.interestScore) priority += topicState.interestScore * 0.12;
  if (topicState?.fatigueScore) priority -= topicState.fatigueScore * 0.1;

  return roundPriority(Math.max(0.05, Math.min(priority, 1)));
}

function buildExpansionReason(
  signal: InteractionSignal,
  feedback: LearningFeedback,
  nextAction: NextActionPolicy,
  kind: ExpansionJobKind,
  config: AgentExpansionPolicyConfig
): string {
  if (kind === "cooldown_topic") {
    return "User skipped quickly or topic fatigue is high, so pause the topic before generating more.";
  }

  if (kind === "schedule_review") {
    return "User saved or reviewed the post, so convert interest into durable recall.";
  }

  if (signal.askedQuestion) {
    return "User asked a question, so generate a simpler or more grounded follow-up before going broader.";
  }

  if (signal.liked && nextAction === "expand_broader") {
    return "User liked the post and appears ready, so expand into adjacent concepts.";
  }

  if (signal.openedThread || signal.dwellTimeMs >= config.softInterestDwellTimeMs) {
    return "User showed pull through thread open or long dwell, so continue the learning path.";
  }

  return feedback.reason;
}

function createFallbackFeedback(signal: InteractionSignal): LearningFeedback {
  const signalStrength = scoreInteraction(signal);
  const nextAction: NextActionPolicy = signal.skippedQuickly
    ? "cooldown_topic"
    : signal.saved || signal.reviewed
      ? "schedule_review"
      : signal.askedQuestion
        ? "reframe_simpler"
        : signal.openedThread || signal.liked || signalStrength >= 5
          ? "continue_deeper"
          : "ask_clarifying_question";

  return {
    postId: signal.postId,
    topicId: signal.topicId,
    conceptIds: signal.conceptIds,
    signalStrength,
    inferredState: signal.skippedQuickly ? "fatigued" : signalStrength >= 5 ? "interested" : "not_relevant",
    nextAction,
    reason: "Fallback feedback inferred directly from interaction signal."
  };
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}

function addHours(date: Date, hours: number): Date {
  const next = new Date(date);
  next.setHours(next.getHours() + hours);
  return next;
}

function buildExpansionJobId(postId: string, nextAction: NextActionPolicy, generatedAt: Date): string {
  return `${postId}-${nextAction}-${generatedAt.toISOString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function roundPriority(value: number): number {
  return Math.round(value * 100) / 100;
}

function unique<T>(value: T, index: number, values: T[]): boolean {
  return values.indexOf(value) === index;
}
