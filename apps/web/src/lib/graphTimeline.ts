import {
  resolveConcept,
  slugConcept,
  type ConceptAliasRecord,
  type KnowledgeCard,
  type LinkedKnowledgeGraph
} from "@aitimeline/core";

export interface GraphGrowthTimeline {
  edgeFirstSeen: Record<string, number>;
  endMs: number;
  newConceptCount: number;
  newConnectionCount: number;
  nodeFirstSeen: Record<string, number>;
  startMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildGraphGrowthTimeline(input: {
  cards: KnowledgeCard[];
  conceptAliases: ConceptAliasRecord[];
  graph: LinkedKnowledgeGraph;
  nowMs?: number;
}): GraphGrowthTimeline {
  const endMs = input.nowMs ?? Date.now();
  const nodeFirstSeen: Record<string, number> = {};
  const cardsById = new Map(input.cards.map((card) => [card.id, card]));

  for (const card of input.cards) {
    if (card.kind === "connection_note") {
      continue;
    }

    const createdAt = parseTime(card.createdAt, endMs);
    setMinTime(nodeFirstSeen, card.id, createdAt);

    for (const concept of card.concepts) {
      const canonical = resolveConcept(concept, input.conceptAliases);
      setMinTime(nodeFirstSeen, slugConcept(canonical), createdAt);
    }
  }

  for (const node of input.graph.nodes) {
    if (nodeFirstSeen[node.id] !== undefined) {
      continue;
    }

    const card = cardsById.get(node.id);

    if (card) {
      nodeFirstSeen[node.id] = parseTime(card.createdAt, endMs);
      continue;
    }

    const linkedCardTimes = input.graph.edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .flatMap((edge) => {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const otherCard = cardsById.get(otherId);
        return otherCard ? [parseTime(otherCard.createdAt, endMs)] : [];
      });

    nodeFirstSeen[node.id] = linkedCardTimes.length > 0 ? Math.min(...linkedCardTimes) : endMs;
  }

  const edgeFirstSeen: Record<string, number> = {};

  for (const edge of input.graph.edges) {
    edgeFirstSeen[edge.id] = Math.max(nodeFirstSeen[edge.source] ?? endMs, nodeFirstSeen[edge.target] ?? endMs);
  }

  // Replay opens at the first real event (with a half-day lead-in) instead of
  // a fixed 30-day window that is mostly empty for young libraries.
  const windowStartMs = endMs - 30 * DAY_MS;
  const firstSeenTimes = Object.values(nodeFirstSeen);
  const firstEventMs = firstSeenTimes.length > 0 ? Math.min(...firstSeenTimes) : windowStartMs;
  const startMs = Math.max(windowStartMs, Math.min(firstEventMs - DAY_MS / 2, endMs - DAY_MS / 2));

  return {
    edgeFirstSeen,
    endMs,
    newConceptCount: input.graph.nodes.filter(
      (node) => node.kind === "concept" && isWithinWindow(nodeFirstSeen[node.id], startMs, endMs)
    ).length,
    newConnectionCount: input.graph.edges.filter((edge) => isWithinWindow(edgeFirstSeen[edge.id], startMs, endMs)).length,
    nodeFirstSeen,
    startMs
  };
}

export function progressToTime(timeline: GraphGrowthTimeline, progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return timeline.startMs + (timeline.endMs - timeline.startMs) * clamped;
}

export function timeToProgress(timeline: GraphGrowthTimeline, timeMs: number): number {
  const span = timeline.endMs - timeline.startMs || 1;
  return Math.max(0, Math.min(1, (timeMs - timeline.startMs) / span));
}

export function nodeAppearanceAlpha(firstSeenMs: number | undefined, currentMs: number): number {
  if (firstSeenMs === undefined || currentMs < firstSeenMs) {
    return 0;
  }

  const fadeMs = DAY_MS * 1.4;
  return Math.max(0.18, Math.min(1, (currentMs - firstSeenMs) / fadeMs));
}

function setMinTime(target: Record<string, number>, key: string, value: number): void {
  target[key] = target[key] === undefined ? value : Math.min(target[key], value);
}

function parseTime(value: string, fallback: number): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
}

function isWithinWindow(value: number | undefined, startMs: number, endMs: number): boolean {
  return value !== undefined && value > startMs && value <= endMs;
}
