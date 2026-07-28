import { describe, expect, it } from "vitest";
import type { DismissedPostRecord } from "../storage/persistenceStore.js";
import type { InteractionSignal, KnowledgeCard } from "../types.js";
import {
  filterTimelineLifecycle,
  getHardDismissedPostIds,
  isPureExposureSignal,
  isReadSignal,
  isSoftDismissalExpired
} from "./lifecycle.js";

function makeCard(id: string): KnowledgeCard {
  return {
    id,
    title: `Card ${id}`,
    summary: `Summary for ${id}.`,
    keyTakeaway: `Takeaway for ${id}.`,
    concepts: ["Lifecycle"],
    sources: [
      {
        id: `source-${id}`,
        title: `Source ${id}`,
        url: `https://example.com/${id}`,
        type: "article"
      }
    ],
    recommendedBecause: "Lifecycle fixture.",
    trustState: "emerging",
    createdAt: "2026-06-01T00:00:00.000Z",
    estimatedReadMinutes: 2
  };
}

const pureExposureSignal = {
  postId: "post-1",
  topicId: "lifecycle",
  conceptIds: ["Lifecycle"],
  impression: true,
  dwellTimeMs: 0,
  openedThread: false,
  liked: false,
  saved: false,
  askedQuestion: false,
  reviewed: false,
  skippedQuickly: false,
  createdAt: "2026-07-28T00:00:00.000Z"
} satisfies InteractionSignal;

describe("timeline dismissal lifecycle", () => {
  it("keeps a soft dismissal hidden before day 30 and returns it exactly at expiry", () => {
    const record = {
      postId: "soft-card",
      dismissedAt: "2026-06-01T00:00:00.000Z",
      mode: "soft"
    } satisfies DismissedPostRecord;
    const card = makeCard(record.postId);
    const justBeforeExpiry = "2026-06-30T23:59:59.999Z";
    const atExpiry = "2026-07-01T00:00:00.000Z";

    expect(isSoftDismissalExpired(record, justBeforeExpiry)).toBe(false);
    expect(filterTimelineLifecycle({ posts: [card], dismissedPosts: [record], now: justBeforeExpiry })).toEqual([]);
    expect(isSoftDismissalExpired(record, atExpiry)).toBe(true);
    expect(filterTimelineLifecycle({ posts: [card], dismissedPosts: [record], now: atExpiry })).toEqual([card]);
  });

  it("keeps hard dismissals active indefinitely and excludes soft records from the hard set", () => {
    const records = [
      {
        postId: "hard-card",
        dismissedAt: "2026-01-01T00:00:00.000Z",
        mode: "hard"
      },
      {
        postId: "soft-card",
        dismissedAt: "2026-01-01T00:00:00.000Z",
        mode: "soft"
      }
    ] satisfies DismissedPostRecord[];

    expect(getHardDismissedPostIds(records)).toEqual(new Set(["hard-card"]));
    expect(
      filterTimelineLifecycle({
        posts: [makeCard("hard-card")],
        dismissedPosts: records,
        now: "2099-01-01T00:00:00.000Z"
      })
    ).toEqual([]);
  });
});

describe("timeline signal shapes", () => {
  it("recognizes only a zero-dwell impression with no actions as pure exposure", () => {
    expect(isPureExposureSignal(pureExposureSignal)).toBe(true);
    expect(
      [
        { ...pureExposureSignal, impression: false },
        { ...pureExposureSignal, dwellTimeMs: 1 },
        { ...pureExposureSignal, openedThread: true },
        { ...pureExposureSignal, liked: true },
        { ...pureExposureSignal, saved: true },
        { ...pureExposureSignal, askedQuestion: true },
        { ...pureExposureSignal, reviewed: true },
        { ...pureExposureSignal, skippedQuickly: true }
      ].map(isPureExposureSignal)
    ).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("counts the 12-second threshold and opened threads as reads", () => {
    expect(isReadSignal({ ...pureExposureSignal, dwellTimeMs: 11_999 })).toBe(false);
    expect(isReadSignal({ ...pureExposureSignal, liked: true, saved: true })).toBe(false);
    expect(isReadSignal({ ...pureExposureSignal, dwellTimeMs: 12_000 })).toBe(true);
    expect(isReadSignal({ ...pureExposureSignal, openedThread: true })).toBe(true);
  });
});
