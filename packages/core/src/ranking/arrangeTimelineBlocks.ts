import type { ConceptAliasRecord, KnowledgeCard, RankedKnowledgeCard } from "../types.js";
import { createConceptAliasResolver, normalizeConceptKey, slugConcept } from "../graph/conceptAliases.js";

export const topicDwellBoostPerMinute = 6;
export const maxTopicDwellBoost = 30;

export type TimelineBlockTopicSource = "learning_goal" | "card_topic";

export interface TimelineBlockTopic {
  id: string;
  label: string;
  source: TimelineBlockTopicSource;
  goalId?: string;
  progressPercent?: number;
}

export interface ActiveLearningGoalBlockTopic {
  id: string;
  label: string;
  conceptIds: string[];
  progressPercent: number;
  createdAt?: string;
}

export interface TimelineBlockDivider {
  blockId: string;
  topicId: string;
  topicLabel: string;
}

export interface TimelineBlock<Card extends RankedKnowledgeCard = RankedKnowledgeCard> {
  id: string;
  topic: TimelineBlockTopic;
  divider: TimelineBlockDivider;
  cards: Card[];
  postIds: string[];
  highestScore: number;
  dwellBoost: number;
  score: number;
}

export type TimelineArrangementItem<Card extends RankedKnowledgeCard = RankedKnowledgeCard> =
  | {
      kind: "block";
      block: TimelineBlock<Card>;
    }
  | {
      kind: "card";
      card: Card;
      blockTopic: TimelineBlockTopic;
    };

export interface TimelineBlockArrangement<Card extends RankedKnowledgeCard = RankedKnowledgeCard> {
  items: TimelineArrangementItem<Card>[];
  blocks: TimelineBlock<Card>[];
}

export interface ArrangeTimelineBlocksInput<Card extends RankedKnowledgeCard = RankedKnowledgeCard> {
  cards: Card[];
  blockTopicsByPostId: Record<string, TimelineBlockTopic>;
  topicDwellMs?: Record<string, number>;
  interleavedPostIds?: string[];
}

export function resolveCardBlockTopic(
  card: KnowledgeCard,
  activeGoals: readonly ActiveLearningGoalBlockTopic[] = [],
  conceptAliases: readonly ConceptAliasRecord[] = []
): TimelineBlockTopic {
  const resolver = createConceptAliasResolver(conceptAliases);
  const cardConceptKeys = new Set(
    (card.concepts ?? [])
      .map((concept) => normalizeConceptKey(resolver.resolveConcept(concept)))
      .filter(Boolean)
  );
  const matchingGoals = activeGoals
    .map((goal, index) => ({
      goal,
      index,
      conceptKeys: new Set(
        goal.conceptIds.map((concept) => normalizeConceptKey(resolver.resolveConcept(concept))).filter(Boolean)
      )
    }))
    .filter(({ conceptKeys }) => Array.from(cardConceptKeys).some((conceptKey) => conceptKeys.has(conceptKey)))
    .sort((left, right) => {
      if (left.goal.progressPercent !== right.goal.progressPercent) {
        return left.goal.progressPercent - right.goal.progressPercent;
      }

      return (
        (left.goal.createdAt ?? "").localeCompare(right.goal.createdAt ?? "") ||
        left.goal.label.localeCompare(right.goal.label) ||
        left.index - right.index
      );
    });

  const goalMatch = matchingGoals[0]?.goal;

  if (goalMatch) {
    return {
      id: `goal:${goalMatch.id}`,
      label: goalMatch.label,
      source: "learning_goal",
      goalId: goalMatch.id,
      progressPercent: goalMatch.progressPercent
    };
  }

  const topicId = getCardTopicId(card);
  const fallbackLabel = resolveFallbackTopicLabel(card, topicId, resolver);

  return {
    id: topicId,
    label: fallbackLabel,
    source: "card_topic"
  };
}

export function assignCardBlockTopics(
  cards: readonly KnowledgeCard[],
  activeGoals: readonly ActiveLearningGoalBlockTopic[] = [],
  conceptAliases: readonly ConceptAliasRecord[] = []
): Record<string, TimelineBlockTopic> {
  return Object.fromEntries(
    cards.map((card) => [card.id, resolveCardBlockTopic(card, activeGoals, conceptAliases)])
  );
}

export function arrangeTimelineBlocks<Card extends RankedKnowledgeCard>(
  input: ArrangeTimelineBlocksInput<Card>
): TimelineBlockArrangement<Card> {
  const interleavedPostIds = new Set(input.interleavedPostIds ?? []);
  const items: TimelineArrangementItem<Card>[] = [];
  const blocks: TimelineBlock<Card>[] = [];
  let segment: Card[] = [];

  const flushSegment = () => {
    if (!segment.length) {
      return;
    }

    const segmentBlocks = orderBlocks(
      createBlocks(segment, input.blockTopicsByPostId, input.topicDwellMs ?? {}, blocks.length)
    );

    blocks.push(...segmentBlocks);
    items.push(...segmentBlocks.map((block) => ({ kind: "block" as const, block })));
    segment = [];
  };

  for (const card of input.cards) {
    const blockTopic = input.blockTopicsByPostId[card.id] ?? resolveCardBlockTopic(card);

    if (card.kind === "connection_note" || interleavedPostIds.has(card.id)) {
      flushSegment();
      items.push({ kind: "card", card, blockTopic });
      continue;
    }

    segment.push(card);
  }

  flushSegment();

  return { items, blocks };
}

