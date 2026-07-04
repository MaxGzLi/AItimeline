import type { LinkedKnowledgeGraph } from "@aitimeline/core";

// One-hop neighborhood around a card: the card itself, every node it links to
// (its concepts, wikilink targets), and the other cards/notes attached to
// those concepts. Edges are kept only when both endpoints survive the cut.
export function buildCardNeighborhoodGraph(graph: LinkedKnowledgeGraph, cardId: string): LinkedKnowledgeGraph {
  const firstRing = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.source === cardId) {
      firstRing.add(edge.target);
    } else if (edge.target === cardId) {
      firstRing.add(edge.source);
    }
  }

  const kept = new Set<string>([cardId, ...firstRing]);

  for (const edge of graph.edges) {
    if (firstRing.has(edge.source)) {
      kept.add(edge.target);
    } else if (firstRing.has(edge.target)) {
      kept.add(edge.source);
    }
  }

  return {
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target))
  };
}
