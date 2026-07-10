import type { ContentLanguage } from "../harness/contentLanguage.js";
import type { InteractionSignal, KnowledgeCardKind, ReviewState, TopicState } from "../types.js";
import { normalizeConceptKey, normalizeConceptLabel } from "../graph/conceptAliases.js";
import {
  coalesceInteractionSignals,
  type InteractionSignalInput
} from "../interaction/coalesceInteractionSignals.js";
import {
  addDaysToDayKey,
  differenceInDayKeys,
  getDayKey,
  getIsoWeekKey,
  getIsoWeekStartKey,
  getStartOfDayInstant
} from "../time/calendarKeys.js";

export interface WeeklyRecapPostInput {
  id: string;
  kind?: KnowledgeCardKind;
  concepts: string[];
  createdAt: string;
}

export type WeeklyRecapReviewStateInput = Pick<ReviewState, "dueAt" | "intervalDays" | "lastReviewedAt" | "postId">;

export type WeeklyRecapInteractionSignalInput = Pick<
  InteractionSignal,
  | "askedQuestion"
  | "conceptIds"
  | "createdAt"
  | "dwellTimeMs"
  | "impression"
  | "liked"
  | "openedThread"
  | "postId"
  | "reviewed"
  | "saved"
  | "skippedQuickly"
  | "topicId"
>;

export type WeeklyRecapTopicStateInput = TopicState & { updatedAt?: string };

export interface WeeklyRecapInput {
  contentLanguage?: ContentLanguage;
  interactionSignals: InteractionSignalInput[];
  posts: WeeklyRecapPostInput[];
  reviewStates: WeeklyRecapReviewStateInput[];
  topicStates?: WeeklyRecapTopicStateInput[];
  timeZone?: string;
}

type CoalescedWeeklyRecapInput = Omit<WeeklyRecapInput, "interactionSignals"> & {
  interactionSignals: WeeklyRecapInteractionSignalInput[];
};

export interface WeeklyRecapTopConcept {
  concept: string;
  count: number;
  score: number;
}

export interface WeeklyRecapStats {
  newCardCount: number;
  newConceptCount: number;
  reviewCompletedCount: number;
  reviewDueCount: number;
  topConcepts: WeeklyRecapTopConcept[];
}

export interface WeeklyConceptTrendPoint {
  date: string;
  totalConcepts: number;
}

export interface WeeklyConceptTrend {
  points: WeeklyConceptTrendPoint[];
  weekStartIndex: number;
}

export interface WeeklyRecapNarrative {
  en: string[];
  language: ContentLanguage;
  sentences: string[];
  zh: string[];
}

export interface WeeklyRecapRecord {
  id: string;
  weekStart: string;
  weekEnd: string;
  stats: WeeklyRecapStats;
  conceptTrend: WeeklyConceptTrend;
  narrative: WeeklyRecapNarrative;
  seenAt?: string;
  dismissedAt?: string;
}

export function buildWeeklyRecap(input: WeeklyRecapInput, weekStart: string | Date): WeeklyRecapRecord | null {
  const timeZone = input.timeZone;
  const validInteractionSignals = input.interactionSignals.filter((record) =>
    Boolean(tryGetDayKey(getInteractionSignalCreatedAt(record), timeZone))
  );
  const interactionSignals = coalesceInteractionSignals(validInteractionSignals, timeZone);
  const normalizedInput: CoalescedWeeklyRecapInput = { ...input, interactionSignals };
  const normalizedWeekStart = getIsoWeekStartKey(weekStart, timeZone);
  const weekEndExclusive = addDaysToDayKey(normalizedWeekStart, 7);
  const weekEnd = addDaysToDayKey(weekEndExclusive, -1);
  const earliestLibraryDate = getEarliestLibraryDayKey(normalizedInput, timeZone);

  if (!earliestLibraryDate || earliestLibraryDate > normalizedWeekStart) {
    return null;
  }

  const conceptFirstSeen = collectConceptFirstSeen(input.posts, weekEndExclusive, timeZone);
  const newConceptCount = Array.from(conceptFirstSeen.values()).filter((record) =>
    isDayKeyInRange(record.date, normalizedWeekStart, weekEndExclusive)
  ).length;
  const newCardCount = input.posts.filter((post) =>
    isValueInDayKeyRange(post.createdAt, normalizedWeekStart, weekEndExclusive, timeZone)
  ).length;
  const completedReviewPostIds = collectCompletedReviewPostIds(
    input.reviewStates,
    interactionSignals,
    normalizedWeekStart,
    weekEndExclusive,
    timeZone
  );
  const dueReviewPostIds = collectDueReviewPostIds(
    input.reviewStates,
    normalizedWeekStart,
    weekEndExclusive,
    timeZone
  );

  for (const postId of completedReviewPostIds) {
    dueReviewPostIds.add(postId);
  }

  const stats: WeeklyRecapStats = {
    newCardCount,
    newConceptCount,
    reviewCompletedCount: completedReviewPostIds.size,
    reviewDueCount: dueReviewPostIds.size,
    topConcepts: collectTopConcepts(normalizedInput, normalizedWeekStart, weekEndExclusive, timeZone)
  };
  const narrative = buildNarrative(stats, input.contentLanguage ?? "zh");

  return {
    id: buildWeeklyRecapId(normalizedWeekStart, timeZone),
    weekStart: normalizedWeekStart,
    weekEnd,
    stats,
    conceptTrend: buildConceptTrend(conceptFirstSeen, earliestLibraryDate, normalizedWeekStart, weekEnd),
    narrative
  };
}

