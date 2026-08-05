import { describe, expect, it } from "vitest";
import { getAgentTask, listAgentTasks, retryAgentTask, __testing } from "../src/domains/agentTasks.mjs";

function createJobRecord({ job: jobOverrides, ...overrides } = {}) {
  const job = {
    id: "job-1",
    kind: "import_source",
    topicId: "agent memory",
    conceptIds: ["agent memory"],
    priority: 0.5,
    reason: "观察员想补一条来源。",
    createdAt: "2026-08-01T10:00:00.000Z",
    runAfter: "2026-08-01T10:00:00.000Z",
    ...jobOverrides
  };

  return {
    id: job.id,
    originalJobId: job.id,
    attempt: 0,
    status: "succeeded",
    attempts: 1,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:05:00.000Z",
    claimedAt: "2026-08-01T10:01:00.000Z",
    completedAt: "2026-08-01T10:05:00.000Z",
    workerId: "worker-secret",
    ...overrides,
    job
  };
}

function createStores({ records = [], snapshot = {} } = {}) {
  const state = { records: records.map((record) => ({ ...record })), saved: [] };

  return {
    state,
    curationStore: {
      list: (status) => state.records.filter((record) => !status || record.status === status),
      enqueueRetry: (jobId, retriedAt) => {
        const current = state.records.find((record) => record.id === jobId);
        const retry = {
          ...current,
          id: `${current.originalJobId}|retry-1`,
          job: { ...current.job, id: `${current.originalJobId}|retry-1`, createdAt: retriedAt, runAfter: retriedAt },
          attempt: current.attempt + 1,
          status: "queued",
          attempts: 0,
          createdAt: retriedAt,
          updatedAt: retriedAt,
          completedAt: undefined,
          lastError: undefined,
          result: undefined
        };

        state.records.push(retry);

        return retry;
      }
    },
    persistenceStore: {
      getSnapshot: () => ({ posts: [], agentTurns: [], ...snapshot }),
      saveCurationJobRecords: (saved) => {
        state.saved.push(...saved);
      }
    }
  };
}

describe("listAgentTasks", () => {
  it("merges queue jobs with asked questions and orders them by last activity", () => {
    const { curationStore, persistenceStore } = createStores({
      records: [createJobRecord({ updatedAt: "2026-08-01T10:05:00.000Z" })],
      snapshot: {
        agentTurns: [
          {
            id: "agent-turn-1",
            userId: "local-user",
            question: "MCP 是什么?",
            intent: "grounded_qa",
            status: "answered",
            threadId: "thread-1",
            answerCardId: "post-9",
            createdAt: "2026-08-02T09:00:00.000Z"
          }
        ]
      }
    });

    const result = listAgentTasks({ persistenceStore, curationStore, contentLanguage: "zh" });

    expect(result.total).toBe(2);
    expect(result.tasks.map((task) => task.id)).toEqual(["agent-turn-1", "job-1"]);
    expect(result.tasks[0]).toMatchObject({ kind: "question", origin: "you", status: "succeeded" });
    expect(result.tasks[1]).toMatchObject({ kind: "import_source", status: "succeeded", retryable: false });
  });

  // 答完但挂着「要不要出网查」的确认不是排队:原来映射成 queued,列表就永远
  // 显示「排队中」,和详情里的「答完了」自相矛盾。
  it("lists a turn pending user confirmation as awaiting, not queued", () => {
    const { curationStore, persistenceStore } = createStores({
      snapshot: {
        agentTurns: [
          {
            id: "agent-turn-2",
            userId: "local-user",
            question: "门控网络是怎么选专家的",
            intent: "grounded_qa",
            status: "pending_confirmation",
            threadId: "thread-2",
            createdAt: "2026-08-02T09:00:00.000Z"
          }
        ]
      }
    });

    const [task] = listAgentTasks({ persistenceStore, curationStore, contentLanguage: "zh" }).tasks;

    expect(task).toMatchObject({ id: "agent-turn-2", status: "awaiting" });
  });

  it("never leaks the worker id that claimed a job", () => {
    const { curationStore, persistenceStore } = createStores({ records: [createJobRecord()] });

    const [task] = listAgentTasks({ persistenceStore, curationStore, contentLanguage: "zh" }).tasks;

    expect(JSON.stringify(task)).not.toContain("worker-secret");
  });

  it("counts running and failed jobs and translates the failure reason", () => {
    const { curationStore, persistenceStore } = createStores({
      records: [
        createJobRecord({ status: "running", id: "job-running", job: { id: "job-running" } }),
        createJobRecord({
          status: "failed",
          id: "job-failed",
          job: { id: "job-failed" },
          lastError: "Source could not be fetched."
        })
      ]
    });

    const result = listAgentTasks({ persistenceStore, curationStore, contentLanguage: "zh" });

    expect(result.running).toBe(1);
    expect(result.failed).toBe(1);
    const failed = result.tasks.find((task) => task.id === "job-failed");
    expect(failed.failureReason).toBe("抓不到这个来源(网络或对方站点的问题)。");
    expect(failed.retryable).toBe(true);
  });

  it("marks a clip saved from the browser as started by you, not by the observer", () => {
    const { curationStore, persistenceStore } = createStores({
      records: [createJobRecord({ job: { sourceCandidate: { intakeKind: "browser_share" } } })]
    });

    const [task] = listAgentTasks({ persistenceStore, curationStore, contentLanguage: "zh" }).tasks;

    expect(task.origin).toBe("you");
  });
});

