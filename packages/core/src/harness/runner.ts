import { createKnowledgePost, harnessVersion } from "./postHarness.js";
import { validateGrounding } from "./groundingGate.js";
import { validateKnowledgePost } from "./schema.js";
import { createSourceRegistry } from "../source/sourceRegistry.js";
import type {
  AgentHarnessConfig,
  AgentHarnessRunInput,
  AgentHarnessRunResult,
  HarnessValidationIssue,
  HarnessValidationResult,
  KnowledgePost,
  KnowledgePostAgentRunner,
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
  maxPostsPerRun: 12,
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
  const chunks = input.chunks.slice(0, config.maxPostsPerRun);
  const sourceRegistry =
    input.sourceRegistry ??
    createSourceRegistry({
      sources: [input.source],
      chunks,
      createdAt
    });
  const recommendedBecause =
    input.recommendedBecause ?? "这个来源已导入,并转成了可以进时间线的知识卡片。";
  const posts = chunks.map((chunk, index) =>
    createKnowledgePost({
      source: input.source,
      chunk,
      index,
      createdAt,
      recommendedBecause
    })
  );
  const validation = validateHarnessPosts(posts, config, sourceRegistry);
  const status = validation.some((result) => result.issues.some((issue) => issue.severity === "error"))
    ? "failed"
    : "succeeded";

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
      outputPostIds: posts.map((post) => post.id),
      validation
    },
    posts,
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

export function validateHarnessPosts(
  posts: readonly unknown[],
  config: AgentHarnessConfig = defaultAgentHarnessConfig,
  sourceRegistry?: SourceRegistry
): HarnessValidationResult[] {
  return posts.map((candidate) => {
    const result = validateKnowledgePost(candidate);

    if (!result.valid || !isKnowledgePostLike(candidate)) {
      return result;
    }

    const post = candidate;
    const policyIssues = validatePostPolicies(post, config);
    const grounding = sourceRegistry ? validateGrounding(post, sourceRegistry) : undefined;
    const groundingIssues = grounding?.issues ?? [];

    return {
      ...result,
      valid:
        result.valid &&
        !policyIssues.some((issue) => issue.severity === "error") &&
        !groundingIssues.some((issue) => issue.severity === "error"),
      issues: [...result.issues, ...policyIssues, ...groundingIssues],
      grounding
    };
  });
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

function buildRunId(sourceId: string, createdAt: string): string {
  return `${sourceId}-harness-${createdAt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function isKnowledgePostLike(value: unknown): value is KnowledgePost {
  return typeof value === "object" && value !== null && "thread" in value && "graphEdges" in value && "reviewPrompts" in value;
}
