export type PersistenceSnapshotKind = "aitimeline" | "curation-jobs" | "agent-chat";

export interface PersistenceLoadIssue {
  snapshotKind: PersistenceSnapshotKind;
  collection: string;
  index: number;
  recordId?: string;
  jsonPath: string;
  message: string;
  severity?: "error" | "warning";
}

export class PersistenceDecodeError extends Error {
  readonly jsonPath: string;

  constructor(jsonPath: string, message: string) {
    super(`${jsonPath}: ${message}`);
    this.name = "PersistenceDecodeError";
    this.jsonPath = jsonPath;
  }
}

export function decodeJson(serialized: string, snapshotKind: PersistenceSnapshotKind): unknown {
  try {
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new PersistenceDecodeError("$", `${snapshotKind} snapshot is not valid JSON: ${error instanceof Error ? error.message : "parse failed"}`);
  }
}

export function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PersistenceDecodeError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new PersistenceDecodeError(path, "expected an array");
  }
  return value;
}

export function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new PersistenceDecodeError(path, "expected a string");
  }
  return value;
}

export function expectNonEmptyString(value: unknown, path: string): string {
  const decoded = expectString(value, path);
  if (!decoded.trim()) {
    throw new PersistenceDecodeError(path, "expected a non-empty string");
  }
  return decoded;
}

export function expectFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PersistenceDecodeError(path, "expected a finite number");
  }
  return value;
}

export function expectNonNegativeInteger(value: unknown, path: string): number {
  const decoded = expectFiniteNumber(value, path);
  if (!Number.isInteger(decoded) || decoded < 0) {
    throw new PersistenceDecodeError(path, "expected a non-negative integer");
  }
  return decoded;
}

export function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new PersistenceDecodeError(path, "expected a boolean");
  }
  return value;
}

export function expectEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new PersistenceDecodeError(path, `expected one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function expectIsoDate(value: unknown, path: string): string {
  const decoded = expectString(value, path);
  const date = new Date(decoded);
  if (!decoded || !Number.isFinite(date.getTime()) || date.toISOString() !== decoded) {
    throw new PersistenceDecodeError(path, "expected a canonical ISO date");
  }
  return decoded;
}

export function optional<T>(value: unknown, path: string, decode: (value: unknown, path: string) => T): T | undefined {
  return value === undefined ? undefined : decode(value, path);
}

export function decodeRecordCollection<T>(input: {
  snapshotKind: PersistenceSnapshotKind;
  collection: string;
  value: unknown;
  path?: string;
  issues: PersistenceLoadIssue[];
  decodeRecord: (value: unknown, path: string) => T;
}): T[] {
  const path = input.path ?? `$.${input.collection}`;
  const records = expectArray(input.value, path);
  const decoded: T[] = [];

  records.forEach((record, index) => {
    const recordPath = `${path}[${index}]`;
    try {
      decoded.push(input.decodeRecord(record, recordPath));
    } catch (error) {
      if (!(error instanceof PersistenceDecodeError)) {
        throw error;
      }
      const owner = typeof record === "object" && record !== null && !Array.isArray(record) ? record as Record<string, unknown> : undefined;
      const recordId = typeof owner?.id === "string"
        ? owner.id
        : typeof owner?.postId === "string"
          ? owner.postId
          : typeof owner?.userId === "string"
            ? owner.userId
            : undefined;
      input.issues.push({
        snapshotKind: input.snapshotKind,
        collection: input.collection,
        index,
        recordId,
        jsonPath: error.jsonPath,
        message: error.message,
        severity: "error"
      });
    }
  });

  return decoded;
}

export function deepClone<T>(value: T): T {
  return structuredClone(value);
}
