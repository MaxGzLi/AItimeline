import { describe, expect, it } from "vitest";
import core from "../lib/injectCore.js";

const {
  canonicalStatusPath,
  planInjections,
  createDwellState,
  dwellEnter,
  dwellExit,
  currentDwellMs,
  dwellReportDue,
  buildInjectSignal,
  formatSavedAgo
} = core;

function anchorList(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => `/user${index + offset}/status/${index + offset}`);
}

describe("canonicalStatusPath", () => {
  it("normalizes tweet permalinks from paths and full urls", () => {
    expect(canonicalStatusPath("/alice/status/123")).toBe("/alice/status/123");
    expect(canonicalStatusPath("https://x.com/alice/status/123")).toBe("/alice/status/123");
  });

  it("collapses photo/analytics sub-paths onto the same anchor", () => {
    expect(canonicalStatusPath("/alice/status/123/photo/1")).toBe("/alice/status/123");
    expect(canonicalStatusPath("/alice/status/123/analytics")).toBe("/alice/status/123");
  });

  it("rejects non-tweet links", () => {
    expect(canonicalStatusPath("/alice")).toBeNull();
    expect(canonicalStatusPath("/i/lists/1")).toBeNull();
    expect(canonicalStatusPath("")).toBeNull();
    expect(canonicalStatusPath(undefined)).toBeNull();
  });
});

describe("planInjections", () => {
  it("places the first card no earlier than firstIndex", () => {
    const next = planInjections({
      anchors: anchorList(17),
      assignments: {},
      cardIds: ["card-a"],
      spacing: 8,
      sessionMax: 3,
      firstIndex: 3
    });

    expect(next).toEqual({ "/user3/status/3": "card-a" });
  });

  it("keeps at least `spacing` tweets between injected cards in the visible window", () => {
    const next = planInjections({
      anchors: anchorList(17),
      assignments: {},
      cardIds: ["card-a", "card-b", "card-c"],
      spacing: 8,
      sessionMax: 3,
      firstIndex: 3
    });

    const positions = anchorList(17)
      .map((anchor, index) => (next[anchor] ? index : -1))
      .filter((index) => index >= 0);

    expect(positions).toEqual([3, 11]);
    expect(Object.values(next)).toEqual(["card-a", "card-b"]);
  });

  it("is stable: existing assignments survive a re-scan and keep their card", () => {
    const first = planInjections({
      anchors: anchorList(17),
      assignments: {},
      cardIds: ["card-a", "card-b"],
      spacing: 8,
      sessionMax: 3,
      firstIndex: 3
    });
    const second = planInjections({
      anchors: anchorList(17),
      assignments: first,
      cardIds: ["card-a", "card-b"],
      spacing: 8,
      sessionMax: 3,
      firstIndex: 3
    });

    expect(second).toEqual(first);
  });

  it("assigns the remaining card once the window scrolls to fresh anchors", () => {
    const first = planInjections({
      anchors: anchorList(17),
      assignments: {},
      cardIds: ["card-a", "card-b", "card-c"],
      spacing: 8,
      sessionMax: 3,
      firstIndex: 3
    });
    // 滚动后原来的锚点全部回收,窗口里是另一批推文。
    const second = planInjections({
      anchors: anchorList(17, 100),
      assignments: first,
      cardIds: ["card-a", "card-b", "card-c"],
      spacing: 8,
      sessionMax: 3,
      firstIndex: 3
    });

    expect(Object.keys(second)).toHaveLength(3);
    expect(new Set(Object.values(second))).toEqual(new Set(["card-a", "card-b", "card-c"]));
  });

  it("never exceeds sessionMax across scans and never reuses a card", () => {
    let assignments = {};

    for (let round = 0; round < 5; round += 1) {
      assignments = planInjections({
        anchors: anchorList(17, round * 50),
        assignments,
        cardIds: ["card-a", "card-b", "card-c", "card-d", "card-e"],
        spacing: 8,
        sessionMax: 3,
        firstIndex: 3
      });
    }

    const assigned = Object.values(assignments);

    expect(assigned.length).toBeLessThanOrEqual(3);
    expect(new Set(assigned).size).toBe(assigned.length);
  });
});

