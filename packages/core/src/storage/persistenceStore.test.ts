import { describe, expect, it } from "vitest";

import type { KnowledgePost } from "../types.js";
import type { SourceImportWorkerResult } from "../source/sourceImportWorker.js";
import { createAITimelinePersistenceStore, type AITimelinePersistenceStore } from "./persistenceStore.js";
import { createMemoryRevisionedStorageAdapter } from "./revisionedStorage.js";

function createMemoryStore(): AITimelinePersistenceStore {
  return createAITimelinePersistenceStore(createMemoryRevisionedStorageAdapter());
}

interface ImportFixtureOptions {
  importId: string;
  sourceId: string;
  url: string;
  postId: string;
  summary: string;
  keyTakeaway: string;
  createdAt: string;
}

function createImportResult(options: ImportFixtureOptions): SourceImportWorkerResult {
  const source = {
    id: options.sourceId,
    title: `Source ${options.sourceId}`,
    url: options.url,
    type: "article" as const
  };
  const post: KnowledgePost = {
    id: options.postId,
    title: `Card ${options.postId} from ${options.sourceId}`,
    hook: options.summary,
    thesis: options.summary,
    shortBody: options.summary,
    summary: options.summary,
    keyTakeaway: options.keyTakeaway,
    concepts: ["Retrieval"],
    sources: [source],
    citations: [{ sourceId: options.sourceId, url: options.url }],
    recommendedBecause: "Collision fixture.",
    trustState: "supported",
    createdAt: options.createdAt,
    estimatedReadMinutes: 1,
    difficulty: "beginner",
    confidence: "high",
    thread: [],
    graphEdges: [],
    reviewPrompts: [],
    nextActions: [],
    harnessVersion: "test"
  };
  const validation = [{ postId: options.postId, valid: true, issues: [] }];

  return {
    importRecord: {
      id: options.importId,
      source,
      status: "ready",
      createdAt: options.createdAt
    },
    source,
    assets: [],
    chunks: [],
    sourceRegistry: {
      sources: [source],
      assets: [],
      snapshots: [],
      chunks: [],
      chunkVersions: []
    },
    posts: [post],
    validation,
    harnessRun: {
      id: `run-${options.importId}`,
      objective: "source_import",
      sourceId: options.sourceId,
      sourceSnapshotIds: [],
      inputChunkIds: [],
      outputPostIds: [options.postId],
      status: "succeeded",
      validation,
      harnessVersion: "test",
      runnerKind: "deterministic",
      createdAt: options.createdAt,
      completedAt: options.createdAt
    }
  };
}

/**
 * Models chose the card id themselves and reused generic ids like `post-001` across
 * unrelated articles. Persistence replaced by id, so the later import silently destroyed
 * the earlier article's card. Real snapshot on 2026-08-03: 17 ids produced more than once,
 * 34 card versions lost. See docs/specs/2026-08-03-post-id-collision.md.
 */
