import type { ReviewState } from "../types.js";

export const persistentReviewIntervals = [1, 3, 7, 14, 30] as const;

export function createInitialReviewState(postId: string, reviewedAt: string | Date): ReviewState {
  const createdAt = normalizeDate(reviewedAt);
  const intervalDays = persistentReviewIntervals[0];

  return {
    postId,
    intervalDays,
    dueAt: addDays(createdAt, intervalDays).toISOString()
  };
}

export function advanceReviewState(state: ReviewState, reviewedAt: string | Date): ReviewState {
  const completedAt = normalizeDate(reviewedAt);
  const intervalDays = getNextReviewIntervalDays(state.intervalDays);

  return {
    postId: state.postId,
    intervalDays,
    dueAt: addDays(completedAt, intervalDays).toISOString(),
    lastReviewedAt: completedAt.toISOString()
  };
}

export function getNextReviewIntervalDays(currentIntervalDays: number): number {
  for (const intervalDays of persistentReviewIntervals) {
    if (intervalDays > currentIntervalDays) {
      return intervalDays;
    }
  }

  return persistentReviewIntervals[persistentReviewIntervals.length - 1];
}

export function getDueReviewStates(states: ReviewState[], now: string | Date): ReviewState[] {
  const nowDate = normalizeDate(now);

  return states
    .filter((state) => normalizeDate(state.dueAt) <= nowDate)
    .sort((left, right) => normalizeDate(left.dueAt).getTime() - normalizeDate(right.dueAt).getTime());
}

// 已确认复习过、还没到下次 dueAt 的卡处于「休眠期」:在下次到期前
// 完全不进推荐流,只被复习节奏唤醒。
export function getRestingReviewStates(states: ReviewState[], now: string | Date): ReviewState[] {
  const nowDate = normalizeDate(now);

  return states.filter((state) => Boolean(state.lastReviewedAt) && normalizeDate(state.dueAt) > nowDate);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
