import { describe, expect, it } from "vitest";
import type { KnowledgePost, SourceRegistry } from "../types.js";
import {
  isConceptPolarityCompatibleWithText,
  validateGrounding
} from "./groundingGate.js";

const source = {
  id: "source-1",
  title: "Retrieval source",
  url: "https://example.com/retrieval",
  type: "article"
} as const;

function makeRegistry(content: string): SourceRegistry {
  return {
    sources: [source],
    assets: [],
    snapshots: [],
    chunks: [{ id: "chunk-1", sourceId: source.id, content }],
    chunkVersions: []
  };
}

function makePost(claim: string, concept = "RAG"): KnowledgePost {
  return {
    id: "post-1",
    title: claim,
    hook: claim,
    thesis: claim,
    shortBody: claim,
    summary: claim,
    keyTakeaway: claim,
    concepts: [concept],
    sources: [source],
    citations: [{ sourceId: source.id, chunkId: "chunk-1" }],
    recommendedBecause: claim,
    trustState: "supported",
    createdAt: "2026-07-28T00:00:00.000Z",
    estimatedReadMinutes: 1,
    difficulty: "beginner",
    confidence: "high",
    thread: [],
    graphEdges: [],
    reviewPrompts: [],
    nextActions: ["continue_deeper"],
    harnessVersion: "harness-v0"
  };
}

describe("grounding validation", () => {
  it("rejects a thread citation quote that is absent from its registered source chunk", () => {
    const evidence = "RAG improves retrieval quality.";
    const result = validateGrounding(
      {
        ...makePost(evidence),
        thread: [
          {
            id: "thread-1",
            kind: "user_comment",
            title: evidence,
            body: evidence,
            grounded: true,
            citations: [
              {
                sourceId: source.id,
                sourceTitle: source.title,
                chunkId: "chunk-1",
                quote: "Quantum teleportation guarantees immortality."
              }
            ]
          }
        ]
      },
      makeRegistry(evidence)
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "$.thread[0].citations[0].quote",
      message: "citation quote does not appear in its registered source chunk.",
      severity: "error"
    });
  });

  it("accepts a normalized truncated thread citation quote from its registered source chunk", () => {
    const evidence = [
      "RAG improves retrieval quality by preserving source context.",
      "Grounded answers keep citations attached to the evidence they summarize.",
      "Readers can inspect the original chunk before trusting a generated claim.",
      "This traceability makes retrieval workflows easier to audit and correct.",
      "Repeated verification strengthens confidence in the result."
    ].join("\n\t");
    const normalizedEvidence = evidence.replace(/\s+/g, " ").trim();
    const truncatedQuote = `${normalizedEvidence.slice(0, 277).toUpperCase()}...`;
    const result = validateGrounding(
      {
        ...makePost(evidence),
        thread: [
          {
            id: "thread-1",
            kind: "user_comment",
            title: evidence,
            body: evidence,
            grounded: true,
            citations: [
              {
                sourceId: source.id,
                sourceTitle: source.title,
                chunkId: "chunk-1",
                quote: truncatedQuote
              }
            ]
          }
        ]
      },
      makeRegistry(evidence)
    );

    expect(normalizedEvidence.length).toBeGreaterThan(280);
    expect(result.valid).toBe(true);
  });

  it("uses a pinned chunk version instead of drifted live content for grounding", () => {
    const citedEvidence = "RAG improves retrieval quality.";
    const registry = makeRegistry("Gardening improves soil health.");
    const chunkVersionId = "chunk-1-version-cited";
    registry.chunkVersions = [
      {
        id: chunkVersionId,
        chunkId: "chunk-1",
        sourceId: source.id,
        version: 1,
        contentHash: "cited-content-hash",
        contentLength: citedEvidence.length,
        createdAt: "2026-07-27T00:00:00.000Z",
        content: citedEvidence
      }
    ];

    const pinnedResult = validateGrounding(
      {
        ...makePost(citedEvidence),
        citations: [{ sourceId: source.id, chunkId: "chunk-1", chunkVersionId }]
      },
      registry
    );
    const liveResult = validateGrounding(makePost(citedEvidence), registry);

    expect(pinnedResult.valid).toBe(true);
    expect(liveResult.valid).toBe(false);
  });

  it("fails closed when a factual card claim is absent from the cited source text", () => {
    const evidence = "RAG improves retrieval quality.";
    const result = validateGrounding(
      {
        ...makePost(evidence),
        summary: "Quantum teleportation guarantees immortality."
      },
      makeRegistry(evidence)
    );

    expect(result.valid).toBe(false);
    expect(result.checks.find((check) => check.fieldPath === "$.summary")?.status).toBe("failed");
  });

  it("fails closed when the card has no citation", () => {
    const evidence = "RAG improves retrieval quality.";
    const result = validateGrounding(
      {
        ...makePost(evidence),
        citations: []
      },
      makeRegistry(evidence)
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({
      path: "$.citations",
      message: "post must include at least one source citation.",
      severity: "error"
    });
  });

  it("rejects a concept whose positive polarity reverses the cited evidence", () => {
    const concept = "RAG improves retrieval quality";
    const evidence = "RAG improves retrieval quality is not true.";

    expect(isConceptPolarityCompatibleWithText(concept, evidence)).toBe(false);

    const result = validateGrounding(makePost(evidence, concept), makeRegistry(evidence));

    expect(result.valid).toBe(false);
    expect(result.checks.find((check) => check.fieldPath === "$.concepts[0]")?.status).toBe("failed");
  });

  it("accepts claims and concepts supported by a registered cited chunk", () => {
    const evidence = "RAG improves retrieval quality.";
    const result = validateGrounding(makePost(evidence), makeRegistry(evidence));

    expect(result.valid).toBe(true);
    expect(result.checks.every((check) => check.status === "passed")).toBe(true);
  });
});
