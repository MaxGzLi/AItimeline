import { describe, expect, it } from "vitest";
import type { ConnectionNoteDetails, KnowledgeCard, KnowledgeGraphEdge } from "../types.js";
import { checkConnectionNoteEdge, createConnectionNoteForImport } from "./connectionNotes.js";

function makeCard(overrides: {
  id: string;
  concepts: string[];
  createdAt?: string;
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
    createdAt: overrides.createdAt ?? "2026-06-01T00:00:00.000Z",
    estimatedReadMinutes: 1,
    graphEdges: overrides.graphEdges ?? []
  };
}

const oldPost = makeCard({
  id: "old-post",
  concepts: ["Shared Concept"],
  createdAt: "2026-05-01T00:00:00.000Z"
});
const newPost = makeCard({
  id: "new-post",
  concepts: ["Shared Concept", "New Concept"],
  graphEdges: [
    {
      id: "edge-1",
      sourceConcept: "Shared Concept",
      relation: "extends",
      targetConcept: "New Concept",
      evidence: "Shared Concept extends into New Concept in the new source.",
      weight: 0.8
    }
  ]
});

describe("createConnectionNoteForImport", () => {
  it("never gives a freshly generated note the library's top trust/confidence tier", () => {
    // Connection notes have zero sources/citations of their own; only cited cards
    // should qualify for the supported/high tier.
    const note = createConnectionNoteForImport({
      existingPosts: [oldPost],
      newPosts: [newPost],
      now: "2026-06-01T00:00:00.000Z"
    });

    expect(note).not.toBeNull();
    expect(note?.trustState).toBe("emerging");
    expect(note?.confidence).toBe("low");
    expect([note?.trustState, note?.confidence]).not.toEqual(["supported", "high"]);
  });

  it("records the stable edge id the evidence was copied from", () => {
    const note = createConnectionNoteForImport({
      existingPosts: [oldPost],
      newPosts: [newPost],
      now: "2026-06-01T00:00:00.000Z"
    });

    expect(note?.connectionNote?.edgeId).toBe("edge-1");
  });
});

describe("checkConnectionNoteEdge", () => {
  const details: ConnectionNoteDetails = {
    oldPostId: "old-post",
    oldPostTitle: "Old Post",
    newPostId: "mother-post",
    newPostTitle: "Mother Post",
    evidence: "The mother card's edge evidence text.",
    edgeId: "edge-1",
    relation: "extends",
    sourceConcept: "A",
    targetConcept: "B",
    reason: "wake_dormant",
    daysSinceOldCard: 20
  };

  it("is verified when the mother card still carries the same edge id and evidence", () => {
    const currentEdge: KnowledgeGraphEdge = {
      id: "edge-1",
      sourceConcept: "A",
      relation: "extends",
      targetConcept: "B",
      evidence: details.evidence,
      weight: 0.7
    };
    const motherPost = makeCard({ id: "mother-post", concepts: ["A", "B"], graphEdges: [currentEdge] });

    expect(checkConnectionNoteEdge(details, [motherPost])).toEqual({ status: "verified", currentEdge });
  });

  it("is stale when the mother card's edge evidence changed since the note copied it", () => {
    // This is the real-world case: a later, unrelated import overwrites the mother
    // card by id and the edge id survives but its evidence text does not.
    const overwrittenEdge: KnowledgeGraphEdge = {
      id: "edge-1",
      sourceConcept: "A",
      relation: "extends",
      targetConcept: "B",
      evidence: "A completely different evidence string from a later overwrite.",
      weight: 0.7
    };
    const motherPost = makeCard({ id: "mother-post", concepts: ["A", "B"], graphEdges: [overwrittenEdge] });

    expect(checkConnectionNoteEdge(details, [motherPost])).toEqual({ status: "stale", currentEdge: overwrittenEdge });
  });

  it("is stale when the mother card no longer carries an edge with that id", () => {
    const motherPost = makeCard({ id: "mother-post", concepts: ["A", "B"], graphEdges: [] });

    expect(checkConnectionNoteEdge(details, [motherPost])).toEqual({ status: "stale", currentEdge: undefined });
  });

  it("is stale when the mother card itself no longer exists", () => {
    expect(checkConnectionNoteEdge(details, [])).toEqual({ status: "stale" });
  });

  it("is unknown for notes generated before the stable edge id existed", () => {
    const { edgeId: _edgeId, ...legacyDetails } = details;
    const motherPost = makeCard({
      id: "mother-post",
      concepts: ["A", "B"],
      graphEdges: [
        {
          id: "edge-1",
          sourceConcept: "A",
          relation: "extends",
          targetConcept: "B",
          evidence: details.evidence,
          weight: 0.7
        }
      ]
    });

    expect(checkConnectionNoteEdge(legacyDetails, [motherPost])).toEqual({ status: "unknown" });
  });
});
