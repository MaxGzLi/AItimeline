import type { LinkedKnowledgeGraph, SourceImport } from "@aitimeline/core";

export interface ImportGroup {
  latest: SourceImport;
  count: number;
}

// The import history repeats the same source title dozens of times (follow-up
// batches, re-imports). Collapse by title so one line stands for one source.
export function groupImportsByTitle(imports: SourceImport[]): ImportGroup[] {
  const groups = new Map<string, ImportGroup>();

  for (const item of imports) {
    const group = groups.get(item.source.title);

    if (!group) {
      groups.set(item.source.title, { latest: item, count: 1 });
      continue;
    }

    group.count += 1;

    if (Date.parse(item.createdAt) > Date.parse(group.latest.createdAt)) {
      group.latest = item;
    }
  }

  return Array.from(groups.values()).sort(
    (left, right) => Date.parse(right.latest.createdAt) - Date.parse(left.latest.createdAt)
  );
}

/** Import records created inside the trailing window (default: the last 7 days). */
export function countRecentImports(imports: SourceImport[], now: string | Date, windowDays = 7): number {
  const nowMs = typeof now === "string" ? Date.parse(now) : now.getTime();

  if (!Number.isFinite(nowMs)) {
    return 0;
  }

  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  return imports.filter((item) => {
    const createdMs = Date.parse(item.createdAt);

    return Number.isFinite(createdMs) && createdMs > windowStartMs && createdMs <= nowMs;
  }).length;
}

export interface LinkedGraphSummary {
  /** Concept hub nodes (ghost wikilink targets excluded — they have no card yet). */
  conceptCount: number;
  /** Knowledge cards, notes and ideas — everything the user actually holds. */
  cardCount: number;
  linkCount: number;
}

export function summarizeLinkedGraph(graph: LinkedKnowledgeGraph): LinkedGraphSummary {
  let conceptCount = 0;
  let cardCount = 0;

  for (const node of graph.nodes) {
    if (node.kind === "concept") {
      conceptCount += 1;
    } else if (node.kind === "card" || node.kind === "note" || node.kind === "idea") {
      cardCount += 1;
    }
  }

  return { conceptCount, cardCount, linkCount: graph.edges.length };
}
