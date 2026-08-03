import { describe, expect, it } from "vitest";
import type { KnowledgePost, SourceRegistry } from "../types.js";
import {
  isConceptPolarityCompatibleWithText,
  normalizedConceptAppearsInText,
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

describe("concept word-form tolerance", () => {
  it.each([
    ["Chatbot", "Chatbots answer questions."],
    ["ReAct Loop", "Master ReAct loops, tool use, and memory patterns."],
    ["Tool Interface", "The course covers the memory systems and the tool interfaces."],
    ["Data Paper", "Data papers have emerged as a distinctive publication format."],
    ["Policy", "Routing policies decide which expert handles a token."],
    ["Index", "Vector indexes are rebuilt nightly."],
    ["Loss", "Auxiliary losses stabilize expert routing."]
  ])("matches concept %j against its regular plural in the evidence", (concept, evidence) => {
    expect(normalizedConceptAppearsInText(concept, evidence)).toBe(true);
  });

  it("matches a plural concept against its singular in the evidence", () => {
    expect(normalizedConceptAppearsInText("Agents", "An agent plans and acts.")).toBe(true);
    expect(normalizedConceptAppearsInText("Policies", "The routing policy is learned.")).toBe(true);
  });

  it.each([
    ["Mixture-of-Experts", "Mixture of experts (MoE) is a machine learning technique."],
    ["Mixture of Experts", "The mixture-of-experts layer routes each token."],
    ["Auxiliary-loss-free", "DeepSeek uses an auxiliary loss free load balancing strategy."],
    ["Multi-Token", "Multi Token prediction improves throughput."],
    ["Multi_Token", "The multi-token objective is trained jointly."],
    ["fine-tuning", "Alignment goals require less extensive fine tuning."]
  ])("treats hyphen, underscore and space as the same separator for %j", (concept, evidence) => {
    expect(normalizedConceptAppearsInText(concept, evidence)).toBe(true);
  });

  it("still ignores letter case", () => {
    expect(normalizedConceptAppearsInText("KV Cache", "the kv cache grows with sequence length")).toBe(true);
  });

  // --- the ruler must stay closed on everything below ---

  it("rejects a prefix that is not a regular plural of the evidence word", () => {
    expect(normalizedConceptAppearsInText("Age", "An agent plans and acts.")).toBe(false);
    expect(normalizedConceptAppearsInText("Token", "Tokenization splits the input.")).toBe(false);
  });

  it("rejects short words that would only collide through naive suffix stripping", () => {
    expect(normalizedConceptAppearsInText("Los", "The auxiliary loss is small.")).toBe(false);
    expect(normalizedConceptAppearsInText("Bu", "The bus arrives late.")).toBe(false);
  });

  it("rejects a multi-word concept when the evidence only carries one of its words", () => {
    expect(normalizedConceptAppearsInText("Memory Bottleneck", "Memory grows with context length.")).toBe(false);
    expect(normalizedConceptAppearsInText("Memory Bottleneck", "The bottleneck is bandwidth, not memory.")).toBe(false);
  });

  it("rejects a concept whose words are present but not contiguous", () => {
    expect(normalizedConceptAppearsInText("Expert Routing", "Each expert receives tokens through learned routing.")).toBe(
      false
    );
  });

  it("rejects a fabricated concept outright", () => {
    expect(normalizedConceptAppearsInText("Quantum Retrieval", "RAG improves retrieval quality.")).toBe(false);
  });

  it("keeps word boundaries when the concept is hyphenated", () => {
    expect(normalizedConceptAppearsInText("AI-Agent", "ai-agentic workflows are emerging.")).toBe(false);
  });

  it("keeps arithmetic and currency symbols on the literal path", () => {
    expect(normalizedConceptAppearsInText("C++", "We rewrote the kernel in C++.")).toBe(true);
    expect(normalizedConceptAppearsInText("C++", "The C language is fast.")).toBe(false);
  });

  it("applies no word-form tolerance to Chinese concepts", () => {
    expect(normalizedConceptAppearsInText("多模态模型", "多模态模型可以同时处理图像和文本。")).toBe(true);
    expect(normalizedConceptAppearsInText("多模态模型", "多模态输入需要额外的编码器。")).toBe(false);
  });
});

describe("concept grounding scope and severity", () => {
  function makeMultiChunkRegistry(contents: readonly string[]): SourceRegistry {
    return {
      sources: [source],
      assets: [],
      snapshots: [],
      chunks: contents.map((content, index) => ({
        id: `chunk-${index + 1}`,
        sourceId: source.id,
        content
      })),
      chunkVersions: []
    };
  }

  function conceptStatus(post: KnowledgePost, registry: SourceRegistry, sameSourceFollowup = false) {
    return validateGrounding(post, registry, { sameSourceFollowup }).checks.find(
      (check) => check.fieldPath === "$.concepts[0]"
    )?.status;
  }

  // The evidence pool is every chunk this card cites, not just the first one.
  // The concept here is spelled exactly as the second chunk spells it, so this
  // pins the scope on its own, independent of any word-form tolerance.
  it("accepts a concept that only appears in a later cited chunk of the card", () => {
    const contents = ["RAG improves retrieval quality.", "A ReAct Loop lets an agent plan before acting."];
    const post: KnowledgePost = {
      ...makePost(contents[0], "ReAct Loop"),
      citations: [
        { sourceId: source.id, chunkId: "chunk-1" },
        { sourceId: source.id, chunkId: "chunk-2" }
      ]
    };

    expect(conceptStatus(post, makeMultiChunkRegistry(contents))).toBe("passed");
  });

  it("rejects a concept that appears in no cited chunk of the card", () => {
    const contents = ["RAG improves retrieval quality.", "Chunk rewriting keeps citations attached."];
    const post: KnowledgePost = {
      ...makePost(contents[0], "ReAct Loop"),
      citations: [
        { sourceId: source.id, chunkId: "chunk-1" },
        { sourceId: source.id, chunkId: "chunk-2" }
      ]
    };
    const result = validateGrounding(post, makeMultiChunkRegistry(contents));

    expect(result.valid).toBe(false);
    expect(result.checks.find((check) => check.fieldPath === "$.concepts[0]")?.status).toBe("failed");
  });

  it("rejects a concept living in an uncited chunk of an otherwise cited source", () => {
    const contents = ["RAG improves retrieval quality.", "ReAct loops let an agent plan before acting."];
    const post = makePost(contents[0], "ReAct Loop");

    expect(post.citations).toHaveLength(1);
    expect(conceptStatus(post, makeMultiChunkRegistry(contents))).toBe("failed");
  });

  it("keeps an unsupported concept at warning severity for same-source follow-ups", () => {
    const evidence = "RAG improves retrieval quality.";
    const post = makePost(evidence, "Quantum Retrieval");

    expect(conceptStatus(post, makeRegistry(evidence), true)).toBe("warning");
    expect(conceptStatus(post, makeRegistry(evidence), false)).toBe("failed");
  });
});
