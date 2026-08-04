import { describe, expect, it } from "vitest";
import { createSourceImportWorker } from "../source/sourceImportWorker.js";
import { evaluateSourceQualityDeterministic } from "../source/sourceQualityGate.js";
import type { KnowledgeChunk } from "../types.js";
import type { BackgroundSourceCandidate } from "./backgroundCuration.js";
import { executeBackgroundCurationJob, type BackgroundCurationJobRecord } from "./backgroundCurationQueue.js";

// A realistic ~280-character tweet. The browser extension sends no topic, so
// the gate sees no concept hints, and a casual tweet this short lands well
// below the deterministic gate's accept threshold on the normal lanes.
const shortTweetText =
  "honestly the more time I spend with coding agents the more convinced I am that context is " +
  "the whole game. hand the agent the right files and it nails the task on the first try; hand " +
  "it the wrong ones and it just spins. picking what goes in the window beats a bigger model.";

const createdAt = "2026-08-04T09:00:00.000Z";

function buildCandidate(intakeKind?: BackgroundSourceCandidate["intakeKind"]): BackgroundSourceCandidate {
  return {
    id: "agent-capture-clip-1",
    source: {
      id: "article-x-com-alice-status-42",
      title: "Alice (@alice) on X",
      url: "https://x.com/alice/status/42",
      type: "article",
      author: "Alice"
    },
    // The extension sends no topic, so a real clip candidate has no concepts.
    conceptIds: [],
    relevanceScore: 0.7,
    noveltyScore: 0.6,
    qualityScore: 0.7,
    reason: "Saved from X via the AITimeline extension.",
    discoveredAt: createdAt,
    capturedText: shortTweetText,
    ...(intakeKind ? { intakeKind } : {})
  };
}

function buildChunks(candidate: BackgroundSourceCandidate): KnowledgeChunk[] {
  return [
    {
      id: `${candidate.source.id}-chunk-1`,
      sourceId: candidate.source.id,
      content: shortTweetText,
      conceptHints: candidate.conceptIds
    }
  ];
}

function buildImportJobRecord(candidate: BackgroundSourceCandidate): BackgroundCurationJobRecord {
  return {
    id: "record-clip-1",
    job: {
      id: "job-clip-1",
      kind: "import_source",
      // Topicless captures fall back to the source title (see capture.mjs).
      topicId: candidate.source.title,
      conceptIds: candidate.conceptIds,
      priority: 0.66,
      reason: "Browser capture: saved from X.",
      createdAt,
      sourceCandidate: candidate
    },
    status: "running",
    attempts: 1,
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    originalJobId: "job-clip-1",
    attempt: 0
  };
}

async function runImportJob(candidate: BackgroundSourceCandidate) {
  return executeBackgroundCurationJob(buildImportJobRecord(candidate), {
    sourceImportWorker: createSourceImportWorker(),
    ingestSourceCandidate: (ingestCandidate) => ({
      chunks: buildChunks(ingestCandidate),
      recommendedBecause: `Saved from the browser: ${ingestCandidate.reason}`
    })
  });
}

describe("import_source quality gate by intake lane", () => {
  it("uses a fixture short enough that the deterministic gate would reject it", () => {
    const candidate = buildCandidate();
    const verdict = evaluateSourceQualityDeterministic({
      source: candidate.source,
      chunks: buildChunks(candidate),
      createdAt
    });

    expect(verdict.verdict).toBe("reject");
  });

  it("turns a short browser_share clip into a card without running the quality gate", async () => {
    const record = await runImportJob(buildCandidate("browser_share"));

    expect(record.status).toBe("succeeded");
    expect(record.result?.sourceImport?.qualityGate).toBeUndefined();
    expect(record.result?.sourceImport?.importRecord.status).toBe("ready");

    const posts = record.result?.sourceImport?.posts ?? [];

    expect(posts.length).toBeGreaterThanOrEqual(1);
    expect(posts[0]?.citations?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(posts[0]?.citations?.[0]?.sourceId).toBe("article-x-com-alice-status-42");
  });

  it("still gate-rejects the same short content on the agent_capture lane", async () => {
    const record = await runImportJob(buildCandidate("agent_capture"));

    expect(record.result?.sourceImport?.qualityGate?.verdict).toBe("reject");
    expect(record.result?.sourceImport?.posts).toEqual([]);
    expect(record.result?.message).toContain("Source quality gate rejected");
  });

  it("still gate-rejects short content when the candidate carries no intake lane", async () => {
    const record = await runImportJob(buildCandidate());

    expect(record.result?.sourceImport?.qualityGate?.verdict).toBe("reject");
    expect(record.result?.sourceImport?.posts).toEqual([]);
  });
});
