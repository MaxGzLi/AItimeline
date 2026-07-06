import type {
  Citation,
  KnowledgeChunk,
  KnowledgeConfidence,
  KnowledgeDifficulty,
  KnowledgeGraphEdge,
  KnowledgePost,
  KnowledgeReviewPrompt,
  KnowledgeThreadBlock,
  NextActionPolicy,
  Source
} from "../types.js";
import type { ContentLanguage } from "./contentLanguage.js";

export interface KnowledgePostHarnessInput {
  source: Source;
  chunk: KnowledgeChunk;
  index: number;
  createdAt: string;
  recommendedBecause: string;
  contentLanguage?: ContentLanguage;
}

export const harnessVersion = "harness-v0";

export function createKnowledgePost(input: KnowledgePostHarnessInput): KnowledgePost {
  const language = input.contentLanguage ?? "zh";
  const concepts = input.chunk.conceptHints?.length ? input.chunk.conceptHints : [defaultImportedConcept(language)];
  const primaryConcept = concepts[0];
  const citation: Citation = {
    sourceId: input.source.id,
    chunkId: input.chunk.id,
    url: input.source.url,
    startTimeSeconds: input.chunk.startTimeSeconds,
    endTimeSeconds: input.chunk.endTimeSeconds
  };
  const thesis = buildThesis(input.chunk.content, primaryConcept);

  return {
    id: `${input.source.id}-post-${input.index + 1}`,
    title: buildTitle(input.chunk.content, primaryConcept, language),
    hook: buildHook(input.chunk.content, primaryConcept, language),
    thesis,
    shortBody: buildShortBody(input.chunk.content),
    summary: input.chunk.content,
    keyTakeaway: buildKeyTakeaway(input.chunk.content, thesis),
    concepts,
    sources: [input.source],
    citations: [citation],
    recommendedBecause: input.recommendedBecause,
    trustState: "emerging",
    createdAt: input.createdAt,
    estimatedReadMinutes: Math.max(1, Math.ceil(input.chunk.content.length / 900)),
    difficulty: inferDifficulty(concepts),
    confidence: inferConfidence(input.source, input.chunk),
    thread: buildThread(input.chunk, concepts, language),
    graphEdges: buildGraphEdges(input.chunk, concepts),
    reviewPrompts: buildReviewPrompts(input.chunk, concepts, language),
    nextActions: buildNextActions(concepts),
    harnessVersion
  };
}

function buildTitle(text: string, fallbackConcept: string, language: ContentLanguage): string {
  const sentence = firstUsefulSentence(text);
  const title = sentence ?? (
    language === "zh"
      ? `${fallbackConcept} 值得从这个来源里学`
      : `${fallbackConcept} is worth learning from this source`
  );

  return trimTo(title, 96);
}

function buildHook(text: string, concept: string, language: ContentLanguage): string {
  if (language === "zh") {
    if (/does not simply summarize/i.test(text)) {
      return "关键不只是摘要,而是哪些内容能沉淀成长期记忆。";
    }

    if (/source grounding/i.test(text)) {
      return "NotebookLM 给出 grounding;学习流还需要把知识重新带回时间线。";
    }

    if (/recommendation/i.test(text)) {
      return "当 ranking 知道用户准备好学什么,知识流才会变强。";
    }

    if (/evaluation/i.test(text)) {
      return "导入知识很容易,验证用户是否记住才是难点。";
    }

    return `${concept} 重要,因为它会改变用户接下来看到什么。`;
  }

  if (/does not simply summarize/i.test(text)) {
    return "The interesting part is not the summary. It is what survives into memory.";
  }

  if (/source grounding/i.test(text)) {
    return "NotebookLM gives you grounding; a learning feed needs resurfacing.";
  }

  if (/recommendation/i.test(text)) {
    return "A knowledge feed becomes powerful when ranking knows what you are ready to learn.";
  }

  if (/evaluation/i.test(text)) {
    return "Importing knowledge is easy. Proving the user remembers it is the hard part.";
  }

  return `${concept} matters because it can change what the user sees next.`;
}

function buildThesis(text: string, concept: string): string {
  const sentence = firstUsefulSentence(text);

  return sentence ? trimTo(sentence, 180) : `${concept} should become a durable, connected learning unit.`;
}

function buildShortBody(text: string): string {
  return trimTo(text, 260);
}

function buildKeyTakeaway(text: string, thesis: string): string {
  if (/memory/i.test(text)) {
    return "The agent should extract what can become durable memory, not just compress the source.";
  }

  if (/resurfacing/i.test(text)) {
    return "Grounded source knowledge becomes more valuable when it returns at the right moment.";
  }

  if (/ranker/i.test(text)) {
    return "Recommendation should explain why a post appears and what learning gap it fills.";
  }

  if (/citations/i.test(text)) {
    return "A source-grounded answer should also test whether the generated post improved recall.";
  }

  return thesis;
}

