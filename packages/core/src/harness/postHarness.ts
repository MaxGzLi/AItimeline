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
import {
  isConceptPolarityCompatibleWithText,
  normalizedConceptAppearsInText
} from "./groundingGate.js";

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
  const supportedConceptHints = (input.chunk.conceptHints ?? []).filter((concept) =>
    normalizedConceptAppearsInText(concept, input.chunk.content) &&
    isConceptPolarityCompatibleWithText(concept, input.chunk.content)
  );
  const concepts = supportedConceptHints.length
    ? supportedConceptHints
    : [inferSourceConcept(input.chunk.content, language)];
  const primaryConcept = concepts[0];
  const citation: Citation = {
    sourceId: input.source.id,
    chunkId: input.chunk.id,
    url: input.source.url,
    startTimeSeconds: input.chunk.startTimeSeconds,
    endTimeSeconds: input.chunk.endTimeSeconds
  };
  const thesis = buildThesis(input.chunk.content, primaryConcept);
  const groundedTitle = buildTitle(input.chunk.content, primaryConcept, language);
  const title = isLocalFollowupSource(input.source)
    ? trimTo(`${language === "zh" ? "跟进：" : "Follow-up: "}${groundedTitle}`, 96)
    : groundedTitle;

  return {
    id: `${input.source.id}-post-${input.index + 1}`,
    title,
    hook: markBeyondSource(buildHook(input.chunk.content, primaryConcept, language), language),
    thesis,
    shortBody: buildShortBody(input.chunk.content),
    summary: input.chunk.content,
    keyTakeaway: buildKeyTakeaway(input.chunk.content, thesis),
    concepts,
    sources: [input.source],
    citations: [citation],
    // Recommendation rationale describes system/user context, not source
    // content, so deterministic output labels that provenance explicitly.
    recommendedBecause: markBeyondSource(input.recommendedBecause, language),
    trustState: "emerging",
    createdAt: input.createdAt,
    estimatedReadMinutes: Math.max(1, Math.ceil(input.chunk.content.length / 900)),
    difficulty: inferDifficulty(concepts),
    confidence: inferConfidence(input.source, input.chunk),
    thread: buildThread(input.chunk, concepts, language).map((block) => ({
      ...block,
      title: markBeyondSource(block.title, language),
      body: markBeyondSource(block.body, language),
      prompt: block.prompt ? markBeyondSource(block.prompt, language) : block.prompt
    })),
    graphEdges: buildGraphEdges(input.chunk, concepts),
    reviewPrompts: buildReviewPrompts(input.chunk, concepts, language).map((prompt) => ({
      ...prompt,
      prompt: markBeyondSource(prompt.prompt, language)
    })),
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

function buildKeyTakeaway(_text: string, thesis: string): string {
  // The deterministic path cannot safely invent an interpretation. Reuse the
  // source-backed thesis and leave richer takeaways to a validated model run.
  return thesis;
}

function buildThread(chunk: KnowledgeChunk, concepts: string[], language: ContentLanguage): KnowledgeThreadBlock[] {
  const primaryConcept = concepts[0] ?? defaultImportedConcept(language);
  const secondaryConcept = concepts[1] ?? primaryConcept;
  const shortBody = buildShortBody(chunk.content);

  if (language === "zh") {
    return [
      {
        id: `${chunk.id}-thread-explain`,
        kind: "explain",
        title: "这是什么意思",
        body: `这张卡会把 ${primaryConcept} 变成一个可操作的判断:${shortBody}。它的运作方式是先从来源里抓住一个稳定主张,再把主张放进时间线、引用、复习和图谱关系里。这样设计的原因是让用户得到能被追问、复习、连接和重新推荐的知识单元。`
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
        body: `${shortBody}。请根据来源说明 ${primaryConcept} 应该怎样进入学习流。请指出 ${primaryConcept} 需要保留哪些引用或复习提示。回答时应始终围绕 ${primaryConcept} 的来源措辞展开,并把 ${primaryConcept} 的证据限制条件一并保留下来。`
      }
    ];
  }

  return [
    {
      id: `${chunk.id}-thread-explain`,
      kind: "explain",
      title: "What this means",
      body: `This card turns ${primaryConcept} into one teachable judgment: ${shortBody}. The mechanism is to isolate a stable claim from the cited chunk, then place that claim inside a timeline object with citations, review prompts, and graph edges. The design gives the learner a unit that can be questioned, reviewed, connected, and recommended later.`
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
      body: `${shortBody}. Explain how ${primaryConcept} should enter a learning timeline using this evidence. Name the citations or review prompts that should remain attached to ${primaryConcept}. ${primaryConcept} remains the evidence anchor for both the explanation plus the review decision.`
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
  // A deterministic compare prompt cannot prove that two separately extracted
  // concepts co-occur in one claim-local evidence span. Keep one grounded
  // anchor; a validated model run can introduce a supported comparison.
  const secondaryConcept = primaryConcept;

  return [
    {
      id: `${chunk.id}-review-recall`,
      kind: "recall",
      prompt: language === "zh" ? `${primaryConcept} 的核心启发是什么?` : `What is the core lesson about ${primaryConcept}?`,
      answerHint: trimTo(chunk.content, 180),
      dueInDays: 1
    },
    {
      id: `${chunk.id}-review-compare`,
      kind: "compare",
      prompt:
        language === "zh"
          ? `${primaryConcept} 和 ${secondaryConcept} 怎么连起来?`
          : `How does ${primaryConcept} connect to ${secondaryConcept}?`,
      answerHint: trimTo(chunk.content, 180),
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

function inferSourceConcept(text: string, language: ContentLanguage): string {
  const normalized = text.normalize("NFKC").trim();
  const cjkPhrase = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,12}/u)?.[0];

  if (cjkPhrase) {
    return cjkPhrase;
  }

  const ignored = new Set(["a", "an", "and", "the", "this", "that", "from", "into", "with"]);
  const word = Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(normalized))
    .filter((entry) => entry.isWordLike)
    .map((entry) => entry.segment.trim())
    .find(
      (candidate) =>
        (candidate.length >= 4 || /^[A-Z0-9]{2,}$/.test(candidate)) &&
        !ignored.has(candidate.toLowerCase())
    );

  return word?.slice(0, 48) || defaultImportedConcept(language);
}

function markBeyondSource(value: string, language: ContentLanguage): string {
  if (/^\s*\[(?:beyond source|超出来源)\]/i.test(value)) {
    return value;
  }

  return `${language === "en" ? "[beyond source]" : "[超出来源]"} ${value}`;
}

function isLocalFollowupSource(source: Source): boolean {
  return source.id.startsWith("followup-") || source.url.includes("aitimeline.local/followups/");
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
  const sentences = text.split(/[.!?。！？]/).map((part) => part.trim()).filter(Boolean);

  // Prefer a substantive sentence, but never replace a short source with an
  // invented generic thesis. Short deterministic inputs must remain verbatim.
  return sentences.find((part) => part.length > 16) ?? sentences[0];
}

function trimTo(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const prefix = text.slice(0, maxLength).trimEnd();
  const lastWhitespace = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\n"), prefix.lastIndexOf("\t"));

  // Factual deterministic fields must remain literal source substrings. Avoid
  // an ellipsis or a partial Latin word; CJK text can safely use the raw prefix.
  return lastWhitespace >= Math.floor(maxLength * 0.6)
    ? prefix.slice(0, lastWhitespace).trimEnd()
    : prefix;
}

function slugConcept(concept: string): string {
  return concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
