import { describe, expect, it } from "vitest";
import { ingestSourceCandidate, splitCapturedTextIntoParagraphs } from "../src/domains/importPipeline.mjs";

const throwingFetch = async () => {
  throw new Error("ingest must not fetch when captured text is present");
};

function buildTweetCandidate(overrides = {}) {
  return {
    id: "agent-capture-tweet",
    source: {
      id: "article-x-com-alice-status-123",
      title: "Alice (@alice) on X",
      url: "https://x.com/alice/status/123",
      type: "article",
      author: "Alice"
    },
    conceptIds: ["Attention"],
    relevanceScore: 0.7,
    noveltyScore: 0.6,
    qualityScore: 0.7,
    reason: "Saved from X via the AITimeline extension.",
    discoveredAt: "2026-08-04T00:00:00.000Z",
    capturedText:
      "Attention lets a transformer weigh every token against every other token, which is why context handling scales so well.",
    ...overrides
  };
}

describe("captured-text ingestion", () => {
  it("builds asset and chunks from the captured text without fetching", async () => {
    const candidate = buildTweetCandidate();
    const ingested = await ingestSourceCandidate(candidate, throwingFetch);

    expect(ingested.assets).toHaveLength(1);
    expect(ingested.assets[0]).toMatchObject({
      id: "article-x-com-alice-status-123-text",
      sourceId: "article-x-com-alice-status-123",
      kind: "text",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    expect(ingested.chunks).toHaveLength(1);
    expect(ingested.chunks[0]).toEqual({
      id: "article-x-com-alice-status-123-chunk-1",
      sourceId: "article-x-com-alice-status-123",
      content: candidate.capturedText,
      conceptHints: ["Attention"]
    });
    expect(ingested.recommendedBecause).toContain("Saved from the browser");
  });

  it("splits multi-paragraph captures on blank lines like the article path", async () => {
    const first =
      "Speculative decoding drafts several tokens with a small model and lets the large model verify them in one pass.";
    const second =
      "The verification step keeps the output distribution identical to the large model, so quality is not traded away.";
    const ingested = await ingestSourceCandidate(
      buildTweetCandidate({ capturedText: `${first}\n\n${second}` }),
      throwingFetch
    );

    expect(ingested.chunks.map((chunk) => chunk.content)).toEqual([first, second]);
  });

  it("treats whitespace-only captured text as absent and falls back to fetching", async () => {
    await expect(
      ingestSourceCandidate(buildTweetCandidate({ capturedText: " \n\n \n " }), throwingFetch)
    ).rejects.toThrow("ingest must not fetch when captured text is present");
  });

  it("still fetches when no captured text is present", async () => {
    await expect(ingestSourceCandidate(buildTweetCandidate({ capturedText: undefined }), throwingFetch)).rejects.toThrow(
      "ingest must not fetch when captured text is present"
    );
  });
});

describe("splitCapturedTextIntoParagraphs", () => {
  it("collapses a short tweet into a single chunk instead of dropping it", () => {
    expect(splitCapturedTextIntoParagraphs("short line one\n\nshort line two")).toEqual([
      "short line one short line two"
    ]);
  });

  it("normalizes internal whitespace within a paragraph", () => {
    const text = `A paragraph  with   irregular\nline breaks that is comfortably longer than the eighty character minimum used by articles.`;

    expect(splitCapturedTextIntoParagraphs(text)).toEqual([
      "A paragraph with irregular line breaks that is comfortably longer than the eighty character minimum used by articles."
    ]);
  });
});
