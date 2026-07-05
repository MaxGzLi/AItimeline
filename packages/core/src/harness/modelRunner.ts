import { createSourceRegistry } from "../source/sourceRegistry.js";
import type {
  AgentHarnessRunInput,
  AgentHarnessRunResult,
  HarnessValidationIssue,
  HarnessValidationResult,
  KnowledgePost,
  KnowledgePostAgentRunner,
  SourceRegistry
} from "../types.js";
import { createAgentHarnessConfig, validateHarnessPosts } from "./runner.js";
import { knowledgePostJsonSchema } from "./schema.js";
import { agentHarnessSystemPrompt } from "./systemPrompt.js";

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelCompletionRequest {
  messages: ModelMessage[];
  responseFormat?: "json_object";
  temperature?: number;
}

export interface ModelCompletionResponse {
  content: string;
  raw?: unknown;
}

export interface ModelClient {
  complete(request: ModelCompletionRequest): Promise<ModelCompletionResponse>;
}

export interface CreateModelKnowledgePostRunnerOptions {
  client: ModelClient;
  id?: string;
  maxRepairAttempts?: number;
  temperature?: number;
}

interface ParsedModelPosts {
  posts: unknown[];
  validation: HarnessValidationResult[];
}

interface ModelRunAttempt {
  candidates: unknown[];
  validation: HarnessValidationResult[];
}

export function createModelKnowledgePostRunner(
  options: CreateModelKnowledgePostRunnerOptions
): KnowledgePostAgentRunner {
  const runnerId = options.id ?? "model-knowledge-post-runner";

  return {
    id: runnerId,
    kind: "model",
    run: (input) => runModelAgentHarness(input, options)
  };
}

export async function runModelAgentHarness(
  input: AgentHarnessRunInput,
  options: CreateModelKnowledgePostRunnerOptions
): Promise<AgentHarnessRunResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const config = createAgentHarnessConfig({
    ...(input.config ?? {}),
    runnerKind: "model"
  });
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
  const maxRepairAttempts = options.maxRepairAttempts ?? 2;
  const messages = buildInitialMessages(input, sourceRegistry, createdAt, recommendedBecause);
  let currentMessages = messages;
  let finalAttempt: ModelRunAttempt = {
    candidates: [],
    validation: [
      createValidationResult({
        path: "$",
        message: "model runner did not produce a response.",
        severity: "error"
      })
    ]
  };

  for (let attemptIndex = 0; attemptIndex <= maxRepairAttempts; attemptIndex += 1) {
    const response = await options.client.complete({
      messages: currentMessages,
      responseFormat: "json_object",
      temperature: options.temperature ?? 0.2
    });
    const parsed = parseModelPosts(response.content);
    const validation = parsed.validation.length
      ? parsed.validation
      : validateHarnessPosts(parsed.posts, config, sourceRegistry);

    finalAttempt = {
      candidates: parsed.posts,
      validation
    };

    if (!hasValidationErrors(validation)) {
      break;
    }

    if (attemptIndex < maxRepairAttempts) {
      currentMessages = [
        ...messages,
        {
          role: "assistant",
          content: response.content
        },
        {
          role: "user",
          content: buildRepairPrompt(validation, response.content)
        }
      ];
    }
  }

  const hasErrors = hasValidationErrors(finalAttempt.validation);
  const acceptedPosts = hasErrors
    ? []
    : collectAcceptedPosts(finalAttempt.candidates, finalAttempt.validation);
  const status = hasErrors ? "failed" : "succeeded";

  return {
    run: {
      id: input.id ?? buildRunId(input.source.id, createdAt),
      sourceId: input.source.id,
      harnessVersion: config.version,
      runnerKind: "model",
      objective: config.objective,
      status,
      createdAt,
      completedAt: new Date().toISOString(),
      sourceSnapshotIds: sourceRegistry.snapshots.map((snapshot) => snapshot.id),
      inputChunkIds: chunks.map((chunk) => chunk.id),
      outputPostIds: acceptedPosts.map((post) => post.id),
      validation: finalAttempt.validation
    },
    posts: acceptedPosts,
    validation: finalAttempt.validation,
    sourceRegistry
  };
}

