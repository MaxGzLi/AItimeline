import { createExpansionPlan, shouldContinueSeries } from "../harness/expansionPolicy.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import type {
  AgentExpansionJob,
  AgentExpansionPlan,
  InteractionSignal,
  LearningFeedback,
  NextActionPolicy,
  DailyAutoJobBudgetRecord,
  Source,
  TopicState
} from "../types.js";

export type BackgroundCurationJobKind =
  | "generate_followup"
  | "deep_read_article"
  | "concept_brief"
  | "discover_sources"
  | "research_question"
  | "research_idea"
  | "import_source"
  | "schedule_review"
  | "ask_clarifying_question"
  | "cooldown_topic";

export interface BackgroundSourceCandidate {
  id: string;
  source: Source;
  topicId?: string;
  conceptIds: string[];
  relevanceScore: number;
  noveltyScore: number;
  qualityScore: number;
  reason: string;
  discoveredAt: string;
}

export interface BackgroundCurationJob {
  id: string;
  kind: BackgroundCurationJobKind;
  postId?: string;
  topicId: string;
  conceptIds: string[];
  nextAction?: NextActionPolicy;
  priority: number;
  reason: string;
  createdAt: string;
  runAfter?: string;
  sourceCandidate?: BackgroundSourceCandidate;
  researchQuestion?: BackgroundResearchQuestion;
  researchIdea?: BackgroundResearchIdea;
  deepReadArticle?: BackgroundDeepReadArticleJob;
}

export interface BackgroundResearchQuestion {
  turnId: string;
  threadId: string;
  userId: string;
  question: string;
  choices: Record<string, string>;
  contentLanguage?: ContentLanguage;
}

export interface BackgroundResearchIdea {
  turnId: string;
  threadId: string;
  userId: string;
  question: string;
  ideaPostId?: string;
  supportQueries: string[];
  challengeQueries: string[];
  contentLanguage?: ContentLanguage;
}

export interface BackgroundDeepReadArticleJob {
  userId: string;
  goalId?: string;
  contentLanguage?: ContentLanguage;
}

export interface BackgroundCurationSuppression {
  topicId: string;
  postId?: string;
  sourceCandidateId?: string;
  reason: string;
}

export interface BackgroundCurationPlan {
  generatedAt: string;
  jobs: BackgroundCurationJob[];
  suppressions: BackgroundCurationSuppression[];
  acceptedSourceCandidateIds: string[];
  cooledTopicIds: string[];
  expansionPlan: AgentExpansionPlan;
}

export interface BackgroundCurationConfig {
  minCandidateScore: number;
  maxJobsPerTopic: number;
  maxSourceImportsPerTopic: number;
  sourceDiscoveryDelayMinutes: number;
}

export interface ApplyDailyAutoJobBudgetInput {
  plan: BackgroundCurationPlan;
  budget?: DailyAutoJobBudgetRecord;
  limit: number;
  now?: string | Date;
}

export interface DailyAutoJobBudgetResult {
  plan: BackgroundCurationPlan;
  budget: DailyAutoJobBudgetRecord;
  discardedJobIds: string[];
}

export interface CreateBackgroundCurationPlanInput {
  signals: InteractionSignal[];
  feedback: LearningFeedback[];
  topicStates?: TopicState[];
  sourceCandidates?: BackgroundSourceCandidate[];
  contentLanguage?: ContentLanguage;
  generatedAt?: string | Date;
  config?: Partial<BackgroundCurationConfig>;
}

export const defaultBackgroundCurationConfig: BackgroundCurationConfig = {
  minCandidateScore: 0.55,
  maxJobsPerTopic: 3,
  maxSourceImportsPerTopic: 2,
  sourceDiscoveryDelayMinutes: 20
};