function buildThread(chunk: KnowledgeChunk, concepts: string[], language: ContentLanguage): KnowledgeThreadBlock[] {
  const primaryConcept = concepts[0] ?? defaultImportedConcept(language);
  const secondaryConcept = concepts[1] ?? "Memory";

  return [
    {
      id: `${chunk.id}-thread-explain`,
      kind: "explain",
      title: language === "zh" ? "这是什么意思" : "What this means",
      body: `This post turns ${primaryConcept} into one teachable claim: ${buildShortBody(chunk.content)}`
    },
    {
      id: `${chunk.id}-thread-example`,
      kind: "example",
      title: language === "zh" ? "例子" : "Example",
      body: `If a user imports a long video, the agent should create a small post, a source citation, a review prompt, and graph links instead of one giant summary.`
    },
    {
      id: `${chunk.id}-thread-contrast`,
      kind: "contrast",
      title: language === "zh" ? "对比" : "Contrast",
      body: `A normal summarizer compresses content once. A learning feed turns the idea into something that can be recommended, questioned, reviewed, and connected.`
    },
    {
      id: `${chunk.id}-thread-extension`,
      kind: "extension",
      title: language === "zh" ? "下一步" : "Where to go next",
      body: `Connect ${primaryConcept} to ${secondaryConcept}, then decide whether the user needs a deeper explanation, a broader adjacent concept, or a simpler reframe.`
    },
    {
      id: `${chunk.id}-thread-quiz`,
      kind: "quiz",
      title: language === "zh" ? "快速检查" : "Quick check",
      body: `In one sentence, explain why this idea should return in the timeline later instead of staying buried in the source.`
    }
  ];
}

function buildGraphEdges(chunk: KnowledgeChunk, concepts: string[]): KnowledgeGraphEdge[] {
  return concepts.slice(0, 3).flatMap((concept, index) => {
    const nextConcept = concepts[index + 1];

    if (!nextConcept) {
      return [];
    }

    return [
      {
        id: `${chunk.id}-edge-${slugConcept(concept)}-${slugConcept(nextConcept)}`,
        sourceConcept: concept,
        relation: inferRelation(concept, nextConcept),
        targetConcept: nextConcept,
        evidence: trimTo(chunk.content, 160),
        weight: 0.72
      }
    ];
  });
}

function buildReviewPrompts(chunk: KnowledgeChunk, concepts: string[], language: ContentLanguage): KnowledgeReviewPrompt[] {
  const primaryConcept = concepts[0] ?? defaultImportedConcept(language);
  const secondaryConcept = concepts[1] ?? "Memory";

  return [
    {
      id: `${chunk.id}-review-recall`,
      kind: "recall",
      prompt: language === "zh" ? `${primaryConcept} 的核心启发是什么?` : `What is the core lesson about ${primaryConcept}?`,
      answerHint: buildKeyTakeaway(chunk.content, primaryConcept),
      dueInDays: 1
    },
    {
      id: `${chunk.id}-review-compare`,
      kind: "compare",
      prompt:
        language === "zh"
          ? `${primaryConcept} 和 ${secondaryConcept} 怎么连起来?`
          : `How does ${primaryConcept} connect to ${secondaryConcept}?`,
      answerHint:
        language === "zh"
          ? "关注来源如何把概念连成学习系统,而不只是做摘要。"
          : `Look for how the source links concepts into a learning system, not only a summary.`,
      dueInDays: 3
    }
  ];
}

function buildNextActions(concepts: string[]): NextActionPolicy[] {
  if (concepts.includes("Evaluation")) {
    return ["continue_deeper", "schedule_review"];
  }

  if (concepts.includes("Knowledge Graph") || concepts.includes("Memory")) {
    return ["expand_broader", "schedule_review"];
  }

  return ["continue_deeper", "expand_broader"];
}

function inferDifficulty(concepts: string[]): KnowledgeDifficulty {
  return concepts.includes("Evaluation") || concepts.includes("RAG") ? "intermediate" : "beginner";
}

function inferConfidence(source: Source, chunk: KnowledgeChunk): KnowledgeConfidence {
  if (source.type === "manual") {
    return "medium";
  }

  return chunk.content.length > 120 ? "medium" : "low";
}

function defaultImportedConcept(language: ContentLanguage): string {
  return language === "zh" ? "导入知识" : "Imported Knowledge";
}

function inferRelation(concept: string, nextConcept: string): KnowledgeGraphEdge["relation"] {
  if (concept === "Evaluation" || nextConcept === "Evaluation") {
    return "evaluates";
  }

  if (concept === "RAG" || nextConcept === "RAG") {
    return "applies";
  }

  if (concept === "NotebookLM" || nextConcept === "NotebookLM") {
    return "contrasts";
  }

  return "extends";
}

function firstUsefulSentence(text: string): string | undefined {
  return text.split(/[.!?。！？]/).map((part) => part.trim()).find((part) => part.length > 16);
}

function trimTo(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function slugConcept(concept: string): string {
  return concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