function buildInitialMessages(
  input: AgentHarnessRunInput,
  sourceRegistry: SourceRegistry,
  createdAt: string,
  recommendedBecause: string
): ModelMessage[] {
  const config = createAgentHarnessConfig({
    ...(input.config ?? {}),
    runnerKind: "model"
  });
  const chunks = input.chunks.slice(0, config.maxPostsPerRun);

  return [
    {
      role: "system",
      content: agentHarnessSystemPrompt
    },
    {
      role: "user",
      content: [
        "Create timeline-native KnowledgePost objects from the registered source chunks.",
        "",
        "Return exactly one JSON object in this shape:",
        '{"posts":[KnowledgePost, ...]}',
        "",
        "Hard requirements:",
        `- Produce at most ${config.maxPostsPerRun} posts.`,
        `- Use harnessVersion "${config.version}" exactly.`,
        `- Use createdAt "${createdAt}" exactly for each post.`,
        "- Every post must include citations with registered sourceId and chunkId values.",
        "- Source facts must be supported by cited chunks; do not invent claims outside the source.",
        "- Each thread must include explain, example, contrast, extension, and quiz blocks.",
        "- Use graphEdges for durable concept links that can power review and recommendation.",
        "- Use nextActions to say whether the user should go deeper, broader, simpler, review, or cool down.",
        "- Do not include markdown, comments, or prose outside JSON.",
        "",
        `recommendedBecause: ${recommendedBecause}`,
        "",
        "Source:",
        JSON.stringify(input.source, null, 2),
        "",
        "Registered source chunks:",
        JSON.stringify(chunks, null, 2),
        "",
        "Source registry summary:",
        JSON.stringify(
          {
            sources: sourceRegistry.sources.map((source) => source.id),
            snapshots: sourceRegistry.snapshots.map((snapshot) => snapshot.id),
            chunks: sourceRegistry.chunks.map((chunk) => chunk.id)
          },
          null,
          2
        ),
        "",
        "User context:",
        JSON.stringify(input.userContext ?? {}, null, 2),
        "",
        "KnowledgePost JSON schema:",
        JSON.stringify(
          {
            type: "object",
            required: ["posts"],
            properties: {
              posts: {
                type: "array",
                items: knowledgePostJsonSchema
              }
            }
          },
          null,
          2
        )
      ].join("\n")
    }
  ];
}

function buildRepairPrompt(validation: HarnessValidationResult[], previousResponse: string): string {
  const truncationGuidance = hasJsonParseValidationError(validation)
    ? [
        "",
        "The previous output was truncated. Reduce the number of cards, shorten each card, and ensure the JSON is complete with every object, array, and string closed."
      ]
    : [];

  return [
    "The previous JSON response failed the AITimeline harness.",
    "Return a complete replacement JSON object in the exact shape {\"posts\":[...]} with all errors fixed.",
    "Do not apologize. Do not explain the fix. Do not reuse unsupported claims.",
    ...truncationGuidance,
    "",
    "Validation issues:",
    JSON.stringify(
      validation.flatMap((result) =>
        result.issues.map((issue) => ({
          postId: result.postId,
          path: issue.path,
          severity: issue.severity,
          message: issue.message
        }))
      ),
      null,
      2
    ),
    "",
    "Previous response:",
    truncate(previousResponse, 12000)
  ].join("\n");
}

function hasJsonParseValidationError(validation: readonly HarnessValidationResult[]): boolean {
  return validation.some((result) =>
    result.issues.some((issue) => /must be parseable JSON/i.test(issue.message))
  );
}

function parseModelPosts(content: string): ParsedModelPosts {
  const payload = extractJsonPayload(content);

  try {
    const parsed = JSON.parse(payload) as unknown;
    const posts = extractPostsArray(parsed);

    if (!posts.length) {
      return {
        posts: [],
        validation: [
          createValidationResult({
            path: "$.posts",
            message: "model response must include at least one post.",
            severity: "error"
          })
        ]
      };
    }

    return {
      posts,
      validation: []
    };
  } catch (error) {
    return {
      posts: [],
      validation: [
        createValidationResult({
          path: "$",
          message: `model response must be parseable JSON: ${error instanceof Error ? error.message : "unknown error"}`,
          severity: "error"
        })
      ]
    };
  }
}

function extractJsonPayload(content: string): string {
  const trimmed = content.trim();
  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedJson?.[1]) {
    return fencedJson[1].trim();
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

function extractPostsArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (isRecord(parsed) && Array.isArray(parsed.posts)) {
    return parsed.posts;
  }

  throw new Error("response must be a posts array or an object with a posts array.");
}

function collectAcceptedPosts(
  candidates: readonly unknown[],
  validation: readonly HarnessValidationResult[]
): KnowledgePost[] {
  return candidates.filter((candidate, index) => validation[index]?.valid && isKnowledgePostLike(candidate)) as KnowledgePost[];
}

function hasValidationErrors(validation: readonly HarnessValidationResult[]): boolean {
  if (!validation.length) {
    return true;
  }

  return validation.some(
    (result) => !result.valid || result.issues.some((issue) => issue.severity === "error")
  );
}

function createValidationResult(issue: HarnessValidationIssue): HarnessValidationResult {
  return {
    valid: false,
    issues: [issue]
  };
}

function buildRunId(sourceId: string, createdAt: string): string {
  return `${sourceId}-model-harness-${createdAt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...[truncated]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKnowledgePostLike(value: unknown): value is KnowledgePost {
  return typeof value === "object" && value !== null && "thread" in value && "graphEdges" in value && "reviewPrompts" in value;
}
