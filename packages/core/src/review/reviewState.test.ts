import { describe, expect, it } from "vitest";
import {
  advanceReviewState,
  createInitialReviewState,
  getDueReviewStates,
  getRestingReviewStates
} from "./reviewState.js";

describe("review state scheduling", () => {
  it("advances through 1, 3, 7, 14, and 30 days before capping at 30", () => {
    const states = [createInitialReviewState("post-1", "2026-07-01T00:00:00.000Z")];
    const reviewedAt = [
      "2026-07-02T00:00:00.000Z",
      "2026-07-05T00:00:00.000Z",
      "2026-07-12T00:00:00.000Z",
      "2026-07-26T00:00:00.000Z",
      "2026-08-25T00:00:00.000Z"
    ];

    for (const completedAt of reviewedAt) {
      states.push(advanceReviewState(states[states.length - 1], completedAt));
    }

    expect(
      states.map(({ intervalDays, dueAt }) => ({ intervalDays, dueAt }))
    ).toEqual([
      { intervalDays: 1, dueAt: "2026-07-02T00:00:00.000Z" },
      { intervalDays: 3, dueAt: "2026-07-05T00:00:00.000Z" },
      { intervalDays: 7, dueAt: "2026-07-12T00:00:00.000Z" },
      { intervalDays: 14, dueAt: "2026-07-26T00:00:00.000Z" },
      { intervalDays: 30, dueAt: "2026-08-25T00:00:00.000Z" },
      { intervalDays: 30, dueAt: "2026-09-24T00:00:00.000Z" }
    ]);
  });

  it("treats a reviewed card exactly at dueAt as due rather than resting", () => {
    const states = [
      {
        postId: "due-now",
        intervalDays: 3,
        dueAt: "2026-07-28T08:00:00.000Z",
        lastReviewedAt: "2026-07-25T08:00:00.000Z"
      },
      {
        postId: "resting",
        intervalDays: 7,
        dueAt: "2026-07-28T08:00:00.001Z",
        lastReviewedAt: "2026-07-21T08:00:00.001Z"
      }
    ];
    const now = "2026-07-28T08:00:00.000Z";

    expect(getDueReviewStates(states, now).map((state) => state.postId)).toEqual(["due-now"]);
    expect(getRestingReviewStates(states, now).map((state) => state.postId)).toEqual(["resting"]);
  });
});
