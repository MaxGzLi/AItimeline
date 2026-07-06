import type { ConceptAliasRecord, ConceptMergeSuggestion, KnowledgeCard } from "../types.js";

export interface ConceptAliasResolver {
  resolveConcept(name: string): string;
  slugConcept(name: string): string;
  records: ConceptAliasRecord[];
}

export interface ConceptAliasOptions {
  conceptAliases?: ConceptAliasRecord[];
}

const fullWidthAsciiStart = 0xff01;
const fullWidthAsciiEnd = 0xff5e;
const fullWidthOffset = 0xfee0;

export function normalizeConceptKey(name: string): string {
  return toHalfWidth(name).trim().toLowerCase();
}

export function normalizeConceptLabel(name: string): string {
  return toHalfWidth(name).trim();
}

export function slugConcept(name: string): string {
  return normalizeConceptKey(name).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "");
}

export function resolveConcept(name: string, aliases: readonly ConceptAliasRecord[] = []): string {
  return createConceptAliasResolver(aliases).resolveConcept(name);
}

export function createConceptAliasResolver(
  aliases: readonly ConceptAliasRecord[] = []
): ConceptAliasResolver {
  // 显示名与别名指向边分开存:canonical 自身不占别名槽位,链式合并(B→Alpha 后再 Gamma→Beta)才能追到根。
  const labelByKey = new Map<string, string>();
  const parentKeyByAliasKey = new Map<string, string>();
  const records = normalizeConceptAliases(aliases);

  for (const record of records) {
    const canonical = normalizeConceptLabel(record.canonical);
    const canonicalKey = normalizeConceptKey(canonical);

    if (!canonicalKey) {
      continue;
    }

    labelByKey.set(canonicalKey, canonical);

    for (const alias of record.aliases) {
      const aliasLabel = normalizeConceptLabel(alias);
      const aliasKey = normalizeConceptKey(aliasLabel);

      if (!aliasKey || aliasKey === canonicalKey) {
        continue;
      }

      if (!labelByKey.has(aliasKey)) {
        labelByKey.set(aliasKey, aliasLabel);
      }

      if (!parentKeyByAliasKey.has(aliasKey)) {
        parentKeyByAliasKey.set(aliasKey, canonicalKey);
      }
    }
  }

  const resolve = (name: string): string => {
    const fallback = normalizeConceptLabel(name);
    let key = normalizeConceptKey(fallback);

    if (!key) {
      return fallback;
    }

    const visited = new Set<string>();

    while (parentKeyByAliasKey.has(key) && !visited.has(key)) {
      visited.add(key);
      key = parentKeyByAliasKey.get(key) ?? key;
    }

    return labelByKey.get(key) ?? fallback;
  };

  return {
    resolveConcept: resolve,
    slugConcept: (name) => slugConcept(resolve(name)),
    records
  };
}

export function createAutomaticConceptAliases(
  cards: readonly KnowledgeCard[],
  existingAliases: readonly ConceptAliasRecord[] = [],
  decidedAt = new Date().toISOString()
): ConceptAliasRecord[] {
  const existingKeys = new Set<string>();

  for (const record of existingAliases) {
    existingKeys.add(normalizeConceptKey(record.canonical));

    for (const alias of record.aliases) {
      existingKeys.add(normalizeConceptKey(alias));
    }
  }

  const byKey = new Map<string, string[]>();

  for (const card of cards) {
    if (card.kind === "connection_note") {
      continue;
    }

    for (const concept of collectCardConcepts(card)) {
      const label = normalizeConceptLabel(concept);
      const key = normalizeConceptKey(label);

      if (!key || existingKeys.has(key)) {
        continue;
      }

      const labels = byKey.get(key) ?? [];

      if (!labels.some((item) => item === label)) {
        labels.push(label);
      }

      byKey.set(key, labels);
    }
  }

  const records: ConceptAliasRecord[] = [];

  for (const labels of byKey.values()) {
    if (labels.length < 2) {
      continue;
    }

    const canonical = chooseCanonicalLabel(labels);
    const aliases = labels.filter((label) => label !== canonical).sort((left, right) => left.localeCompare(right));

    if (aliases.length) {
      records.push({
        canonical,
        aliases,
        decidedBy: "auto",
        decidedAt
      });
    }
  }

  return records.sort((left, right) => left.canonical.localeCompare(right.canonical));
}

