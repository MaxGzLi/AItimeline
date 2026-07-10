import type { ModelClient, ModelMessage } from "../harness/modelRunner.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import { validateClaimSupport } from "../harness/groundingGate.js";
import { normalizeConceptKey } from "../graph/conceptAliases.js";
import type {
  ConceptBrief,
  ConceptBriefAdjacentConcept,
  ConceptBriefSentence,
  KnowledgeCard,
  KnowledgeEdgeRelation
} from "../types.js";

export interface ConceptBriefCardInput {
  id: string;
  title: string;
  keyTakeaway: string;
  concepts: string[];
  createdAt: string;
  graphEdges?: KnowledgeCard["graphEdges"];
}

export interface ConceptBriefInput {
  concept: string;
  cards: ConceptBriefCardInput[];
  reviewCount?: number;
  contentLanguage?: ContentLanguage;
  createdAt?: string | Date;
}

export interface GenerateConceptBriefOptions {
  client?: ModelClient;
  temperature?: number;
}

interface ModelConceptBriefPayload {
  sentences?: unknown;
}

const conceptBriefVersion = "concept-brief-v0" as const;

export async function generateConceptBrief(
  input: ConceptBriefInput,
  options: GenerateConceptBriefOptions = {}
): Promise<ConceptBrief> {
  if (!options.client) {
    return createDeterministicConceptBrief(input);
  }

  try {
    const response = await options.client.complete({
      messages: buildConceptBriefMessages(input),
      responseFormat: "json_object",
      temperature: options.temperature ?? 0.1
    });
    const parsed = parseModelConceptBrief(response.content);
    const brief = normalizeModelConceptBrief(parsed, input);

    if (brief) {
      return brief;
    }
  } catch {
    // Deterministic fallback keeps the concept page useful when the model path
    // is unavailable or returns an unverifiable brief.
  }

  return createDeterministicConceptBrief(input);
}

export function createDeterministicConceptBrief(input: ConceptBriefInput): ConceptBrief {
  const createdAt = normalizeDate(input.createdAt).toISOString();
  const cards = normalizeCards(input.cards);
  const sourceCardIds = cards.map((card) => card.id);
  const adjacentConcepts = collectAdjacentConcepts(input.concept, cards).slice(0, 4);
  const primaryCard = cards[0];
  const secondCard = cards[1] ?? primaryCard;
  const relation = adjacentConcepts[0];
  const language = input.contentLanguage ?? "zh";
  const sentences = language === "en"
    ? buildEnglishSentences(input, cards, adjacentConcepts)
    : buildChineseSentences(input, cards, adjacentConcepts);

  return {
    id: buildConceptBriefId(input.concept, createdAt),
    concept: input.concept,
    version: conceptBriefVersion,
    runnerKind: "deterministic",
    generatedAt: createdAt,
    cardCount: cards.length,
    reviewCount: normalizeCount(input.reviewCount),
    sourceCardIds,
    adjacentConcepts,
    sentences: sentences.length
      ? sentences
      : [
          {
            id: `${slug(input.concept)}-brief-empty`,
            text:
              language === "en"
                ? `${input.concept} does not have enough sourced cards for a full brief yet.`
                : `${input.concept} 还没有足够的可溯源卡片生成完整简介。`,
            cardId: primaryCard?.id ?? secondCard?.id ?? ""
          }
        ].filter((sentence) => sentence.cardId)
  };
}

export function shouldRefreshConceptBrief(
  brief: Pick<ConceptBrief, "cardCount"> | undefined,
  currentCardCount: number
): boolean {
  if (!brief) {
    return true;
  }

  return Math.abs(currentCardCount - brief.cardCount) >= 3;
}

export function createConceptBriefInputFromCards(input: {
  concept: string;
  cards: KnowledgeCard[];
  reviewCount?: number;
  contentLanguage?: ContentLanguage;
  createdAt?: string | Date;
}): ConceptBriefInput {
  return {
    concept: input.concept,
    cards: input.cards
      .filter((card) => card.kind !== "connection_note")
      .map((card) => ({
        id: card.id,
        title: card.title,
        keyTakeaway: card.keyTakeaway || card.thesis || card.summary,
        concepts: card.concepts,
        createdAt: card.createdAt,
        graphEdges: card.graphEdges
      })),
    reviewCount: input.reviewCount,
    contentLanguage: input.contentLanguage,
    createdAt: input.createdAt
  };
}

function buildConceptBriefMessages(input: ConceptBriefInput): ModelMessage[] {
  const language = input.contentLanguage ?? "zh";
  const cards = normalizeCards(input.cards);
  const adjacentConcepts = collectAdjacentConcepts(input.concept, cards);

  return [
    {
      role: "system",
      content: [
        "You are the AITimeline Concept Brief Agent.",
        "Write a short concept-page brief from already saved knowledge cards.",
        "Every sentence must cite exactly one source card id. Do not write any sentence that cannot be traced to a card.",
        "Use only card titles, keyTakeaways, concepts, and graph edges as factual grounding.",
        "Return JSON only in this shape: {\"sentences\":[{\"text\":\"...\",\"cardId\":\"...\"}]}.",
        "Cover four jobs when evidence exists: what the concept is, why it matters, how it relates to adjacent graph concepts, and the user's progress.",
        language === "en"
          ? "Write natural English."
          : "Write Simplified Chinese, preserving technical terms and concept names."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          concept: input.concept,
          reviewCount: normalizeCount(input.reviewCount),
          cards,
          adjacentConcepts
        },
        null,
        2
      )
    }
  ];
}

