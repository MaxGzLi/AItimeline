import { describe, expect, it } from "vitest";
import { ingestSourceCandidate } from "../src/domains/importPipeline.mjs";

// 真实字幕轴的形状:每条三四十个字符的半句话。旧实现一条轴一个 chunk,
// 来源质检的首/中/尾取样只看到一百来个字符,整批 YouTube 来源都被判「内容密度极低」。
const cueTexts = [
  "the reason speculative decoding works",
  "is that most tokens in a response",
  "are easy enough for a small model",
  "to guess correctly on the first try",
  "so we let the draft model propose",
  "a handful of tokens at a time",
  "and then the large model verifies",
  "all of them in a single forward pass",
  "if the verification agrees",
  "we keep every token we drafted",
  "and if it disagrees at position k",
  "we throw away the tail and resample",
  "which means the output distribution",
  "stays identical to the large model",
  "so you get the speedup for free",
  "without trading away any quality"
];

const timedText = {
  events: cueTexts.map((text, index) => ({
    tStartMs: index * 3000,
    dDurationMs: 3000,
    segs: [{ utf8: text }]
  }))
};

const playerResponse = {
  videoDetails: {
    title: "Speculative decoding explained",
    author: "AITimeline Demo",
    lengthSeconds: "48"
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?v=spec123", languageCode: "en" }]
    }
  }
};

const transcriptFetch = async (input) => {
  const url = String(input);

  if (url.includes("/youtubei/v1/player")) {
    return new Response(JSON.stringify(playerResponse), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (url.includes("/api/timedtext")) {
    return new Response(JSON.stringify(timedText), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  return new Response("not found", { status: 404 });
};

function buildYoutubeCandidate() {
  return {
    id: "agent-capture-youtube",
    source: {
      id: "youtube-spec123",
      title: "Speculative decoding explained",
      url: "https://www.youtube.com/watch?v=spec123",
      type: "youtube"
    },
    conceptIds: ["Speculative Decoding"],
    relevanceScore: 0.7,
    noveltyScore: 0.6,
    qualityScore: 0.7,
    reason: "Background curation picked this video.",
    discoveredAt: "2026-08-04T00:00:00.000Z"
  };
}

describe("youtube transcript ingestion", () => {
  it("merges caption cues into paragraph-sized chunks", async () => {
    const ingested = await ingestSourceCandidate(buildYoutubeCandidate(), transcriptFetch);

    expect(ingested.chunks.length).toBeGreaterThan(0);
    expect(ingested.chunks.length).toBeLessThan(cueTexts.length / 3);

    for (const chunk of ingested.chunks.slice(0, -1)) {
      expect(chunk.content.length).toBeGreaterThanOrEqual(200);
    }
  });

  it("gives the source quality gate more than a few cues to judge", async () => {
    const ingested = await ingestSourceCandidate(buildYoutubeCandidate(), transcriptFetch);
    const chunks = ingested.chunks;
    // 门禁取样规则:首 + 中 + 尾三块(packages/core/src/source/sourceQualityGate.ts:261-272)。
    const sample = [chunks[0], chunks[Math.floor(chunks.length / 2)], chunks[chunks.length - 1]]
      .map((chunk) => chunk.content)
      .join("\n\n");

    expect(sample.length).toBeGreaterThan(300);
  });

  it("keeps the transcript verbatim and in order", async () => {
    const ingested = await ingestSourceCandidate(buildYoutubeCandidate(), transcriptFetch);

    expect(ingested.chunks.map((chunk) => chunk.content).join(" ")).toBe(cueTexts.join(" "));
  });

  it("keeps timestamps spanning the merged cues so citations still deep-link", async () => {
    const ingested = await ingestSourceCandidate(buildYoutubeCandidate(), transcriptFetch);
    const chunks = ingested.chunks;

    expect(chunks[0].startTimeSeconds).toBe(0);
    expect(chunks[chunks.length - 1].endTimeSeconds).toBe(cueTexts.length * 3);

    for (const chunk of chunks) {
      expect(chunk.endTimeSeconds).toBeGreaterThan(chunk.startTimeSeconds);
      expect(chunk.sourceId).toBe("youtube-spec123");
      expect(chunk.conceptHints).toEqual(["Speculative Decoding"]);
    }
  });

  it("gives each chunk a distinct id", async () => {
    const ingested = await ingestSourceCandidate(buildYoutubeCandidate(), transcriptFetch);

    expect(new Set(ingested.chunks.map((chunk) => chunk.id)).size).toBe(ingested.chunks.length);
  });
});