export function normalizeConceptAliases(aliases: readonly ConceptAliasRecord[]): ConceptAliasRecord[] {
  const byCanonical = new Map<string, ConceptAliasRecord>();

  for (const record of aliases) {
    const canonical = normalizeConceptLabel(record.canonical);
    const canonicalKey = normalizeConceptKey(canonical);

    if (!canonicalKey) {
      continue;
    }

    const existing = byCanonical.get(canonicalKey);
    const aliasSet = new Map<string, string>();

    for (const alias of existing?.aliases ?? []) {
      aliasSet.set(normalizeConceptLabel(alias), normalizeConceptLabel(alias));
    }

    for (const alias of record.aliases) {
      const label = normalizeConceptLabel(alias);
      const key = normalizeConceptKey(label);

      if (key && label !== canonical) {
        aliasSet.set(label, label);
      }
    }

    byCanonical.set(canonicalKey, {
      canonical: existing?.canonical ?? canonical,
      aliases: Array.from(aliasSet.values()).sort((left, right) => left.localeCompare(right)),
      decidedBy: record.decidedBy === "user" || existing?.decidedBy === "user" ? "user" : "auto",
      decidedAt: existing?.decidedAt && existing.decidedAt < record.decidedAt ? existing.decidedAt : record.decidedAt
    });
  }

  return Array.from(byCanonical.values())
    .filter((record) => record.aliases.length > 0)
    .sort((left, right) => left.canonical.localeCompare(right.canonical));
}

export function addConceptAliasDecision(
  aliases: readonly ConceptAliasRecord[],
  decision: ConceptAliasRecord
): ConceptAliasRecord[] {
  return normalizeConceptAliases([...aliases, decision]);
}

export function removeConceptAlias(
  aliases: readonly ConceptAliasRecord[],
  canonical: string,
  alias: string
): ConceptAliasRecord[] {
  const canonicalKey = normalizeConceptKey(canonical);
  const aliasKey = normalizeConceptKey(alias);

  return normalizeConceptAliases(
    aliases
      .map((record) => {
        if (normalizeConceptKey(record.canonical) !== canonicalKey) {
          return record;
        }

        return {
          ...record,
          aliases: record.aliases.filter((item) => normalizeConceptKey(item) !== aliasKey)
        };
      })
      .filter((record) => record.aliases.length > 0)
  );
}

export function createConceptMergeSuggestion(input: {
  left: string;
  right: string;
  leftExcerpt?: string;
  rightExcerpt?: string;
  createdAt?: string;
}): ConceptMergeSuggestion {
  const left = normalizeConceptLabel(input.left);
  const right = normalizeConceptLabel(input.right);
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    id: buildConceptPairId(left, right),
    left,
    right,
    leftExcerpt: input.leftExcerpt,
    rightExcerpt: input.rightExcerpt,
    createdAt,
    status: "pending"
  };
}

export function buildConceptPairId(left: string, right: string): string {
  const pair = [normalizeConceptKey(left), normalizeConceptKey(right)].sort();

  return `concept-pair-${hashText(pair.join("|"))}`;
}

function collectCardConcepts(card: KnowledgeCard): string[] {
  return [
    ...card.concepts,
    ...(card.graphEdges ?? []).flatMap((edge) => [edge.sourceConcept, edge.targetConcept])
  ];
}

function chooseCanonicalLabel(labels: string[]): string {
  return [...labels].sort((left, right) => {
    const trimmedDelta = left.length - right.length;

    if (trimmedDelta !== 0) {
      return trimmedDelta;
    }

    return left.localeCompare(right);
  })[0];
}

function toHalfWidth(value: string): string {
  let output = "";

  for (const char of value) {
    const code = char.charCodeAt(0);

    if (code === 0x3000) {
      output += " ";
    } else if (code >= fullWidthAsciiStart && code <= fullWidthAsciiEnd) {
      output += String.fromCharCode(code - fullWidthOffset);
    } else {
      output += char;
    }
  }

  return output;
}

function hashText(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}