describe("getAgentTask", () => {
  it("builds an ordered step stream and resolves the cards the job produced", () => {
    const { curationStore, persistenceStore } = createStores({
      records: [
        createJobRecord({
          result: {
            kind: "source_imported",
            sourceImport: { source: { title: "Agent memory, revisited" }, posts: [{ id: "post-1" }] }
          }
        })
      ],
      snapshot: {
        posts: [
          {
            id: "post-1",
            title: "长期记忆的三种写法",
            keyTakeaway: "写入时机比存储格式更决定召回质量。",
            concepts: ["agent memory", "retrieval"],
            thread: [{ citations: [{ quote: "Memory writes are the bottleneck." }] }],
            sources: [{ title: "Agent memory, revisited", url: "https://example.test/a", author: "Ann" }]
          }
        ]
      }
    });

    const detail = getAgentTask({ id: "job-1", persistenceStore, curationStore, contentLanguage: "zh" });

    expect(detail.steps.map((step) => step.kind)).toEqual(["queued", "claimed", "imported", "succeeded"]);
    expect(detail.steps.at(-1).note).toBe("产出 1 张卡");
    expect(detail.produced).toEqual([
      {
        id: "post-1",
        title: "长期记忆的三种写法",
        keyTakeaway: "写入时机比存储格式更决定召回质量。",
        concepts: ["agent memory", "retrieval"],
        quote: "Memory writes are the bottleneck.",
        source: { title: "Agent memory, revisited", url: "https://example.test/a", author: "Ann" }
      }
    ]);
  });

  it("leaves the time empty on steps the record has no timestamp for", () => {
    const { curationStore, persistenceStore } = createStores({
      records: [
        createJobRecord({
          job: { kind: "discover_sources" },
          result: {
            kind: "sources_discovered",
            discoveredSourceCandidates: [{ id: "cand-1", source: { title: "A", url: "https://example.test/a" } }]
          }
        })
      ]
    });

    const detail = getAgentTask({ id: "job-1", persistenceStore, curationStore, contentLanguage: "zh" });
    const discovered = detail.steps.find((step) => step.kind === "discovered");

    expect(discovered.at).toBeNull();
    expect(discovered.items).toEqual([{ title: "A", url: "https://example.test/a", relevanceScore: null }]);
  });

  it("ends a failed job's stream with the reason instead of a success step", () => {
    const { curationStore, persistenceStore } = createStores({
      records: [createJobRecord({ status: "failed", lastError: "Source import failed." })]
    });

    const detail = getAgentTask({ id: "job-1", persistenceStore, curationStore, contentLanguage: "zh" });

    expect(detail.steps.at(-1)).toMatchObject({ kind: "failed", text: "导入这个来源时失败了。" });
    expect(detail.steps.some((step) => step.kind === "succeeded")).toBe(false);
  });

  // 失败原因在出网前已被 sanitizeFailedCurationRecord 收敛:导入类只剩「抓不到」和
  // 「导入失败」两种,其余任务一律「后台任务失败」。界面能说的就这么多,别更细。
  it("shows the generic wording for a non-import job because that is all the record keeps", () => {
    const { curationStore, persistenceStore } = createStores({
      records: [
        createJobRecord({
          status: "failed",
          lastError: "Model call timed out after 30s at provider.example.",
          job: { kind: "generate_followup" }
        })
      ]
    });

    const [task] = listAgentTasks({ persistenceStore, curationStore, contentLanguage: "zh" }).tasks;

    expect(task.failureReason).toBe("这个后台任务失败了。");
    expect(JSON.stringify(task)).not.toContain("provider.example");
  });

  it("returns null for an id that belongs to neither a job nor a question", () => {
    const { curationStore, persistenceStore } = createStores();

    expect(getAgentTask({ id: "nope", persistenceStore, curationStore, contentLanguage: "zh" })).toBeNull();
  });
});

