import type { SourceType, UserMemory } from "../types.js";

export type UserMemoryListField =
  | "profile.interests"
  | "profile.goals"
  | "knowledge.knownConcepts"
  | "knowledge.weakConcepts"
  | "knowledge.savedConcepts"
  | "interaction.recentCardIds"
  | "interaction.recentQuestions"
  | "agent.topicAgents"
  | "agent.preferredSourceTypes";

export type UserMemoryScalarField = "profile.explanationStyle";

export type UserMemoryEditKind =
  | "add"
  | "remove"
  | "replace"
  | "clear"
  | "set"
  | "auto_mastery_promotion";

export type UserMemoryEditEventKind = UserMemoryEditKind | "auto_mastery_blacklist";

export interface UserMemoryEdit {
  id?: string;
  kind: UserMemoryEditKind;
  field: UserMemoryListField | UserMemoryScalarField;
  value?: string;
  values?: string[];
  createdAt?: string;
  reason?: string;
}

export interface UserMemoryEditEvent {
  id: string;
  kind: UserMemoryEditEventKind;
  field: UserMemoryEdit["field"];
  previousValue?: string | string[];
  nextValue?: string | string[];
  createdAt: string;
  reason?: string;
}

export interface UserMemoryEditResult {
  memory: UserMemory;
  events: UserMemoryEditEvent[];
}

const sourceTypes = ["youtube", "article", "paper", "blog", "news", "repo", "pdf", "audio", "manual", "user_note"] as const;
const explanationStyles = ["brief", "example-first", "deep"] as const;

export function createEmptyUserMemory(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    profile: {
      interests: [],
      goals: [],
      ...overrides.profile
    },
    knowledge: {
      knownConcepts: [],
      weakConcepts: [],
      savedConcepts: [],
      ...overrides.knowledge
    },
    interaction: {
      recentCardIds: [],
      recentQuestions: [],
      ...overrides.interaction
    },
    agent: {
      topicAgents: [],
      preferredSourceTypes: [],
      ...overrides.agent
    }
  };
}

export function applyUserMemoryEdits(
  memory: UserMemory,
  edits: UserMemoryEdit[],
  now: string | Date = new Date()
): UserMemoryEditResult {
  let nextMemory = cloneMemory(memory);
  const events: UserMemoryEditEvent[] = [];
  const createdAt = normalizeDate(now).toISOString();

  for (const edit of edits) {
    const result = applyUserMemoryEdit(nextMemory, {
      ...edit,
      createdAt: edit.createdAt ?? createdAt
    });

    nextMemory = result.memory;
    events.push(result.event);
  }

  return {
    memory: nextMemory,
    events
  };
}

export function applyUserMemoryEdit(memory: UserMemory, edit: UserMemoryEdit): { memory: UserMemory; event: UserMemoryEditEvent } {
  const nextMemory = cloneMemory(memory);
  const createdAt = edit.createdAt ?? new Date().toISOString();

  if (edit.field === "profile.explanationStyle") {
    const previousValue = nextMemory.profile.explanationStyle;
    const nextValue = edit.kind === "clear" ? undefined : parseExplanationStyle(edit.value);

    if (nextValue) {
      nextMemory.profile.explanationStyle = nextValue;
    } else {
      delete nextMemory.profile.explanationStyle;
    }

    return {
      memory: nextMemory,
      event: createMemoryEditEvent(edit, createdAt, previousValue, nextValue)
    };
  }

  const previousValue = [...readList(nextMemory, edit.field)];
  const nextValue = applyListEdit(previousValue, edit);

  writeList(nextMemory, edit.field, nextValue);
  reconcileKnowledgeConcepts(nextMemory, edit.field, nextValue);

  return {
    memory: nextMemory,
    event: createMemoryEditEvent(edit, createdAt, previousValue, readList(nextMemory, edit.field))
  };
}

function applyListEdit(previousValue: string[], edit: UserMemoryEdit): string[] {
  if (edit.kind === "clear") {
    return [];
  }

  if (edit.kind === "replace") {
    return normalizeValues(edit.values ?? [], edit.field);
  }

  const value = normalizeValue(edit.value, edit.field);

  if (!value) {
    throw new Error(`Memory edit for ${edit.field} requires a value.`);
  }

  if (edit.kind === "add" || edit.kind === "auto_mastery_promotion") {
    return dedupe([...previousValue, value]);
  }

  if (edit.kind === "remove") {
    return previousValue.filter((item) => item !== value);
  }

  throw new Error(`Memory edit kind ${edit.kind} is not supported for list fields.`);
}

