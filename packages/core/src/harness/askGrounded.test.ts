import { describe, expect, it } from "vitest";
import type { KnowledgePost, SourceRegistry } from "../types.js";
import { askGrounded } from "./askGrounded.js";
import type { ModelClient } from "./modelRunner.js";

const source = {
  id: "source-1",
  title: "DeepSeek-V3 Technical Report",
  url: "https://example.com/deepseek-v3",
  type: "article"
} as const;

const evidence =
  "DeepSeekMoE activates only a subset of its experts for each token, so the model keeps a very high total parameter count while the compute per token stays small.";

function makeRegistry(): SourceRegistry {
  return {
    sources: [source],
    assets: [],
    snapshots: [],
    chunks: [{ id: "chunk-1", sourceId: source.id, content: evidence }],
    chunkVersions: []
  };
}

function makePost(): KnowledgePost {
  return {
    id: "post-1",
    title: "DeepSeekMoE 的稀疏激活",
    hook: evidence,
    thesis: evidence,
    shortBody: evidence,
    summary: evidence,
    keyTakeaway: evidence,
    concepts: ["Mixture-of-Experts"],
    sources: [source],
    citations: [{ sourceId: source.id, chunkId: "chunk-1" }],
    recommendedBecause: evidence,
    trustState: "supported",
    createdAt: "2026-08-04T00:00:00.000Z",
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

function makeClient(answer: string): ModelClient {
  return {
    complete: async () => ({ content: JSON.stringify({ answer, citedExcerpts: [1] }) })
  };
}

function makeScriptedClient(answers: string[]): { client: ModelClient; calls: string[][] } {
  const calls: string[][] = [];

  return {
    calls,
    client: {
      complete: async (request) => {
        calls.push(request.messages.map((message) => message.content));

        return { content: JSON.stringify({ answer: answers[calls.length - 1], citedExcerpts: [1] }) };
      }
    }
  };
}

describe("askGrounded", () => {
  // 真机上抓到的:DeepSeek 偶尔回一个没有正文的响应,异常一路抛到接口,
  // 用户问一句话换来一个报错。退回确定性答案,而且它只由登记过的原文块拼成。
  it("falls back to the deterministic answer when the model call throws", async () => {
    const client: ModelClient = {
      complete: async () => {
        throw new Error("model response did not include assistant message content.");
      }
    };
    const result = await askGrounded(
      { post: makePost(), registry: makeRegistry(), question: "混合专家是怎么省算力的?" },
      { client, contentLanguage: "zh" }
    );

    expect(result.runnerKind).toBe("deterministic");
    expect(result.grounded).toBe(true);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].quote).toBe(evidence);
    expect(result.answer).toContain(evidence);
  });

  // 答一个问题天生是转述,不是照抄。词序硬门只认近乎摘抄的句子,于是每个真答案
  // 都被判成没依据,界面永远只会回「库内暂无足够依据」。
  it("keeps an answer that restates the excerpt in the reader's own words", async () => {
    const answer =
      "根据提供的资料,DeepSeekMoE 每个 token 只激活一部分 expert,所以总参数量很大而单个 token 的计算量很小。";
    const result = await askGrounded(
      { post: makePost(), registry: makeRegistry(), question: "混合专家是怎么省算力的?" },
      { client: makeClient(answer), contentLanguage: "zh" }
    );

    expect(result.grounded).toBe(true);
    expect(result.runnerKind).toBe("model");
    expect(result.answer).toBe(answer);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunkId).toBe("chunk-1");
  });

  // 门禁一次定生死的话,同一个问题这次能答、下次被拦,全看模型这回怎么措辞。
  // 拦下来先让它照着拒绝理由改写一次再判。
  it("asks the model to rewrite once when the gate rejects the first answer", async () => {
    const { client, calls } = makeScriptedClient([
      "根据提供的资料,DeepSeekMoE 靠 FlashAttention 内核把计算量压下来。",
      "DeepSeekMoE 每个 token 只激活一部分 expert,所以计算量很小。"
    ]);
    const result = await askGrounded(
      { post: makePost(), registry: makeRegistry(), question: "混合专家是怎么省算力的?" },
      { client, contentLanguage: "zh" }
    );

    expect(calls).toHaveLength(2);
    expect(calls[1].at(-1)).toContain("rejected by the deterministic grounding check");
    expect(result.grounded).toBe(true);
    expect(result.answer).toBe("DeepSeekMoE 每个 token 只激活一部分 expert,所以计算量很小。");
  });

  // 重写不是无限重试:改了还不合格就认输,不能拿用户的等待时间赌模型。
  it("gives up after one rewrite instead of retrying forever", async () => {
    const { client, calls } = makeScriptedClient([
      "DeepSeekMoE 靠 FlashAttention 内核提速。",
      "DeepSeekMoE 靠 FlashAttention 内核提速。"
    ]);
    const result = await askGrounded(
      { post: makePost(), registry: makeRegistry(), question: "混合专家是怎么省算力的?" },
      { client, contentLanguage: "zh" }
    );

    expect(calls).toHaveLength(2);
    expect(result.grounded).toBe(false);
    expect(result.answer).toBe("库内暂无足够依据回答这个问题。");
  });

  // 放宽的是连接用的散文,不是事实。来源里没有的数字和术语必须照样拦住,
  // 否则这条测试就杀不死任何变异。
  it("still refuses an answer whose numbers and terms are absent from the excerpt", async () => {
    const answer =
      "根据提供的资料,DeepSeekMoE 通过 FlashAttention-3 内核把显存占用降低了 87%,并在 Llama-4 上验证过。";
    const result = await askGrounded(
      { post: makePost(), registry: makeRegistry(), question: "混合专家是怎么省算力的?" },
      { client: makeClient(answer), contentLanguage: "zh" }
    );

    expect(result.grounded).toBe(false);
    expect(result.citations).toEqual([]);
    expect(result.answer).toBe("库内暂无足够依据回答这个问题。");
  });
});