function createBlocks<Card extends RankedKnowledgeCard>(
  cards: Card[],
  blockTopicsByPostId: Record<string, TimelineBlockTopic>,
  topicDwellMs: Record<string, number>,
  blockOffset: number
): TimelineBlock<Card>[] {
  const grouped = new Map<string, { topic: TimelineBlockTopic; cards: Card[] }>();

  for (const card of cards) {
    const topic = blockTopicsByPostId[card.id] ?? resolveCardBlockTopic(card);
    const group = grouped.get(topic.id) ?? { topic, cards: [] };

    group.cards.push(card);
    grouped.set(topic.id, group);
  }

  const blocks: TimelineBlock<Card>[] = [];

  for (const group of grouped.values()) {
    const sizes = getBlockSizes(group.cards.length);
    let cursor = 0;

    for (const size of sizes) {
      const blockCards = group.cards.slice(cursor, cursor + size);
      const highestScore = Math.max(...blockCards.map((card) => card.score));
      const dwellBoost = scoreTopicDwell(topicDwellMs[group.topic.id] ?? 0);
      const blockIndex = blockOffset + blocks.length;
      const id = `block-${sanitizeId(group.topic.id)}-${blockIndex}`;

      blocks.push({
        id,
        topic: group.topic,
        divider: {
          blockId: id,
          topicId: group.topic.id,
          topicLabel: group.topic.label
        },
        cards: blockCards,
        postIds: blockCards.map((card) => card.id),
        highestScore,
        dwellBoost,
        score: roundScore(highestScore + dwellBoost)
      });
      cursor += size;
    }
  }

  return blocks;
}

function orderBlocks<Card extends RankedKnowledgeCard>(blocks: TimelineBlock<Card>[]): TimelineBlock<Card>[] {
  const remaining = [...blocks].sort(compareBlocks);
  const ordered: TimelineBlock<Card>[] = [];

  while (remaining.length) {
    const previousTopicId = ordered.at(-1)?.topic.id;
    const nextIndex = remaining.findIndex((block) => block.topic.id !== previousTopicId);
    const selectedIndex = nextIndex === -1 ? 0 : nextIndex;
    const [selected] = remaining.splice(selectedIndex, 1);

    ordered.push(selected);
  }

  return ordered;
}

function compareBlocks<Card extends RankedKnowledgeCard>(left: TimelineBlock<Card>, right: TimelineBlock<Card>): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.highestScore !== left.highestScore) {
    return right.highestScore - left.highestScore;
  }

  return left.id.localeCompare(right.id);
}

function getBlockSizes(count: number): number[] {
  if (count <= 0) {
    return [];
  }

  if (count < 3) {
    return [count];
  }

  let best: { sizes: number[]; short: number; fourCount: number } | null = null;

  for (let short = 0; short <= 2; short += 1) {
    const remaining = count - short;

    if (remaining < 0) {
      continue;
    }

    for (let fourCount = Math.floor(remaining / 4); fourCount >= 0; fourCount -= 1) {
      const rest = remaining - fourCount * 4;

      if (rest % 3 !== 0) {
        continue;
      }

      const threeCount = rest / 3;
      const sizes = [...Array(fourCount).fill(4), ...Array(threeCount).fill(3)];

      if (short > 0) {
        sizes.push(short);
      }

      if (
        !best ||
        (short === 0 && best.short !== 0) ||
        (short > 0 && best.short > 0 && short > best.short) ||
        (short === best.short && fourCount > best.fourCount) ||
        (short === best.short && fourCount === best.fourCount && sizes.length < best.sizes.length)
      ) {
        best = { sizes, short, fourCount };
      }
    }
  }

  return best?.sizes ?? [count];
}

function scoreTopicDwell(dwellMs: number): number {
  if (!Number.isFinite(dwellMs)) {
    return 0;
  }

  const minutes = Math.max(0, dwellMs) / 60000;

  return roundScore(Math.min(maxTopicDwellBoost, minutes * topicDwellBoostPerMinute));
}

function resolveFallbackTopicLabel(
  card: KnowledgeCard,
  topicId: string,
  resolver: ReturnType<typeof createConceptAliasResolver>
): string {
  const firstConcept = card.concepts?.[0];

  if (firstConcept) {
    const label = resolver.resolveConcept(firstConcept).trim();

    if (label) {
      return label;
    }
  }

  return topicId || "general";
}

function getCardTopicId(card: KnowledgeCard): string {
  const explicitTopicId = (card as KnowledgeCard & { topicId?: string }).topicId;

  if (typeof explicitTopicId === "string" && explicitTopicId.trim()) {
    return explicitTopicId.trim();
  }

  return slugConcept(card.concepts?.[0] ?? card.id) || "general";
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "topic";
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