export function createBackgroundCurationPlan(input: CreateBackgroundCurationPlanInput): BackgroundCurationPlan {
  const config = { ...defaultBackgroundCurationConfig, ...input.config };
  const generatedAt = normalizeDate(input.generatedAt);
  const expansionPlan = createExpansionPlan({
    signals: input.signals,
    feedback: input.feedback,
    topicStates: input.topicStates,
    generatedAt
  });
  const signalsByPost = new Map(input.signals.map((signal) => [signal.postId, signal]));
  const feedbackByPost = new Map(input.feedback.map((feedback) => [feedback.postId, feedback]));
  const usedCandidateIds = new Set<string>();
  const jobs: BackgroundCurationJob[] = [];
  const suppressions: BackgroundCurationSuppression[] = expansionPlan.suppressions.map((suppression) => ({
    topicId: suppression.topicId,
    postId: suppression.postId,
    reason: suppression.reason
  }));
  const jobsPerTopic = new Map<string, number>();

  for (const expansionJob of expansionPlan.jobs) {
    const signal = signalsByPost.get(expansionJob.postId);
    const feedback = feedbackByPost.get(expansionJob.postId);

    if (expansionJob.nextAction === "continue_deeper") {
      const selectedCandidates = selectSourceCandidates(
        expansionJob,
        input.sourceCandidates ?? [],
        usedCandidateIds,
        config
      );

      if (selectedCandidates.length === 0) {
        queueJob(
          createSourceDiscoveryJob(expansionJob, generatedAt, config, input.contentLanguage ?? "zh"),
          jobs,
          jobsPerTopic,
          suppressions,
          config
        );
        continue;
      }

      for (const candidate of selectedCandidates) {
        usedCandidateIds.add(candidate.id);
        queueJob(
          createSourceImportJob(expansionJob, candidate, generatedAt, input.contentLanguage ?? "zh"),
          jobs,
          jobsPerTopic,
          suppressions,
          config
        );
      }

      continue;
    }

    queueJob(mapExpansionJob(expansionJob), jobs, jobsPerTopic, suppressions, config);

    if (!shouldQueueBackgroundSources(expansionJob, signal, feedback)) {
      continue;
    }

    const selectedCandidates = selectSourceCandidates(
      expansionJob,
      input.sourceCandidates ?? [],
      usedCandidateIds,
      config
    );

    if (selectedCandidates.length === 0) {
      queueJob(
        createSourceDiscoveryJob(expansionJob, generatedAt, config, input.contentLanguage ?? "zh"),
        jobs,
        jobsPerTopic,
        suppressions,
        config
      );
      continue;
    }

    for (const candidate of selectedCandidates) {
      usedCandidateIds.add(candidate.id);
      queueJob(
        createSourceImportJob(expansionJob, candidate, generatedAt, input.contentLanguage ?? "zh"),
        jobs,
        jobsPerTopic,
        suppressions,
        config
      );
    }
  }

  return {
    generatedAt: generatedAt.toISOString(),
    jobs: jobs.sort((left, right) => right.priority - left.priority),
    suppressions,
    acceptedSourceCandidateIds: Array.from(usedCandidateIds),
    cooledTopicIds: expansionPlan.cooledTopicIds,
    expansionPlan
  };
}

export function applyDailyAutoJobBudget(input: ApplyDailyAutoJobBudgetInput): DailyAutoJobBudgetResult {
  const now = normalizeDate(input.now ?? input.plan.generatedAt);
  const date = now.toISOString().slice(0, 10);
  const limit = Math.max(0, Math.floor(input.limit));
  const startingUsed = input.budget?.date === date ? input.budget.used : 0;
  const startingDiscarded = input.budget?.date === date ? input.budget.discarded : 0;
  let used = startingUsed;
  let discarded = startingDiscarded;
  const discardedJobIds: string[] = [];
  const discardedSourceCandidateIds = new Set<string>();
  const jobs = input.plan.jobs.filter((job) => {
    if (!isMeteredAutoJobKind(job.kind)) {
      return true;
    }

    if (used < limit) {
      used += 1;
      return true;
    }

    discarded += 1;
    discardedJobIds.push(job.id);
    if (job.sourceCandidate?.id) {
      discardedSourceCandidateIds.add(job.sourceCandidate.id);
    }
    return false;
  });
  const budget: DailyAutoJobBudgetRecord = {
    date,
    used,
    limit,
    discarded,
    updatedAt: now.toISOString()
  };

  return {
    plan: {
      ...input.plan,
      jobs,
      acceptedSourceCandidateIds: input.plan.acceptedSourceCandidateIds.filter(
        (candidateId) => !discardedSourceCandidateIds.has(candidateId)
      ),
      suppressions: [
        ...input.plan.suppressions,
        ...discardedJobIds.map((jobId) => ({
          topicId: "daily-auto-job-budget",
          reason: `Discarded automatic job ${jobId} because the daily budget was exhausted.`
        }))
      ]
    },
    budget,
    discardedJobIds
  };
}

export function isMeteredAutoJobKind(kind: BackgroundCurationJobKind): boolean {
  return (
    kind === "discover_sources" ||
    kind === "import_source" ||
    kind === "generate_followup" ||
    kind === "concept_brief"
  );
}

function shouldQueueBackgroundSources(
  expansionJob: AgentExpansionJob,
  signal: InteractionSignal | undefined,
  feedback: LearningFeedback | undefined
): boolean {
  if (expansionJob.kind !== "generate_followup") {
    return false;
  }

  if (expansionJob.nextAction === "reframe_simpler") {
    return false;
  }

  if (!signal) {
    return expansionJob.nextAction === "continue_deeper" || expansionJob.nextAction === "expand_broader";
  }

  return shouldContinueSeries(signal, feedback);
}

function selectSourceCandidates(
  expansionJob: AgentExpansionJob,
  candidates: BackgroundSourceCandidate[],
  usedCandidateIds: Set<string>,
  config: BackgroundCurationConfig
): BackgroundSourceCandidate[] {
  return candidates
    .filter((candidate) => !usedCandidateIds.has(candidate.id))
    .filter((candidate) => candidateMatchesJob(candidate, expansionJob))
    .map((candidate) => ({
      candidate,
      score: scoreSourceCandidate(candidate, expansionJob)
    }))
    .filter((candidateScore) => candidateScore.score >= config.minCandidateScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, config.maxSourceImportsPerTopic)
    .map((candidateScore) => candidateScore.candidate);
}