export function getMostRecentCompletedIsoWeekStart(now: string | Date = new Date(), timeZone?: string): string {
  const currentWeekStart = getIsoWeekStartKey(now, timeZone);

  return addDaysToDayKey(currentWeekStart, -7);
}

export function buildWeeklyRecapId(weekStart: string | Date, timeZone?: string): string {
  return `weekly-recap-${getIsoWeekKey(weekStart, timeZone)}`;
}

export function getIsoWeekStart(value: string | Date, timeZone?: string): Date {
  return getStartOfDayInstant(getIsoWeekStartKey(value, timeZone), timeZone);
}

function collectConceptFirstSeen(
  posts: WeeklyRecapPostInput[],
  weekEndExclusive: string,
  timeZone?: string
): Map<string, { concept: string; date: string }> {
  const firstSeen = new Map<string, { concept: string; date: string }>();

  for (const post of posts) {
    const day = tryGetDayKey(post.createdAt, timeZone);

    if (!day || day >= weekEndExclusive) {
      continue;
    }

    for (const rawConcept of post.concepts ?? []) {
      const concept = normalizeConceptLabel(rawConcept);
      const key = normalizeConceptKey(concept);

      if (!key) {
        continue;
      }

      const existing = firstSeen.get(key);

      if (!existing || day < existing.date) {
        firstSeen.set(key, { concept, date: day });
      }
    }
  }

  return firstSeen;
}

function buildConceptTrend(
  conceptFirstSeen: Map<string, { concept: string; date: string }>,
  earliestLibraryDate: string,
  weekStart: string,
  weekEnd: string
): WeeklyConceptTrend {
  const start = earliestLibraryDate < weekStart ? earliestLibraryDate : weekStart;
  const orderedFirstSeenDates = Array.from(conceptFirstSeen.values())
    .map((record) => record.date)
    .sort();
  const points: WeeklyConceptTrendPoint[] = [];
  let cursor = 0;
  let totalConcepts = 0;

  for (let day = start; day <= weekEnd; day = addDaysToDayKey(day, 1)) {
    while (cursor < orderedFirstSeenDates.length && orderedFirstSeenDates[cursor] <= day) {
      totalConcepts += 1;
      cursor += 1;
    }

    points.push({
      date: day,
      totalConcepts
    });
  }

  return {
    points,
    weekStartIndex: Math.max(0, differenceInDayKeys(weekStart, start))
  };
}

function collectCompletedReviewPostIds(
  reviewStates: WeeklyRecapReviewStateInput[],
  interactionSignals: WeeklyRecapInteractionSignalInput[],
  weekStart: string,
  weekEndExclusive: string,
  timeZone?: string
): Set<string> {
  const postIds = new Set<string>();

  for (const state of reviewStates) {
    if (
      state.lastReviewedAt &&
      isValueInDayKeyRange(state.lastReviewedAt, weekStart, weekEndExclusive, timeZone)
    ) {
      postIds.add(state.postId);
    }
  }

  for (const signal of interactionSignals) {
    if (signal.reviewed && isValueInDayKeyRange(signal.createdAt, weekStart, weekEndExclusive, timeZone)) {
      postIds.add(signal.postId);
    }
  }

  return postIds;
}

function collectDueReviewPostIds(
  reviewStates: WeeklyRecapReviewStateInput[],
  weekStart: string,
  weekEndExclusive: string,
  timeZone?: string
): Set<string> {
  const postIds = new Set<string>();

  for (const state of reviewStates) {
    if (isValueInDayKeyRange(state.dueAt, weekStart, weekEndExclusive, timeZone)) {
      postIds.add(state.postId);
    }
  }

  return postIds;
}

