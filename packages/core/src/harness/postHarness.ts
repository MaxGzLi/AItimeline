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
  const shortBody = buildShortBody(chunk.content);

  if (language === "zh") {
    return [
      {
        id: `${chunk.id}-thread-explain`,
        kind: "explain",
        title: "这是什么意思",
        body: `这张卡不是把来源再压缩一遍,而是把 ${primaryConcept} 变成一个可操作的判断:${shortBody}。它的运作方式是先从来源里抓住一个稳定主张,再把主张放进时间线、引用、复习和图谱关系里。这样设计的原因是,用户之后需要的不是一段孤立摘要,而是能被追问、复习、连接和重新推荐的知识单元。`
      },
      {
        id: `${chunk.id}-thread-example`,
        kind: "example",
        title: "例子",
        body: `[超出来源] 假设你导入一段很长的材料,系统先拿到一个来源片段作为输入,再抽出 ${primaryConcept} 这个核心概念,把它变成标题、要点、引用、复习题和图谱边。输出不是一份大而全的总结,而是一张能在时间线里被再次打开的卡:你可以读判断、看证据、回答小测,再决定要深入还是换个角度。`
      },
      {
        id: `${chunk.id}-thread-contrast`,
        kind: "contrast",
        title: "对比",
        body: `${primaryConcept} 和 ${secondaryConcept} 的区别在于,前者更像这张卡正在讲的具体抓手,后者更像系统长期保存和调度这些抓手的容器。要判断什么时候用哪个:当你要解释这条来源片段本身,先用 ${primaryConcept};当你要决定它未来如何复习、推荐或连接其他卡片,再把它放进 ${secondaryConcept} 的视角。`
      },
      {
        id: `${chunk.id}-thread-extension`,
        kind: "extension",
        title: "下一步",
        body: `[超出来源] 真正的工程权衡在于,卡片越短越容易进入时间线,但越短也越可能丢掉来源里的限制条件;卡片越厚越有学习价值,又会增加生成、校验和阅读成本。更稳的做法是保留来源内的核心判断,把补充解释显式标成超出来源,并让用户通过继续追问来决定要不要为这个点引入新来源。`
      },
      {
        id: `${chunk.id}-thread-quiz`,
        kind: "quiz",
        title: "快速检查",
        body: `如果你现在要把这条来源材料放进自己的学习流,你会把它当作一次性摘要,还是当作之后会回到时间线的知识卡?请用一个场景回答:什么时候只需要读完即走,什么时候必须保留引用、图谱关系和复习提示。能说清这个选择,才算真正理解了 ${primaryConcept} 的用途。`
      }
    ];
  }

  return [
    {
      id: `${chunk.id}-thread-explain`,
      kind: "explain",
      title: "What this means",
      body: `This card does not merely compress the source. It turns ${primaryConcept} into one teachable judgment: ${shortBody}. The mechanism is to isolate a stable claim from the cited chunk, then place that claim inside a timeline object with citations, review prompts, and graph edges. The design choice matters because a learner needs a unit that can be questioned, reviewed, connected, and recommended later, not a paragraph that disappears after the import.`
    },
    {
      id: `${chunk.id}-thread-example`,
      kind: "example",
      title: "Example",
      body: `[beyond source] Imagine a user imports a long source. The input is one grounded chunk, the transformation extracts ${primaryConcept}, and the output is a compact card with a title, takeaway, citation, review question, and graph relation. The useful result is not a giant summary. It is a card the user can reopen, challenge with a follow-up question, and connect to nearby ideas before deciding whether to go deeper or broader.`
    },
    {
      id: `${chunk.id}-thread-contrast`,
      kind: "contrast",
      title: "Contrast",
      body: `${primaryConcept} is the concrete handle this card asks the user to understand, while ${secondaryConcept} is the longer-term container that decides how the handle returns. Use ${primaryConcept} when explaining what this source chunk is saying. Use ${secondaryConcept} when deciding how the idea should be resurfaced, reviewed, or connected to other cards. That distinction keeps the card from becoming either a loose tag or an isolated summary.`
    },
    {
      id: `${chunk.id}-thread-extension`,
      kind: "extension",
      title: "Where to go next",
      body: `[beyond source] The engineering trade-off is depth versus controllability. A shorter card fits the feed and is easier to validate, but it can lose important constraints from the source. A richer card teaches more, but it costs more generation, grounding, and reading attention. The practical move is to keep the source-backed judgment visible, mark extra interpretation honestly, and let explicit follow-up questions decide when a new source is worth pulling in.`
    },
    {
      id: `${chunk.id}-thread-quiz`,
      kind: "quiz",
      title: "Quick check",
      body: `Suppose you are deciding whether this imported idea should stay as a one-time summary or become a card that returns in the timeline. What evidence would make you keep citations, graph links, and a review prompt? Answer with a concrete scenario, not a definition of ${primaryConcept}. If you can justify that decision, you have understood what the card is for.`
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
