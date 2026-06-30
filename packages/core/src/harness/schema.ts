import type {
  HarnessValidationIssue,
  HarnessValidationResult,
  KnowledgeConfidence,
  KnowledgeDifficulty,
  KnowledgeEdgeRelation,
  KnowledgePost,
  NextActionPolicy,
  ReviewPromptKind,
  SourceType,
  ThreadBlockKind,
  TrustState
} from "../types.js";

const trustStates = ["emerging", "supported", "contested"] as const satisfies readonly TrustState[];
const difficulties = ["beginner", "intermediate", "advanced"] as const satisfies readonly KnowledgeDifficulty[];
const confidences = ["low", "medium", "high"] as const satisfies readonly KnowledgeConfidence[];
const sourceTypes = [
  "youtube",
  "article",
  "paper",
  "blog",
  "news",
  "repo",
  "pdf",
  "audio",
  "manual"
] as const satisfies readonly SourceType[];
const threadKinds = ["explain", "example", "contrast", "extension", "quiz"] as const satisfies readonly ThreadBlockKind[];
const edgeRelations = [
  "requires",
  "extends",
  "contrasts",
  "applies",
  "evaluates",
  "summarizes"
] as const satisfies readonly KnowledgeEdgeRelation[];
const reviewPromptKinds = ["recall", "compare", "apply", "explain"] as const satisfies readonly ReviewPromptKind[];
const nextActionPolicies = [
  "continue_deeper",
  "expand_broader",
  "reframe_simpler",
  "cooldown_topic",
  "schedule_review",
  "ask_clarifying_question"
] as const satisfies readonly NextActionPolicy[];

export const knowledgePostJsonSchema = {
  type: "object",
  required: [
    "id",
    "title",
    "hook",
    "thesis",
    "shortBody",
    "summary",
    "keyTakeaway",
    "concepts",
    "sources",
    "citations",
    "recommendedBecause",
    "trustState",
    "createdAt",
    "estimatedReadMinutes",
    "difficulty",
    "confidence",
    "thread",
    "graphEdges",
    "reviewPrompts",
    "nextActions",
    "harnessVersion"
  ],
  properties: {
    id: { type: "string" },
    title: { type: "string", maxLength: 120 },
    hook: { type: "string", maxLength: 180 },
    thesis: { type: "string", maxLength: 240 },
    shortBody: { type: "string", maxLength: 320 },
    summary: { type: "string" },
    keyTakeaway: { type: "string", maxLength: 220 },
    concepts: { type: "array", items: { type: "string" }, minItems: 1 },
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "title", "url", "type"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          url: { type: "string" },
          type: { enum: sourceTypes }
        }
      }
    },
    citations: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["sourceId"],
        properties: {
          sourceId: { type: "string" },
          chunkId: { type: "string" }
        }
      }
    },
    recommendedBecause: { type: "string" },
    trustState: { enum: trustStates },
    estimatedReadMinutes: { type: "number", minimum: 1 },
    difficulty: { enum: difficulties },
    confidence: { enum: confidences },
    thread: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "kind", "title", "body"],
        properties: {
          id: { type: "string" },
          kind: { enum: threadKinds },
          title: { type: "string" },
          body: { type: "string" }
        }
      }
    },
    graphEdges: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "sourceConcept", "relation", "targetConcept", "evidence", "weight"],
        properties: {
          id: { type: "string" },
          sourceConcept: { type: "string" },
          relation: { enum: edgeRelations },
          targetConcept: { type: "string" },
          evidence: { type: "string" },
          weight: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    reviewPrompts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "kind", "prompt", "answerHint", "dueInDays"],
        properties: {
          id: { type: "string" },
          kind: { enum: reviewPromptKinds },
          prompt: { type: "string" },
          answerHint: { type: "string" },
          dueInDays: { type: "number", minimum: 1 }
        }
      }
    },
    nextActions: { type: "array", items: { enum: nextActionPolicies }, minItems: 1 },
    harnessVersion: { type: "string" }
  }
} as const;