function candidateMatchesJob(candidate: BackgroundSourceCandidate, expansionJob: AgentExpansionJob): boolean {
  if (candidate.topicId && candidate.topicId === expansionJob.topicId) {
    return true;
  }

  return candidate.conceptIds.some((conceptId) => expansionJob.conceptIds.includes(conceptId));
}

function scoreSourceCandidate(candidate: BackgroundSourceCandidate, expansionJob: AgentExpansionJob): number {
  const overlapCount = candidate.conceptIds.filter((conceptId) => expansionJob.conceptIds.includes(conceptId)).length;
  const overlapScore = expansionJob.conceptIds.length ? overlapCount / expansionJob.conceptIds.length : 0;
  const score =
    candidate.relevanceScore * 0.45 +
    candidate.qualityScore * 0.25 +
    candidate.noveltyScore * 0.15 +
    overlapScore * 0.15;

  return roundPriority(score);
}

function mapExpansionJob(job: AgentExpansionJob): BackgroundCurationJob {
  return {
    id: `${job.id}-curation`,
    kind: job.kind,
    postId: job.postId,
    topicId: job.topicId,
    conceptIds: job.conceptIds,
    nextAction: job.nextAction,
    priority: job.priority,
    reason: job.reason,
    createdAt: job.createdAt,
    runAfter: job.runAfter
  };
}

function createSourceImportJob(
  expansionJob: AgentExpansionJob,
  candidate: BackgroundSourceCandidate,
  generatedAt: Date,
  contentLanguage: ContentLanguage
): BackgroundCurationJob {
  const sourceScore = scoreSourceCandidate(candidate, expansionJob);

  return {
    id: `${expansionJob.id}-import-${candidate.id}`,
    kind: "import_source",
    postId: expansionJob.postId,
    topicId: expansionJob.topicId,
    conceptIds: mergeUnique(expansionJob.conceptIds, candidate.conceptIds),
    nextAction: expansionJob.nextAction,
    priority: roundPriority(Math.min(1, expansionJob.priority * 0.65 + sourceScore * 0.35)),
    reason:
      expansionJob.nextAction === "continue_deeper"
        ? contentLanguage === "en"
          ? `You asked to go deeper, so this new source is being packaged for your timeline: ${candidate.reason}`
          : `你点了深入,所以为时间线打包这个新来源:${candidate.reason}`
        : contentLanguage === "en"
          ? `You showed interest, so this related source is being packaged for your timeline: ${candidate.reason}`
          : `你表现出了兴趣,所以为时间线打包这个相关来源:${candidate.reason}`,
    createdAt: generatedAt.toISOString(),
    runAfter: generatedAt.toISOString(),
    sourceCandidate: candidate
  };
}

function createSourceDiscoveryJob(
  expansionJob: AgentExpansionJob,
  generatedAt: Date,
  config: BackgroundCurationConfig,
  contentLanguage: ContentLanguage
): BackgroundCurationJob {
  const runAfter = new Date(generatedAt);
  runAfter.setMinutes(runAfter.getMinutes() + config.sourceDiscoveryDelayMinutes);

  return {
    id: `${expansionJob.id}-discover-sources`,
    kind: "discover_sources",
    postId: expansionJob.postId,
    topicId: expansionJob.topicId,
    conceptIds: expansionJob.conceptIds,
    nextAction: expansionJob.nextAction,
    priority: roundPriority(Math.max(0.1, expansionJob.priority - 0.08)),
    reason:
      contentLanguage === "en"
        ? "You showed interest, but there is no matching candidate source yet, so the agent will look for one."
        : "你表现出了兴趣,但目前还没有匹配的候选来源,所以让智能体去找一找。",
    createdAt: generatedAt.toISOString(),
    runAfter: runAfter.toISOString()
  };
}

function queueJob(
  job: BackgroundCurationJob,
  jobs: BackgroundCurationJob[],
  jobsPerTopic: Map<string, number>,
  suppressions: BackgroundCurationSuppression[],
  config: BackgroundCurationConfig
): void {
  const jobCount = jobsPerTopic.get(job.topicId) ?? 0;

  if (jobCount >= config.maxJobsPerTopic && job.kind !== "cooldown_topic") {
    suppressions.push({
      topicId: job.topicId,
      sourceCandidateId: job.sourceCandidate?.id,
      reason: "Topic already has enough background curation jobs queued."
    });
    return;
  }

  jobs.push(job);
  jobsPerTopic.set(job.topicId, jobCount + 1);
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}

function mergeUnique(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]));
}

function roundPriority(value: number): number {
  return Math.round(value * 100) / 100;
}