function parseModelConceptBrief(content: string): ModelConceptBriefPayload | null {
  const payload = extractJsonPayload(content);

  try {
    const parsed = JSON.parse(payload) as unknown;

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeModelConceptBrief(
  parsed: ModelConceptBriefPayload | null,
  input: ConceptBriefInput
): ConceptBrief | null {
  if (!parsed || !Array.isArray(parsed.sentences)) {
    return null;
  }

  const cards = normalizeCards(input.cards);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const sentences: ConceptBriefSentence[] = parsed.sentences.flatMap((sentence, index) => {
    if (!isRecord(sentence) || typeof sentence.text !== "string" || typeof sentence.cardId !== "string") {
      return [];
    }

    const text = sentence.text.trim();
    const cardId = sentence.cardId.trim();

    const citedCard = cardsById.get(cardId);

    if (!text || !citedCard || !isConceptBriefSentenceSupported(text, citedCard)) {
      return [];
    }

    return [
      {
        id: `${slug(input.concept)}-brief-model-${index + 1}`,
        text,
        cardId
      }
    ];
  });

  if (!sentences.length || sentences.length !== parsed.sentences.length) {
    return null;
  }

  const createdAt = normalizeDate(input.createdAt).toISOString();

  return {
    id: buildConceptBriefId(input.concept, createdAt),
    concept: input.concept,
    version: conceptBriefVersion,
    runnerKind: "model",
    generatedAt: createdAt,
    cardCount: cards.length,
    reviewCount: normalizeCount(input.reviewCount),
    sourceCardIds: cards.map((card) => card.id),
    adjacentConcepts: collectAdjacentConcepts(input.concept, cards).slice(0, 4),
    sentences
  };
}

function isConceptBriefSentenceSupported(text: string, card: ConceptBriefCardInput): boolean {
  const evidenceText = [
    card.title,
    card.keyTakeaway,
    ...card.concepts,
    ...(card.graphEdges ?? []).map(
      (edge) =>
        `${edge.sourceConcept} ${edge.relation} ${edge.targetConcept} (weight ${edge.weight}): ${edge.evidence}`
    )
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");

  if (!evidenceText) {
    return false;
  }

  // Compare with evidence clauses so negation/direction come from the matching
  // clause, not an unrelated neighboring clause in the same card field.
  const evidenceTexts = splitSupportClauses(evidenceText);

  // A model item may contain several grammatical sentences even though the
  // response schema calls it one sentence. Validate every one so a supported
  // first sentence cannot carry an unsupported second sentence into the brief.
  return splitSupportClauses(text).every(
    (clause) =>
      validateClaimSupport(clause, evidenceTexts, {
        // Briefs are short and cite one card, so require a substantial lexical
        // anchor. False negatives safely fall back to the deterministic brief.
        minOverlap: 1,
        minimumSharedTokens: 2,
        checkProperNouns: true,
        allowBeyondSource: false
      }).supported
  );
}

function splitSupportClauses(value: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(value))
    .flatMap(({ segment }) =>
      segment.split(/[;；\n]+|\b(?:and|but|while|whereas)\b|(?:并且|而且|但是|同时)/giu)
    )
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function buildChineseSentences(
  input: ConceptBriefInput,
  cards: ConceptBriefCardInput[],
  adjacentConcepts: ConceptBriefAdjacentConcept[]
): ConceptBriefSentence[] {
  const concept = input.concept;
  const primaryCard = cards[0];
  const secondCard = cards[1] ?? primaryCard;
  const relation = adjacentConcepts[0];
  const progressCard = cards[cards.length - 1] ?? primaryCard;

  return [
    primaryCard
      ? {
          id: `${slug(concept)}-brief-what`,
          text: `你从《${primaryCard.title}》里把 ${concept} 先沉淀成这个判断:${primaryCard.keyTakeaway}`,
          cardId: primaryCard.id
        }
      : undefined,
    secondCard
      ? {
          id: `${slug(concept)}-brief-why`,
          text: `${concept} 重要,因为它不只是一个标签,而是会影响你如何解释、比较或应用相关知识;《${secondCard.title}》给出的可复述要点是:${secondCard.keyTakeaway}`,
          cardId: secondCard.id
        }
      : undefined,
    relation
      ? {
          id: `${slug(concept)}-brief-relation`,
          text: `在你的图谱里,${concept} 通过「${formatRelationZh(relation.relation)}」连到 ${relation.concept},所以阅读时应把这两个概念放在同一条理解链上。`,
          cardId: relation.cardId
        }
      : primaryCard
        ? {
            id: `${slug(concept)}-brief-relation`,
            text: `目前 ${concept} 的相邻关系还不密集,先以《${primaryCard.title}》为中心读,再观察后续卡片会把它延伸到哪些概念。`,
            cardId: primaryCard.id
          }
        : undefined,
    progressCard
      ? {
          id: `${slug(concept)}-brief-progress`,
          text: `掌握进度上,这里已有 ${cards.length} 张卡和 ${normalizeCount(input.reviewCount)} 次复习信号;下一步先回看《${progressCard.title}》,确认你能把其中判断换成自己的话。`,
          cardId: progressCard.id
        }
      : undefined
  ].filter((sentence): sentence is ConceptBriefSentence => !!sentence);
}

function buildEnglishSentences(
  input: ConceptBriefInput,
  cards: ConceptBriefCardInput[],
  adjacentConcepts: ConceptBriefAdjacentConcept[]
): ConceptBriefSentence[] {
  const concept = input.concept;
  const primaryCard = cards[0];
  const secondCard = cards[1] ?? primaryCard;
  const relation = adjacentConcepts[0];
  const progressCard = cards[cards.length - 1] ?? primaryCard;

  return [
    primaryCard
      ? {
          id: `${slug(concept)}-brief-what`,
          text: `From "${primaryCard.title}", ${concept} currently means this reusable judgment: ${primaryCard.keyTakeaway}`,
          cardId: primaryCard.id
        }
      : undefined,
    secondCard
      ? {
          id: `${slug(concept)}-brief-why`,
          text: `${concept} matters because it changes how you explain, compare, or apply nearby ideas; "${secondCard.title}" captures the takeaway as: ${secondCard.keyTakeaway}`,
          cardId: secondCard.id
        }
      : undefined,
    relation
      ? {
          id: `${slug(concept)}-brief-relation`,
          text: `In your graph, ${concept} ${formatRelationEn(relation.relation)} ${relation.concept}, so read the two concepts as part of the same understanding chain.`,
          cardId: relation.cardId
        }
      : primaryCard
        ? {
            id: `${slug(concept)}-brief-relation`,
            text: `${concept} does not have many adjacent graph links yet, so start from "${primaryCard.title}" and watch which later cards extend it.`,
            cardId: primaryCard.id
          }
        : undefined,
    progressCard
      ? {
          id: `${slug(concept)}-brief-progress`,
          text: `Your progress is ${cards.length} cards and ${normalizeCount(input.reviewCount)} review signals; next, revisit "${progressCard.title}" and check whether you can restate its judgment in your own words.`,
          cardId: progressCard.id
        }
      : undefined
  ].filter((sentence): sentence is ConceptBriefSentence => !!sentence);
}

function collectAdjacentConcepts(
  concept: string,
  cards: ConceptBriefCardInput[]
): ConceptBriefAdjacentConcept[] {
  const conceptKey = normalizeConceptKey(concept);
  const byKey = new Map<string, ConceptBriefAdjacentConcept>();

  for (const card of cards) {
    for (const edge of card.graphEdges ?? []) {
      const sourceKey = normalizeConceptKey(edge.sourceConcept);
      const targetKey = normalizeConceptKey(edge.targetConcept);
      const adjacent =
        sourceKey === conceptKey
          ? edge.targetConcept
          : targetKey === conceptKey
            ? edge.sourceConcept
            : undefined;

      if (!adjacent) {
        continue;
      }

      const adjacentKey = normalizeConceptKey(adjacent);

      if (!adjacentKey || byKey.has(adjacentKey)) {
        continue;
      }

      byKey.set(adjacentKey, {
        concept: adjacent,
        relation: edge.relation,
        cardId: card.id
      });
    }
  }

  return Array.from(byKey.values());
}

function normalizeCards(cards: ConceptBriefCardInput[]): ConceptBriefCardInput[] {
  const byId = new Map<string, ConceptBriefCardInput>();

  for (const card of cards) {
    if (!card.id || !card.title) {
      continue;
    }

    byId.set(card.id, {
      ...card,
      keyTakeaway: card.keyTakeaway || card.title,
      concepts: [...card.concepts],
      graphEdges: card.graphEdges ? [...card.graphEdges] : undefined
    });
  }

  return Array.from(byId.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function formatRelationZh(relation: KnowledgeEdgeRelation): string {
  const labels: Record<KnowledgeEdgeRelation, string> = {
    requires: "需要",
    extends: "延伸",
    contrasts: "对比",
    applies: "应用",
    evaluates: "评估",
    summarizes: "总结"
  };

  return labels[relation];
}

function formatRelationEn(relation: KnowledgeEdgeRelation): string {
  const labels: Record<KnowledgeEdgeRelation, string> = {
    requires: "requires",
    extends: "extends",
    contrasts: "contrasts with",
    applies: "applies to",
    evaluates: "evaluates",
    summarizes: "summarizes"
  };

  return labels[relation];
}

function extractJsonPayload(content: string): string {
  const trimmed = content.trim();
  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedJson?.[1]) {
    return fencedJson[1].trim();
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

function buildConceptBriefId(concept: string, createdAt: string): string {
  return `concept-brief-${slug(concept)}-${hashText(createdAt).slice(0, 8)}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "") || "concept";
}

function hashText(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function normalizeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
