import { describe, expect, it } from "vitest";

import {
  createInMemoryBackgroundCurationJobStore,
  createMemoryRevisionedStorageAdapter,
  createSourceRegistry,
  runConversationTurn
} from "../../../packages/core/dist/index.js";
import { __testing, buildAgentChatTools, createAgentChatStore, handleAgentChatMessage } from "../src/domains/agentChat.mjs";

const now = new Date().toISOString();
const source = {
  id: "source-attn",
  title: "注意力机制入门",
  url: "https://example.com/attention",
  type: "article"
};
const chunk = {
  id: "chunk-attn-1",
  sourceId: "source-attn",
  content: "注意力机制通过 query 与 key 的相似度为每个位置分配权重。Attention weights come from query-key similarity."
};
const attentionPost = {
  id: "post-attn",
  title: "注意力机制怎么分配权重",
  hook: "注意力其实是加权平均。",
  thesis: "注意力机制按相似度分配权重。",
  shortBody: "注意力机制通过 query 与 key 的相似度分配权重。",
  summary: "注意力机制通过 query 与 key 的相似度为每个位置分配权重。",
  keyTakeaway: "注意力机制按 query-key 相似度分配权重。",
  concepts: ["注意力机制", "Transformer"],
  sources: [source],
  citations: [{ sourceId: "source-attn", chunkId: "chunk-attn-1" }],
  thread: [],
  graphEdges: [],
  reviewPrompts: [],
  recommendedBecause: "测试固定卡。",
  createdAt: now
};
const registry = createSourceRegistry({ sources: [source], chunks: [chunk], createdAt: now });

function createFakePersistenceStore(overrides = {}) {
  const state = {
    snapshot: {
      posts: [attentionPost],
      sourceRegistries: [{ sourceId: "source-attn", registry }],
      conceptAliases: [],
      userMemories: [],
      autoJobBudget: [],
      curationJobs: [],
      interactionSignals: [],
      agentTurns: [],
      // summarizeSnapshot 逐字段读 length,确定性兜底全流程要走到它
      sourceImports: [],
      harnessRuns: [],
      topicStates: [],
      dismissedPosts: [],
      reviewStates: [],
      sourceCandidates: [],
      notifications: [],
      conceptMergeSuggestions: [],
      sourceQualityVerdicts: [],
      mergedSources: [],
      conceptBriefs: [],
      deepReadArticles: [],
      weeklyRecaps: [],
      subscriptions: [],
      learningGoals: [],
      ...overrides
    },
    savedCurationRecords: [],
    savedBudgets: []
  };

  return {
    state,
    getSnapshot: () => state.snapshot,
    saveInteractionSignalRecords() {
      return state.snapshot;
    },
    saveUserMemory() {
      return state.snapshot;
    },
    saveAgentTurnRecords() {
      return state.snapshot;
    },
    saveDailyAutoJobBudgetRecords(records) {
      state.savedBudgets.push(...records);
      const byDate = new Map(state.snapshot.autoJobBudget.map((record) => [record.date, record]));
      for (const record of records) byDate.set(record.date, record);
      state.snapshot = { ...state.snapshot, autoJobBudget: [...byDate.values()] };
      return state.snapshot;
    },
    saveCurationJobRecords(records) {
      state.savedCurationRecords.push(...records);
      return state.snapshot;
    }
  };
}

function createTools({ persistenceStore, curationStore, contentLanguage = "zh" } = {}) {
  const state = { answer: undefined, actions: undefined, turnRecordId: undefined, awaitingConfirmation: false };
  const tools = buildAgentChatTools({
    persistenceStore: persistenceStore ?? createFakePersistenceStore(),
    curationStore: curationStore ?? createInMemoryBackgroundCurationJobStore(),
    askModelClient: undefined,
    contentLanguage,
    userId: "local-user",
    chatTurnId: "chat-turn-test",
    state,
    env: {}
  });

  return { tools, state };
}

describe("中文问题选卡(缺陷 1 回归)", () => {
  const question = "什么是注意力机制?";

  it("rankPostsForQuestion 对纯中文问题能命中概念,不再空手而归", () => {
    const ranked = __testing.rankPostsForQuestion([attentionPost], question, []);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].postId).toBe("post-attn");
    expect(ranked[0].conceptHits).toBeGreaterThan(0);
    expect(ranked[0].overlapScore).toBeGreaterThan(0);
  });

  it("概念没建索引时,CJK 二元组重合仍能当补充信号", () => {
    const postWithoutMatchingConcept = { ...attentionPost, concepts: ["Transformer"] };
    const ranked = __testing.rankPostsForQuestion([postWithoutMatchingConcept], question, []);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].conceptHits).toBe(0);
    expect(ranked[0].lexicalOverlap).toBeGreaterThan(0);
  });

  it("全库零命中时诚实返回空,不盲目兜底 posts[0]", () => {
    const unrelatedPost = {
      ...attentionPost,
      id: "post-unrelated",
      title: "GPU scheduling basics",
      summary: "How GPU kernels are scheduled.",
      keyTakeaway: "Kernels queue per stream.",
      concepts: ["GPU Scheduling"]
    };

    expect(__testing.rankPostsForQuestion([unrelatedPost], "怎么腌酸菜?", [])).toHaveLength(0);
  });

  it("模型模式的 ask_grounded / search_library 与无模型确定性路径选同一张卡", async () => {
    const { tools } = createTools();
    const askResult = await tools.ask_grounded.run({ question });

    expect(askResult.found).toBe(true);
    expect(askResult.postId).toBe("post-attn");
    expect(askResult.answer).toBeTruthy();

    const searchResult = tools.search_library.run({ query: question });

    expect(searchResult.matches[0]?.postId).toBe("post-attn");

    const deterministicTurn = await runConversationTurn({
      question,
      posts: [attentionPost],
      registry,
      now
    });

    expect(deterministicTurn.answerCardId).toBe("post-attn");
    expect(askResult.postId).toBe(deterministicTurn.answerCardId);
  });

  it("库内没有可依据的卡时 ask_grounded 报 found:false", async () => {
    const persistenceStore = createFakePersistenceStore({ posts: [], sourceRegistries: [] });
    const { tools } = createTools({ persistenceStore });
    const result = await tools.ask_grounded.run({ question });

    expect(result.found).toBe(false);
  });
});

