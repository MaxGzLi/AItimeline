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

export interface KnowledgePostHarnessInput {
  source: Source;
  chunk: KnowledgeChunk;
  index: number;
  createdAt: string;
  recommendedBecause: string;
}

export const harnessVersion = "harness-v0";

export function createKnowledgePost(input: KnowledgePostHarnessInput): KnowledgePost {
  const concepts = input.chunk.conceptHints?.length ? input.chunk.conceptHints : ["Imported Knowledge"];
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
    title: buildTitle(input.chunk.content, primaryConcept),
    hook: buildHook(input.chunk.content, primaryConcept),
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
    thread: buildThread(input.chunk, concepts),
    graphEdges: buildGraphEdges(input.chunk, concepts),
    reviewPrompts: buildReviewPrompts(input.chunk, concepts),
    nextActions: buildNextActions(concepts),
    harnessVersion
  };
}

function buildTitle(text: string, fallbackConcept: string): string {
  const sentence = firstUsefulSentence(text);
  const title = sentence ?? `${fallbackConcept} is worth learning from this source`;

  return trimTo(title, 96);
}

function buildHook(text: string, concept: string): string {
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

function buildThread(chunk: KnowledgeChunk, concepts: string[]): KnowledgeThreadBlock[] {
  const primaryConcept = concepts[0] ?? "Imported Knowledge";
  const secondaryConcept = concepts[1] ?? "Memory";

  return [
    {
      id: `${chunk.id}-thread-explain`,
      kind: "explain",
      title: "What this means",
      body: `This post turns ${primaryConcept} into one teachable claim: ${buildShortBody(chunk.content)}`
    },
    {
      id: `${chunk.id}-thread-example`,
      kind: "example",
      title: "Example",
      body: `If a user imports a long video, the agent should create a small post, a source citation, a review prompt, and graph links instead of one giant summary.`
    },
    {
      id: `${chunk.id}-thread-contrast`,
      kind: "contrast",
      title: "Contrast",
      body: `A normal summarizer compresses content once. A learning feed turns the idea into something that can be recommended, questioned, reviewed, and connected.`
    },
    {
      id: `${chunk.id}-thread-extension`,
      kind: "extension",
      title: "Where to go next",
      body: `Connect ${primaryConcept} to ${secondaryConcept}, then decide whether the user needs a deeper explanation, a broader adjacent concept, or a simpler reframe.`
    },
    {
      id: `${chunk.id}-thread-quiz`,
      kind: "quiz",
      title: "Quick check",
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

function buildReviewPrompts(chunk: KnowledgeChunk, concepts: string[]): KnowledgeReviewPrompt[] {
  const primaryConcept = concepts[0] ?? "Imported Knowledge";
  const secondaryConcept = concepts[1] ?? "Memory";

  return [
    {
      id: `${chunk.id}-review-recall`,
      kind: "recall",
      prompt: `What is the core lesson about ${primaryConcept}?`,
      answerHint: buildKeyTakeaway(chunk.content, primaryConcept),
      dueInDays: 1
    },
    {
      id: `${chunk.id}-review-compare`,
      kind: "compare",
      prompt: `How does ${primaryConcept} connect to ${secondaryConcept}?`,
      answerHint: `Look for how the source links concepts into a learning system, not only a summary.`,
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

