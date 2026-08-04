import { createKnowledgePost, harnessVersion } from "./postHarness.js";
import { validateGrounding } from "./groundingGate.js";
import { validateKnowledgePost } from "./schema.js";
import { createSourceRegistry } from "../source/sourceRegistry.js";
import type { ContentLanguage } from "./contentLanguage.js";
import type {
  AgentHarnessConfig,
  AgentHarnessRunInput,
  AgentHarnessRunResult,
  HarnessValidationIssue,
  HarnessValidationResult,
  KnowledgeChunk,
  KnowledgePost,
  KnowledgePostAgentRunner,
  PaperDigestFigure,
  SourceRegistry
} from "../types.js";

export type AgentHarnessConfigOverrides = Partial<Omit<AgentHarnessConfig, "threadPolicy" | "graphPolicy" | "reviewPolicy">> & {
  threadPolicy?: Partial<AgentHarnessConfig["threadPolicy"]>;
  graphPolicy?: Partial<AgentHarnessConfig["graphPolicy"]>;
  reviewPolicy?: Partial<AgentHarnessConfig["reviewPolicy"]>;
};

export const defaultAgentHarnessConfig: AgentHarnessConfig = {
  id: "aitimeline-default-harness",
  version: harnessVersion,
  runnerKind: "deterministic",
  objective: "source_import",
  maxPostsPerRun: 4,
  threadPolicy: {
    requiredKinds: ["explain", "example", "contrast", "extension", "quiz"],
    maxBlocksPerPost: 7
  },
  graphPolicy: {
    maxEdgesPerPost: 6,
    minEdgeWeight: 0.4
  },
  reviewPolicy: {
    enabled: true,
    dueInDays: [1, 3, 7]
  }
};

export const deterministicKnowledgePostRunner: KnowledgePostAgentRunner = {
  id: "deterministic-knowledge-post-runner",
  kind: "deterministic",
  run: runDeterministicAgentHarness
};

export async function runAgentHarness(
  input: AgentHarnessRunInput,
  runner: KnowledgePostAgentRunner = deterministicKnowledgePostRunner
): Promise<AgentHarnessRunResult> {
  return runner.run(input);
}

export function runDeterministicAgentHarness(input: AgentHarnessRunInput): AgentHarnessRunResult {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const config = input.config ?? defaultAgentHarnessConfig;
  const chunks = selectAgentHarnessInputChunks(input, config);
  const postChunks = input.paperDigest ? chunks : chunks.slice(0, config.maxPostsPerRun);
  const sourceRegistry =
    input.sourceRegistry ??
    createSourceRegistry({
      sources: [input.source],
      chunks,
      createdAt
    });
  const recommendedBecause =
    input.recommendedBecause ?? getDefaultRecommendedBecause(input.contentLanguage);
  const posts = input.paperDigest
    ? createDeterministicPaperDigestPosts(input, createdAt, recommendedBecause)
    : postChunks.map((chunk, index) =>
        createKnowledgePost({
          source: input.source,
          chunk,
          index,
          createdAt,
          recommendedBecause,
          contentLanguage: input.contentLanguage
        })
      );
  const validation = validateHarnessPosts(posts, config, sourceRegistry);
  const acceptedPosts = posts.filter((_post, index) => isHarnessValidationAccepted(validation[index]));
  const status = acceptedPosts.length ? "succeeded" : "failed";

  return {
    run: {
      id: input.id ?? buildRunId(input.source.id, createdAt),
      sourceId: input.source.id,
      harnessVersion: config.version,
      runnerKind: deterministicKnowledgePostRunner.kind,
      objective: config.objective,
      status,
      createdAt,
      completedAt: new Date().toISOString(),
      sourceSnapshotIds: sourceRegistry.snapshots.map((snapshot) => snapshot.id),
      inputChunkIds: chunks.map((chunk) => chunk.id),
      outputPostIds: acceptedPosts.map((post) => post.id),
      validation
    },
    posts: acceptedPosts,
    validation,
    sourceRegistry
  };
}

export function createAgentHarnessConfig(overrides: AgentHarnessConfigOverrides = {}): AgentHarnessConfig {
  return {
    ...defaultAgentHarnessConfig,
    ...overrides,
    threadPolicy: {
      ...defaultAgentHarnessConfig.threadPolicy,
      ...overrides.threadPolicy
    },
    graphPolicy: {
      ...defaultAgentHarnessConfig.graphPolicy,
      ...overrides.graphPolicy
    },
    reviewPolicy: {
      ...defaultAgentHarnessConfig.reviewPolicy,
      ...overrides.reviewPolicy
    }
  };
}