function collectTopConcepts(
  input: CoalescedWeeklyRecapInput,
  weekStart: string,
  weekEndExclusive: string,
  timeZone?: string
): WeeklyRecapTopConcept[] {
  const byConcept = new Map<string, { concept: string; count: number; score: number }>();

  for (const signal of input.interactionSignals) {
    if (!isValueInDayKeyRange(signal.createdAt, weekStart, weekEndExclusive, timeZone)) {
      continue;
    }

    const concepts = signal.conceptIds.length ? signal.conceptIds : [signal.topicId];
    const signalScore = scoreSignal(signal);

    for (const rawConcept of concepts) {
      const concept = normalizeConceptLabel(rawConcept);
      const key = normalizeConceptKey(concept);

      if (!key) {
        continue;
      }

      const current = byConcept.get(key) ?? { concept, count: 0, score: 0 };
      byConcept.set(key, {
        concept: current.concept,
        count: current.count + 1,
        score: current.score + signalScore
      });
    }
  }

  if (!byConcept.size) {
    for (const topicState of input.topicStates ?? []) {
      const concept = normalizeConceptLabel(topicState.topicId);
      const key = normalizeConceptKey(concept);

      if (!key || topicState.interestScore <= 0) {
        continue;
      }

      byConcept.set(key, {
        concept,
        count: 0,
        score: topicState.interestScore
      });
    }
  }

  return Array.from(byConcept.values())
    .map((record) => ({
      ...record,
      score: Math.round(record.score * 100) / 100
    }))
    .sort((left, right) => right.score - left.score || right.count - left.count || left.concept.localeCompare(right.concept))
    .slice(0, 3);
}

function scoreSignal(signal: WeeklyRecapInteractionSignalInput): number {
  const positive =
    (signal.impression ? 0.2 : 0) +
    Math.min(1.2, Math.max(0, signal.dwellTimeMs) / 10000) +
    (signal.openedThread ? 1 : 0) +
    (signal.liked ? 2 : 0) +
    (signal.saved ? 2 : 0) +
    (signal.askedQuestion ? 3 : 0) +
    (signal.reviewed ? 2 : 0);

  return Math.max(0.1, positive - (signal.skippedQuickly ? 0.8 : 0));
}

function buildNarrative(stats: WeeklyRecapStats, language: ContentLanguage): WeeklyRecapNarrative {
  const topConcept = stats.topConcepts[0]?.concept;
  const hasGrowth =
    stats.newCardCount > 0 ||
    stats.newConceptCount > 0 ||
    stats.reviewCompletedCount > 0 ||
    stats.reviewDueCount > 0 ||
    Boolean(topConcept);
  const zh = hasGrowth
    ? [
        `本周新增 ${stats.newCardCount} 张卡片、${stats.newConceptCount} 个概念。`,
        `复习完成 ${stats.reviewCompletedCount}/${stats.reviewDueCount},${
          topConcept ? `最活跃的是 #${topConcept}。` : "互动还在等待下一次积累。"
        }`
      ]
    : [
        "这一周还没有新的知识卡片沉淀。",
        "趋势图保持平稳,下次导入或复习后会自动更新。"
      ];
  const en = hasGrowth
    ? [
        `This week added ${stats.newCardCount} cards and ${stats.newConceptCount} new concepts.`,
        `Reviews completed ${stats.reviewCompletedCount}/${stats.reviewDueCount};${
          topConcept ? ` the most active concept was #${topConcept}.` : " interaction is waiting for the next signal."
        }`
      ]
    : [
        "No new knowledge cards landed this week.",
        "The trend stayed flat and will update after your next import or review."
      ];

  return {
    en,
    language,
    sentences: language === "en" ? en : zh,
    zh
  };
}

function getEarliestLibraryDayKey(input: CoalescedWeeklyRecapInput, timeZone?: string): string | null {
  const dates = [
    ...input.posts.map((post) => tryGetDayKey(post.createdAt, timeZone)),
    ...input.reviewStates.flatMap((state) => [
      tryGetDayKey(state.dueAt, timeZone),
      state.lastReviewedAt ? tryGetDayKey(state.lastReviewedAt, timeZone) : null
    ]),
    ...input.interactionSignals.map((signal) => tryGetDayKey(signal.createdAt, timeZone)),
    ...(input.topicStates ?? []).map((state) =>
      state.updatedAt ? tryGetDayKey(state.updatedAt, timeZone) : null
    )
  ]
    .filter((date): date is string => Boolean(date))
    .sort();

  return dates[0] ?? null;
}

function tryGetDayKey(value: string | Date | undefined, timeZone?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return getDayKey(value, timeZone);
  } catch {
    return null;
  }
}

function getInteractionSignalCreatedAt(input: InteractionSignalInput): string | undefined {
  return "signal" in input ? input.signal.createdAt || input.createdAt : input.createdAt;
}

function isValueInDayKeyRange(
  value: string | Date | undefined,
  start: string,
  endExclusive: string,
  timeZone?: string
): boolean {
  const dayKey = tryGetDayKey(value, timeZone);

  return Boolean(dayKey && isDayKeyInRange(dayKey, start, endExclusive));
}

function isDayKeyInRange(dayKey: string, start: string, endExclusive: string): boolean {
  return dayKey >= start && dayKey < endExclusive;
}
