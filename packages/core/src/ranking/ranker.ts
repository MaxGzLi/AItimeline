import type {
  ConceptAliasRecord,
  InteractionSignal,
  KnowledgeCard,
  RankedKnowledgeCard,
  TopicState,
  UserMemory,
  UserProfile
} from "../types.js";
import {
  createConceptAliasResolver,
  normalizeConceptKey,
  slugConcept as slugResolvedConcept
} from "../graph/conceptAliases.js";

export type RecommendationIntent =
  | "deepen_interest"
  | "broaden"
  | "review"
  | "cooldown"
  | "explore"
  | "source_freshness";

export interface PersonalizedTimelineRankingInput {
  cards: KnowledgeCard[];
  memory?: UserMemory;
  topicStates?: TopicState[];
  recentSignals?: InteractionSignal[];
  seenReadCounts?: Record<string, number>;
  dueReviewPostIds?: string[];
  conceptAliases?: ConceptAliasRecord[];
  now?: string | Date;
}

export interface PersonalizedRankedKnowledgeCard extends RankedKnowledgeCard {
  recommendationIntent: RecommendationIntent;
}

export function rankKnowledgeCards(
  cards: KnowledgeCard[],
  profile: UserProfile,
  conceptAliases: ConceptAliasRecord[] = []
): RankedKnowledgeCard[] {
  const resolver = createConceptAliasResolver(conceptAliases);
  return cards
    .map((card) => {
      const reasons: string[] = [];
      let score = 0;
      const cardConcepts = card.concepts.map((concept) => resolver.resolveConcept(concept));
      const profileInterests = profile.interests.map((concept) => resolver.resolveConcept(concept));
      const profileWeakConcepts = profile.weakConcepts.map((concept) => resolver.resolveConcept(concept));
      const profileKnownConcepts = profile.knownConcepts.map((concept) => resolver.resolveConcept(concept));

      const conceptHits = cardConcepts.filter((concept) => profileInterests.includes(concept));
      if (conceptHits.length > 0) {
        score += conceptHits.length * 20;
        reasons.push(`Matches interests: ${conceptHits.join(", ")}`);
      }

      const weakHits = cardConcepts.filter((concept) => profileWeakConcepts.includes(concept));
      if (weakHits.length > 0) {
        score += weakHits.length * 16;
        reasons.push(`Strengthens weak concepts: ${weakHits.join(", ")}`);
      }

      const noveltyHits = cardConcepts.filter((concept) => !profileKnownConcepts.includes(concept));
      if (noveltyHits.length > 0) {
        score += Math.min(noveltyHits.length * 8, 24);
        reasons.push("Adds new concepts");
      }

      if (card.trustState === "supported") {
        score += 12;
        reasons.push("Supported by stronger sources");
      }

      score += Math.max(0, 8 - card.estimatedReadMinutes);

      return {
        ...card,
        score,
        scoreReasons: reasons
      };
    })
    .sort((left, right) => right.score - left.score);
}

