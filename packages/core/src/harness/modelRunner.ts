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
import { extractJsonPayload } from "./agentLoop.js";
import { createAgentHarnessConfig, selectAgentHarnessInputChunks, validateHarnessPosts } from "./runner.js";
import { knowledgePostJsonSchema } from "./schema.js";
import { getAgentHarnessSystemPrompt } from "./systemPrompt.js";
import {
  type ContentLanguage,
  validateKnowledgePostContentLanguage
} from "./contentLanguage.js";

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
  contentLanguage?: ContentLanguage;
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
  const chunks = selectAgentHarnessInputChunks(input, config);
  const sourceRegistry =
    input.sourceRegistry ??
    createSourceRegistry({
      sources: [input.source],
      chunks,
      createdAt
    });
  const contentLanguage = input.contentLanguage ?? options.contentLanguage;
  const recommendedBecause = input.recommendedBecause ?? getDefaultRecommendedBecause(contentLanguage);
  const maxRepairAttempts = options.maxRepairAttempts ?? 2;
  const messages = buildInitialMessages(input, sourceRegistry, createdAt, recommendedBecause, contentLanguage);
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
    const harnessValidation = parsed.validation.length
      ? parsed.validation
      : validateHarnessPosts(parsed.posts, config, sourceRegistry);
    const validation = contentLanguage
      ? appendContentLanguageValidation(harnessValidation, parsed.posts, contentLanguage)
      : harnessValidation;

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
          content: buildRepairPrompt(validation, response.content, contentLanguage)
        }
      ];
    }
  }

  // 按卡保留:修复轮次用尽后,仍然接受逐卡校验通过的卡片,只丢弃未通过的那几张。
  // validateHarnessPosts 已在此 acceptance 之前把超出 maxPostsPerRun 的尾部和重复 ID 标为 error。
  const acceptedPosts = collectAcceptedPosts(finalAttempt.candidates, finalAttempt.validation);
  const status = acceptedPosts.length ? "succeeded" : "failed";

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
  recommendedBecause: string,
  contentLanguage?: ContentLanguage
): ModelMessage[] {
  const config = createAgentHarnessConfig({
    ...(input.config ?? {}),
    runnerKind: "model"
  });
  const chunks = selectAgentHarnessInputChunks(input, config);
  const hardRequirements = input.paperDigest
    ? [
        "Hard requirements:",
        "- Produce the paper section cards defined in the Paper digest protocol below: one overview card is mandatory, and the method, experiment/results, and conclusion cards are included only when their bucket groups have chunks.",
        `- Use harnessVersion "${config.version}" exactly.`,
        `- Use createdAt "${createdAt}" exactly for each post.`,
        "- Every post must include citations with registered sourceId and chunkId values.",
        "- Source facts must be supported by cited chunks; do not invent claims outside the source.",
        "- Every numeric token in source-fact fields must appear verbatim in that card's cited chunks. Digits inside names count (GPT-4o contains 4, Claude-3.5 contains 3.5): if a cited chunk does not contain the token, do not write it.",
        "- Every proper noun and technical term in a claim must appear in a chunk that same claim cites. A thread block is checked against the card's citations plus that block's own citations, so before finishing a block, scan its text for proper nouns and Latin technical terms: each one must appear in a chunk the card cites or that block cites. If it does not, add a citation for the chunk that contains it (a block may cite several chunks) or drop the term.",
        "- reviewPrompts and graphEdges carry no citations of their own and are checked against the card-level citations only: keep them to terms and numbers that appear in the chunks the card cites.",
        "- Only claim an increase or decrease when a cited chunk states that direction in words (grows, drops, higher, 增长, 下降...); if the evidence states a comparison without direction words, mirror the evidence's wording instead of adding a direction.",
        "- Example and quiz blocks follow the same rules: build worked examples from numbers and terms that appear in the chunks that block cites, or keep them free of specific figures (\"几个 token\" instead of \"3 个 token\"). Never invent toy numbers.",
        "- The prior-knowledge bridge (\"你之前了解过 X\") may name X only when X appears in a chunk the card or that block cites. The learner's other known concepts are not in this source: bridge to them without naming them (\"你之前接触过类似的机制\").",
        "- Each thread must include explain, example, contrast, extension, and quiz blocks.",
        ...formatThreadDepthRequirements(contentLanguage),
        "- Use graphEdges for durable concept links that can power review and recommendation.",
        "- Use nextActions to say whether the user should go deeper, broader, simpler, review, or cool down.",
        "- Write mathematical formulas in LaTeX: inline `$...$`, display `$$...$$`; do not flatten them into Unicode subscripts/superscripts.",
        "- Do not include markdown, comments, or prose outside JSON.",
        ...formatHardRequirementLanguagePolicy(contentLanguage)
      ]
    : [
        "Hard requirements:",
        `- Produce at most ${config.maxPostsPerRun} posts.`,
        `- Use harnessVersion "${config.version}" exactly.`,
        `- Use createdAt "${createdAt}" exactly for each post.`,
        "- Every post must include citations with registered sourceId and chunkId values.",
        "- Source facts must be supported by cited chunks; do not invent claims outside the source.",
        "- Every numeric token in source-fact fields must appear verbatim in that card's cited chunks. Digits inside names count (GPT-4o contains 4, Claude-3.5 contains 3.5): if a cited chunk does not contain the token, do not write it.",
        "- Every proper noun and technical term in a claim must appear in a chunk that same claim cites. A thread block is checked against the card's citations plus that block's own citations, so before finishing a block, scan its text for proper nouns and Latin technical terms: each one must appear in a chunk the card cites or that block cites. If it does not, add a citation for the chunk that contains it (a block may cite several chunks) or drop the term.",
        "- reviewPrompts and graphEdges carry no citations of their own and are checked against the card-level citations only: keep them to terms and numbers that appear in the chunks the card cites.",
        "- Only claim an increase or decrease when a cited chunk states that direction in words (grows, drops, higher, 增长, 下降...); if the evidence states a comparison without direction words, mirror the evidence's wording instead of adding a direction.",
        "- Example and quiz blocks follow the same rules: build worked examples from numbers and terms that appear in the chunks that block cites, or keep them free of specific figures (\"几个 token\" instead of \"3 个 token\"). Never invent toy numbers.",
        "- The prior-knowledge bridge (\"你之前了解过 X\") may name X only when X appears in a chunk the card or that block cites. The learner's other known concepts are not in this source: bridge to them without naming them (\"你之前接触过类似的机制\").",
        "- Each thread must include explain, example, contrast, extension, and quiz blocks.",
        ...formatThreadDepthRequirements(contentLanguage),
        "- Use graphEdges for durable concept links that can power review and recommendation.",
        "- Use nextActions to say whether the user should go deeper, broader, simpler, review, or cool down.",
        "- Write mathematical formulas in LaTeX: inline `$...$`, display `$$...$$`; do not flatten them into Unicode subscripts/superscripts.",
        "- Do not include markdown, comments, or prose outside JSON.",
        ...formatHardRequirementLanguagePolicy(contentLanguage)
      ];
  // 桶映射只列真正进了提示词的 chunkId,避免模型引用它没见过内容的 chunk。
  const sampledChunkIds = new Set(chunks.map((chunk) => chunk.id));
  const promptPaperBuckets = input.paperDigest?.buckets.map((bucket) => ({
    ...bucket,
    chunkIds: bucket.chunkIds.filter((chunkId) => sampledChunkIds.has(chunkId))
  }));
  const paperDigestSections = input.paperDigest
    ? [
        "",
        "Paper digest protocol:",
        "- Produce 3-4 section cards when the source has all required sections, in this order:",
        "  1. 概览卡: motivation bucket; this card is mandatory. If motivation has no chunks, use the strongest available sampled chunk.",
        "  2. 方法与架构卡: method bucket; skip this card when the method bucket has no chunks.",
        "  3. 实验与结果卡: experiment and result buckets combined; skip this card when both bucket groups have no chunks.",
        "  4. 局限与结论卡: conclusion bucket; skip this card when the conclusion bucket has no chunks.",
        "- Each card's citations must point to chunkIds from its corresponding bucket group.",
        "- The method card and experiment/results card should attach relevant figures through KnowledgePost.media when a figure clearly matches.",
        "- media may only use assetId values from the Paper figures list; set origin to \"paper\" and copy caption exactly from that list.",
        "- If no suitable paper figure exists for a card, omit the media field for that card.",
        "",
        "Paper digest bucket map:",
        JSON.stringify(promptPaperBuckets, null, 2),
        "",
        "Paper figures list:",
        JSON.stringify(input.paperDigest.figures, null, 2)
      ]
    : [];

  return [
    {
      role: "system",
      content: getAgentHarnessSystemPrompt(contentLanguage ?? "zh")
    },
    {
      role: "user",
      content: [
        "Create timeline-native KnowledgePost objects from the registered source chunks.",
        "",
        "Return exactly one JSON object in this shape:",
        '{"posts":[KnowledgePost, ...]}',
        "",
        ...hardRequirements,
        "",
        `recommendedBecause: ${recommendedBecause}`,
        "",
        "Source:",
        JSON.stringify(input.source, null, 2),
        "",
        "Registered source chunks:",
        JSON.stringify(chunks, null, 2),
        ...paperDigestSections,
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

function buildRepairPrompt(
  validation: HarnessValidationResult[],
  previousResponse: string,
  contentLanguage?: ContentLanguage
): string {
  const truncationGuidance = hasJsonParseValidationError(validation)
    ? [
        "",
        "The previous output was truncated. Reduce the number of cards, shorten each card, and ensure the JSON is complete with every object, array, and string closed."
      ]
    : [];
  const numberGuidance = hasNumberMismatchValidationError(validation)
    ? [
        "",
        "For number mismatches: every number in source-fact fields must appear verbatim in the cited chunks. Remove or reword any number the cited chunks do not contain; do not round, convert, or derive new numbers. Digits inside product or model names (GPT-4o, Claude-3.5) count as numbers — drop such comparisons unless a cited chunk contains them."
      ]
    : [];
  const overlapGuidance = hasSourceFactOverlapValidationError(validation)
    ? [
        "",
        contentLanguage === "en"
          ? "For weak source-fact overlap: when rewriting the failing field, keep key source terms and numbers from the cited chunks verbatim as anchors (method names, model names, metric names, etc.), then organize the English wording around those anchors. Do not use a generic paraphrase that drops source terms."
          : "For weak source-fact overlap: when rewriting the failing field, keep key English terms and numbers from the cited chunks verbatim as anchors (method names, model names, metric names, etc.), then organize the Simplified Chinese wording around those anchors. Do not use a pure-Chinese paraphrase for source facts."
      ]
    : [];
  const entityGuidance = hasUnsupportedEntityValidationError(validation)
    ? [
        "",
        "For proper nouns or technical terms missing from cited evidence: every named entity and technical term in a claim must literally appear in a chunk that same claim cites. The issue path tells you where to add the citation — a $.thread[i] path is checked against the card's citations plus thread[i].citations, so add the chunk that names the term to that block's citations (with a verbatim quote from it); a $.summary, $.keyTakeaway, $.graphEdges or $.reviewPrompts path is checked against the card-level citations, so add the chunk there. If the source has no chunk naming the term, drop the term from that claim."
      ]
    : [];
  const directionGuidance = hasDirectionValidationError(validation)
    ? [
        "",
        "For direction mismatches: the claim asserts an increase or decrease that its cited chunks never state in words. Either cite the chunk that states the direction, or rewrite the claim to mirror the evidence's own comparison wording without adding a direction."
      ]
    : [];

  return [
    "The previous JSON response failed the AITimeline harness.",
    "Return a complete replacement JSON object in the exact shape {\"posts\":[...]} with all errors fixed.",
    "Do not apologize. Do not explain the fix. Do not reuse unsupported claims.",
    ...truncationGuidance,
    ...numberGuidance,
    ...overlapGuidance,
    ...entityGuidance,
    ...directionGuidance,
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

function hasNumberMismatchValidationError(validation: readonly HarnessValidationResult[]): boolean {
  return validation.some((result) =>
    result.issues.some((issue) => /numbers that do not appear in cited evidence/i.test(issue.message))
  );
}

function hasSourceFactOverlapValidationError(validation: readonly HarnessValidationResult[]): boolean {
  return validation.some((result) =>
    result.issues.some((issue) => /Source fact does not overlap enough with cited evidence/i.test(issue.message))
  );
}

function hasUnsupportedEntityValidationError(validation: readonly HarnessValidationResult[]): boolean {
  return validation.some((result) =>
    result.issues.some((issue) =>
      /(?:proper nouns|technical terms) that do not appear in cited evidence/i.test(issue.message)
    )
  );
}

function hasDirectionValidationError(validation: readonly HarnessValidationResult[]): boolean {
  return validation.some((result) =>
    result.issues.some((issue) => /uses an? (?:increase|decrease).+direction that does not match/i.test(issue.message))
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
  return candidates.filter((candidate, index) => {
    const result = validation[index];

    return (
      result?.valid &&
      !result.issues.some((issue) => issue.severity === "error") &&
      isKnowledgePostLike(candidate)
    );
  }) as KnowledgePost[];
}

function hasValidationErrors(validation: readonly HarnessValidationResult[]): boolean {
  if (!validation.length) {
    return true;
  }

  return validation.some(
    (result) => !result.valid || result.issues.some((issue) => issue.severity === "error")
  );
}

function appendContentLanguageValidation(
  validation: readonly HarnessValidationResult[],
  candidates: readonly unknown[],
  contentLanguage: ContentLanguage
): HarnessValidationResult[] {
  return validation.map((result, index) => {
    const languageIssues = validateKnowledgePostContentLanguage(candidates[index], contentLanguage);

    if (!languageIssues.length) {
      return result;
    }

    return {
      ...result,
      valid: false,
      issues: [...result.issues, ...languageIssues]
    };
  });
}

function getDefaultRecommendedBecause(contentLanguage?: ContentLanguage): string {
  return contentLanguage === "en"
    ? "This source was imported and turned into timeline-ready knowledge cards."
    : "这个来源已导入,并转成了可以进时间线的知识卡片。";
}

function formatHardRequirementLanguagePolicy(contentLanguage?: ContentLanguage): string[] {
  // The full language policy already lives in the system prompt; hard
  // requirements repeat only a single emphasis line in the target language.
  if (!contentLanguage) {
    return [];
  }

  if (contentLanguage === "en") {
    return [
      "- All user-facing fields (title, hook, thesis, shortBody, keyTakeaway, summary, thread, reviewPrompts, recommendedBecause) must be written in natural English; keep technical terms in their original wording; graphEdges evidence stays in the source language.",
      "- recommendedBecause describes system or learner context rather than source evidence, so it must start with \"[beyond source]\"."
    ];
  }

  return [
    "- 所有面向用户的字段(title、hook、thesis、shortBody、keyTakeaway、summary、thread、reviewPrompts、recommendedBecause)必须以简体中文书写,技术术语保留英文;graphEdges 的 evidence 保持来源原文语言。",
    "- recommendedBecause 描述系统或学习者上下文而非来源证据,因此必须以 \"[超出来源]\" 开头。"
  ];
}

function formatThreadDepthRequirements(contentLanguage?: ContentLanguage): string[] {
  if (contentLanguage === "en") {
    return [
      "- Thread blocks must be substantive: explain = mechanism + design reason; example = concrete scene or numbers from input to transformation to output; contrast = compare with a known User context concept or adjacent source concept and say when to use which; extension = engineering trade-off or open problem, not vague future talk; quiz = application decision scenario.",
      "- Each thread block should give the user one judgment they can repeat to someone else, with body >= 60 English words as a warning-level depth target.",
      "- If a sentence uses common knowledge beyond the registered source chunks, prefix that sentence with \"[beyond source]\" and do not add new numbers or new proper-noun facts."
    ];
  }

  return [
    "- 知识块必须有实质内容:讲解=机制+设计原因;例子=具体场景或数字并走完输入→变换→输出;对比=优先对比 User context 里的已知概念,没有则对比来源内相邻概念,并说明什么时候用哪个;延伸=工程权衡或开放问题,不要空泛未来可期;小测=应用决策题。",
    "- 每个知识块都要让用户带走一个能复述给别人的判断,body 以不少于 80 个中文字符为 warning 级深度目标。",
    "- 如果某句话使用了注册来源片段之外的通识补充,该句必须以 \"[超出来源]\" 开头,且不得新增数字或新的专有名词事实。"
  ];
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
