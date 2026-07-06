import type { ConceptEdge, ConceptNode, KnowledgeCard, KnowledgeGraph, UserSignal } from "../types.js";
import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  type ConceptAliasOptions
} from "./conceptAliases.js";

export function buildKnowledgeGraph(
  cards: KnowledgeCard[],
  signals: UserSignal[],
  options: ConceptAliasOptions = {}
): KnowledgeGraph {
  const resolver = createConceptAliasResolver([
    ...(options.conceptAliases ?? []),
    ...createAutomaticConceptAliases(cards, options.conceptAliases)
  ]);
  const activeCardIds = new Set(
    signals
      .filter((signal) => signal.type === "like" || signal.type === "save" || signal.type === "ask")
      .map((signal) => signal.cardId)
  );

  const selectedCards = cards.filter((card) => card.kind !== "connection_note" && activeCardIds.has(card.id));
  const nodeMap = new Map<string, ConceptNode>();
  const edgeMap = new Map<string, ConceptEdge>();

  for (const card of selectedCards) {
    const addEdge = (sourceConcept: string, targetConcept: string) => {
      const source = resolver.slugConcept(sourceConcept);
      const target = resolver.slugConcept(targetConcept);

      if (!source || !target || source === target) {
        return;
      }

      const id = `${source}:${target}`;
      const edge = edgeMap.get(id) ?? { id, source, target, weight: 0, cardIds: [] };
      edge.weight += 1;
      edge.cardIds = [...new Set([...edge.cardIds, card.id])];
      edgeMap.set(id, edge);
    };

    const conceptLabels = [
      ...card.concepts,
      ...(card.graphEdges ?? []).flatMap((edge) => [edge.sourceConcept, edge.targetConcept])
    ];
    const seenConceptSlugs = new Set<string>();

    for (const concept of conceptLabels) {
      const label = resolver.resolveConcept(concept);
      const id = resolver.slugConcept(label);

      if (!id || seenConceptSlugs.has(id)) {
        continue;
      }

      seenConceptSlugs.add(id);
      const node = nodeMap.get(id) ?? { id, label, weight: 0, cardIds: [] };
      node.weight += 1;
      node.cardIds = [...new Set([...node.cardIds, card.id])];
      nodeMap.set(id, node);
    }

    for (let index = 0; index < card.concepts.length - 1; index += 1) {
      addEdge(card.concepts[index], card.concepts[index + 1]);
    }

    for (const edge of card.graphEdges ?? []) {
      addEdge(edge.sourceConcept, edge.targetConcept);
    }
  }

  return {
    nodes: [...nodeMap.values()].sort((left, right) => right.weight - left.weight),
    edges: [...edgeMap.values()].sort((left, right) => right.weight - left.weight)
  };
}