function reconcileKnowledgeConcepts(memory: UserMemory, field: UserMemoryListField, value: string[]): void {
  const loweredValues = new Set(value.map((concept) => concept.toLowerCase()));

  if (field === "knowledge.knownConcepts") {
    memory.knowledge.weakConcepts = memory.knowledge.weakConcepts.filter(
      (concept) => !loweredValues.has(concept.toLowerCase())
    );
  }

  if (field === "knowledge.weakConcepts") {
    memory.knowledge.knownConcepts = memory.knowledge.knownConcepts.filter(
      (concept) => !loweredValues.has(concept.toLowerCase())
    );
  }
}

function readList(memory: UserMemory, field: UserMemoryListField): string[] {
  switch (field) {
    case "profile.interests":
      return memory.profile.interests;
    case "profile.goals":
      return memory.profile.goals;
    case "knowledge.knownConcepts":
      return memory.knowledge.knownConcepts;
    case "knowledge.weakConcepts":
      return memory.knowledge.weakConcepts;
    case "knowledge.savedConcepts":
      return memory.knowledge.savedConcepts;
    case "interaction.recentCardIds":
      return memory.interaction.recentCardIds;
    case "interaction.recentQuestions":
      return memory.interaction.recentQuestions;
    case "agent.topicAgents":
      return memory.agent.topicAgents;
    case "agent.preferredSourceTypes":
      return memory.agent.preferredSourceTypes;
  }
}

function writeList(memory: UserMemory, field: UserMemoryListField, value: string[]): void {
  switch (field) {
    case "profile.interests":
      memory.profile.interests = value;
      return;
    case "profile.goals":
      memory.profile.goals = value;
      return;
    case "knowledge.knownConcepts":
      memory.knowledge.knownConcepts = value;
      return;
    case "knowledge.weakConcepts":
      memory.knowledge.weakConcepts = value;
      return;
    case "knowledge.savedConcepts":
      memory.knowledge.savedConcepts = value;
      return;
    case "interaction.recentCardIds":
      memory.interaction.recentCardIds = value;
      return;
    case "interaction.recentQuestions":
      memory.interaction.recentQuestions = value;
      return;
    case "agent.topicAgents":
      memory.agent.topicAgents = value;
      return;
    case "agent.preferredSourceTypes":
      memory.agent.preferredSourceTypes = value as SourceType[];
      return;
  }
}

function normalizeValues(values: string[], field: UserMemoryEdit["field"]): string[] {
  return dedupe(values.map((value) => normalizeValue(value, field)).filter((value): value is string => Boolean(value)));
}

function normalizeValue(value: string | undefined, field: UserMemoryEdit["field"]): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (field === "agent.preferredSourceTypes" && !sourceTypes.includes(normalized as SourceType)) {
    throw new Error(`${normalized} is not a supported source type.`);
  }

  return normalized;
}

function parseExplanationStyle(value: string | undefined): UserMemory["profile"]["explanationStyle"] {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();

  if (!explanationStyles.includes(normalized as NonNullable<UserMemory["profile"]["explanationStyle"]>)) {
    throw new Error(`${normalized} is not a supported explanation style.`);
  }

  return normalized as NonNullable<UserMemory["profile"]["explanationStyle"]>;
}

function createMemoryEditEvent(
  edit: UserMemoryEdit,
  createdAt: string,
  previousValue?: string | string[],
  nextValue?: string | string[]
): UserMemoryEditEvent {
  return {
    id: edit.id ?? buildMemoryEditEventId(edit, createdAt),
    kind: edit.kind,
    field: edit.field,
    previousValue,
    nextValue,
    createdAt,
    reason: edit.reason
  };
}

function buildMemoryEditEventId(edit: UserMemoryEdit, createdAt: string): string {
  return `memory-edit-${edit.field}-${edit.kind}-${createdAt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`;
}

function cloneMemory(memory: UserMemory): UserMemory {
  return {
    profile: {
      interests: [...memory.profile.interests],
      goals: [...memory.profile.goals],
      explanationStyle: memory.profile.explanationStyle
    },
    knowledge: {
      knownConcepts: [...memory.knowledge.knownConcepts],
      weakConcepts: [...memory.knowledge.weakConcepts],
      savedConcepts: [...memory.knowledge.savedConcepts]
    },
    interaction: {
      recentCardIds: [...memory.interaction.recentCardIds],
      recentQuestions: [...memory.interaction.recentQuestions]
    },
    agent: {
      topicAgents: [...memory.agent.topicAgents],
      preferredSourceTypes: [...memory.agent.preferredSourceTypes]
    }
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
