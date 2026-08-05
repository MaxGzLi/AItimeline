import { describe, expect, it } from "vitest";
import type { KnowledgePost, SourceRegistry } from "../types.js";
import { runConversationTurn } from "./conversationAgent.js";

// Shapes mirror the real library: concepts are English long names (the grounding
// gate requires them to appear verbatim in the English source), while the user
// types Chinese mixed with the abbreviations everyone actually says.
function makePost(overrides: { id: string; concepts: string[]; createdAt?: string }): KnowledgePost {
  return {
    id: overrides.id,
    title: `Card ${overrides.id}`,
    hook: `Hook for ${overrides.id}.`,
    thesis: `Thesis for ${overrides.id}.`,
    shortBody: `Short body for ${overrides.id}.`,
    summary: `Summary for ${overrides.id}.`,
    keyTakeaway: `Takeaway for ${overrides.id}.`,
    concepts: overrides.concepts,
    difficulty: "beginner",
    confidence: "high",
    thread: [],
    graphEdges: [],
    reviewPrompts: [],
    nextActions: [],
    harnessVersion: "test",
    sources: [
      {
        id: `${overrides.id}-source`,
        title: `Source for ${overrides.id}`,
        url: `https://example.com/${overrides.id}`,
        type: "article"
      }
    ],
    citations: [{ sourceId: `${overrides.id}-source`, chunkId: `${overrides.id}-chunk` }],
    recommendedBecause: "Fixture.",
    trustState: "supported",
    createdAt: overrides.createdAt ?? "2026-06-01T00:00:00.000Z",
    estimatedReadMinutes: 1
  };
}

function makeRegistry(posts: KnowledgePost[]): SourceRegistry {
  return {
    sources: posts.map((post) => post.sources[0]),
    assets: [],
    snapshots: [],
    chunks: posts.map((post) => ({
      id: `${post.id}-chunk`,
      sourceId: `${post.id}-source`,
      content: `Evidence paragraph for ${post.concepts.join(", ")}.`
    })),
    chunkVersions: []
  };
}

async function ask(question: string, posts: KnowledgePost[]) {
  return runConversationTurn({
    question,
    posts,
    registry: makeRegistry(posts),
    now: "2026-08-04T00:00:00.000Z"
  });
}

