import type { ConceptEdge, ConceptNode, KnowledgeCard, KnowledgeGraph, UserSignal } from "../types.js";

export function buildKnowledgeGraph(cards: KnowledgeCard[], signals: UserSignal[]): KnowledgeGraph {
  const activeCardIds = new Set(
    signals
      .filter((signal) => signal.type === "like" || signal.type === "save" || signal.type === "ask")
      .map((signal) => signal.cardId)
  );

  const selectedCards = cards.filter((card) => activeCardIds.has(card.id));
  const nodeMap = new Map<string, ConceptNode>();
  const edgeMap = new Map<string, ConceptEdge>();

  for (const card of selectedCards) {
    for (const concept of card.concepts) {
      const id = slugConcept(concept);
      const node = nodeMap.get(id) ?? { id, label: concept, weight: 0, cardIds: [] };
      node.weight += 1;
      node.cardIds = [...new Set([...node.cardIds, card.id])];
      nodeMap.set(id, node);
    }

    for (let index = 0; index < card.concepts.length - 1; index += 1) {
      const source = slugConcept(card.concepts[index]);
      const target = slugConcept(card.concepts[index + 1]);
      const id = `${source}:${target}`;
      const edge = edgeMap.get(id) ?? { id, source, target, weight: 0, cardIds: [] };
      edge.weight += 1;
      edge.cardIds = [...new Set([...edge.cardIds, card.id])];
      edgeMap.set(id, edge);
    }
  }

  return {
    nodes: [...nodeMap.values()].sort((left, right) => right.weight - left.weight),
    edges: [...edgeMap.values()].sort((left, right) => right.weight - left.weight)
  };
}

function slugConcept(concept: string): string {
  // Keep Unicode letters/digits so non-ASCII concepts (e.g. Chinese) slug to a distinct key.
  return concept.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "");
}