export function selectAgentHarnessInputChunks(
  input: AgentHarnessRunInput,
  config: AgentHarnessConfig = defaultAgentHarnessConfig
): KnowledgeChunk[] {
  if (!input.paperDigest) {
    return sampleRegularSourceChunks(input);
  }

  const chunkById = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
  const selectedChunkIds = new Set<string>();
  const sampledBuckets = input.paperDigest.buckets.map((bucket) => ({
    cursor: 0,
    selectedCount: 0,
    chunks: bucket.chunkIds.flatMap((chunkId) => {
      const chunk = chunkById.get(chunkId);

      return chunk ? [chunk] : [];
    })
  }));
  const selectedChunks: KnowledgeChunk[] = [];
  const maxTotalChunks = 16;
  const maxChunksPerBucket = 4;

  const addNextChunk = (bucket: (typeof sampledBuckets)[number]): boolean => {
    if (bucket.selectedCount >= maxChunksPerBucket || selectedChunks.length >= maxTotalChunks) {
      return false;
    }

    while (bucket.cursor < bucket.chunks.length) {
      const chunk = bucket.chunks[bucket.cursor];
      bucket.cursor += 1;

      if (!chunk || selectedChunkIds.has(chunk.id)) {
        continue;
      }

      selectedChunkIds.add(chunk.id);
      selectedChunks.push(chunk);
      bucket.selectedCount += 1;
      return true;
    }

    return false;
  };

  for (const bucket of sampledBuckets) {
    addNextChunk(bucket);
  }

  while (selectedChunks.length < maxTotalChunks) {
    let added = false;

    for (const bucket of sampledBuckets) {
      added = addNextChunk(bucket) || added;

      if (selectedChunks.length >= maxTotalChunks) {
        break;
      }
    }

    if (!added) {
      break;
    }
  }

  return selectedChunks;
}

function sampleRegularSourceChunks(input: AgentHarnessRunInput): KnowledgeChunk[] {
  const maxTotalChunks = 16;

  if (input.chunks.length <= maxTotalChunks) {
    return input.chunks;
  }

  const contextConcepts = collectUserContextConcepts(input.userContext);
  const chunksWithIndex = input.chunks.map((chunk, index) => ({
    chunk,
    index,
    score: scoreChunkRelevance(chunk, contextConcepts)
  }));
  const bucketSize = Math.ceil(chunksWithIndex.length / 3);
  const buckets = [
    chunksWithIndex.slice(0, bucketSize),
    chunksWithIndex.slice(bucketSize, bucketSize * 2),
    chunksWithIndex.slice(bucketSize * 2)
  ]
    .filter((bucket) => bucket.length > 0)
    .map((bucket) => ({
      cursor: 0,
      chunks: [...bucket].sort((left, right) => right.score - left.score || left.index - right.index)
    }));
  const selected = new Map<string, { chunk: KnowledgeChunk; index: number }>();

  while (selected.size < maxTotalChunks) {
    let added = false;

    for (const bucket of buckets) {
      while (bucket.cursor < bucket.chunks.length) {
        const item = bucket.chunks[bucket.cursor];
        bucket.cursor += 1;

        if (selected.has(item.chunk.id)) {
          continue;
        }

        selected.set(item.chunk.id, { chunk: item.chunk, index: item.index });
        added = true;
        break;
      }

      if (selected.size >= maxTotalChunks) {
        break;
      }
    }

    if (!added) {
      break;
    }
  }

  return Array.from(selected.values())
    .sort((left, right) => left.index - right.index)
    .map((item) => item.chunk);
}