describe("enqueue_import 预算(缺陷 2 回归)", () => {
  it("同 URL 连调两次:第二次报 alreadyQueued,预算 used 只 +1,队列只有一条任务", () => {
    const persistenceStore = createFakePersistenceStore();
    const curationStore = createInMemoryBackgroundCurationJobStore();
    const { tools } = createTools({ persistenceStore, curationStore });

    const first = tools.enqueue_import.run({ url: "https://example.com/moe-paper", reason: "想看 MoE 论文" });

    expect(first.queued).toBe(true);
    expect(first.alreadyQueued).toBeUndefined();

    const budgetAfterFirst = persistenceStore.state.snapshot.autoJobBudget[0];

    expect(budgetAfterFirst.used).toBe(1);

    const second = tools.enqueue_import.run({ url: "https://example.com/moe-paper", reason: "再来一次" });

    expect(second.queued).toBe(true);
    expect(second.alreadyQueued).toBe(true);
    expect(second.taskId).toBe(first.taskId);

    const budgetAfterSecond = persistenceStore.state.snapshot.autoJobBudget[0];

    expect(budgetAfterSecond.used).toBe(1);
    expect(persistenceStore.state.savedBudgets).toHaveLength(1);
    expect(curationStore.list().filter((record) => record.job.kind === "import_source")).toHaveLength(1);
  });
});

describe("中断轮次文案(缺陷 3 回归)", () => {
  const runningTurn = {
    id: "chat-turn-running",
    userId: "local-user",
    text: "hello",
    status: "running",
    events: [],
    createdAt: now,
    updatedAt: now
  };

  it("en 模式下进程重启的中断事件是英文", () => {
    const adapter = createMemoryRevisionedStorageAdapter(
      JSON.stringify({ version: 2, revision: 0, turns: [runningTurn] })
    );
    const store = createAgentChatStore(adapter, { contentLanguage: "en" });
    const turn = store.get("chat-turn-running");

    expect(turn.status).toBe("failed");
    const lastEvent = turn.events.at(-1);
    expect(lastEvent.type).toBe("error");
    expect(lastEvent.text).toBe("The process restarted; this turn was interrupted.");
    expect(lastEvent.text).not.toMatch(/\p{Script=Han}/u);
  });

  it("zh 默认文案保持中文", () => {
    const adapter = createMemoryRevisionedStorageAdapter(
      JSON.stringify({ version: 2, revision: 0, turns: [runningTurn] })
    );
    const store = createAgentChatStore(adapter, { contentLanguage: "zh" });
    const turn = store.get("chat-turn-running");

    expect(turn.status).toBe("failed");
    expect(turn.events.at(-1).text).toContain("进程重启");
  });
});

describe("模型基础设施故障退确定性兜底", () => {
  async function waitForTerminalTurn(store, id) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const turn = store.get(id);

      if (turn && turn.status !== "running") {
        return turn;
      }

      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }

    throw new Error("turn never reached a terminal status");
  }

  it("模型客户端抛异常(超时/断连):整轮以确定性答案 succeeded 收尾,不是 failed", async () => {
    const adapter = createMemoryRevisionedStorageAdapter(JSON.stringify({ version: 2, revision: 0, turns: [] }));
    const agentChatStore = createAgentChatStore(adapter, { contentLanguage: "zh" });
    const throwingClient = {
      complete: async () => {
        throw new Error("model command timed out after 120000ms: claude -p");
      }
    };

    const { chatTurnId } = handleAgentChatMessage({
      body: { text: "什么是注意力机制?" },
      userId: "local-user",
      agentChatStore,
      persistenceStore: createFakePersistenceStore(),
      curationStore: createInMemoryBackgroundCurationJobStore(),
      askModelClient: throwingClient,
      searchProvider: undefined,
      contentLanguage: "zh",
      env: {}
    });

    const turn = await waitForTerminalTurn(agentChatStore, chatTurnId);

    // 确定性路由答完可能附确认动作(awaiting_confirmation),两种都算活着;
    // 修复前这里是 failed + 一句「这一轮失败了」,没有任何答案。
    expect(["succeeded", "awaiting_confirmation"]).toContain(turn.status);
    expect(turn.events.some((event) => event.type === "error" && event.text.includes("模型调用失败"))).toBe(true);
    expect(turn.events.some((event) => event.type === "error" && event.text.includes("确定性路径"))).toBe(true);
    expect(turn.answer?.text).toBeTruthy();
  });
});