describe("runConversationTurn concept matching for Chinese and abbreviated questions", () => {
  const moePost = makePost({ id: "post-moe", concepts: ["Mixture-of-Experts", "Sparse Activation"] });
  const mlaPost = makePost({ id: "post-mla", concepts: ["Multi-head Latent Attention", "KV Cache"] });
  const balancePost = makePost({ id: "post-balance", concepts: ["Auxiliary-loss-free Load Balancing"] });
  const library = [moePost, mlaPost, balancePost];

  it("answers an abbreviation question from the card whose long-form concept it abbreviates", async () => {
    const turn = await ask("MoE 到底省在哪?", library);

    expect(turn.matchedConcepts).toContain("Mixture-of-Experts");
    expect(turn.intent).toBe("grounded_qa");
    expect(turn.answerCardId).toBe("post-moe");
  });

  it("answers an abbreviation coined from initials of separate words (MLA)", async () => {
    const turn = await ask("MLA是什么？在哪最先出现的", library);

    expect(turn.matchedConcepts).toContain("Multi-head Latent Attention");
    expect(turn.answerCardId).toBe("post-mla");
    expect(turn.zone).not.toBe("dark");
  });

  it("answers a Chinese-worded question about an English-named concept", async () => {
    const turn = await ask("稀疏激活是什么意思", library);

    expect(turn.matchedConcepts).toContain("Sparse Activation");
    expect(turn.intent).toBe("grounded_qa");
    expect(turn.answerCardId).toBe("post-moe");
  });

  it("answers the mixed Chinese-plus-abbreviation question the user actually typed", async () => {
    const turn = await ask("多个moe之间如何配合，和模型怎么决定使用哪个moe", library);

    expect(turn.matchedConcepts).toContain("Mixture-of-Experts");
    expect(turn.answerCardId).toBe("post-moe");
  });

  it("resolves a user-decided alias from the snapshot's conceptAliases", async () => {
    const turn = await runConversationTurn({
      question: "无辅助损失的负载均衡是怎么做的?",
      posts: library,
      registry: makeRegistry(library),
      conceptAliases: [
        {
          canonical: "Auxiliary-loss-free Load Balancing",
          aliases: ["无辅助损失负载均衡"],
          decidedBy: "user",
          decidedAt: "2026-08-01T00:00:00.000Z"
        }
      ],
      now: "2026-08-04T00:00:00.000Z"
    });

    expect(turn.matchedConcepts).toContain("Auxiliary-loss-free Load Balancing");
    expect(turn.answerCardId).toBe("post-balance");
  });

  it("still routes a genuinely out-of-library question to discovery", async () => {
    // The real turn that should stay outside: nothing in the library covers it,
    // and answering it from an unrelated card would be worse than saying so.
    const turn = await ask("你可以去找一些关于王虹获得菲尔兹数学奖的挂谷猜想相关的知识么", library);

    expect(turn.matchedConcepts).toEqual([]);
    expect(turn.intent).toBe("discovery_proposal");
    expect(turn.zone).toBe("dark");
    expect(turn.answerCardId).toBeUndefined();
  });

  it("does not treat an unrelated abbreviation as a library hit", async () => {
    const turn = await ask("What is SLAM used for in robotics?", library);

    expect(turn.matchedConcepts).toEqual([]);
    expect(turn.intent).toBe("discovery_proposal");
  });

  it("does not match an abbreviation buried inside a longer word", async () => {
    // "MLA" sitting inside "MLAB" is not a mention of Multi-head Latent Attention.
    const turn = await ask("MLAB 这个工具怎么用?", library);

    expect(turn.matchedConcepts).toEqual([]);
    expect(turn.intent).toBe("discovery_proposal");
  });

  it("keeps matching concept names case-insensitively", async () => {
    const turn = await ask("how does sparse activation cut compute?", library);

    expect(turn.matchedConcepts).toContain("Sparse Activation");
    expect(turn.answerCardId).toBe("post-moe");
  });
});

// 什么时候会真的花钱、动网络,由「这一轮带不带 confirm_discovery」决定:
// handleAgentAsk 只在带确认动作时才不立刻搜。所以这几条断言守的是钱和网络,
// 不只是界面文案。
describe("discovery consent", () => {
  const moePost = makePost({ id: "post-moe", concepts: ["Mixture-of-Experts", "Sparse Activation"] });
  const library = [moePost];

  it("asks before searching outside even when the question matched a known concept", async () => {
    const turn = await ask("MoE 到底省在哪?", library);
    const kinds = turn.actions.map((action) => action.kind);

    expect(turn.zone).toBe("frontier");
    expect(kinds).toContain("confirm_discovery");
    // 确认动作在前:handleAgentAsk 看到它就不会自动搜。
    expect(kinds.indexOf("confirm_discovery")).toBeLessThan(kinds.indexOf("discover_sources"));
  });

  it("hands the confirmation the same queries the search would have used", async () => {
    const turn = await ask("MoE 到底省在哪?", library);
    const confirm = turn.actions.find((action) => action.kind === "confirm_discovery");
    const discover = turn.actions.find((action) => action.kind === "discover_sources");

    expect(confirm?.questions?.length).toBeGreaterThan(0);
    expect(confirm?.queries).toEqual(discover?.queries);
    expect(confirm?.queries?.length).toBeGreaterThan(0);
  });

  it("still asks before searching for a question nothing in the library covers", async () => {
    const turn = await ask("量子拓扑织机怎么用", library);

    expect(turn.zone).toBe("dark");
    expect(turn.actions.map((action) => action.kind)).toContain("confirm_discovery");
  });

  it("never offers to search when the answer is fully inside the library", async () => {
    const turn = await ask("稀疏激活是什么意思", library);

    // learning / inside 区本来就没有 discover 动作,别因为改 frontier 把它们带上。
    if (turn.zone === "learning" || turn.zone === "inside") {
      expect(turn.actions.map((action) => action.kind)).not.toContain("discover_sources");
    }
  });
});
