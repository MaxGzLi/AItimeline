import { describe, expect, it } from "vitest";
import type { KnowledgeCard, KnowledgeEdgeRelation, KnowledgeGraphEdge } from "../types.js";
import { buildCardConnections, type CardConnectionKind } from "./cardConnections.js";

function makeCard(overrides: {
  id: string;
  concepts: string[];
  graphEdges?: KnowledgeGraphEdge[];
}): KnowledgeCard {
  return {
    id: overrides.id,
    title: overrides.id,
    summary: `Summary for ${overrides.id}.`,
    keyTakeaway: `Takeaway for ${overrides.id}.`,
    concepts: overrides.concepts,
    sources: [],
    citations: [],
    recommendedBecause: "Fixture.",
    trustState: "supported",
    createdAt: "2026-06-01T00:00:00.000Z",
    estimatedReadMinutes: 1,
    graphEdges: overrides.graphEdges ?? []
  };
}

describe("buildCardConnections relation-to-kind mapping", () => {
  // cardConnections.ts collapses six relation values down to three connection
  // kinds; only requires and contrasts get their own kind, the other four all
  // fall through to leads_to. Cover every relation so a future edit to any one
  // of them is caught, not just the two that already have a dedicated kind.
  const cases: Array<[KnowledgeEdgeRelation, CardConnectionKind]> = [
    ["requires", "builds_on"],
    ["extends", "leads_to"],
    ["contrasts", "contrast"],
    ["applies", "leads_to"],
    ["evaluates", "leads_to"],
    ["summarizes", "leads_to"]
  ];

  it.each(cases)("maps a %s edge to a %s connection", (relation, expectedKind) => {
    const other = makeCard({ id: "other-card", concepts: ["Target Concept"] });
    const card = makeCard({
      id: "source-card",
      concepts: ["Source Concept"],
      graphEdges: [
        {
          id: "edge-1",
          sourceConcept: "Source Concept",
          relation,
          targetConcept: "Target Concept",
          evidence: "Fixture evidence.",
          weight: 0.5
        }
      ]
    });

    const connections = buildCardConnections(card, [card, other]);

    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ kind: expectedKind, relation, cardId: "other-card" });
  });
});

describe("buildCardConnections typed-vs-shared-concept filtering", () => {
  it("keeps a low-weight typed connection over a higher-weight shared-concept connection to the same card", () => {
    // The filter at cardConnections.ts:100-106 drops a "related" (shared-concept)
    // connection whenever a typed connection already points at the same card, with
    // no weight comparison at all. Use a typed edge far lighter than the
    // shared-concept fallback (0.01 vs the fixed 0.3) so a weight-based rewrite of
    // that filter would flip this assertion.
    const other = makeCard({ id: "other-card", concepts: ["Shared Concept"] });
    const card = makeCard({
      id: "source-card",
      concepts: ["Shared Concept"],
      graphEdges: [
        {
          id: "edge-1",
          sourceConcept: "Source Concept",
          relation: "extends",
          targetConcept: "Shared Concept",
          evidence: "Fixture evidence.",
          weight: 0.01
        }
      ]
    });

    const connections = buildCardConnections(card, [card, other]);

    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ kind: "leads_to", cardId: "other-card", weight: 0.01 });
  });
});
