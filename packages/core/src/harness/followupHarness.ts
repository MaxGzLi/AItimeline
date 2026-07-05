import type { BackgroundCurationJob } from "../agents/backgroundCuration.js";
import type { SourceImportWorkerInput } from "../source/sourceImportWorker.js";
import type {
  HarnessValidationIssue,
  HarnessValidationResult,
  KnowledgeChunk,
  KnowledgePost,
  NextActionPolicy,
  Source,
  ThreadBlockKind
} from "../types.js";
import { createAgentHarnessConfig } from "./runner.js";

export type FollowupGenerationIntent = "continue_deeper" | "expand_broader" | "reframe_simpler" | "review_reinforcement";

export interface FollowupGenerationProtocol {
  id: string;
  version: "followup-harness-v0";
  jobId: string;
  originPostId?: string;
  topicId: string;
  conceptIds: string[];
  intent: FollowupGenerationIntent;
  learningGoal: string;
  sourcePolicy: {
    groundingMode: "seed_post_and_registered_chunks";
    seedSourceIds: string[];
    allowedClaimKinds: string[];
    forbiddenClaims: string[];
  };
  outputContract: {
    maxPosts: number;
    requiredThreadKinds: ThreadBlockKind[];
    requiresGraphEdges: boolean;
    requiresReviewPrompts: boolean;
    requiresCitations: boolean;
  };
  storagePlan: {
    sourceId: string;
    chunkIds: string[];
    postIdPrefix: string;
  };
  systemPrompt: string;
  userPrompt: string;
  createdAt: string;
}

export interface FollowupSourceImportPlan {
  protocol: FollowupGenerationProtocol;
  input: SourceImportWorkerInput;
}

export interface CreateFollowupGenerationProtocolInput {
  job: BackgroundCurationJob;
  seedPost?: KnowledgePost;
  createdAt?: string | Date;
}

export interface CreateFollowupSourceImportPlanInput extends CreateFollowupGenerationProtocolInput {
  seedPost: KnowledgePost;
}

export const followupHarnessSystemPrompt = `You are the AITimeline Follow-up Agent.

Your job is to create the next timeline post after a user interaction.

Hard rules:
1. Follow the intent exactly: deepen, broaden, simplify, or reinforce review.
2. Use only the seed post, registered chunks, user signal reason, and provided concepts as factual grounding.
3. If no external source is attached, say less rather than invent facts.
4. Produce timeline-native KnowledgePost output with citations, thread blocks, graph edges, review prompts, and nextActions.
5. Store every generated idea as a source-backed chunk before it becomes a post.
6. Make the post addictive through clarity, tension, and curiosity, not unsupported claims.

Language policy:
- Write all user-facing text in Simplified Chinese.
- Keep technical terms, proper nouns, and concept names in their original English (e.g., AI Agent, RAG, LLM); do not translate them.
- Quotes from sources must stay verbatim in the source language.
- Except inside citation quote fields, never copy sentences from the evidence verbatim; explain in your own words in Simplified Chinese while keeping the key English terms.
- Numbers must match the cited evidence exactly.
- Keep concepts and graphEdges concept names in English so graph nodes stay continuous.
- Every source-fact field (summary, thesis, shortBody, graphEdges evidence) must retain at least one key English term or number taken from the cited evidence.`;

const protocolVersion = "followup-harness-v0" as const;
const requiredThreadKinds: ThreadBlockKind[] = ["explain", "example", "contrast", "extension", "quiz"];

export function createFollowupGenerationProtocol(
  input: CreateFollowupGenerationProtocolInput
): FollowupGenerationProtocol {
  const createdAt = normalizeDate(input.createdAt).toISOString();
  const intent = inferFollowupIntent(input.job.nextAction);
  const sourceId = buildFollowupSourceId(input.job);
  const chunkIds = [`${sourceId}-chunk-1`];

  return {
    id: `${sourceId}-protocol`,
    version: protocolVersion,
    jobId: input.job.id,
    originPostId: input.job.postId,
    topicId: input.job.topicId,
    conceptIds: normalizeConcepts(input.job.conceptIds),
    intent,
    learningGoal: buildLearningGoal(intent, input.job, input.seedPost),
    sourcePolicy: {
      groundingMode: "seed_post_and_registered_chunks",
      seedSourceIds: input.seedPost?.sources.map((source) => source.id) ?? [],
      allowedClaimKinds: [
        "facts quoted or paraphrased from the seed post",
        "interpretations explicitly derived from the seed post",
        "examples framed as examples, not source facts",
        "questions and review prompts"
      ],
      forbiddenClaims: [
        "new facts from the open web unless an import_source job attached a source",
        "statistics, names, or dates not present in registered chunks",
        "claims that cannot be cited back to a chunk"
      ]
    },
    outputContract: {
      maxPosts: 1,
      requiredThreadKinds,
      requiresGraphEdges: true,
      requiresReviewPrompts: true,
      requiresCitations: true
    },
    storagePlan: {
      sourceId,
      chunkIds,
      postIdPrefix: `${sourceId}-post`
    },
    systemPrompt: followupHarnessSystemPrompt,
    userPrompt: buildUserPrompt(intent, input.job, input.seedPost),
    createdAt
  };
}

