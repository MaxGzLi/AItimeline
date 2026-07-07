import type { KnowledgeCard, KnowledgeDifficulty, KnowledgeEdgeRelation, SourceOrigin } from "../types.js";
import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  type ConceptAliasOptions
} from "./conceptAliases.js";

export type ConceptDigestRole = "foundation" | "builds" | "applies" | "contrast";

export interface ConceptDigestEntry {
  cardId: string;
  title: string;
  keyTakeaway: string;
  role: ConceptDigestRole;
  difficulty?: KnowledgeDifficulty;
  // The card's own spelling of the concept, when it appears in the card's concept list.
  conceptLabel?: string;
}

export interface ConceptDigest {
  // Display spelling of the concept, taken from the first matching card.
  concept: string;
  cardCount: number;
  firstSeenAt?: string;
  firstCardId?: string;
  firstCardTitle?: string;
  firstSourceOrigin?: SourceOrigin;
  entries: ConceptDigestEntry[];
}

/**
 * Assemble every accumulated fragment that touches one concept into a single readable
 * "whole": requires prerequisites first, then creation order, so a user can read a concept
 * end to end instead of meeting it scattered across the stream. A card counts as touching
 * the concept when it lists the concept or when one of its graph edges names it.
 */
export function buildConceptDigest(
  concept: string,
  allCards: KnowledgeCard[],
  options: ConceptAliasOptions = {}
): ConceptDigest {
  const resolver = createConceptAliasResolver([
    ...(options.conceptAliases ?? []),
    ...createAutomaticConceptAliases(allCards, options.conceptAliases)
  ]);
  const targetSlug = resolver.slugConcept(concept);
  let label = resolver.resolveConcept(concept);
  const entries: ConceptDigestEntry[] = [];
  let firstCard: KnowledgeCard | undefined;

  for (const card of allCards) {
    if (card.kind === "connection_note") {
      continue;
    }

    const conceptLabel = card.concepts.find((candidate) => resolver.slugConcept(candidate) === targetSlug);
    const relations = relationsTouchingConcept(card, targetSlug, resolver);

    if (!conceptLabel && relations.length === 0) {
      continue;
    }

    if (conceptLabel && label === concept) {
      label = resolver.resolveConcept(conceptLabel);
    }

    if (!firstCard || card.createdAt.localeCompare(firstCard.createdAt) < 0) {
      firstCard = card;
    }

    entries.push({
      cardId: card.id,
      title: card.title,
      keyTakeaway: card.keyTakeaway || card.thesis || card.summary,
      role: deriveRole(card, relations),
      difficulty: card.difficulty,
      conceptLabel
    });
  }

  entries.sort(compareEntries(allCards));

  return {
    concept: label,
    cardCount: entries.length,
    firstSeenAt: firstCard?.createdAt,
    firstCardId: firstCard?.id,
    firstCardTitle: firstCard?.title,
    firstSourceOrigin: firstCard?.sources?.[0]?.origin,
    entries
  };
}

function relationsTouchingConcept(
  card: KnowledgeCard,
  targetSlug: string,
  resolver: ReturnType<typeof createConceptAliasResolver>
): KnowledgeEdgeRelation[] {
  const relations: KnowledgeEdgeRelation[] = [];

  for (const edge of card.graphEdges ?? []) {
    if (resolver.slugConcept(edge.sourceConcept) === targetSlug || resolver.slugConcept(edge.targetConcept) === targetSlug) {
      relations.push(edge.relation);
    }
  }

  return relations;
}

function deriveRole(card: KnowledgeCard, relations: KnowledgeEdgeRelation[]): ConceptDigestRole {
  if (relations.includes("contrasts")) {
    return "contrast";
  }

  if (card.difficulty === "beginner") {
    return "foundation";
  }

  if (relations.includes("applies") || relations.includes("evaluates") || card.difficulty === "advanced") {
    return "applies";
  }

  return "builds";
}

function compareEntries(allCards: KnowledgeCard[]) {
  const createdAt = new Map(allCards.map((card) => [card.id, card.createdAt]));
  const requiresRank = buildRequiresRanks(allCards);

  return (left: ConceptDigestEntry, right: ConceptDigestEntry): number => {
    const leftRank = requiresRank.get(left.cardId) ?? 0;
    const rightRank = requiresRank.get(right.cardId) ?? 0;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return (createdAt.get(left.cardId) ?? "").localeCompare(createdAt.get(right.cardId) ?? "");
  };
}

function buildRequiresRanks(allCards: KnowledgeCard[]): Map<string, number> {
  const cards = allCards.filter((card) => card.kind !== "connection_note");
  const cardIds = new Set(cards.map((card) => card.id));
  const conceptToCardIds = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  for (const card of cards) {
    outgoing.set(card.id, new Set());
    indegree.set(card.id, 0);

    for (const concept of collectCardConcepts(card)) {
      const key = slugConcept(concept);

      if (!key) {
        continue;
      }

      const ids = conceptToCardIds.get(key) ?? new Set<string>();
      ids.add(card.id);
      conceptToCardIds.set(key, ids);
    }
  }

  for (const card of cards) {
    for (const edge of card.graphEdges ?? []) {
      if (edge.relation !== "requires") {
        continue;
      }

      const dependentIds = conceptToCardIds.get(slugConcept(edge.sourceConcept)) ?? new Set<string>();
      const prerequisiteIds = conceptToCardIds.get(slugConcept(edge.targetConcept)) ?? new Set<string>();

      for (const prerequisiteId of prerequisiteIds) {
        for (const dependentId of dependentIds) {
          if (prerequisiteId === dependentId || !cardIds.has(prerequisiteId) || !cardIds.has(dependentId)) {
            continue;
          }

          const edges = outgoing.get(prerequisiteId);

          if (!edges || edges.has(dependentId)) {
            continue;
          }

          edges.add(dependentId);
          indegree.set(dependentId, (indegree.get(dependentId) ?? 0) + 1);
        }
      }
    }
  }

  const createdAt = new Map(cards.map((card) => [card.id, card.createdAt]));
  const queue = Array.from(indegree.entries())
    .filter(([, count]) => count === 0)
    .map(([cardId]) => cardId)
    .sort((left, right) => (createdAt.get(left) ?? "").localeCompare(createdAt.get(right) ?? ""));
  const rank = new Map<string, number>();

  while (queue.length) {
    const cardId = queue.shift() as string;
    const currentRank = rank.size;

    rank.set(cardId, currentRank);

    for (const nextId of outgoing.get(cardId) ?? []) {
      const nextIndegree = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, nextIndegree);

      if (nextIndegree === 0) {
        queue.push(nextId);
        queue.sort((left, right) => (createdAt.get(left) ?? "").localeCompare(createdAt.get(right) ?? ""));
      }
    }
  }

  for (const card of cards.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (!rank.has(card.id)) {
      rank.set(card.id, rank.size);
    }
  }

  return rank;
}

function collectCardConcepts(card: KnowledgeCard): string[] {
  return [
    ...card.concepts,
    ...(card.graphEdges ?? []).flatMap((edge) => [edge.sourceConcept, edge.targetConcept])
  ];
}

function slugConcept(concept: string): string {
  return concept.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "");
}
