import { describe, expect, it } from "vitest";
import type { InteractionSignal, KnowledgeCard } from "../types.js";
import { rankPersonalizedTimeline } from "./ranker.js";

function makeCard(
  id: string,
  concept: string,
  createdAt = "2026-01-01T00:00:00.000Z",
  estimatedReadMinutes = 6
): KnowledgeCard {
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
    estimatedReadMinutes
  };
}

/** An impression with nothing else on it: seen in the feed, never acted on. */
function makeIgnoredExposures(postId: string, count: number): InteractionSignal[] {
  return Array.from({ length: count }, (_unused, index) => ({
    postId,
    topicId: "shared",
    conceptIds: ["Shared"],
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: new Date(Date.UTC(2026, 6, 10 + index)).toISOString()
  }));
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

describe("exposure fatigue", () => {
  const exposed = makeCard("exposed-card", "Shared");
  const untouched = makeCard("untouched-card", "Shared");

  function scoreExposedCard(exposureCount: number, dueReviewPostIds?: string[]): number {
    const ranked = rankPersonalizedTimeline({
      cards: [exposed, untouched],
      recentSignals: makeIgnoredExposures(exposed.id, exposureCount),
      dueReviewPostIds,
      now: "2026-07-28T00:00:00.000Z",
      timeZone: "UTC"
    });

    return ranked.find((card) => card.id === exposed.id)?.score ?? Number.NaN;
  }

  it("lowers a card that keeps being shown without any interaction", () => {
    const baseline = scoreExposedCard(0);

    expect(scoreExposedCard(1)).toBe(baseline - 8);
    expect(
      rankPersonalizedTimeline({
        cards: [exposed, untouched],
        recentSignals: makeIgnoredExposures(exposed.id, 1),
        now: "2026-07-28T00:00:00.000Z",
        timeZone: "UTC"
      }).map((card) => card.id)
    ).toEqual([untouched.id, exposed.id]);
  });

  it("grows the penalty with each ignored exposure and then caps it", () => {
    const baseline = scoreExposedCard(0);

    expect(scoreExposedCard(2)).toBe(baseline - 16);
    expect(scoreExposedCard(3)).toBe(baseline - 24);
    expect(scoreExposedCard(6)).toBe(baseline - 24);
  });

  it("exempts due review cards so they still surface on schedule", () => {
    const baseline = scoreExposedCard(0);

    expect(scoreExposedCard(3, [exposed.id])).toBe(baseline + 30);
  });

  it("leaves a card alone once the exposure carried an interaction", () => {
    const baseline = scoreExposedCard(0);
    const engagedSignals = makeIgnoredExposures(exposed.id, 2).map((signal) => ({ ...signal, liked: true }));
    const ranked = rankPersonalizedTimeline({
      cards: [exposed, untouched],
      recentSignals: engagedSignals,
      now: "2026-07-28T00:00:00.000Z",
      timeZone: "UTC"
    });

    // Two liked signals only add the existing +12 engagement boost: no fatigue.
    expect(ranked.find((card) => card.id === exposed.id)?.score).toBe(baseline + 12);
  });
});

describe("session rotation", () => {
  // "top-fast" scores 15, the other two score 10 (inside the 10-point window),
  // and "buried" is dragged 12 points below them by its read history.
  const rotationCards = [
    makeCard("top-fast", "Shared", "2026-01-01T00:00:00.000Z", 1),
    makeCard("top-slow", "Shared", "2026-01-02T00:00:00.000Z"),
    makeCard("mid", "Shared", "2026-01-03T00:00:00.000Z"),
    makeCard("buried", "Shared", "2026-01-04T00:00:00.000Z")
  ];
  const rotationInput = {
    cards: rotationCards,
    seenReadCounts: { buried: 1 },
    now: "2026-07-28T00:00:00.000Z",
    timeZone: "UTC"
  };

  function orderFor(sessionSeed?: string): string[] {
    return rankPersonalizedTimeline({ ...rotationInput, sessionSeed }).map((card) => card.id);
  }

  it("keeps the deterministic order when no seed is given", () => {
    expect(rankPersonalizedTimeline(rotationInput).map((card) => card.score)).toEqual([15, 10, 10, -2]);
    expect(orderFor()).toEqual(["top-fast", "mid", "top-slow", "buried"]);
    expect(orderFor(undefined)).toEqual(orderFor());
  });

  it("returns the same order for the same seed and a different one across seeds", () => {
    expect(orderFor("session-a")).toEqual(orderFor("session-a"));
    expect(orderFor("session-a")).not.toEqual(orderFor("session-b"));
  });

  it("rotates only inside the score window, so a buried card never reaches the top", () => {
    const seeds = Array.from({ length: 40 }, (_unused, index) => `session-${index}`);
    const orders = seeds.map((seed) => orderFor(seed));
    const leaders = new Set(orders.map((order) => order[0]));

    for (const order of orders) {
      expect(order[3]).toBe("buried");
      expect(order.slice(0, 3).sort()).toEqual(["mid", "top-fast", "top-slow"]);
    }

    // A rotation that never moves anything would leave a single leader; a global
    // shuffle would eventually put "buried" first. Neither passes here.
    expect(leaders.size).toBeGreaterThan(1);
    expect(leaders.has("buried")).toBe(false);
  });
});
