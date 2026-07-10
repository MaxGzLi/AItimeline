export interface TimelineTimeZoneEnvironment {
  AITIMELINE_TIMEZONE?: string;
}

export type CalendarDateValue = string | Date;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKeyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const canonicalTimeZones = new Map<string, string>();
const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Resolve the configured timeline timezone once at the application boundary.
 * With no explicit input, safely read AITIMELINE_TIMEZONE from a Node-like
 * runtime when present. Blank or missing values use the host system timezone;
 * invalid non-blank IANA names fail fast instead of silently changing day keys.
 */
export function resolveTimelineTimeZone(
  input?: string | TimelineTimeZoneEnvironment
): string {
  const configuredValue =
    typeof input === "string"
      ? input
      : input
        ? input.AITIMELINE_TIMEZONE
        : getRuntimeTimeZone();
  const requestedTimeZone =
    typeof configuredValue === "string" && configuredValue.trim()
      ? configuredValue.trim()
      : getSystemTimeZone();
  const cached = canonicalTimeZones.get(requestedTimeZone);

  if (cached) {
    return cached;
  }

  try {
    const canonical = new Intl.DateTimeFormat("en-US", {
      timeZone: requestedTimeZone
    }).resolvedOptions().timeZone;

    if (!canonical) {
      throw new RangeError(`Invalid IANA time zone: ${requestedTimeZone}`);
    }

    canonicalTimeZones.set(requestedTimeZone, canonical);
    canonicalTimeZones.set(canonical, canonical);
    return canonical;
  } catch (error) {
    if (error instanceof RangeError && error.message.startsWith("Invalid IANA time zone:")) {
      throw error;
    }

    throw new RangeError(`Invalid IANA time zone: ${requestedTimeZone}`);
  }
}

export function isValidIanaTimeZone(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  try {
    resolveTimelineTimeZone(value);
    return true;
  } catch {
    return false;
  }
}

/** Return a YYYY-MM-DD civil-day key in the requested timezone. */
export function getDayKey(value: CalendarDateValue, timeZone?: string): string {
  const resolvedTimeZone = resolveTimelineTimeZone(timeZone);

  if (typeof value === "string") {
    const trimmed = value.trim();

    // A persisted day key is already a civil date, not a UTC-midnight instant.
    if (dayKeyPattern.test(trimmed)) {
      parseDayKey(trimmed);
      return trimmed;
    }
  }

  const date = normalizeDate(value);
  const formatter = getDayKeyFormatter(resolvedTimeZone);
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new RangeError(`Could not derive a day key in time zone ${resolvedTimeZone}`);
  }

  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Return the instant at local 00:00 for a civil day key. */
export function getStartOfDayInstant(dayKey: string, timeZone?: string): Date {
  const resolvedTimeZone = resolveTimelineTimeZone(timeZone);
  const targetTimestamp = parseDayKey(dayKey).getTime();
  let candidateTimestamp = targetTimestamp;
  const candidateTimestamps = new Set<number>([candidateTimestamp]);

  // Time-zone offsets can change around midnight. Re-evaluate the candidate
  // until the local wall-clock projection stabilizes.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = getTimeZoneOffsetMs(new Date(candidateTimestamp), resolvedTimeZone);
    const nextTimestamp = targetTimestamp - offset;
    candidateTimestamps.add(nextTimestamp);

    if (nextTimestamp === candidateTimestamp) {
      break;
    }

    candidateTimestamp = nextTimestamp;
  }

  const candidatesOnDay = Array.from(candidateTimestamps)
    .map((timestamp) => new Date(timestamp))
    .filter((candidate) => getDayKey(candidate, resolvedTimeZone) === dayKey)
    .sort((left, right) => left.getTime() - right.getTime());

  if (!candidatesOnDay.length) {
    throw new RangeError(`Could not resolve start of day ${dayKey} in time zone ${resolvedTimeZone}`);
  }

  return candidatesOnDay[0];
}

/** Add calendar days without introducing daylight-saving-time drift. */
export function addDaysToDayKey(dayKey: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new RangeError(`Day-key offset must be an integer: ${days}`);
  }

  const date = parseDayKey(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDayKey(date);
}

/** Return left - right in civil calendar days. */
export function differenceInDayKeys(left: string, right: string): number {
  return (parseDayKey(left).getTime() - parseDayKey(right).getTime()) / DAY_MS;
}

/** Return the Monday YYYY-MM-DD key for the ISO week containing value. */
export function getIsoWeekStartKey(value: CalendarDateValue, timeZone?: string): string {
  return getIsoWeekStartForDayKey(getDayKey(value, timeZone));
}

/** Return an ISO week key such as 2026-W28 in the requested timezone. */
export function getIsoWeekKey(value: CalendarDateValue, timeZone?: string): string {
  const weekStart = getIsoWeekStartKey(value, timeZone);
  const thursday = addDaysToDayKey(weekStart, 3);
  const weekYear = parseDayKey(thursday).getUTCFullYear();
  const firstWeekStart = getIsoWeekStartForDayKey(`${String(weekYear).padStart(4, "0")}-01-04`);
  const week = differenceInDayKeys(weekStart, firstWeekStart) / 7 + 1;

  return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function getSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || "UTC";
}

function getRuntimeTimeZone(): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      env?: {
        AITIMELINE_TIMEZONE?: unknown;
      };
    };
  };
  const value = runtime.process?.env?.AITIMELINE_TIMEZONE;
  return typeof value === "string" ? value : undefined;
}

function getDayKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = dayKeyFormatters.get(timeZone);

  if (existing) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  dayKeyFormatters.set(timeZone, formatter);
  return formatter;
}

function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = dateTimeFormatters.get(timeZone);

  if (existing) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  dateTimeFormatters.set(timeZone, formatter);
  return formatter;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getDateTimeFormatter(timeZone).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const projected = new Date(0);
  projected.setUTCHours(
    Number(values.get("hour")),
    Number(values.get("minute")),
    Number(values.get("second")),
    0
  );
  projected.setUTCFullYear(
    Number(values.get("year")),
    Number(values.get("month")) - 1,
    Number(values.get("day"))
  );

  return projected.getTime() - Math.trunc(date.getTime() / 1000) * 1000;
}

function getIsoWeekStartForDayKey(dayKey: string): string {
  const date = parseDayKey(dayKey);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDaysToDayKey(dayKey, -mondayOffset);
}

function normalizeDate(value: CalendarDateValue): Date {
  const date = value instanceof Date ? value : new Date(value.trim());

  if (!Number.isFinite(date.getTime())) {
    throw new RangeError(`Invalid calendar date: ${String(value)}`);
  }

  return date;
}

function parseDayKey(value: string): Date {
  const match = dayKeyPattern.exec(value);

  if (!match) {
    throw new RangeError(`Invalid day key: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    year < 1 ||
    year > 9999 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid day key: ${value}`);
  }

  return date;
}

function formatUtcDayKey(date: Date): string {
  const year = date.getUTCFullYear();

  if (year < 1 || year > 9999) {
    throw new RangeError(`Day key year is out of range: ${year}`);
  }

  return [
    String(year).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}
