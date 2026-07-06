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

const roleOrder: Record<ConceptDigestRole, number> = {
  foundation: 0,
  builds: 1,
  applies: 2,
  contrast: 3
};

const difficultyOrder: Record<KnowledgeDifficulty, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2
};

/**
 * Assemble every accumulated fragment that touches one concept into a single readable
 * "whole": ordered foundations -> builds -> applications -> contrasts so a user can read a
 * concept end to end instead of meeting it scattered across the stream. A card counts as
 * touching the concept when it lists the concept or when one of its graph edges names it.
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

  return (left: ConceptDigestEntry, right: ConceptDigestEntry): number => {
    if (roleOrder[left.role] !== roleOrder[right.role]) {
      return roleOrder[left.role] - roleOrder[right.role];
    }

    const leftDifficulty = left.difficulty ? difficultyOrder[left.difficulty] : 1;
    const rightDifficulty = right.difficulty ? difficultyOrder[right.difficulty] : 1;

    if (leftDifficulty !== rightDifficulty) {
      return leftDifficulty - rightDifficulty;
    }

    return (createdAt.get(left.cardId) ?? "").localeCompare(createdAt.get(right.cardId) ?? "");
  };
}
