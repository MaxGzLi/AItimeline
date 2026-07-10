import { getDayKey } from "../time/calendarKeys.js";
import type { InteractionSignal } from "../types.js";

/** Minimal persisted-record shape needed to preserve event identity. */
export interface InteractionSignalRecordLike {
  id: string;
  signal: InteractionSignal;
  createdAt?: string;
}

export type InteractionSignalInput = InteractionSignal | InteractionSignalRecordLike;

interface NormalizedSignalInput {
  signal: InteractionSignal;
  createdAt: string;
  order: number;
}

interface DailySignalGroup extends NormalizedSignalInput {
  dayKey: string;
}

const interactionBooleanFields = [
  "impression",
  "openedThread",
  "liked",
  "saved",
  "askedQuestion",
  "reviewed",
  "skippedQuickly"
] as const satisfies readonly (keyof InteractionSignal)[];

/**
 * Coalesces cumulative dwell snapshots without changing the persisted shape.
 * Persisted wrappers are first de-duplicated by record id, then non-exposure
 * signals are merged per post and user-calendar day. Pure exposure records stay
 * separate so a later dwell report cannot turn an exposure-only event into an
 * interaction.
 */
export function coalesceInteractionSignals(
  inputs: readonly InteractionSignalInput[],
  timeZone?: string
): InteractionSignal[] {
  const normalizedInputs = dedupeAndNormalizeInputs(inputs);
  const pureExposures: NormalizedSignalInput[] = [];
  const dailyGroups = new Map<string, DailySignalGroup>();

  for (const input of normalizedInputs) {
    if (isPureExposure(input.signal)) {
      pureExposures.push(input);
      continue;
    }

    const dayKey = getDayKey(input.createdAt, timeZone);
    const groupKey = `${input.signal.postId}\u0000${dayKey}`;
    const current = dailyGroups.get(groupKey);

    if (!current) {
      dailyGroups.set(groupKey, {
        ...input,
        dayKey,
        signal: {
          ...input.signal,
          dwellTimeMs: normalizeDwellTimeMs(input.signal.dwellTimeMs),
          createdAt: input.createdAt
        }
      });
      continue;
    }

    const inputTimestamp = normalizeTimestamp(input.createdAt);
    const currentTimestamp = normalizeTimestamp(current.createdAt);
    const latest = inputTimestamp >= currentTimestamp ? input : current;
    const mergedSignal: InteractionSignal = {
      ...latest.signal,
      dwellTimeMs: Math.max(
        normalizeDwellTimeMs(current.signal.dwellTimeMs),
        normalizeDwellTimeMs(input.signal.dwellTimeMs)
      ),
      createdAt: latest.createdAt
    };

    for (const field of interactionBooleanFields) {
      mergedSignal[field] = Boolean(current.signal[field] || input.signal[field]);
    }

    dailyGroups.set(groupKey, {
      ...latest,
      dayKey,
      signal: mergedSignal
    });
  }

  return [
    ...pureExposures.map((input) => ({ ...input.signal, createdAt: input.createdAt })),
    ...Array.from(dailyGroups.values(), (group) => group.signal)
  ].sort(compareSignalsChronologically);
}

function dedupeAndNormalizeInputs(inputs: readonly InteractionSignalInput[]): NormalizedSignalInput[] {
  const rawSignals: NormalizedSignalInput[] = [];
  const recordsById = new Map<string, NormalizedSignalInput>();

  inputs.forEach((input, order) => {
    if (isSignalRecord(input)) {
      recordsById.set(input.id, normalizeInput(input.signal, input.createdAt, order));
      return;
    }

    rawSignals.push(normalizeInput(input, undefined, order));
  });

  return [...rawSignals, ...recordsById.values()].sort((left, right) => left.order - right.order);
}

function normalizeInput(signal: InteractionSignal, recordCreatedAt: string | undefined, order: number): NormalizedSignalInput {
  const createdAt = signal.createdAt || recordCreatedAt;

  if (!createdAt) {
    throw new RangeError("Interaction signal createdAt is required.");
  }

  normalizeTimestamp(createdAt);

  return {
    signal,
    createdAt,
    order
  };
}

function isSignalRecord(input: InteractionSignalInput): input is InteractionSignalRecordLike {
  return "signal" in input;
}

function isPureExposure(signal: InteractionSignal): boolean {
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

function normalizeDwellTimeMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeTimestamp(value: string): number {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`Invalid interaction signal createdAt: ${value}`);
  }

  return timestamp;
}

function compareSignalsChronologically(left: InteractionSignal, right: InteractionSignal): number {
  return (
    normalizeTimestamp(left.createdAt) - normalizeTimestamp(right.createdAt) ||
    left.postId.localeCompare(right.postId) ||
    left.topicId.localeCompare(right.topicId)
  );
}
