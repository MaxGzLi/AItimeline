import type { ContentLanguage } from "../harness/contentLanguage.js";
import type { InteractionSignal, KnowledgeCardKind, ReviewState, TopicState } from "../types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

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
  interactionSignals: WeeklyRecapInteractionSignalInput[];
  posts: WeeklyRecapPostInput[];
  reviewStates: WeeklyRecapReviewStateInput[];
  topicStates?: WeeklyRecapTopicStateInput[];
}

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
  const normalizedWeekStart = getIsoWeekStart(weekStart);
  const weekEndExclusive = addUtcDays(normalizedWeekStart, 7);
  const weekEnd = addUtcDays(weekEndExclusive, -1);
  const earliestLibraryDate = getEarliestLibraryDate(input);

  if (!earliestLibraryDate || earliestLibraryDate.getTime() > normalizedWeekStart.getTime()) {
    return null;
  }

  const conceptFirstSeen = collectConceptFirstSeen(input.posts, weekEndExclusive);
  const newConceptCount = Array.from(conceptFirstSeen.values()).filter((record) =>
    isInRange(record.date, normalizedWeekStart, weekEndExclusive)
  ).length;
  const newCardCount = input.posts.filter((post) =>
    isInRange(parseDate(post.createdAt), normalizedWeekStart, weekEndExclusive)
  ).length;
  const completedReviewPostIds = collectCompletedReviewPostIds(
    input.reviewStates,
    input.interactionSignals,
    normalizedWeekStart,
    weekEndExclusive
  );
  const dueReviewPostIds = collectDueReviewPostIds(input.reviewStates, normalizedWeekStart, weekEndExclusive);

  for (const postId of completedReviewPostIds) {
    dueReviewPostIds.add(postId);
  }

  const stats: WeeklyRecapStats = {
    newCardCount,
    newConceptCount,
    reviewCompletedCount: completedReviewPostIds.size,
    reviewDueCount: dueReviewPostIds.size,
    topConcepts: collectTopConcepts(input, normalizedWeekStart, weekEndExclusive)
  };
  const narrative = buildNarrative(stats, input.contentLanguage ?? "zh");

  return {
    id: buildWeeklyRecapId(normalizedWeekStart),
    weekStart: formatDate(normalizedWeekStart),
    weekEnd: formatDate(weekEnd),
    stats,
    conceptTrend: buildConceptTrend(conceptFirstSeen, earliestLibraryDate, normalizedWeekStart, weekEnd),
    narrative
  };
}

export function getMostRecentCompletedIsoWeekStart(now: string | Date = new Date()): string {
  const currentWeekStart = getIsoWeekStart(now);

  return formatDate(addUtcDays(currentWeekStart, -7));
}

export function buildWeeklyRecapId(weekStart: string | Date): string {
  const { week, year } = getIsoWeekYearAndNumber(getIsoWeekStart(weekStart));

  return `weekly-recap-${year}-W${String(week).padStart(2, "0")}`;
}

export function getIsoWeekStart(value: string | Date): Date {
  const date = toUtcDay(value);
  const mondayOffset = (date.getUTCDay() + 6) % 7;

  return addUtcDays(date, -mondayOffset);
}

function collectConceptFirstSeen(
  posts: WeeklyRecapPostInput[],
  weekEndExclusive: Date
): Map<string, { concept: string; date: Date }> {
  const firstSeen = new Map<string, { concept: string; date: Date }>();

  for (const post of posts) {
    const createdAt = parseDate(post.createdAt);

    if (!createdAt || createdAt.getTime() >= weekEndExclusive.getTime()) {
      continue;
    }

    const day = toUtcDay(createdAt);

    for (const rawConcept of post.concepts ?? []) {
      const concept = normalizeConceptLabel(rawConcept);
      const key = normalizeConceptKey(concept);

      if (!key) {
        continue;
      }

      const existing = firstSeen.get(key);

      if (!existing || day.getTime() < existing.date.getTime()) {
        firstSeen.set(key, { concept, date: day });
      }
    }
  }

  return firstSeen;
}