describe("retryAgentTask", () => {
  it("requeues a failed job under a new id so the queue cannot drop it as a duplicate", () => {
    const { curationStore, persistenceStore, state } = createStores({
      records: [createJobRecord({ status: "failed", lastError: "Source import failed." })]
    });

    const result = retryAgentTask({
      id: "job-1",
      persistenceStore,
      curationStore,
      contentLanguage: "zh",
      now: "2026-08-04T12:00:00.000Z"
    });

    expect(result.retried).toBe(true);
    expect(result.taskId).not.toBe("job-1");
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({ status: "queued", attempt: 1 });
    expect(state.saved[0].job.runAfter).toBe("2026-08-04T12:00:00.000Z");
  });

  it("refuses to retry a job that has not failed and writes nothing", () => {
    const { curationStore, persistenceStore, state } = createStores({ records: [createJobRecord()] });

    const result = retryAgentTask({
      id: "job-1",
      persistenceStore,
      curationStore,
      contentLanguage: "zh",
      now: "2026-08-04T12:00:00.000Z"
    });

    expect(result).toMatchObject({ retried: false, reason: "not_failed" });
    expect(state.saved).toHaveLength(0);
  });

  it("reports a missing task instead of throwing", () => {
    const { curationStore, persistenceStore } = createStores();

    expect(
      retryAgentTask({
        id: "gone",
        persistenceStore,
        curationStore,
        contentLanguage: "zh",
        now: "2026-08-04T12:00:00.000Z"
      })
    ).toMatchObject({ retried: false, reason: "not_found" });
  });
});

describe("task titles", () => {
  it("names an import by the source it is importing", () => {
    expect(
      __testing.describeJob(
        { kind: "import_source", topicId: "agent memory", sourceCandidate: { source: { title: "Ann on memory" } } },
        "zh"
      )
    ).toBe("导入来源:Ann on memory");
  });

  // researchQuestion 是对象不是字符串,直接内插会印出 [object Object]。
  it("names a research task by the question that was asked, not the whole payload", () => {
    expect(
      __testing.describeJob(
        {
          kind: "research_question",
          topicId: "question-abc",
          researchQuestion: {
            turnId: "agent-turn-1",
            question: "混合专家是什么",
            choices: { focus: "definition", depth: "quick" }
          }
        },
        "zh"
      )
    ).toBe("研究问题:混合专家是什么");
  });

  it("falls back to the topic when a research job carries no question text", () => {
    expect(__testing.describeJob({ kind: "research_question", topicId: "question-abc" }, "zh")).toBe(
      "研究问题:question-abc"
    );
  });

  it("falls back to the topic when the job carries no source title", () => {
    expect(__testing.describeJob({ kind: "discover_sources", topicId: "agent memory" }, "zh")).toBe(
      "找来源:agent memory"
    );
  });
});