export function validateKnowledgePost(post: unknown): HarnessValidationResult {
  const issues: HarnessValidationIssue[] = [];
  const postId = isRecord(post) && typeof post.id === "string" ? post.id : undefined;

  if (!isRecord(post)) {
    return {
      postId,
      valid: false,
      issues: [{ path: "$", message: "KnowledgePost must be an object.", severity: "error" }]
    };
  }

  requireString(post, "id", issues);
  requireString(post, "title", issues);
  requireString(post, "hook", issues);
  requireString(post, "thesis", issues);
  requireString(post, "shortBody", issues);
  requireString(post, "summary", issues);
  requireString(post, "keyTakeaway", issues);
  requireString(post, "recommendedBecause", issues);
  requireString(post, "createdAt", issues);
  requireString(post, "harnessVersion", issues);
  requireEnum(post, "trustState", trustStates, issues);
  requireEnum(post, "difficulty", difficulties, issues);
  requireEnum(post, "confidence", confidences, issues);
  requirePositiveNumber(post, "estimatedReadMinutes", issues);
  requireStringArray(post, "concepts", issues, { minItems: 1 });
  validateSources(post.sources, issues);
  validateCitations(post.citations, issues);
  validateThread(post.thread, issues);
  validateGraphEdges(post.graphEdges, issues);
  validateReviewPrompts(post.reviewPrompts, issues);
  validateNextActions(post.nextActions, issues);
  warnIfLong(post, "title", 120, issues);
  warnIfLong(post, "hook", 180, issues);
  warnIfLong(post, "thesis", 240, issues);
  warnIfLong(post, "shortBody", 320, issues);

  return {
    postId,
    valid: !issues.some((issue) => issue.severity === "error"),
    issues
  };
}

export function validateKnowledgePosts(posts: readonly KnowledgePost[]): HarnessValidationResult[] {
  return posts.map((post) => validateKnowledgePost(post));
}

function validateSources(value: unknown, issues: HarnessValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path: "$.sources", message: "sources must be a non-empty array.", severity: "error" });
    return;
  }

  value.forEach((source, index) => {
    if (!isRecord(source)) {
      issues.push({ path: `$.sources[${index}]`, message: "source must be an object.", severity: "error" });
      return;
    }

    requireString(source, "id", issues, `$.sources[${index}]`);
    requireString(source, "title", issues, `$.sources[${index}]`);
    requireString(source, "url", issues, `$.sources[${index}]`);
    requireEnum(source, "type", sourceTypes, issues, `$.sources[${index}]`);
  });
}

function validateCitations(value: unknown, issues: HarnessValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path: "$.citations", message: "citations must be a non-empty array.", severity: "error" });
    return;
  }

  value.forEach((citation, index) => {
    if (!isRecord(citation)) {
      issues.push({ path: `$.citations[${index}]`, message: "citation must be an object.", severity: "error" });
      return;
    }

    requireString(citation, "sourceId", issues, `$.citations[${index}]`);
  });
}

function validateThread(value: unknown, issues: HarnessValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path: "$.thread", message: "thread must be a non-empty array.", severity: "error" });
    return;
  }

  value.forEach((block, index) => {
    if (!isRecord(block)) {
      issues.push({ path: `$.thread[${index}]`, message: "thread block must be an object.", severity: "error" });
      return;
    }

    requireString(block, "id", issues, `$.thread[${index}]`);
    requireEnum(block, "kind", threadKinds, issues, `$.thread[${index}]`);
    requireString(block, "title", issues, `$.thread[${index}]`);
    requireString(block, "body", issues, `$.thread[${index}]`);
  });
}

