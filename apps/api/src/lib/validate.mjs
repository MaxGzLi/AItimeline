// @ts-check

import {
  HttpError,
  isSupportedSourceCandidateType,
  normalizeIsoDate,
  parseHttpUrl,
  requireString
} from "../domains/shared.mjs";

export function requireObjectBody(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be an object.");
  }

  return value;
}


export function requireIsoDate(value, fieldName) {
  if (typeof value !== "string" || !isValidIsoDateString(value.trim())) {
    throw new HttpError(400, `${fieldName} must be a valid ISO date.`);
  }

  try {
    return normalizeIsoDate(value.trim());
  } catch {
    throw new HttpError(400, `${fieldName} must be a valid ISO date.`);
  }
}

function isValidIsoDateString(value) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/
  );

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(new Date(value).getTime())
  );
}

export function requireInteractionSignal(signal, snapshot) {
  if (typeof signal !== "object" || signal === null || Array.isArray(signal)) {
    throw new HttpError(400, "signal is required.");
  }

  requireString(signal.postId, "signal.postId");
  requireString(signal.topicId, "signal.topicId");

  if (
    !Array.isArray(signal.conceptIds) ||
    signal.conceptIds.some((conceptId) => typeof conceptId !== "string" || !conceptId.trim())
  ) {
    throw new HttpError(400, "signal.conceptIds must be an array of non-empty strings.");
  }

  const booleanFields = [
    "impression",
    "openedThread",
    "liked",
    "saved",
    "askedQuestion",
    "reviewed",
    "skippedQuickly"
  ];

  for (const field of booleanFields) {
    if (typeof signal[field] !== "boolean") {
      throw new HttpError(400, `signal.${field} must be a boolean.`);
    }
  }

  const dwellTimeMs =
    signal.dwellTimeMs === undefined && signal.dwellSeconds !== undefined
      ? signal.dwellSeconds * 1000
      : signal.dwellTimeMs;

  if (typeof dwellTimeMs !== "number" || !Number.isFinite(dwellTimeMs) || dwellTimeMs < 0) {
    throw new HttpError(400, "signal.dwellTimeMs must be a finite non-negative number.");
  }

  if (
    signal.dwellSeconds !== undefined &&
    (typeof signal.dwellSeconds !== "number" || !Number.isFinite(signal.dwellSeconds) || signal.dwellSeconds < 0)
  ) {
    throw new HttpError(400, "signal.dwellSeconds must be a finite non-negative number.");
  }

  const postId = signal.postId.trim();

  if (!snapshot.posts.some((post) => post.id === postId)) {
    throw new HttpError(400, "signal.postId does not reference a known post.");
  }

  return {
    ...signal,
    postId,
    topicId: signal.topicId.trim(),
    conceptIds: signal.conceptIds.map((conceptId) => conceptId.trim()),
    dwellTimeMs,
    createdAt: requireIsoDate(signal.createdAt, "signal.createdAt")
  };
}

export function requireTopicState(topicState, signalTopicId) {
  if (typeof topicState !== "object" || topicState === null || Array.isArray(topicState)) {
    throw new HttpError(400, "topicState must be an object.");
  }

  requireString(topicState.topicId, "topicState.topicId");

  if (topicState.topicId.trim() !== signalTopicId) {
    throw new HttpError(400, "topicState.topicId must match signal.topicId.");
  }

  for (const field of ["interestScore", "fatigueScore", "comprehensionScore"]) {
    if (typeof topicState[field] !== "number" || !Number.isFinite(topicState[field])) {
      throw new HttpError(400, `topicState.${field} must be a finite number.`);
    }
  }

  return {
    ...topicState,
    topicId: topicState.topicId.trim(),
    ...(topicState.cooldownUntil
      ? { cooldownUntil: requireIsoDate(topicState.cooldownUntil, "topicState.cooldownUntil") }
      : {})
  };
}

export function requireSupportedSourceCandidates(candidates) {
  for (const candidate of candidates) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof candidate.source !== "object" ||
      candidate.source === null ||
      Array.isArray(candidate.source) ||
      !isSupportedSourceCandidateType(candidate.source.type)
    ) {
      throw new HttpError(
        400,
        "Source candidate type is not supported. Supported types: article, blog, news, youtube."
      );
    }

    requireString(candidate.id, "sourceCandidates[].id");
    requireString(candidate.source.id, "sourceCandidates[].source.id");
    requireString(candidate.source.title, "sourceCandidates[].source.title");
    requireString(candidate.source.url, "sourceCandidates[].source.url");
    parseHttpUrl(candidate.source.url);

    if (
      !Array.isArray(candidate.conceptIds) ||
      candidate.conceptIds.some((conceptId) => typeof conceptId !== "string" || !conceptId.trim())
    ) {
      throw new HttpError(400, "sourceCandidates[].conceptIds must be an array of non-empty strings.");
    }

    for (const field of ["relevanceScore", "noveltyScore", "qualityScore"]) {
      if (
        typeof candidate[field] !== "number" ||
        !Number.isFinite(candidate[field]) ||
        candidate[field] < 0 ||
        candidate[field] > 1
      ) {
        throw new HttpError(400, `sourceCandidates[].${field} must be a number between 0 and 1.`);
      }
    }
  }
}

export function parseReviewGrade(value) {
  if (value === undefined) {
    return "remembered";
  }

  if (value !== "remembered" && value !== "fuzzy" && value !== "forgot") {
    throw new HttpError(400, "grade must be remembered, fuzzy, or forgot.");
  }

  return value;
}

export function parseOptionalIdempotencyKey(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

export function parseOptionalUserId(value) {
  if (value === undefined) {
    return "local-user";
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "userId must be a non-empty string.");
  }

  return value.trim();
}

export function parseOptionalDate(value) {
  if (typeof value !== "string") {
    return new Date();
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : new Date();
}
