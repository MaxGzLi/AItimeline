import type {
  ConceptAliasRecord,
  InteractionSignal,
  KnowledgeCard,
  RankedKnowledgeCard,
  TopicState,
  UserMemory,
  UserProfile
} from "../types.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import {
  createConceptAliasResolver,
  normalizeConceptKey,
  slugConcept as slugResolvedConcept
} from "../graph/conceptAliases.js";
import {
  coalesceInteractionSignals,
  type InteractionSignalInput
} from "../interaction/coalesceInteractionSignals.js";
import { countSeenReadSignalsByPostId, isLifecycleInteractionSignal } from "./lifecycle.js";

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
  recentSignals?: InteractionSignalInput[];
  seenReadCounts?: Record<string, number>;
  dueReviewPostIds?: string[];
  conceptAliases?: ConceptAliasRecord[];
  learningGoalConcepts?: string[];
  contentLanguage?: ContentLanguage;
  now?: string | Date;
  timeZone?: string;
  /**
   * Per-page-load seed. When set, cards whose scores sit inside the same narrow
   * window are rotated deterministically so a new visit does not always open on
   * the same card. Omitting it keeps the ranking purely deterministic.
   */
  sessionSeed?: string;
}

/** A shown-but-ignored card loses this much per exposure, up to the cap. */
const exposureFatiguePenaltyPerSignal = 8;
const maxExposureFatiguePenalty = 24;
/** Cards within this many points of the window head rotate among themselves. */
const sessionRotationScoreWindow = 10;

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
  const coalescedSignals = coalesceInteractionSignals(input.recentSignals ?? [], input.timeZone);
  const derivedSeenReadCounts = countSeenReadSignalsByPostId(coalescedSignals, input.timeZone);
  const exposureFatigueCounts = countIgnoredExposuresByPostId(coalescedSignals);
  const recentSignals = [...coalescedSignals]
    .sort((left, right) => normalizeDate(right.createdAt).getTime() - normalizeDate(left.createdAt).getTime())
    .slice(0, 80);
  const interestSet = createConceptSet(memory?.profile.interests ?? [], resolver);
  const knownSet = createConceptSet(memory?.knowledge.knownConcepts ?? [], resolver);
  const savedSet = createConceptSet(memory?.knowledge.savedConcepts ?? [], resolver);
  const weakSet = createConceptSet(memory?.knowledge.weakConcepts ?? [], resolver);
  const learningGoalSet = createConceptSet(input.learningGoalConcepts ?? [], resolver);
  const recentCardSet = new Set(memory?.interaction.recentCardIds ?? []);
  const dueReviewPostIds = new Set(input.dueReviewPostIds ?? []);
  const contentLanguage = input.contentLanguage ?? "en";

  const ranked = input.cards
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
      const learningGoalHits = findConceptHits(cardConcepts, learningGoalSet, resolver);
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

      if (learningGoalHits.length > 0) {
        score += Math.min(learningGoalHits.length * 18, 36);
        reasons.push(formatLearningGoalReason(learningGoalHits, contentLanguage));
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
        const seenReadCount = Math.max(
          0,
          input.seenReadCounts?.[card.id] ?? derivedSeenReadCounts[card.id] ?? 0
        );
        const seenReadPenalty = Math.min(seenReadCount * 12, 36);

        if (seenReadPenalty > 0) {
          score -= seenReadPenalty;
          reasons.unshift("Already read; lowering it so fresh cards can surface");
        }

        const exposureFatiguePenalty = Math.min(
          (exposureFatigueCounts[card.id] ?? 0) * exposureFatiguePenaltyPerSignal,
          maxExposureFatiguePenalty
        );

        if (exposureFatiguePenalty > 0) {
          score -= exposureFatiguePenalty;
          reasons.unshift("Scrolled past without a look; making room for something new");
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

  return rotateRankedCardsBySessionSeed(ranked, input.sessionSeed);
}

/**
 * Counts merged signals that only ever showed the card: an impression with no
 * like / save / thread open / question / review and no read-length dwell.
 */
function countIgnoredExposuresByPostId(signals: readonly InteractionSignal[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const signal of signals) {
    if (signal.impression && !isLifecycleInteractionSignal(signal)) {
      counts[signal.postId] = (counts[signal.postId] ?? 0) + 1;
    }
  }

  return counts;
}

/**
 * Rotates cards inside score windows so consecutive page loads open on a
 * different card without letting a low-scoring card jump the queue. A window is
 * the run of cards scoring within `sessionRotationScoreWindow` of its head; the
 * order inside it comes from a seeded hash, never from Math.random, so the same
 * seed always yields the same list. Without a seed the input order is kept.
 */
export function rotateRankedCardsBySessionSeed<T extends { id: string; score: number }>(
  cards: readonly T[],
  sessionSeed: string | undefined
): T[] {
  if (!sessionSeed) {
    return [...cards];
  }

  const rotated: T[] = [];
  let windowStart = 0;

  while (windowStart < cards.length) {
    const headScore = cards[windowStart].score;
    let windowEnd = windowStart + 1;

    while (windowEnd < cards.length && headScore - cards[windowEnd].score <= sessionRotationScoreWindow) {
      windowEnd += 1;
    }

    const window = cards.slice(windowStart, windowEnd).map((card, offset) => ({ card, offset }));

    window.sort(
      (left, right) =>
        hashStringFnv1a(`${sessionSeed} ${left.card.id}`) - hashStringFnv1a(`${sessionSeed} ${right.card.id}`) ||
        left.offset - right.offset
    );
    rotated.push(...window.map((entry) => entry.card));
    windowStart = windowEnd;
  }

  return rotated;
}

/** FNV-1a 32-bit: deterministic across processes, unlike any RNG. */
function hashStringFnv1a(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function formatLearningGoalReason(concepts: string[], contentLanguage: ContentLanguage): string {
  const labels = concepts.slice(0, 2).join(", ");

  return contentLanguage === "zh" ? `在你的学习路径上:${labels}` : `On your learning path: ${labels}`;
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