function validateGraphEdges(value: unknown, issues: HarnessValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path: "$.graphEdges", message: "graphEdges must be an array.", severity: "error" });
    return;
  }

  value.forEach((edge, index) => {
    if (!isRecord(edge)) {
      issues.push({ path: `$.graphEdges[${index}]`, message: "graph edge must be an object.", severity: "error" });
      return;
    }

    requireString(edge, "id", issues, `$.graphEdges[${index}]`);
    requireString(edge, "sourceConcept", issues, `$.graphEdges[${index}]`);
    requireEnum(edge, "relation", edgeRelations, issues, `$.graphEdges[${index}]`);
    requireString(edge, "targetConcept", issues, `$.graphEdges[${index}]`);
    requireString(edge, "evidence", issues, `$.graphEdges[${index}]`);
    requirePositiveNumber(edge, "weight", issues, `$.graphEdges[${index}]`);

    if (typeof edge.weight === "number" && (edge.weight < 0 || edge.weight > 1)) {
      issues.push({
        path: `$.graphEdges[${index}].weight`,
        message: "edge weight should be between 0 and 1.",
        severity: "warning"
      });
    }
  });
}

function validateReviewPrompts(value: unknown, issues: HarnessValidationIssue[]): void {
  if (!Array.isArray(value)) {
    issues.push({ path: "$.reviewPrompts", message: "reviewPrompts must be an array.", severity: "error" });
    return;
  }

  value.forEach((prompt, index) => {
    if (!isRecord(prompt)) {
      issues.push({ path: `$.reviewPrompts[${index}]`, message: "review prompt must be an object.", severity: "error" });
      return;
    }

    requireString(prompt, "id", issues, `$.reviewPrompts[${index}]`);
    requireEnum(prompt, "kind", reviewPromptKinds, issues, `$.reviewPrompts[${index}]`);
    requireString(prompt, "prompt", issues, `$.reviewPrompts[${index}]`);
    requireString(prompt, "answerHint", issues, `$.reviewPrompts[${index}]`);
    requirePositiveNumber(prompt, "dueInDays", issues, `$.reviewPrompts[${index}]`);
  });
}

function validateNextActions(value: unknown, issues: HarnessValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path: "$.nextActions", message: "nextActions must be a non-empty array.", severity: "error" });
    return;
  }

  value.forEach((action, index) => {
    if (!nextActionPolicies.includes(action as NextActionPolicy)) {
      issues.push({
        path: `$.nextActions[${index}]`,
        message: "next action is not supported by the harness.",
        severity: "error"
      });
    }
  });
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

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  issues: HarnessValidationIssue[],
  options: { minItems?: number } = {},
  basePath = "$"
): void {
  const value = record[key];

  if (!Array.isArray(value)) {
    issues.push({ path: `${basePath}.${key}`, message: `${key} must be an array.`, severity: "error" });
    return;
  }

  if (options.minItems && value.length < options.minItems) {
    issues.push({
      path: `${basePath}.${key}`,
      message: `${key} must contain at least ${options.minItems} item.`,
      severity: "error"
    });
  }

  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      issues.push({
        path: `${basePath}.${key}[${index}]`,
        message: `${key} items must be non-empty strings.`,
        severity: "error"
      });
    }
  });
}

function requireEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  issues: HarnessValidationIssue[],
  basePath = "$"
): void {
  if (!allowed.includes(record[key] as T)) {
    issues.push({ path: `${basePath}.${key}`, message: `${key} has an unsupported value.`, severity: "error" });
  }
}

function requirePositiveNumber(
  record: Record<string, unknown>,
  key: string,
  issues: HarnessValidationIssue[],
  basePath = "$"
): void {
  if (typeof record[key] !== "number" || !Number.isFinite(record[key]) || record[key] <= 0) {
    issues.push({ path: `${basePath}.${key}`, message: `${key} must be a positive number.`, severity: "error" });
  }
}

function warnIfLong(
  record: Record<string, unknown>,
  key: string,
  maxLength: number,
  issues: HarnessValidationIssue[]
): void {
  const value = record[key];

  if (typeof value === "string" && value.length > maxLength) {
    issues.push({
      path: `$.${key}`,
      message: `${key} is longer than the feed contract recommends.`,
      severity: "warning"
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
