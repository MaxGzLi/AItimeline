import { describe, expect, it } from "vitest";
import type { InteractionSignal, KnowledgeCard } from "../types.js";
import { rankPersonalizedTimeline } from "./ranker.js";

function makeCard(id: string, concept: string, createdAt = "2026-01-01T00:00:00.000Z"): KnowledgeCard {
  return {
    id,
    title: `Card ${id}`,
    summary: `Summary for ${id}.`,
    keyTakeaway: `Takeaway for ${id}.`,
    concepts: [concept],
    sources: [
      {
        id: `source-${id}`,
        title: `Source ${id}`,
        url: `https://example.com/${id}`,
        type: "article"
      }
    ],
    recommendedBecause: "Ranking fixture.",
    trustState: "emerging",
    createdAt,
    estimatedReadMinutes: 6
  };
}

function makePositiveSignal(
  postId: string,
  patch: Pick<InteractionSignal, "liked" | "saved">
): InteractionSignal {
  return {
    postId,
    topicId: "retrieval",
    conceptIds: ["Retrieval"],
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: patch.liked,
    saved: patch.saved,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-07-20T00:00:00.000Z"
  };
}

describe("personalized timeline ranking", () => {
  it("ranks a concept related to recent like and save signals ahead of an unrelated card", () => {
    const related = makeCard("related-card", "Retrieval");
    const unrelated = makeCard("unrelated-card", "Gardening");
    const ranked = rankPersonalizedTimeline({
      cards: [unrelated, related],
      recentSignals: [
        makePositiveSignal("liked-seed", { liked: true, saved: false }),
        makePositiveSignal("saved-seed", { liked: false, saved: true })
      ],
      now: "2026-07-28T00:00:00.000Z",
      timeZone: "UTC"
    });

    expect(ranked.map((card) => card.id)).toEqual(["related-card", "unrelated-card"]);
    expect(ranked.map((card) => card.score)).toEqual([22, 10]);
  });

  it("uses newer creation time as a deterministic tiebreaker across repeated calls", () => {
    const cards = [
      makeCard("older-card", "Shared", "2026-01-01T00:00:00.000Z"),
      makeCard("newer-card", "Shared", "2026-02-01T00:00:00.000Z")
    ];
    const input = {
      cards,
      now: "2026-07-28T00:00:00.000Z"
    };
    const first = rankPersonalizedTimeline(input);
    const second = rankPersonalizedTimeline(input);

    expect(first.map((card) => card.score)).toEqual([10, 10]);
    expect(first.map((card) => card.id)).toEqual(["newer-card", "older-card"]);
    expect(second.map((card) => card.id)).toEqual(first.map((card) => card.id));
  });
});