export function validateFollowupGenerationProtocol(protocol: unknown): HarnessValidationResult {
  const issues: HarnessValidationIssue[] = [];
  const postId = isRecord(protocol) && typeof protocol.id === "string" ? protocol.id : undefined;

  if (!isRecord(protocol)) {
    return {
      postId,
      valid: false,
      issues: [{ path: "$", message: "Follow-up protocol must be an object.", severity: "error" }]
    };
  }

  requireString(protocol, "id", issues);
  requireString(protocol, "jobId", issues);
  requireString(protocol, "topicId", issues);
  requireString(protocol, "learningGoal", issues);
  requireString(protocol, "systemPrompt", issues);
  requireString(protocol, "userPrompt", issues);
  requireString(protocol, "createdAt", issues);

  if (protocol.version !== protocolVersion) {
    issues.push({ path: "$.version", message: "Follow-up protocol version is unsupported.", severity: "error" });
  }

  if (!isFollowupIntent(protocol.intent)) {
    issues.push({ path: "$.intent", message: "Follow-up intent is unsupported.", severity: "error" });
  }

  if (!Array.isArray(protocol.conceptIds) || protocol.conceptIds.length === 0) {
    issues.push({ path: "$.conceptIds", message: "Follow-up protocol requires at least one concept.", severity: "error" });
  }

  if (!isRecord(protocol.outputContract)) {
    issues.push({ path: "$.outputContract", message: "Follow-up protocol requires an output contract.", severity: "error" });
  } else {
    for (const kind of requiredThreadKinds) {
      if (!Array.isArray(protocol.outputContract.requiredThreadKinds) || !protocol.outputContract.requiredThreadKinds.includes(kind)) {
        issues.push({
          path: "$.outputContract.requiredThreadKinds",
          message: `Follow-up output contract must require ${kind} thread block.`,
          severity: "error"
        });
      }
    }
  }

  if (!isRecord(protocol.storagePlan) || !Array.isArray(protocol.storagePlan.chunkIds) || protocol.storagePlan.chunkIds.length === 0) {
    issues.push({ path: "$.storagePlan", message: "Follow-up protocol requires chunk storage ids.", severity: "error" });
  }

  return {
    postId,
    valid: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}

export function createFollowupSourceImportPlan(input: CreateFollowupSourceImportPlanInput): FollowupSourceImportPlan {
  const protocol = createFollowupGenerationProtocol(input);
  const source = createFollowupSource(protocol, input.seedPost);
  const chunks = createFollowupChunks(protocol, input.job, input.seedPost);

  return {
    protocol,
    input: {
      id: `${protocol.storagePlan.sourceId}-import-${dateSlug(protocol.createdAt)}`,
      source,
      chunks,
      createdAt: protocol.createdAt,
      recommendedBecause: buildRecommendedBecause(protocol, input.job),
      config: createAgentHarnessConfig({
        objective: "followup_generation",
        maxPostsPerRun: protocol.outputContract.maxPosts
      }),
      userContext: {
        topicStates: [
          {
            topicId: input.job.topicId,
            interestScore: protocol.intent === "reframe_simpler" ? 0.54 : 0.76,
            fatigueScore: 0.12,
            comprehensionScore: protocol.intent === "reframe_simpler" ? 0.36 : 0.68
          }
        ]
      }
    }
  };
}

function createFollowupSource(protocol: FollowupGenerationProtocol, seedPost: KnowledgePost | undefined): Source {
  const primaryConcept = protocol.conceptIds[0] ?? protocol.topicId;

  return {
    id: protocol.storagePlan.sourceId,
    title: `Follow-up: ${primaryConcept}`,
    url: `https://aitimeline.local/followups/${protocol.jobId}`,
    type: "manual",
    author: "AITimeline Follow-up Agent",
    publishedAt: protocol.createdAt,
    durationSeconds: seedPost?.estimatedReadMinutes ? seedPost.estimatedReadMinutes * 60 : undefined
  };
}

function createFollowupChunks(
  protocol: FollowupGenerationProtocol,
  _job: BackgroundCurationJob,
  seedPost: KnowledgePost
): KnowledgeChunk[] {
  const body = buildSeedPostGroundingContent(seedPost);

  return [
    {
      id: protocol.storagePlan.chunkIds[0],
      sourceId: protocol.storagePlan.sourceId,
      content: body,
      conceptHints: enrichConcepts(protocol.conceptIds, protocol.intent)
    }
  ];
}

function buildSeedPostGroundingContent(seedPost: KnowledgePost): string {
  return dedupeTexts([
    seedPost.title,
    seedPost.hook,
    seedPost.thesis,
    seedPost.shortBody,
    seedPost.summary,
    seedPost.keyTakeaway,
    ...seedPost.thread.flatMap((block) => [block.title, block.body, block.prompt])
  ]).join("\n\n");
}

function buildLearningGoal(
  intent: FollowupGenerationIntent,
  job: BackgroundCurationJob,
  seedPost: KnowledgePost | undefined
): string {
  const primaryConcept = job.conceptIds[0] ?? job.topicId;
  const seedTitle = seedPost?.title ? ` after "${seedPost.title}"` : "";

  if (intent === "expand_broader") {
    return `Broaden ${primaryConcept}${seedTitle} by connecting it to adjacent concepts without leaving the grounded source.`;
  }

  if (intent === "reframe_simpler") {
    return `Simplify ${primaryConcept}${seedTitle} because the user likely needs a clearer mental model before more depth.`;
  }

  if (intent === "review_reinforcement") {
    return `Turn ${primaryConcept}${seedTitle} into durable recall with a concise review-focused follow-up.`;
  }

  return `Deepen ${primaryConcept}${seedTitle} by unpacking the mechanism, prerequisite, and practical consequence.`;
}

function buildUserPrompt(
  intent: FollowupGenerationIntent,
  job: BackgroundCurationJob,
  seedPost: KnowledgePost | undefined
): string {
  return [
    "Create one follow-up KnowledgePost for the timeline.",
    `Intent: ${intent}.`,
    `Topic: ${job.topicId}.`,
    `Concepts: ${job.conceptIds.join(", ")}.`,
    `Reason: ${job.reason}`,
    seedPost ? `Seed post: ${JSON.stringify(toSeedPostSummary(seedPost), null, 2)}` : "Seed post: not available.",
    "Return a post that can be cited to the follow-up chunk and connected back to the user's knowledge graph."
  ].join("\n");
}

function buildRecommendedBecause(protocol: FollowupGenerationProtocol, job: BackgroundCurationJob): string {
  if (protocol.intent === "expand_broader") {
    return `你表现出足够的兴趣,可以把这个话题往外延展了。${job.reason}`;
  }

  if (protocol.intent === "reframe_simpler") {
    return `你提了问题或有些迟疑,所以换个更简单的角度重新讲一遍。${job.reason}`;
  }

  if (protocol.intent === "review_reinforcement") {
    return `你收藏或复习过,所以它作为回忆练习再次出现。${job.reason}`;
  }

  return `你表现出了兴趣,所以准备了一张更深入的跟进卡片。${job.reason}`;
}

function inferFollowupIntent(nextAction: NextActionPolicy | undefined): FollowupGenerationIntent {
  if (nextAction === "expand_broader") {
    return "expand_broader";
  }

  if (nextAction === "reframe_simpler" || nextAction === "ask_clarifying_question") {
    return "reframe_simpler";
  }

  if (nextAction === "schedule_review") {
    return "review_reinforcement";
  }

  return "continue_deeper";
}

function enrichConcepts(concepts: string[], intent: FollowupGenerationIntent): string[] {
  const additions: Record<FollowupGenerationIntent, string[]> = {
    continue_deeper: ["Mechanism", "Prerequisite"],
    expand_broader: ["Adjacent Concept", "Application"],
    reframe_simpler: ["Mental Model", "Clarifying Question"],
    review_reinforcement: ["Recall", "Spaced Review"]
  };

  return normalizeConcepts([...concepts, ...additions[intent]]);
}

function normalizeConcepts(concepts: string[]): string[] {
  return Array.from(new Set(concepts.map((concept) => concept.trim()).filter(Boolean)));
}

function dedupeTexts(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function toSeedPostSummary(post: KnowledgePost): Record<string, unknown> {
  return {
    id: post.id,
    title: post.title,
    thesis: post.thesis,
    keyTakeaway: post.keyTakeaway,
    concepts: post.concepts,
    sources: post.sources.map((source) => ({ id: source.id, title: source.title, type: source.type })),
    citations: post.citations
  };
}

function buildFollowupSourceId(job: BackgroundCurationJob): string {
  return `followup-${slug(job.topicId)}-${hashText(job.id).slice(0, 8)}`;
}

function isFollowupIntent(value: unknown): value is FollowupGenerationIntent {
  return (
    value === "continue_deeper" ||
    value === "expand_broader" ||
    value === "reframe_simpler" ||
    value === "review_reinforcement"
  );
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  issues: HarnessValidationIssue[],
  basePath = "$"
): void {
  if (typeof record[key] !== "string" || record[key].trim() === "") {
    issues.push({ path: `${basePath}.${key}`, message: `${key} must be a non-empty string.`, severity: "error" });
  }
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}

function dateSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "topic";
}

function hashText(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