describe("post id collisions across imports", () => {
  it("keeps both cards when unrelated sources produce the same post id", () => {
    const store = createMemoryStore();

    store.saveSourceImportResult(
      createImportResult({
        importId: "import-a",
        sourceId: "article-a",
        url: "https://example.com/a",
        postId: "post-001",
        summary: "Mindtagger speeds up annotation for knowledge base construction.",
        keyTakeaway: "Annotation tooling decides knowledge base quality.",
        createdAt: "2026-06-10T00:00:00.000Z"
      }),
      "2026-06-10T00:00:00.000Z"
    );

    const snapshot = store.saveSourceImportResult(
      createImportResult({
        importId: "import-b",
        sourceId: "article-b",
        url: "https://example.com/b",
        postId: "post-001",
        summary: "Speculative decoding cuts serving latency with a small draft model.",
        keyTakeaway: "A draft model lowers latency when acceptance stays high.",
        createdAt: "2026-06-11T00:00:00.000Z"
      }),
      "2026-06-11T00:00:00.000Z"
    );

    expect(snapshot.posts).toHaveLength(2);
    expect(snapshot.posts.map((post) => post.sources[0]?.id).sort()).toEqual(["article-a", "article-b"]);
  });

  it("still replaces the card when the same source is imported again", () => {
    const store = createMemoryStore();
    const first = createImportResult({
      importId: "import-a",
      sourceId: "article-a",
      url: "https://example.com/a",
      postId: "post-001",
      summary: "First pass at the annotation tooling article.",
      keyTakeaway: "Annotation tooling decides knowledge base quality.",
      createdAt: "2026-06-10T00:00:00.000Z"
    });

    store.saveSourceImportResult(first, "2026-06-10T00:00:00.000Z");

    const snapshot = store.saveSourceImportResult(
      createImportResult({
        importId: "import-a-again",
        sourceId: "article-a",
        url: "https://example.com/a",
        postId: "post-001",
        summary: "Rewritten pass at the very same annotation tooling article.",
        keyTakeaway: "Annotation tooling decides knowledge base quality.",
        createdAt: "2026-06-12T00:00:00.000Z"
      }),
      "2026-06-12T00:00:00.000Z"
    );

    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0]?.id).toBe("post-001");
    expect(snapshot.posts[0]?.summary).toBe("Rewritten pass at the very same annotation tooling article.");
  });

  it("does not multiply cards when the same colliding import is applied twice", () => {
    const store = createMemoryStore();

    store.saveSourceImportResult(
      createImportResult({
        importId: "import-a",
        sourceId: "article-a",
        url: "https://example.com/a",
        postId: "post-001",
        summary: "Mindtagger speeds up annotation for knowledge base construction.",
        keyTakeaway: "Annotation tooling decides knowledge base quality.",
        createdAt: "2026-06-10T00:00:00.000Z"
      }),
      "2026-06-10T00:00:00.000Z"
    );

    const colliding = createImportResult({
      importId: "import-b",
      sourceId: "article-b",
      url: "https://example.com/b",
      postId: "post-001",
      summary: "Speculative decoding cuts serving latency with a small draft model.",
      keyTakeaway: "A draft model lowers latency when acceptance stays high.",
      createdAt: "2026-06-11T00:00:00.000Z"
    });

    store.saveSourceImportResult(colliding, "2026-06-11T00:00:00.000Z");
    const snapshot = store.saveSourceImportResult(colliding, "2026-06-13T00:00:00.000Z");

    expect(snapshot.posts).toHaveLength(2);
  });

  it("lets a colliding card merge into the card it collided with when the content matches", () => {
    const store = createMemoryStore();
    const summary = "Speculative decoding uses a draft model plus a verification pass to cut serving latency.";
    const keyTakeaway = "A draft model cuts latency when token acceptance stays high.";

    store.saveSourceImportResult(
      createImportResult({
        importId: "import-a",
        sourceId: "article-a",
        url: "https://example.com/a",
        postId: "post-001",
        summary,
        keyTakeaway,
        createdAt: "2026-06-10T00:00:00.000Z"
      }),
      "2026-06-10T00:00:00.000Z"
    );

    const snapshot = store.saveSourceImportResult(
      createImportResult({
        importId: "import-b",
        sourceId: "article-b",
        url: "https://example.com/b",
        postId: "post-001",
        summary,
        keyTakeaway,
        createdAt: "2026-06-11T00:00:00.000Z"
      }),
      "2026-06-11T00:00:00.000Z"
    );

    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.posts[0]?.sources.map((source) => source.id).sort()).toEqual(["article-a", "article-b"]);
    expect(snapshot.mergedSources).toHaveLength(1);
  });

  it("points the run ledger at the new id instead of the id the model reused", () => {
    const store = createMemoryStore();

    store.saveSourceImportResult(
      createImportResult({
        importId: "import-a",
        sourceId: "article-a",
        url: "https://example.com/a",
        postId: "post-001",
        summary: "Mindtagger speeds up annotation for knowledge base construction.",
        keyTakeaway: "Annotation tooling decides knowledge base quality.",
        createdAt: "2026-06-10T00:00:00.000Z"
      }),
      "2026-06-10T00:00:00.000Z"
    );

    const snapshot = store.saveSourceImportResult(
      createImportResult({
        importId: "import-b",
        sourceId: "article-b",
        url: "https://example.com/b",
        postId: "post-001",
        summary: "Speculative decoding cuts serving latency with a small draft model.",
        keyTakeaway: "A draft model lowers latency when acceptance stays high.",
        createdAt: "2026-06-11T00:00:00.000Z"
      }),
      "2026-06-11T00:00:00.000Z"
    );

    const renamedId = snapshot.posts.find((post) => post.sources[0]?.id === "article-b")?.id;

    expect(renamedId).toBeDefined();
    expect(renamedId).not.toBe("post-001");
    expect(renamedId?.startsWith("post-001-")).toBe(true);

    const run = snapshot.harnessRuns.find((item) => item.sourceId === "article-b");

    expect(run?.outputPostIds).toEqual([renamedId]);
    expect(run?.validation.map((record) => record.postId)).toEqual([renamedId]);
    expect(snapshot.validation.filter((record) => record.postId === "post-001")).toHaveLength(1);
  });
});
