import type { KnowledgeCard, KnowledgeEdgeRelation } from "../types.js";
import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  type ConceptAliasOptions
} from "./conceptAliases.js";

export type CardConnectionKind = "builds_on" | "leads_to" | "contrast" | "related";

export interface CardConnection {
  kind: CardConnectionKind;
  // Present when the link came from a typed knowledge-graph edge rather than a bare shared concept.
  relation?: KnowledgeEdgeRelation;
  // The concept that links the two cards (display label).
  concept: string;
  cardId: string;
  title: string;
  evidence?: string;
  weight: number;
}

export interface BuildCardConnectionsOptions extends ConceptAliasOptions {
  maxPerKind?: number;
}

interface CardConceptRef {
  cardId: string;
  title: string;
}

const defaultMaxPerKind = 3;
const sharedConceptWeight = 0.3;

/**
 * Connect one knowledge fragment to the other cards a user has accumulated, using the
 * agent-produced graph edges (relation + weight + evidence) first and falling back to a
 * shared-concept link so fragments still join the web before typed edges line up.
 */
export function buildCardConnections(
  card: KnowledgeCard,
  allCards: KnowledgeCard[],
  options: BuildCardConnectionsOptions = {}
): CardConnection[] {
  if (card.kind === "connection_note") {
    return [];
  }

  const maxPerKind = options.maxPerKind ?? defaultMaxPerKind;
  const others = allCards.filter((candidate) => candidate.kind !== "connection_note" && candidate.id !== card.id);
  const resolver = createConceptAliasResolver([
    ...(options.conceptAliases ?? []),
    ...createAutomaticConceptAliases(allCards, options.conceptAliases)
  ]);
  const conceptIndex = buildConceptIndex(others, resolver);
  const best = new Map<string, CardConnection>();

  const consider = (connection: CardConnection) => {
    const key = `${connection.kind}:${connection.cardId}`;
    const existing = best.get(key);

    if (!existing || connection.weight > existing.weight) {
      best.set(key, connection);
    }
  };

  // 1) Typed connections from this card's real graph edges.
  for (const edge of card.graphEdges ?? []) {
    const kind = relationToKind(edge.relation);

    const concept = resolver.resolveConcept(edge.targetConcept);

    for (const match of conceptIndex.get(resolver.slugConcept(concept)) ?? []) {
      consider({
        kind,
        relation: edge.relation,
        concept,
        cardId: match.cardId,
        title: match.title,
        evidence: edge.evidence,
        weight: edge.weight
      });
    }
  }

  // 2) Shared-concept fallback so fragments still connect before edges line up.
  for (const concept of card.concepts) {
    const label = resolver.resolveConcept(concept);

    for (const match of conceptIndex.get(resolver.slugConcept(label)) ?? []) {
      consider({
        kind: "related",
        concept: label,
        cardId: match.cardId,
        title: match.title,
        weight: sharedConceptWeight
      });
    }
  }

  // A card already linked by a typed relation should not also appear as a generic "related".
  const typedCardIds = new Set(
    [...best.values()].filter((connection) => connection.kind !== "related").map((connection) => connection.cardId)
  );
  const connections = [...best.values()].filter(
    (connection) => connection.kind !== "related" || !typedCardIds.has(connection.cardId)
  );

  return capPerKind(connections, maxPerKind);
}

function buildConceptIndex(
  cards: KnowledgeCard[],
  resolver: ReturnType<typeof createConceptAliasResolver>
): Map<string, CardConceptRef[]> {
  const index = new Map<string, CardConceptRef[]>();

  for (const card of cards) {
    const ref: CardConceptRef = { cardId: card.id, title: card.title };
    const slugs = new Set<string>();

    for (const concept of card.concepts) {
      slugs.add(resolver.slugConcept(concept));
    }

    for (const edge of card.graphEdges ?? []) {
      slugs.add(resolver.slugConcept(edge.sourceConcept));
      slugs.add(resolver.slugConcept(edge.targetConcept));
    }

    for (const slug of slugs) {
      if (!slug) {
        continue;
      }

      const list = index.get(slug) ?? [];
      list.push(ref);
      index.set(slug, list);
    }
  }

  return index;
}

function relationToKind(relation: KnowledgeEdgeRelation): CardConnectionKind {
  if (relation === "requires") {
    return "builds_on";
  }

  if (relation === "contrasts") {
    return "contrast";
  }

  return "leads_to";
}

function capPerKind(connections: CardConnection[], maxPerKind: number): CardConnection[] {
  const sorted = [...connections].sort((left, right) => right.weight - left.weight);
  const counts = new Map<CardConnectionKind, number>();
  const result: CardConnection[] = [];

  for (const connection of sorted) {
    const count = counts.get(connection.kind) ?? 0;

    if (count >= maxPerKind) {
      continue;
    }

    counts.set(connection.kind, count + 1);
    result.push(connection);
  }

  return result;
}
