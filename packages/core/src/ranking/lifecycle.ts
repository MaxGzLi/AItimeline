import type { InteractionSignal, KnowledgeCard } from "../types.js";

export interface TimelineLifecycleFilterInput {
  posts: KnowledgeCard[];
  interactionSignals?: InteractionSignal[];
  dismissedPostIds?: string[];
  now?: string | Date;
  dueReviewPostIds?: string[];
  /** 已复习、未到下次 dueAt 的休眠卡:到期前不进推荐流。 */
  restingReviewPostIds?: string[];
}

export interface TimelineLifecycleStats {
  exposureCount: number;
  readCount: number;
  interactionCount: number;
  lastInteractionAt?: string;
}

const readDwellTimeMs = 12000;
const staleReadDays = 30;

export function filterTimelineLifecycle(input: TimelineLifecycleFilterInput): KnowledgeCard[] {
  const now = normalizeDate(input.now ?? new Date());
  const dismissedPostIds = new Set(input.dismissedPostIds ?? []);
  const dueReviewPostIds = new Set(input.dueReviewPostIds ?? []);
  const restingReviewPostIds = new Set(input.restingReviewPostIds ?? []);
  const statsByPostId = summarizeLifecycleSignals(input.interactionSignals ?? []);

  return input.posts.filter((post) => {
    if (dismissedPostIds.has(post.id) || restingReviewPostIds.has(post.id)) {
      return false;
    }

    if (isUserNotePost(post) || dueReviewPostIds.has(post.id)) {
      return true;
    }

    const stats = statsByPostId.get(post.id);

    if (!stats) {
      return true;
    }

    if (stats.exposureCount >= 5 && stats.interactionCount === 0) {
      return false;
    }

    if (stats.readCount > 0 && stats.lastInteractionAt) {
      const lastInteractionAt = normalizeDate(stats.lastInteractionAt);
      const ageDays = (now.getTime() - lastInteractionAt.getTime()) / (24 * 60 * 60 * 1000);

      if (ageDays > staleReadDays) {
        return false;
      }
    }

    return true;
  });
}

export function summarizeLifecycleSignals(signals: InteractionSignal[]): Map<string, TimelineLifecycleStats> {
  const statsByPostId = new Map<string, TimelineLifecycleStats>();

  for (const signal of signals) {
    const current =
      statsByPostId.get(signal.postId) ??
      ({
        exposureCount: 0,
        readCount: 0,
        interactionCount: 0
      } satisfies TimelineLifecycleStats);

    if (signal.impression) {
      current.exposureCount += 1;
    }

    if (isReadSignal(signal)) {
      current.readCount += 1;
    }

    if (isLifecycleInteractionSignal(signal)) {
      current.interactionCount += 1;

      if (
        !current.lastInteractionAt ||
        normalizeDate(signal.createdAt).getTime() > normalizeDate(current.lastInteractionAt).getTime()
      ) {
        current.lastInteractionAt = signal.createdAt;
      }
    }

    statsByPostId.set(signal.postId, current);
  }

  return statsByPostId;
}

export function countSeenReadSignalsByPostId(signals: InteractionSignal[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const signal of signals) {
    if (isReadSignal(signal)) {
      counts[signal.postId] = (counts[signal.postId] ?? 0) + 1;
    }
  }

  return counts;
}

export function isReadSignal(signal: InteractionSignal): boolean {
  return signal.dwellTimeMs >= readDwellTimeMs || signal.openedThread;
}

export function isLifecycleInteractionSignal(signal: InteractionSignal): boolean {
  return (
    signal.liked ||
    signal.saved ||
    signal.askedQuestion ||
    signal.openedThread ||
    signal.reviewed ||
    isReadSignal(signal)
  );
}

export function isPureExposureSignal(signal: InteractionSignal): boolean {
  return (
    signal.impression === true &&
    signal.dwellTimeMs === 0 &&
    signal.openedThread === false &&
    signal.liked === false &&
    signal.saved === false &&
    signal.askedQuestion === false &&
    signal.reviewed === false &&
    signal.skippedQuickly === false
  );
}

export function isUserNotePost(post: KnowledgeCard): boolean {
  return post.sources.some((source) => source.type === "user_note");
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