describe("dwell accumulation", () => {
  it("accumulates visible spans and caps at 120s", () => {
    let state = createDwellState();

    state = dwellEnter(state, 1000);
    state = dwellExit(state, 3000);
    expect(state.accumulatedMs).toBe(2000);

    state = dwellEnter(state, 10000);
    expect(currentDwellMs(state, 12000)).toBe(4000);

    state = dwellExit(state, 10000 + 200000);
    expect(state.accumulatedMs).toBe(120000);
  });

  it("exit reports need >=1200ms total and 800ms past the last report", () => {
    let state = createDwellState();

    state = dwellEnter(state, 0);
    expect(dwellReportDue(state, 1000, "exit")).toBeNull();
    expect(dwellReportDue(state, 1500, "exit")).toBe(1500);

    state = { ...dwellExit(state, 1500), reportedMs: 1500 };
    state = dwellEnter(state, 2000);
    expect(dwellReportDue(state, 2500, "exit")).toBeNull();
    expect(dwellReportDue(state, 3000, "exit")).toBe(2500);
  });

  it("tick reports need >=9000ms total and 3500ms past the last report", () => {
    let state = createDwellState();

    state = dwellEnter(state, 0);
    expect(dwellReportDue(state, 8000, "tick")).toBeNull();
    expect(dwellReportDue(state, 9500, "tick")).toBe(9500);

    state = { ...state, reportedMs: 9500 };
    expect(dwellReportDue(state, 12000, "tick")).toBeNull();
    expect(dwellReportDue(state, 13500, "tick")).toBe(13500);
  });
});

describe("buildInjectSignal", () => {
  const card = { id: "post-1", topicId: "rlhf", conceptIds: ["RLHF"] };

  it("builds impressions as pure exposure (dwell must stay 0)", () => {
    const signal = buildInjectSignal(card, "impression", { createdAt: "2026-08-04T00:00:00.000Z" });

    expect(signal).toEqual({
      postId: "post-1",
      topicId: "rlhf",
      conceptIds: ["RLHF"],
      impression: true,
      dwellTimeMs: 0,
      openedThread: false,
      liked: false,
      saved: false,
      askedQuestion: false,
      reviewed: false,
      skippedQuickly: false,
      createdAt: "2026-08-04T00:00:00.000Z"
    });
  });

  it("builds dwell signals with the cumulative dwell value", () => {
    const signal = buildInjectSignal(card, "dwell", { dwellTimeMs: 4200, createdAt: "2026-08-04T00:00:00.000Z" });

    expect(signal.dwellTimeMs).toBe(4200);
    expect(signal.openedThread).toBe(false);
    expect(signal.impression).toBe(true);
  });

  it("builds open signals with openedThread and at least the web app's 9s open dwell", () => {
    const short = buildInjectSignal(card, "open", { dwellTimeMs: 1200, createdAt: "2026-08-04T00:00:00.000Z" });
    const long = buildInjectSignal(card, "open", { dwellTimeMs: 15000, createdAt: "2026-08-04T00:00:00.000Z" });

    expect(short.openedThread).toBe(true);
    expect(short.dwellTimeMs).toBe(9000);
    expect(long.dwellTimeMs).toBe(15000);
  });

  it("rejects unknown kinds", () => {
    expect(() => buildInjectSignal(card, "like", { createdAt: "2026-08-04T00:00:00.000Z" })).toThrow(
      /Unknown inject signal kind/
    );
  });
});

describe("formatSavedAgo", () => {
  it("labels today, yesterday and N days ago", () => {
    const now = "2026-08-04T12:00:00.000Z";

    expect(formatSavedAgo("2026-08-04T09:00:00.000Z", now)).toBe("今天存的");
    expect(formatSavedAgo("2026-08-03T09:00:00.000Z", now)).toBe("昨天存的");
    expect(formatSavedAgo("2026-08-01T09:00:00.000Z", now)).toBe("3 天前存的");
  });

  it("falls back on invalid dates", () => {
    expect(formatSavedAgo("not-a-date", "2026-08-04T12:00:00.000Z")).toBe("之前存的");
  });
});
