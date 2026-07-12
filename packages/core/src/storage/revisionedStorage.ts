export interface RevisionedStorageAdapter {
  read(): string | null | undefined;
  compareAndSwap(expectedRevision: number, serialized: string): boolean;
  close?(): void;
}

export class PersistenceConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(`Persistence compare-and-swap conflict after retrying (expected revision ${expectedRevision}, actual revision ${actualRevision}).`);
    this.name = "PersistenceConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export interface RevisionedValue {
  version: 2;
  revision: number;
  updatedAt?: string;
}

export interface CommitWithRetryOptions<T extends RevisionedValue> {
  readAndDecode(): T;
  mutate(base: T): T | undefined;
  serialize(value: T): string;
  compareAndSwap(expectedRevision: number, serialized: string): boolean;
  maxAttempts?: number;
}

export interface CommitWithRetryResult<T> {
  value: T;
  committed: boolean;
}

export function commitWithRetry<T extends RevisionedValue>(
  options: CommitWithRetryOptions<T>
): CommitWithRetryResult<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  let expectedRevision = 0;
  let actualRevision = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const base = options.readAndDecode();
    expectedRevision = base.revision;
    actualRevision = base.revision;
    const candidate = options.mutate(structuredClone(base));

    if (!candidate) {
      return { value: base, committed: false };
    }

    candidate.version = 2;
    candidate.revision = base.revision + 1;

    if (options.compareAndSwap(base.revision, options.serialize(candidate))) {
      return { value: candidate, committed: true };
    }

    actualRevision = options.readAndDecode().revision;
  }

  throw new PersistenceConflictError(expectedRevision, actualRevision);
}

export function createMemoryRevisionedStorageAdapter(initialSerialized?: string): RevisionedStorageAdapter & {
  serialized(): string | undefined;
} {
  let value = initialSerialized;

  return {
    read: () => value,
    compareAndSwap(expectedRevision, serialized) {
      if (readSerializedRevision(value) !== expectedRevision) {
        return false;
      }
      value = serialized;
      return true;
    },
    serialized: () => value
  };
}

export function readSerializedRevision(serialized: string | null | undefined): number {
  if (!serialized) {
    return 0;
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return Number.NaN;
    }
    const revision = (parsed as Record<string, unknown>).revision;
    return revision === undefined ? 0 : typeof revision === "number" && Number.isInteger(revision) && revision >= 0 ? revision : Number.NaN;
  } catch {
    return Number.NaN;
  }
}
