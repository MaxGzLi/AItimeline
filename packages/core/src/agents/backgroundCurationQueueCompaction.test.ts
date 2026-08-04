import { describe, expect, it } from "vitest";

import { createMemoryRevisionedStorageAdapter } from "../storage/revisionedStorage.js";
import type { SourceImportWorkerResult } from "../source/sourceImportWorker.js";
import {
  compactTerminalCurationResult,
  createPersistentBackgroundCurationJobStore,
  decodeBackgroundCurationJobStoreSnapshot,
  type BackgroundCurationJobResult
} from "./backgroundCurationQueue.js";

const enqueuedAt = "2026-08-04T09:00:00.000Z";
const completedAt = "2026-08-04T09:05:00.000Z";
const materializedAt = "2026-08-04T09:06:00.000Z";

function buildPlan(jobId: string, topicId: string, reason: string) {
  return {
    generatedAt: enqueuedAt,
    jobs: [
      {
        id: jobId,
        kind: "import_source" as const,
        topicId,
        conceptIds: [] as string[],
        priority: 0.7,
        reason,
        createdAt: enqueuedAt
      }
    ],
    suppressions: [],
    acceptedSourceCandidateIds: [],
    cooledTopicIds: [],
    expansionPlan: { generatedAt: enqueuedAt, jobs: [], suppressions: [], cooledTopicIds: [] }
  };
}

function buildFatSourceImport(): SourceImportWorkerResult {
  const source = {
    id: "source-x-status-42",
    title: "Alice (@alice) on X",
    url: "https://x.com/alice/status/42",
    type: "article" as const
  };

  return {
    importRecord: {
      id: "import-record-1",
      source,
      status: "ready",
      createdAt: completedAt
    },
    source,
    assets: [{ id: "asset-1", sourceId: source.id, kind: "image", path: "media/asset-1.jpg" }],
    chunks: [
      {
        id: "chunk-1",
        sourceId: source.id,
        content: "很长的原文全文".repeat(2000),
        conceptHints: []
      }
    ],
    sourceRegistry: {
      id: "registry-1",
      source,
      chunks: [{ id: "chunk-1", sourceId: source.id, content: "很长的原文全文".repeat(2000), conceptHints: [] }]
    },
    posts: [
      {
        id: "post-1",
        title: "标题",
        hook: "钩子",
        thesis: "论点",
        shortBody: "正文".repeat(500),
        summary: "摘要",
        keyTakeaway: "要点",
        concepts: ["Mixture of Experts"],
        sources: [source],
        citations: [{ sourceId: source.id, url: source.url }],
        recommendedBecause: "测试",
        createdAt: completedAt,
        kind: "insight",
        thread: []
      }
    ],
    validation: [{ postId: "post-1", passed: true, issues: [] }],
    harnessRun: { id: "run-1", steps: ["很大的调试记录".repeat(1000)] },
    qualityGate: { verdict: "reject", reasons: ["内容太短"] }
  } as unknown as SourceImportWorkerResult;
}

function buildFatResult(): BackgroundCurationJobResult {
  const sourceImport = buildFatSourceImport();

  return {
    kind: "import_source",
    sourceImports: [sourceImport],
    materializationPlan: {
      version: 1,
      effectAt: completedAt,
      sourceImports: [sourceImport],
      releasePlans: [],
      conceptAliases: []
    },
    discoveredSourceCandidates: [
      {
        id: "cand-1",
        source: { id: "cand-source", title: "候选", url: "https://example.com/a", type: "article" },
        conceptIds: [],
        relevanceScore: 0.5,
        noveltyScore: 0.5,
        qualityScore: 0.5,
        reason: "测试候选",
        discoveredAt: completedAt
      }
    ]
  };
}

function buildStoreWithTerminalRecord(result: BackgroundCurationJobResult) {
  const adapter = createMemoryRevisionedStorageAdapter();
  const store = createPersistentBackgroundCurationJobStore(adapter);

  store.enqueuePlan(buildPlan("job-1", "Alice (@alice) on X", "测试导入"));

  const claimed = store.claimNextDueJob(enqueuedAt, { workerId: "worker-1", leaseDurationMs: 600_000 });

  if (!claimed) throw new Error("test setup: no job claimed");

  store.completeClaim(
    claimed.id,
    { workerId: "worker-1", claimGeneration: claimed.attempts },
    { status: "succeeded", completedAt, result }
  );

  return { adapter, store, recordId: claimed.id };
}

const sweepAt = "2026-08-04T09:10:00.000Z";

