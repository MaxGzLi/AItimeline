import { describe, expect, it } from "vitest";
import type { KnowledgePost, KnowledgeThreadBlock, SourceRegistry } from "../types.js";
import {
  isConceptPolarityCompatibleWithText,
  normalizedConceptAppearsInText,
  validateClaimSupport,
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

  it("downgrades a Latin concept missing from CJK-only evidence to a warning", () => {
    const evidence = "在中国学校里，人工智能现在通过扫描笔记本来批改作业，并打印出反馈。";
    const result = validateGrounding(makePost(evidence, "AI Grading"), makeRegistry(evidence));

    const conceptCheck = result.checks.find((check) => check.fieldPath === "$.concepts[0]");

    expect(conceptCheck?.status).toBe("warning");
    expect(result.valid).toBe(true);
  });

  it("still passes a Latin concept that appears verbatim inside CJK evidence", () => {
    const evidence = "世界各国的LLM，韩国最近的势头也很猛。";
    const result = validateGrounding(makePost(evidence, "LLM"), makeRegistry(evidence));

    expect(result.checks.find((check) => check.fieldPath === "$.concepts[0]")?.status).toBe("passed");
  });

  it("still fails a same-script concept that is absent from the evidence", () => {
    const evidence = "RAG improves retrieval quality.";
    const result = validateGrounding(makePost(evidence, "Vector Databases"), makeRegistry(evidence));

    expect(result.checks.find((check) => check.fieldPath === "$.concepts[0]")?.status).toBe("failed");
    expect(result.valid).toBe(false);
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

  it("matches a name the evidence only writes in possessive form", () => {
    expect(normalizedConceptAppearsInText("Schlag", "Eloquently put by Schlag’s paper (Fast Weight Programmers)")).toBe(
      true
    );
    expect(normalizedConceptAppearsInText("Schlag", "Eloquently put by Sutskever's paper")).toBe(false);
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

  // A thread block's own citations used to be checked for quote authenticity and
  // then ignored as evidence, so a block citing exactly the chunk that names its
  // entity was still graded against the card-level citations alone.
  it("grounds a thread block claim in the chunk that block cites", () => {
    const contents = ["RAG improves retrieval quality.", "ReAct loops let an agent plan before acting."];
    const evidence = "RAG improves retrieval quality.";
    const blockClaim = "ReAct loops let an agent plan before acting.";
    const withBlockCitation = (citations: KnowledgeThreadBlock["citations"]): KnowledgePost => ({
      ...makePost(evidence),
      thread: [
        {
          id: "thread-1",
          kind: "explain",
          title: "ReAct",
          body: blockClaim,
          grounded: true,
          citations
        }
      ]
    });
    const blockStatus = (post: KnowledgePost): string | undefined =>
      validateGrounding(post, makeMultiChunkRegistry(contents)).checks.find(
        (check) => check.fieldPath === "$.thread[0].body"
      )?.status;

    expect(
      blockStatus(
        withBlockCitation([
          { sourceId: source.id, sourceTitle: source.title, chunkId: "chunk-2", quote: blockClaim }
        ])
      )
    ).toBe("passed");
    expect(blockStatus(withBlockCitation(undefined))).toBe("failed");
  });
});

// Anchor-style claim support (docs/specs/2026-08-03-anchor-grounding.md): fact
// anchors (numbers, direction, negation, proper nouns, Latin technical terms
// inside CJK prose) must appear in the cited evidence; narrative wording is the
// model's own voice and is no longer order-checked.
describe("anchor-style claim support", () => {
  const sourceFactOptions = {
    minOverlap: 1,
    minimumSharedTokens: 2,
    checkProperNouns: true,
    supportMode: "anchors"
  } as const;

  it("keeps the ordered-support gate for callers that do not opt into anchors", () => {
    // Deep-read, concept briefs and grounded Q&A rely on the legacy default:
    // one shared entity must not support an unrelated predicate.
    expect(
      validateClaimSupport("RAG cures cancer", ["RAG retrieval uses seven steps."], {
        minOverlap: 1,
        minimumSharedTokens: 2,
        checkProperNouns: false
      }).supported
    ).toBe(false);
  });

  // --- must still be rejected ---

  it("rejects a Chinese claim whose number contradicts the evidence", () => {
    expect(
      validateClaimSupport("训练用了 32 块 GPU", ["The run used 16 GPUs."], sourceFactOptions).supported
    ).toBe(false);
  });

  it("rejects a Chinese multiplier that the evidence never states", () => {
    expect(
      validateClaimSupport("解码速度提升 6 倍", ["Decode throughput improved substantially."], sourceFactOptions)
        .supported
    ).toBe(false);
  });

  it("rejects a Chinese claim whose Latin technical term is absent from the evidence", () => {
    expect(
      validateClaimSupport(
        "RLHF 让答案更符合人类偏好",
        ["The KV cache stores key and value vectors for previous tokens."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });

  it("rejects a lowercase Latin term in Chinese prose that the evidence never mentions", () => {
    expect(
      validateClaimSupport(
        "把 prompt 模板缓存能减少延迟",
        ["The KV cache stores key and value vectors."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });

  it("rejects an English claim with a fabricated proper noun", () => {
    expect(
      validateClaimSupport("The gains came from RLHF-Zero", ["The gains came from better data."], sourceFactOptions)
        .supported
    ).toBe(false);
  });

  it("rejects a direction flip on an anchored claim", () => {
    expect(
      validateClaimSupport("KV cache 命中率上升", ["KV cache hit rates dropped sharply."], sourceFactOptions)
        .supported
    ).toBe(false);
  });

  it("rejects a negation the evidence does not contain", () => {
    expect(
      validateClaimSupport("模型不使用 KV cache", ["The model uses the KV cache for decoding."], sourceFactOptions)
        .supported
    ).toBe(false);
  });

  it("keeps sign sensitivity across languages", () => {
    expect(
      validateClaimSupport("指标变化 +5%", ["The metric changed by -5%."], sourceFactOptions).supported
    ).toBe(false);
  });

  // --- must now be accepted ---

  it("treats single-word English cardinals as the same number in digits", () => {
    expect(
      validateClaimSupport(
        "其中 2 个共享专家处理所有 token",
        ["Two are shared experts that process every token."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("still rejects a digit the word-form evidence does not state", () => {
    expect(
      validateClaimSupport(
        "其中 3 个共享专家处理所有 token",
        ["Two are shared experts that process every token."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });

  it("lets evidence stating an addition satisfy an increase-shaped claim", () => {
    expect(
      validateClaimSupport(
        "Kimi Linear 通过 alpha projection 增加了通道缩放",
        ["Kimi Linear adds a per-channel scale through the alpha projection."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("still rejects an increase claim when evidence states the opposite direction", () => {
    expect(
      validateClaimSupport("KV cache 命中率增加", ["KV cache hit rates dropped sharply."], sourceFactOptions)
        .supported
    ).toBe(false);
  });

  it("treats the generic classifier 个 as bare counting", () => {
    expect(
      validateClaimSupport(
        "KimiK3 的 MoE 有 898 个专家",
        ["KimiK3 has 898 experts in total, and its MoE router selects 16 for each token."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("still rejects a classifier count the evidence does not state", () => {
    expect(
      validateClaimSupport(
        "KimiK3 的 MoE 有 999 个专家",
        ["KimiK3 has 898 experts in total, and its MoE router selects 16 for each token."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });

  it("recognizes halving as a stated decrease direction", () => {
    expect(
      validateClaimSupport(
        "MoE 的压缩空间能降低计算量",
        ["The MoE experts operate in a compressed latent space, which nearly halves the FLOPs."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("does not treat the lexicalized 不同 as a negation", () => {
    expect(
      validateClaimSupport(
        "DeltaNet 则不同",
        ["DeltaNet addresses this loss of recoverability with a different update."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("does not treat a 如果没有 hypothetical as a negation claim", () => {
    expect(
      validateClaimSupport(
        "如果没有 KV cache，每一步都要重算",
        ["The KV cache stores key and value vectors so earlier steps are not recomputed."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("recognizes decay as a stated decrease direction", () => {
    expect(
      validateClaimSupport(
        "alpha 投影让模型控制记忆衰减",
        ["We decay the previous cache through the alpha projection, then add the new cache at full strength."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("does not treat the comparative 不如 as a negation", () => {
    expect(
      validateClaimSupport(
        "ELU+1 的归一化不如 softmax 灵活",
        ["Linear attention applies a feature map such as ELU+1, while softmax couples every query to every key."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("keeps big-O notation attached to its clause instead of tearing out a lone letter", () => {
    expect(
      validateClaimSupport(
        "KV cache 让内存按 O(N) 增长",
        ["The KV cache memory grows as O(N) with sequence length, increasing at every step."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("does not treat Latin connectives in CJK prose as anchors", () => {
    expect(
      validateClaimSupport(
        "GQA vs MQA 的核心差异",
        ["GQA groups queries while MQA shares one key-value head."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("accepts a Chinese paraphrase whose anchors all appear in the evidence", () => {
    expect(
      validateClaimSupport(
        "KV cache 用存储换计算，把之前 token 的 key 和 value 向量存下来",
        [
          "Storing their key and value vectors avoids that redundant work. That storage is the KV cache. It retains vectors for the previous N-1 tokens."
        ],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("accepts English narrative glue without factual anchors", () => {
    expect(
      validateClaimSupport(
        "Imagine deploying a chatbot that must answer in real time",
        ["The KV cache reduces decode latency."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("treats 倍 and 6x as the same multiplier", () => {
    expect(
      validateClaimSupport(
        "解码吞吐量提升 6 倍",
        ["Kimi Linear delivers 6x higher decode throughput."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("treats 倍 and times as the same multiplier", () => {
    expect(
      validateClaimSupport("速度是原来的 3 倍", ["It runs 3 times faster."], sourceFactOptions).supported
    ).toBe(true);
  });

  it("treats a bare calendar year and 年 as the same number", () => {
    expect(
      validateClaimSupport(
        "从 2019 年的 GPT-2 到 2026 年的 KimiK3",
        ["That's how many GPT-2 (2019) models fit inside KimiK3 (2026)."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("does not treat a sentence-initial common word as a proper noun", () => {
    expect(
      validateClaimSupport(
        "Scaling brings a trade-off in memory capacity",
        ["Each architecture adds capacity to address a concrete limitation."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("keeps letter-attached digits as technical tokens, not numeric claims", () => {
    expect(
      validateClaimSupport(
        "ELU+1 让分数保持非负",
        ["Linear attention uses ELU+1 to keep scores non-negative."],
        sourceFactOptions
      ).supported
    ).toBe(true);
    expect(
      validateClaimSupport("ELU+1 让分数保持非负", ["Softmax exponentiates the scores."], sourceFactOptions)
        .supported
    ).toBe(false);
  });

  // Deliberate policy trade-off accepted on 2026-08-03: a fabricated predicate on
  // a real entity carries no number, direction, negation or missing anchor, so it
  // passes. The remaining nets are numbers, polarity, proper nouns and anchors.
  it("accepts a fabricated predicate on a real entity (documented trade-off)", () => {
    expect(
      validateClaimSupport("Aspirin guarantees immortality", ["Aspirin can reduce ordinary pain."], sourceFactOptions)
        .supported
    ).toBe(true);
  });

  // --- cross-script evidence scope ---

  it("finds a number anywhere in the citation when claim and evidence use different scripts", () => {
    expect(
      validateClaimSupport(
        "其中 2 个共享处理所有 token",
        ["KimiK3 has 898 experts in total. Two are shared and process every token; of the remaining 896, the router selects 16 for each token."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("still rejects a number the cross-script citation never states", () => {
    expect(
      validateClaimSupport(
        "每个 token 只经过 18 个专家",
        ["KimiK3 has 898 experts in total. Two are shared and process every token; of the remaining 896, the router selects 16 for each token."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });

  it("keeps numbers clause-local when claim and evidence share a script", () => {
    expect(
      validateClaimSupport("Revenue increased 5%.", ["Revenue increased 9%, costs decreased 5%."], {
        minOverlap: 0.08,
        minimumSharedTokens: 2,
        supportMode: "anchors"
      }).supported
    ).toBe(false);
    expect(
      validateClaimSupport("营收增长了 5%。", ["营收增长了 9%，成本下降了 5%。"], {
        minOverlap: 0.08,
        minimumSharedTokens: 2,
        supportMode: "anchors"
      }).supported
    ).toBe(false);
  });

  it("judges cross-script polarity against the whole citation, not one clause", () => {
    // "avoids that redundant work" sits in a different clause than the one the
    // overlap picks, and is the negative statement the claim restates.
    expect(
      validateClaimSupport(
        "生成时就不用重算前面所有 token 的投影",
        ["The model would otherwise recompute projections for all previous tokens. Storing their key and value vectors avoids that redundant work."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("still rejects a negated claim when nothing in the cross-script citation is negative", () => {
    expect(
      validateClaimSupport(
        "KV cache 不会保存历史 token 的向量",
        ["That storage is the KV cache. It retains vectors for the previous tokens."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });

  // --- hypotheses ---

  it("does not compare a hypothesis's polarity with the evidence", () => {
    expect(
      validateClaimSupport(
        "如果 DeltaNet 无法清除旧记忆会怎样",
        ["DeltaNet implements a first-order linear recurrence over the cache."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("still holds a hypothesis to its entities", () => {
    expect(
      validateClaimSupport(
        "如果 Mamba 无法清除旧记忆会怎样",
        ["DeltaNet implements a first-order linear recurrence over the cache."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });

  it("exempts the whole hypothesis sentence, not just its marker clause", () => {
    // "但发现…内存不够" is the hypothesis's own scenario; the negation belongs to
    // the question, not to the source.
    expect(
      validateClaimSupport(
        "如果你要处理超长序列，但发现 softmax 注意力内存不够，你会怎么做？",
        ["Linear attention uses ELU+1, while softmax uses exponentiation."],
        sourceFactOptions
      ).supported
    ).toBe(true);
  });

  it("resumes polarity checking after the hypothesis sentence ends", () => {
    expect(
      validateClaimSupport(
        "如果状态超过容量，会互相干扰。Retrieval quality drops.",
        ["Once the state exceeds its effective capacity, associations begin to interfere. Retrieval quality is measured."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });

  // --- quiz choice options (user decision 2026-08-03: deterministic rule, no model) ---

  const questionOptions = {
    minOverlap: 1,
    minimumSharedTokens: 1,
    checkProperNouns: true,
    checkDirection: true,
    checkNegation: true,
    requireClaimPolarityCue: false,
    supportMode: "anchors",
    exemptChoiceOptionPolarity: true
  } as const;

  it("does not compare a quiz option's direction or negation with the evidence", () => {
    expect(
      validateClaimSupport(
        "你会优先考虑什么优化？A. 增加 KV Cache 的容量；B. 减少 KV Cache 的容量；C. 不用 KV Cache",
        ["That storage is the KV cache. It retains vectors for the previous tokens."],
        questionOptions
      ).supported
    ).toBe(true);
  });

  it("still checks entities and numbers inside quiz options", () => {
    expect(
      validateClaimSupport(
        "A. 改用 FlashAttention",
        ["That storage is the KV cache."],
        questionOptions
      ).supported
    ).toBe(false);
    expect(
      validateClaimSupport(
        "A. 把专家数增加到 64 个",
        ["KimiK3 has 898 experts in total."],
        questionOptions
      ).supported
    ).toBe(false);
  });

  it("keeps checking a question premise that is not an option", () => {
    expect(
      validateClaimSupport("Why did throughput decrease by 5%?", ["Throughput increased by 5%."], questionOptions)
        .supported
    ).toBe(false);
  });

  it("keeps option-shaped clauses checked for callers without the exemption", () => {
    expect(
      validateClaimSupport(
        "A. 增加 KV Cache 的容量",
        ["That storage is the KV cache. It retains vectors for the previous tokens."],
        sourceFactOptions
      ).supported
    ).toBe(false);
  });
});
