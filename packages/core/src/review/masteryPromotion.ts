import type { KnowledgeCard, ReviewState, TopicState } from "../types.js";
import { normalizeConceptKey, normalizeConceptLabel } from "../graph/conceptAliases.js";
import { persistentReviewIntervals } from "./reviewState.js";

export interface MasteryPromotionInput {
  concepts: string[];
  cards: Pick<KnowledgeCard, "id" | "concepts" | "kind">[];
  reviewStates: ReviewState[];
  topicStates: (Pick<TopicState, "topicId" | "comprehensionScore"> & { updatedAt?: string })[];
  knownConcepts?: string[];
  promotionBlacklist?: string[];
}

export interface MasteryPromotion {
  concept: string;
  postIds: string[];
  cardCount: number;
  qualifyingCardCount: number;
  intervalDays: number[];
  maxIntervalDays: number;
  comprehensionScore: number;
  estimatedReviewCount: number;
}

const multipleCardMinimumIntervalDays = 7;
const singleCardMinimumIntervalDays = 14;
const masteryComprehensionThreshold = 0.7;

export function evaluateMasteryPromotions(input: MasteryPromotionInput): MasteryPromotion[] {
  const candidates = uniqueConceptLabels(input.concepts);
  const knownKeys = new Set((input.knownConcepts ?? []).map(normalizeConceptKey).filter(Boolean));
  const blacklistKeys = new Set((input.promotionBlacklist ?? []).map(normalizeConceptKey).filter(Boolean));
  const reviewStateByPostId = new Map(input.reviewStates.map((state) => [state.postId, state]));
  const topicStateByConceptKey = new Map<string, MasteryPromotionInput["topicStates"][number]>();

  // Snapshots can hold several topic states whose ids normalize to the same
  // concept (casing drift across write paths); the freshest one is the truth.
  for (const state of input.topicStates) {
    const key = normalizeConceptKey(state.topicId);

    if (!key) {
      continue;
    }

    const existing = topicStateByConceptKey.get(key);

    if (!existing || (state.updatedAt ?? "") > (existing.updatedAt ?? "")) {
      topicStateByConceptKey.set(key, state);
    }
  }

  return candidates.flatMap((concept) => {
    const conceptKey = normalizeConceptKey(concept);

    if (!conceptKey || knownKeys.has(conceptKey) || blacklistKeys.has(conceptKey)) {
      return [];
    }

    const topicState = topicStateByConceptKey.get(conceptKey);

    if (!topicState || topicState.comprehensionScore < masteryComprehensionThreshold) {
      return [];
    }

    const relatedCards = input.cards.filter(
      (card) =>
        card.kind !== "connection_note" &&
        card.concepts.some((cardConcept) => normalizeConceptKey(cardConcept) === conceptKey)
    );
    const relatedStates = relatedCards.flatMap((card) => {
      const state = reviewStateByPostId.get(card.id);

      return state ? [state] : [];
    });
    const qualifyingStates = relatedStates.filter((state) => state.intervalDays >= multipleCardMinimumIntervalDays);
    const hasEnoughReviewHistory =
      relatedCards.length === 1
        ? (relatedStates[0]?.intervalDays ?? 0) >= singleCardMinimumIntervalDays
        : qualifyingStates.length >= 2;

    if (!hasEnoughReviewHistory) {
      return [];
    }

    const intervalDays = relatedStates.map((state) => state.intervalDays).sort((left, right) => left - right);

    return [
      {
        concept,
        postIds: relatedCards.map((card) => card.id),
        cardCount: relatedCards.length,
        qualifyingCardCount: relatedCards.length === 1 ? 1 : qualifyingStates.length,
        intervalDays,
        maxIntervalDays: intervalDays.length ? Math.max(...intervalDays) : 0,
        comprehensionScore: topicState.comprehensionScore,
        estimatedReviewCount: relatedStates.reduce(
          (total, state) => total + estimateCompletedReviewCount(state.intervalDays),
          0
        )
      }
    ];
  });
}

function uniqueConceptLabels(concepts: string[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const concept of concepts) {
    const label = normalizeConceptLabel(concept);
    const key = normalizeConceptKey(label);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    labels.push(label);
  }

  return labels;
}

function estimateCompletedReviewCount(intervalDays: number): number {
  for (let index = persistentReviewIntervals.length - 1; index >= 0; index -= 1) {
    if (intervalDays >= persistentReviewIntervals[index]) {
      return index;
    }
  }

  return 0;
}