export function rankPersonalizedTimeline(input: PersonalizedTimelineRankingInput): PersonalizedRankedKnowledgeCard[] {
  const now = normalizeDate(input.now ?? new Date());
  const memory = input.memory;
  const resolver = createConceptAliasResolver(input.conceptAliases);
  const topicStateById = new Map((input.topicStates ?? []).map((state) => [state.topicId, state]));
  const recentSignals = [...(input.recentSignals ?? [])]
    .sort((left, right) => normalizeDate(right.createdAt).getTime() - normalizeDate(left.createdAt).getTime())
    .slice(0, 80);
  const interestSet = createConceptSet(memory?.profile.interests ?? [], resolver);
  const knownSet = createConceptSet(memory?.knowledge.knownConcepts ?? [], resolver);
  const savedSet = createConceptSet(memory?.knowledge.savedConcepts ?? [], resolver);
  const weakSet = createConceptSet(memory?.knowledge.weakConcepts ?? [], resolver);
  const recentCardSet = new Set(memory?.interaction.recentCardIds ?? []);
  const dueReviewPostIds = new Set(input.dueReviewPostIds ?? []);

  return input.cards
    .map((card) => {
      const reasons: string[] = [];
      let score = 10;
      const isDueReview = dueReviewPostIds.has(card.id);
      const cardConcepts = card.concepts.map((concept) => resolver.resolveConcept(concept));
      const topicId = getTopicId(card, resolver);
      const topicState = topicStateById.get(topicId) ?? findTopicStateByConcept(topicStateById, cardConcepts);
      const sameTopicSignals = recentSignals.filter(
        (signal) =>
          signal.topicId === topicId ||
          signal.postId === card.id ||
          hasConceptOverlap(signal.conceptIds, cardConcepts, resolver)
      );
      const interestHits = findConceptHits(cardConcepts, interestSet, resolver);
      const savedHits = findConceptHits(cardConcepts, savedSet, resolver);
      const weakHits = findConceptHits(cardConcepts, weakSet, resolver);
      const knownHits = findConceptHits(cardConcepts, knownSet, resolver);

      if (card.kind === "connection_note") {
        score += 42;
        reasons.push("New connection found across your timeline");
      }

      if (interestHits.length > 0) {
        score += interestHits.length * 18;
        reasons.push(`Memory interest: ${interestHits.slice(0, 2).join(", ")}`);
      }

      if (savedHits.length > 0) {
        score += savedHits.length * 16;
        reasons.push(`Saved concept follow-up: ${savedHits.slice(0, 2).join(", ")}`);
      }

      if (weakHits.length > 0) {
        score += weakHits.length * 20;
        reasons.push(`Review weak concept: ${weakHits.slice(0, 2).join(", ")}`);
      }

      if (knownHits.length > 0) {
        score += Math.min(knownHits.length * 4, 8);
        reasons.push("Connects to known concepts");
      }

      if (recentCardSet.has(card.id)) {
        score += 6;
        reasons.push("Recently active in your memory");
      }

      if (topicState) {
        const cooldownActive = topicState.cooldownUntil ? normalizeDate(topicState.cooldownUntil) > now : false;

        if (cooldownActive) {
          score -= 35;
          reasons.push("Topic is cooling down after weak engagement");
        } else {
          score += topicState.interestScore * 24;

          if (topicState.interestScore >= 0.55) {
            reasons.push("Recent engagement says this topic is pulling you in");
          }
        }

        if (topicState.fatigueScore >= 0.7) {
          score -= 22;
          reasons.push("Recent quick skips lower this topic for now");
        }

        if (topicState.comprehensionScore < 0.45 && card.difficulty !== "advanced") {
          score += 12;
          reasons.push("Simpler follow-up after confusion");
        }

        if (topicState.interestScore >= 0.55 && topicState.comprehensionScore >= 0.7) {
          score += 10;
          reasons.push("Ready for a broader connection");
        }
      }

      const signalScore = scoreRecentSignals(sameTopicSignals);

      score += signalScore.score;
      reasons.push(...signalScore.reasons);

      if (card.trustState === "supported") {
        score += 8;
        reasons.push("Supported by stronger sources");
      }

      if (card.reviewPrompts?.length) {
        score += Math.min(card.reviewPrompts.length * 3, 9);
        reasons.push("Has review checks ready");
      }

      score += Math.max(0, 6 - card.estimatedReadMinutes);
      score += scoreFreshness(card, now);

      if (isDueReview) {
        score += 30;
        reasons.unshift("Due for spaced review");
      } else {
        const seenReadCount = Math.max(0, input.seenReadCounts?.[card.id] ?? 0);
        const seenReadPenalty = Math.min(seenReadCount * 12, 36);

        if (seenReadPenalty > 0) {
          score -= seenReadPenalty;
          reasons.unshift("Already read; lowering it so fresh cards can surface");
        }
      }

      if (reasons.length === 0) {
        reasons.push("Fresh source ready for exploration");
      }

      return {
        ...card,
        score: Math.round(score * 10) / 10,
        scoreReasons: dedupe(reasons).slice(0, 5),
        recommendationIntent: isDueReview
          ? "review"
          : inferRecommendationIntent(card, topicState, weakHits.length, savedHits.length, signalScore, now)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return normalizeDate(right.createdAt).getTime() - normalizeDate(left.createdAt).getTime();
    });
}

function scoreRecentSignals(signals: InteractionSignal[]): { score: number; reasons: string[]; positive: number; negative: number } {
  let score = 0;
  let positive = 0;
  let negative = 0;
  const reasons: string[] = [];

  for (const signal of signals.slice(0, 12)) {
    if (signal.liked || signal.saved || signal.askedQuestion || signal.openedThread || signal.reviewed) {
      positive += 1;
    }

    if (signal.skippedQuickly) {
      negative += 1;
    }

    if (signal.dwellTimeMs >= 12000) {
      positive += 1;
    }
  }

  if (positive > 0) {
    score += Math.min(positive * 6, 18);
    reasons.push("Recent interactions ask for more on this topic");
  }

  if (negative > 0) {
    score -= Math.min(negative * 9, 24);
    reasons.push("Recent skips reduce similar posts");
  }

  return { score, reasons, positive, negative };
}

function inferRecommendationIntent(
  card: KnowledgeCard,
  topicState: TopicState | undefined,
  weakHitCount: number,
  savedHitCount: number,
  signalScore: { positive: number; negative: number },
  now: Date
): RecommendationIntent {
  const cooldownActive = topicState?.cooldownUntil ? normalizeDate(topicState.cooldownUntil) > now : false;

  if (cooldownActive || signalScore.negative > signalScore.positive + 1 || (topicState?.fatigueScore ?? 0) >= 0.8) {
    return "cooldown";
  }

  if (weakHitCount > 0 || savedHitCount > 0) {
    return "review";
  }

  if ((topicState?.interestScore ?? 0) >= 0.65 && (topicState?.comprehensionScore ?? 0) >= 0.7) {
    return "broaden";
  }

  if ((topicState?.interestScore ?? 0) >= 0.55 || signalScore.positive > 0) {
    return "deepen_interest";
  }

  if (scoreFreshness(card, now) > 0) {
    return "source_freshness";
  }

  return "explore";
}

function scoreFreshness(card: KnowledgeCard, now: Date): number {
  const ageMs = now.getTime() - normalizeDate(card.createdAt).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  if (ageDays <= 1) {
    return 5;
  }

  if (ageDays <= 7) {
    return 2;
  }

  return 0;
}

function findTopicStateByConcept(
  topicStateById: Map<string, TopicState>,
  concepts: string[]
): TopicState | undefined {
  for (const concept of concepts) {
    const match =
      topicStateById.get(slugConcept(concept)) ?? topicStateById.get(normalizeConcept(concept)) ?? topicStateById.get(concept);

    if (match) {
      return match;
    }
  }

  return undefined;
}

function hasConceptOverlap(
  left: string[],
  right: string[],
  resolver: ReturnType<typeof createConceptAliasResolver>
): boolean {
  const rightSet = createConceptSet(right, resolver);

  return left.some((concept) => rightSet.has(normalizeConcept(concept, resolver)));
}

function findConceptHits(
  concepts: string[],
  set: Set<string>,
  resolver: ReturnType<typeof createConceptAliasResolver>
): string[] {
  return concepts.filter((concept) => set.has(normalizeConcept(concept, resolver)));
}

function createConceptSet(
  concepts: string[],
  resolver: ReturnType<typeof createConceptAliasResolver>
): Set<string> {
  return new Set(concepts.map((concept) => normalizeConcept(concept, resolver)));
}

function normalizeConcept(concept: string, resolver?: ReturnType<typeof createConceptAliasResolver>): string {
  return normalizeConceptKey(resolver ? resolver.resolveConcept(concept) : concept);
}

function getTopicId(card: KnowledgeCard, resolver: ReturnType<typeof createConceptAliasResolver>): string {
  return slugConcept(card.concepts[0] ?? card.id, resolver);
}

function slugConcept(concept: string, resolver?: ReturnType<typeof createConceptAliasResolver>): string {
  return slugResolvedConcept(resolver ? resolver.resolveConcept(concept) : concept) || "general";
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
