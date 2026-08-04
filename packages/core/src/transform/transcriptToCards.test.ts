import { describe, expect, it } from "vitest";
import { buildTranscriptChunks } from "./transcriptToCards.js";
import type { Source } from "../types.js";
import type { TranscriptSegment } from "./transcriptToCards.js";

const source: Source = {
  id: "youtube-demo",
  title: "How retrieval augmented generation actually works",
  url: "https://www.youtube.com/watch?v=demo",
  type: "youtube"
};

// 真实字幕轴的形状:每条只有三四十个字符,是半句话,不是段落。
// 旧实现一条轴当一个 chunk,来源质检只取首/中/尾三个 chunk,
// 于是模型只看到一百多个字符就判「内容密度极低」。
const realisticCues: TranscriptSegment[] = [
  "so the first thing to understand",
  "about retrieval augmented generation",
  "is that the model never memorizes",
  "your documents at all",
  "instead we split the corpus",
  "into passages of a few hundred words",
  "and embed each passage separately",
  "into a shared vector space",
  "at query time we embed the question",
  "and look for the nearest passages",
  "which is why chunk size matters",
  "more than almost any other knob",
  "if the passages are too small",
  "each one loses the surrounding context",
  "and the retriever returns fragments",
  "that read like nonsense on their own",
  "if the passages are too large",
  "the embedding gets diluted",
  "and the retriever stops discriminating",
  "between the parts you actually need",
  "so most teams land somewhere",
  "between two hundred and five hundred words",
  "and then spend their time",
  "on the reranking stage instead",
  "because reranking is where",
  "the biggest quality gains usually hide",
  "and that is also the part",
  "most tutorials skip entirely"
].map((text, index) => ({
  startTimeSeconds: index * 3,
  endTimeSeconds: index * 3 + 3,
  text
}));

describe("buildTranscriptChunks", () => {
  it("merges caption cues into paragraph-sized chunks", () => {
    const chunks = buildTranscriptChunks(source, realisticCues);

    // 28 条碎轴不该原样变成 28 个 chunk。
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(realisticCues.length / 3);

    // 除最后一块外,每块都该攒够段落体量(旧实现每块只有三四十字符)。
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.content.length).toBeGreaterThanOrEqual(200);
    }
  });

  it("gives the source quality gate enough text to judge", () => {
    const chunks = buildTranscriptChunks(source, realisticCues);
    // 门禁的取样规则:首 + 中 + 尾三块(sourceQualityGate.ts:261-272)。
    const sample = [chunks[0], chunks[Math.floor(chunks.length / 2)], chunks[chunks.length - 1]]
      .map((chunk) => chunk.content)
      .join("\n\n");

    expect(sample.length).toBeGreaterThan(400);
  });

  it("keeps every word, in order, exactly once", () => {
    const chunks = buildTranscriptChunks(source, realisticCues);
    const rejoined = chunks.map((chunk) => chunk.content).join(" ");

    expect(rejoined).toBe(realisticCues.map((cue) => cue.text).join(" "));
  });

  it("spans the merged cues' timestamps", () => {
    const chunks = buildTranscriptChunks(source, realisticCues);

    expect(chunks[0].startTimeSeconds).toBe(realisticCues[0].startTimeSeconds);
    expect(chunks[chunks.length - 1].endTimeSeconds).toBe(
      realisticCues[realisticCues.length - 1].endTimeSeconds
    );

    // 每块的时间区间首尾相接、单调递增,引文跳转才不会指错地方。
    for (const chunk of chunks) {
      expect(chunk.endTimeSeconds ?? 0).toBeGreaterThan(chunk.startTimeSeconds ?? 0);
    }

    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index].startTimeSeconds ?? 0).toBeGreaterThanOrEqual(
        chunks[index - 1].endTimeSeconds ?? 0
      );
    }
  });

  it("gives each chunk a distinct id", () => {
    const chunks = buildTranscriptChunks(source, realisticCues);

    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(chunks.length);
  });

  it("keeps a single short cue rather than dropping it", () => {
    const chunks = buildTranscriptChunks(source, [
      { startTimeSeconds: 0, endTimeSeconds: 2, text: "thanks for watching" }
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe("thanks for watching");
    expect(chunks[0].startTimeSeconds).toBe(0);
    expect(chunks[0].endTimeSeconds).toBe(2);
  });

  it("keeps an already-long cue as its own chunk", () => {
    const long = "a".repeat(900);
    const chunks = buildTranscriptChunks(source, [
      { startTimeSeconds: 0, endTimeSeconds: 30, text: long },
      { startTimeSeconds: 30, endTimeSeconds: 33, text: "and that is the whole idea" }
    ]);

    expect(chunks[0].content).toBe(long);
    expect(chunks).toHaveLength(2);
  });

  it("returns nothing for an empty transcript", () => {
    expect(buildTranscriptChunks(source, [])).toEqual([]);
  });
});