describe("终结任务 result 瘦身(compactMaterializedResults 延迟清扫)", () => {
  it("刚结算的记录保留完整 result 一轮(run 响应契约与崩溃重放材料)", () => {
    const { store, recordId } = buildStoreWithTerminalRecord(buildFatResult());

    store.markMaterialized([recordId], materializedAt);

    const result = store.get(recordId)?.result;

    expect(result?.compactedAt).toBeUndefined();
    expect(result?.materializationPlan).toBeTruthy();
    expect(result?.sourceImports?.[0]?.chunks?.length).toBeGreaterThan(0);

    // 清扫时间不晚于结算时间 → 同样不压。
    expect(store.compactMaterializedResults(materializedAt)).toBe(0);
  });

  it("清扫早于 before 结算的记录:剥掉大血包,保留结算后仍被读取的字段", () => {
    const { store, recordId } = buildStoreWithTerminalRecord(buildFatResult());

    store.markMaterialized([recordId], materializedAt);
    expect(store.compactMaterializedResults(sweepAt)).toBe(1);

    const record = store.get(recordId);
    const result = record?.result;

    expect(result?.compactedAt).toBe(materializedAt);
    expect(result?.materializationPlan).toBeUndefined();
    // run 响应契约:发现的候选保留(smoke-api 断言消费它,体积也小)。
    expect(result?.discoveredSourceCandidates).toHaveLength(1);

    const compacted = result?.sourceImports?.[0];

    // classifyTerminalImportSource(僵尸候选修复)仍需要的字段:
    expect(compacted?.posts).toEqual([{ id: "post-1" }]);
    expect(compacted?.qualityGate).toEqual({ verdict: "reject", reasons: ["内容太短"] });
    expect(compacted?.source.url).toBe("https://x.com/alice/status/42");
    expect(compacted?.source.id).toBe("source-x-status-42");
    // 队列解码器仍要求的骨架字段:
    expect(compacted?.importRecord.id).toBe("import-record-1");
    expect(compacted?.validation).toEqual([]);
    expect(compacted?.sourceRegistry).toBeTruthy();
    // 血包必须消失:
    expect(compacted?.chunks).toEqual([]);
    expect(compacted?.assets).toEqual([]);
    expect(compacted?.harnessRun).toBeUndefined();
    expect(JSON.stringify(record).length).toBeLessThan(3000);
  });

  it("瘦身后的队列文件能被解码器整读通过(重启不炸)", () => {
    const { adapter, store, recordId } = buildStoreWithTerminalRecord(buildFatResult());

    store.markMaterialized([recordId], materializedAt);
    store.compactMaterializedResults(sweepAt);

    const serialized = adapter.serialized();

    expect(serialized).toBeTruthy();
    const decoded = decodeBackgroundCurationJobStoreSnapshot(serialized as string);

    expect(decoded.issues).toEqual([]);
    expect(decoded.snapshot.records[0]?.result?.compactedAt).toBe(materializedAt);
  });

  it("deepReadArticle 与 conceptBrief 本体保留(网页端从 run 响应直读)", () => {
    const fat: BackgroundCurationJobResult = {
      kind: "import_source",
      sourceImports: [buildFatSourceImport()],
      materializationPlan: { version: 1 },
      conceptBrief: { id: "brief-1", concept: "MoE", body: "简报正文" },
      deepReadArticle: { id: "article-1", title: "深读", body: "文章正文" }
    } as unknown as BackgroundCurationJobResult;
    const { store, recordId } = buildStoreWithTerminalRecord(fat);

    store.markMaterialized([recordId], materializedAt);
    store.compactMaterializedResults(sweepAt);

    const result = store.get(recordId)?.result;

    expect(result?.compactedAt).toBe(materializedAt);
    expect(result?.conceptBrief).toEqual({ id: "brief-1", concept: "MoE", body: "简报正文" });
    expect(result?.deepReadArticle).toEqual({ id: "article-1", title: "深读", body: "文章正文" });
  });

  it("compactTerminalCurationResult 幂等:压缩过的 result 再压不变形", () => {
    const once = compactTerminalCurationResult(buildFatResult(), materializedAt);
    const twice = compactTerminalCurationResult(once, "2026-08-05T00:00:00.000Z");

    expect(twice).toEqual({ ...once, compactedAt: "2026-08-05T00:00:00.000Z" });
  });

  it("没有 result 的失败记录原样保留 lastError", () => {
    const adapter = createMemoryRevisionedStorageAdapter();
    const store = createPersistentBackgroundCurationJobStore(adapter);

    store.enqueuePlan(buildPlan("job-2", "t", "测试失败"));
    const claimed = store.claimNextDueJob(enqueuedAt, { workerId: "worker-1", leaseDurationMs: 600_000 });

    if (!claimed) throw new Error("test setup: no job claimed");
    store.completeClaim(
      claimed.id,
      { workerId: "worker-1", claimGeneration: claimed.attempts },
      { status: "failed", completedAt, lastError: "网络失败" }
    );
    store.markMaterialized([claimed.id], materializedAt);
    expect(store.compactMaterializedResults(sweepAt)).toBe(0);

    const record = store.get(claimed.id);

    expect(record?.status).toBe("failed");
    expect(record?.lastError).toBe("网络失败");
    expect(record?.result).toBeUndefined();
  });
});