function collectUserContextConcepts(context: AgentHarnessRunInput["userContext"]): string[] {
  if (!context) {
    return [];
  }

  return Array.from(
    new Set(
      [
        ...(context.knownConcepts ?? []),
        ...(context.savedConcepts ?? []),
        ...(context.weakConcepts ?? []),
        ...(context.memory?.profile.interests ?? []),
        ...(context.memory?.knowledge.knownConcepts ?? []),
        ...(context.memory?.knowledge.savedConcepts ?? []),
        ...(context.memory?.knowledge.weakConcepts ?? []),
        ...(context.topicStates?.map((state) => state.topicId) ?? []),
        ...(context.recentSignals?.flatMap((signal) => [signal.topicId, ...(signal.conceptIds ?? [])]) ?? [])
      ]
        .map((concept) => concept.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function scoreChunkRelevance(chunk: KnowledgeChunk, contextConcepts: string[]): number {
  const content = chunk.content.toLowerCase();
  const hints = chunk.conceptHints?.map((hint) => hint.trim().toLowerCase()).filter(Boolean) ?? [];
  const hintMatches = hints.filter((hint) => contextConcepts.includes(hint)).length;
  const contentMatches = contextConcepts.filter((concept) => concept && content.includes(concept)).length;

  return hintMatches * 3 + contentMatches + hints.length * 0.2;
}

export function validateHarnessPosts(
  posts: readonly unknown[],
  config: AgentHarnessConfig = defaultAgentHarnessConfig,
  sourceRegistry?: SourceRegistry
): HarnessValidationResult[] {
  const duplicatePostIds = collectDuplicatePostIds(posts);
  const maxPostsPerRun = normalizeMaxPostsPerRun(config.maxPostsPerRun);

  return posts.map((candidate, index) => {
    const result = validateKnowledgePost(candidate);
    const batchIssues = validatePostBatchEntry(candidate, index, maxPostsPerRun, duplicatePostIds);

    if (!result.valid || !isKnowledgePostLike(candidate)) {
      return {
        ...result,
        valid: result.valid && !batchIssues.some((issue) => issue.severity === "error"),
        issues: [...result.issues, ...batchIssues]
      };
    }

    const post = candidate;
    const policyIssues = validatePostPolicies(post, config);
    const mediaIssues = sourceRegistry ? validatePostMedia(post, sourceRegistry) : [];
    const grounding = sourceRegistry
      ? validateGrounding(post, sourceRegistry, {
          sameSourceFollowup: config.objective === "followup_generation" || config.lenientGrounding === true
        })
      : undefined;
    const groundingIssues = grounding?.issues ?? [];

    return {
      ...result,
      valid:
        result.valid &&
        !policyIssues.some((issue) => issue.severity === "error") &&
        !mediaIssues.some((issue) => issue.severity === "error") &&
        !groundingIssues.some((issue) => issue.severity === "error") &&
        !batchIssues.some((issue) => issue.severity === "error"),
      issues: [...result.issues, ...policyIssues, ...mediaIssues, ...groundingIssues, ...batchIssues],
      grounding
    };
  });
}

function validatePostBatchEntry(
  candidate: unknown,
  index: number,
  maxPostsPerRun: number,
  duplicatePostIds: ReadonlySet<string>
): HarnessValidationIssue[] {
  const issues: HarnessValidationIssue[] = [];
  const postId = getCandidatePostId(candidate);

  if (index >= maxPostsPerRun) {
    // The model-declared order is stable, so invalidating the tail gives us a deterministic
    // truncation after repair attempts without discarding an otherwise valid leading batch.
    issues.push({
      path: "$",
      message: `post exceeds the configured maxPostsPerRun limit of ${maxPostsPerRun}.`,
      severity: "error"
    });
  }

  if (postId && duplicatePostIds.has(postId)) {
    issues.push({
      path: "$.id",
      message: `post id "${postId}" must be unique within a harness run.`,
      severity: "error"
    });
  }

  return issues;
}

function collectDuplicatePostIds(posts: readonly unknown[]): Set<string> {
  const counts = new Map<string, number>();

  for (const candidate of posts) {
    const postId = getCandidatePostId(candidate);

    if (postId) {
      counts.set(postId, (counts.get(postId) ?? 0) + 1);
    }
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([postId]) => postId)
  );
}

function getCandidatePostId(candidate: unknown): string | undefined {
  if (typeof candidate !== "object" || candidate === null || !("id" in candidate)) {
    return undefined;
  }

  return typeof candidate.id === "string" ? candidate.id : undefined;
}

function normalizeMaxPostsPerRun(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function isHarnessValidationAccepted(result: HarnessValidationResult | undefined): boolean {
  return Boolean(
    result?.valid && !result.issues.some((issue) => issue.severity === "error")
  );
}

export function validateGeneratedKnowledgePost(
  post: unknown,
  config: AgentHarnessConfig = defaultAgentHarnessConfig
): HarnessValidationResult {
  const baseResult = validateKnowledgePost(post);

  if (!baseResult.valid || !isKnowledgePostLike(post)) {
    return baseResult;
  }

  const policyIssues = validatePostPolicies(post, config);

  return {
    ...baseResult,
    valid: baseResult.valid && !policyIssues.some((issue) => issue.severity === "error"),
    issues: [...baseResult.issues, ...policyIssues]
  };
}

function validatePostPolicies(post: KnowledgePost, config: AgentHarnessConfig): HarnessValidationIssue[] {
  const issues: HarnessValidationIssue[] = [];
  const threadKinds = new Set(post.thread.map((block) => block.kind));

  for (const requiredKind of config.threadPolicy.requiredKinds) {
    if (!threadKinds.has(requiredKind)) {
      issues.push({
        path: "$.thread",
        message: `thread is missing required ${requiredKind} block.`,
        severity: "error"
      });
    }
  }

  if (post.thread.length > config.threadPolicy.maxBlocksPerPost) {
    issues.push({
      path: "$.thread",
      message: "thread has more blocks than the feed harness recommends.",
      severity: "warning"
    });
  }

  if (post.graphEdges.length > config.graphPolicy.maxEdgesPerPost) {
    issues.push({
      path: "$.graphEdges",
      message: "graphEdges exceeds the configured max edges per post.",
      severity: "warning"
    });
  }

  for (const edge of post.graphEdges) {
    if (edge.weight < config.graphPolicy.minEdgeWeight) {
      issues.push({
        path: `$.graphEdges.${edge.id}.weight`,
        message: "graph edge is below the configured minimum weight.",
        severity: "warning"
      });
    }
  }

  if (!config.reviewPolicy.enabled && post.reviewPrompts.length > 0) {
    issues.push({
      path: "$.reviewPrompts",
      message: "review prompts were generated while review policy is disabled.",
      severity: "warning"
    });
  }

  return issues;
}

function createDeterministicPaperDigestPosts(
  input: AgentHarnessRunInput,
  createdAt: string,
  recommendedBecause: string
): KnowledgePost[] {
  const paperDigest = input.paperDigest;

  if (!paperDigest) {
    return [];
  }

  const chunkById = new Map(input.chunks.map((chunk) => [chunk.id, chunk]));
  const posts: KnowledgePost[] = [];
  const cardGroups = [
    { bucketKinds: ["motivation"], mediaPurpose: undefined },
    { bucketKinds: ["method"], mediaPurpose: "method" },
    { bucketKinds: ["experiment", "result"], mediaPurpose: "experiment" },
    { bucketKinds: ["conclusion"], mediaPurpose: undefined }
  ] as const;

  for (const group of cardGroups) {
    const groupChunks = paperDigest.buckets
      .filter((bucket) => group.bucketKinds.some((bucketKind) => bucketKind === bucket.kind))
      .flatMap((bucket) => bucket.chunkIds.flatMap((chunkId) => {
        const chunk = chunkById.get(chunkId);

        return chunk ? [chunk] : [];
      }));

    if (!groupChunks.length) {
      continue;
    }

    const post = createKnowledgePost({
      source: input.source,
      chunk: groupChunks[0],
      index: posts.length,
      createdAt,
      recommendedBecause,
      contentLanguage: input.contentLanguage
    });
    const figure = group.mediaPurpose ? findMatchingPaperFigure(paperDigest.figures, group.mediaPurpose) : undefined;

    posts.push(
      figure
        ? {
            ...post,
            media: [
              {
                assetId: figure.assetId,
                caption: figure.caption,
                origin: "paper"
              }
            ]
          }
        : post
    );
  }

  return posts;
}

function getDefaultRecommendedBecause(contentLanguage?: ContentLanguage): string {
  return contentLanguage === "en"
    ? "This source was imported and turned into timeline-ready knowledge cards."
    : "这个来源已导入,并转成了可以进时间线的知识卡片。";
}

function findMatchingPaperFigure(
  figures: readonly PaperDigestFigure[],
  purpose: "method" | "experiment"
): PaperDigestFigure | undefined {
  const keywords =
    purpose === "method"
      ? ["architecture", "overview", "method", "model", "framework", "pipeline", "system", "design"]
      : ["result", "experiment", "table", "evaluation", "benchmark", "ablation", "performance", "accuracy", "baseline"];

  return figures.find((figure) => {
    const haystack = `${figure.figureLabel} ${figure.caption}`.toLowerCase();

    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

function validatePostMedia(post: KnowledgePost, sourceRegistry: SourceRegistry): HarnessValidationIssue[] {
  const issues: HarnessValidationIssue[] = [];

  if (!post.media) {
    return issues;
  }

  const imageAssetIds = new Set(
    sourceRegistry.assets.filter((asset) => asset.kind === "image").map((asset) => asset.id)
  );

  post.media.forEach((mediaItem, index) => {
    if (!imageAssetIds.has(mediaItem.assetId)) {
      issues.push({
        path: `$.media[${index}].assetId`,
        message: `media assetId "${mediaItem.assetId}" must reference a registered image asset.`,
        severity: "error"
      });
    }
  });

  return issues;
}

function buildRunId(sourceId: string, createdAt: string): string {
  return `${sourceId}-harness-${createdAt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function isKnowledgePostLike(value: unknown): value is KnowledgePost {
  return typeof value === "object" && value !== null && "thread" in value && "graphEdges" in value && "reviewPrompts" in value;
}
