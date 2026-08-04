import { describe, expect, it } from "vitest";
import { parseInjectLimit, selectInjectableCards, toInjectCard } from "../src/domains/injectFeed.mjs";

function makePost(id, overrides = {}) {
  return {
    id,
    kind: "insight",
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    concepts: ["Reinforcement Learning", "Reward Model"],
    createdAt: "2026-06-01T00:00:00.000Z",
    sources: [{ id: `${id}-source`, title: `Source ${id}`, url: `https://example.com/${id}`, type: "article" }],
    ...overrides
  };
}

describe("parseInjectLimit", () => {
  it("defaults to 3 for missing or invalid values", () => {
    expect(parseInjectLimit(null)).toBe(3);
    expect(parseInjectLimit(undefined)).toBe(3);
    expect(parseInjectLimit("abc")).toBe(3);
    expect(parseInjectLimit("0")).toBe(3);
    expect(parseInjectLimit("-2")).toBe(3);
  });

  it("accepts explicit limits and caps them at 10", () => {
    expect(parseInjectLimit("2")).toBe(2);
    expect(parseInjectLimit("10")).toBe(10);
    expect(parseInjectLimit("99")).toBe(10);
  });
});

describe("selectInjectableCards", () => {
  it("puts review-due cards first while preserving timeline order inside each group", () => {
    const posts = [
      makePost("fresh-a"),
      makePost("due-a", { reviewDueAt: "2026-06-09T00:00:00.000Z" }),
      makePost("fresh-b"),
      makePost("due-b", { reviewDueAt: "2026-06-10T00:00:00.000Z" })
    ];

    expect(selectInjectableCards(posts, 10).map((post) => post.id)).toEqual([
      "due-a",
      "due-b",
      "fresh-a",
      "fresh-b"
    ]);
  });

  it("respects the limit", () => {
    const posts = [makePost("a"), makePost("b"), makePost("c")];

    expect(selectInjectableCards(posts, 2).map((post) => post.id)).toEqual(["a", "b"]);
  });

  it("never selects connection notes or cards without a source url", () => {
    const posts = [
      makePost("note", { kind: "connection_note", reviewDueAt: "2026-06-09T00:00:00.000Z" }),
      makePost("unsourced", { sources: [] }),
      makePost("empty-url", { sources: [{ id: "s", title: "S", url: "", type: "article" }] }),
      makePost("ok")
    ];

    expect(selectInjectableCards(posts, 10).map((post) => post.id)).toEqual(["ok"]);
  });
});

describe("toInjectCard", () => {
  it("keeps only the fields the extension needs and derives topicId from the first concept", () => {
    const card = toInjectCard(makePost("post-1", { reviewDueAt: "2026-06-10T00:00:00.000Z" }));

    expect(card).toEqual({
      id: "post-1",
      title: "Title post-1",
      summary: "Summary post-1",
      sourceTitle: "Source post-1",
      sourceUrl: "https://example.com/post-1",
      savedAt: "2026-06-01T00:00:00.000Z",
      topicId: "reinforcement-learning",
      conceptIds: ["Reinforcement Learning", "Reward Model"],
      reviewDueAt: "2026-06-10T00:00:00.000Z"
    });
  });

  it("falls back to the general topic when the card has no concepts", () => {
    const card = toInjectCard(makePost("post-2", { concepts: [] }));

    expect(card.topicId).toBe("general");
    expect(card.conceptIds).toEqual([]);
    expect(card).not.toHaveProperty("reviewDueAt");
  });
});