function buildConceptTrend(
  conceptFirstSeen: Map<string, { concept: string; date: Date }>,
  earliestLibraryDate: Date,
  weekStart: Date,
  weekEnd: Date
): WeeklyConceptTrend {
  const start = earliestLibraryDate.getTime() < weekStart.getTime() ? earliestLibraryDate : weekStart;
  const orderedFirstSeenDates = Array.from(conceptFirstSeen.values())
    .map((record) => record.date.getTime())
    .sort((left, right) => left - right);
  const points: WeeklyConceptTrendPoint[] = [];
  let cursor = 0;
  let totalConcepts = 0;

  for (let day = start; day.getTime() <= weekEnd.getTime(); day = addUtcDays(day, 1)) {
    while (cursor < orderedFirstSeenDates.length && orderedFirstSeenDates[cursor] <= day.getTime()) {
      totalConcepts += 1;
      cursor += 1;
    }

    points.push({
      date: formatDate(day),
      totalConcepts
    });
  }

  return {
    points,
    weekStartIndex: Math.max(0, Math.round((weekStart.getTime() - start.getTime()) / DAY_MS))
  };
}

function collectCompletedReviewPostIds(
  reviewStates: WeeklyRecapReviewStateInput[],
  interactionSignals: WeeklyRecapInteractionSignalInput[],
  weekStart: Date,
  weekEndExclusive: Date
): Set<string> {
  const postIds = new Set<string>();

  for (const state of reviewStates) {
    if (state.lastReviewedAt && isInRange(parseDate(state.lastReviewedAt), weekStart, weekEndExclusive)) {
      postIds.add(state.postId);
    }
  }

  for (const signal of interactionSignals) {
    if (signal.reviewed && isInRange(parseDate(signal.createdAt), weekStart, weekEndExclusive)) {
      postIds.add(signal.postId);
    }
  }

  return postIds;
}

function collectDueReviewPostIds(
  reviewStates: WeeklyRecapReviewStateInput[],
  weekStart: Date,
  weekEndExclusive: Date
): Set<string> {
  const postIds = new Set<string>();

  for (const state of reviewStates) {
    if (isInRange(parseDate(state.dueAt), weekStart, weekEndExclusive)) {
      postIds.add(state.postId);
    }
  }

  return postIds;
}

function collectTopConcepts(
  input: WeeklyRecapInput,
  weekStart: Date,
  weekEndExclusive: Date
): WeeklyRecapTopConcept[] {
  const byConcept = new Map<string, { concept: string; count: number; score: number }>();

  for (const signal of input.interactionSignals) {
    if (!isInRange(parseDate(signal.createdAt), weekStart, weekEndExclusive)) {
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

function getEarliestLibraryDate(input: WeeklyRecapInput): Date | null {
  const dates = [
    ...input.posts.map((post) => parseDate(post.createdAt)),
    ...input.reviewStates.flatMap((state) => [parseDate(state.dueAt), state.lastReviewedAt ? parseDate(state.lastReviewedAt) : null]),
    ...input.interactionSignals.map((signal) => parseDate(signal.createdAt)),
    ...(input.topicStates ?? []).map((state) => (state.updatedAt ? parseDate(state.updatedAt) : null))
  ]
    .filter((date): date is Date => Boolean(date))
    .map(toUtcDay)
    .sort((left, right) => left.getTime() - right.getTime());

  return dates[0] ?? null;
}

function getIsoWeekYearAndNumber(weekStart: Date): { week: number; year: number } {
  const thursday = addUtcDays(weekStart, 3);
  const year = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstWeekStart = getIsoWeekStart(firstThursday);
  const week = Math.floor((weekStart.getTime() - firstWeekStart.getTime()) / (7 * DAY_MS)) + 1;

  return { week, year };
}

function isInRange(date: Date | null, start: Date, endExclusive: Date): boolean {
  return Boolean(date && date.getTime() >= start.getTime() && date.getTime() < endExclusive.getTime());
}

function parseDate(value: string | Date | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

function toUtcDay(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeConceptLabel(value: string): string {
  return value.trim();
}

function normalizeConceptKey(value: string): string {
  return normalizeConceptLabel(value).toLowerCase();
}
