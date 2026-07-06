import type {
  ConceptAliasRecord,
  ConnectionNoteDetails,
  ConnectionNoteReason,
  InteractionSignal,
  KnowledgeCard,
  KnowledgeGraphEdge,
  KnowledgePost
} from "../types.js";
import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  slugConcept as slugConceptKey
} from "./conceptAliases.js";

export interface DismissedPostLike {
  postId: string;
  dismissedAt: string;
  mode: "soft" | "hard";
}

export interface ConnectionNoteGenerationInput {
  existingPosts: KnowledgeCard[];
  newPosts: KnowledgeCard[];
  interactionSignals?: InteractionSignal[];
  dismissedPosts?: DismissedPostLike[];
  conceptAliases?: ConceptAliasRecord[];
  now?: string | Date;
  dailyLimit?: number;
  contentLanguage?: "zh" | "en";
}

export interface ConnectionNoteCandidate {
  reason: ConnectionNoteReason;
  oldPost: KnowledgeCard;
  newPost: KnowledgeCard;
  edge: KnowledgeGraphEdge;
  sourceConcept: string;
  targetConcept: string;
  daysSinceOldCard: number;
  restorePostId?: string;
  score: number;
}

interface ConceptGraphIndex {
  adjacency: Map<string, Set<string>>;
  cardsByConcept: Map<string, KnowledgeCard[]>;
  hubSlugs: Set<string>;
}

const dormantDays = 14;
const defaultDailyLimit = 2;

export function createConnectionNoteForImport(input: ConnectionNoteGenerationInput): KnowledgePost | null {
  const now = normalizeDate(input.now ?? new Date());
  const dailyLimit = input.dailyLimit ?? defaultDailyLimit;
  const existingNotesToday = input.existingPosts.filter(
    (post) => post.kind === "connection_note" && isSameUtcDay(post.createdAt, now)
  ).length;

  if (existingNotesToday >= dailyLimit) {
    return null;
  }

  const candidate = evaluateConnectionNoteCandidates(input)[0];

  if (!candidate) {
    return null;
  }

  const details: ConnectionNoteDetails = {
    oldPostId: candidate.oldPost.id,
    oldPostTitle: candidate.oldPost.title,
    newPostId: candidate.newPost.id,
    newPostTitle: candidate.newPost.title,
    evidence: candidate.edge.evidence,
    relation: candidate.edge.relation,
    sourceConcept: candidate.sourceConcept,
    targetConcept: candidate.targetConcept,
    reason: candidate.reason,
    daysSinceOldCard: candidate.daysSinceOldCard,
    restorePostId: candidate.restorePostId
  };
  const createdAt = now.toISOString();
  const body = buildConnectionNoteBody(details, input.contentLanguage ?? "zh");

  return {
    kind: "connection_note",
    id: buildConnectionNoteId(details, createdAt),
    title: input.contentLanguage === "en" ? "Connection note" : "\u8fde\u63a5\u64ad\u62a5",
    hook: body,
    thesis: body,
    shortBody: body,
    summary: body,
    keyTakeaway: body,
    concepts: [details.sourceConcept, details.targetConcept],
    sources: [],
    citations: [],
    recommendedBecause: input.contentLanguage === "en" ? "A new import connected to an older card." : "\u65b0\u5bfc\u5165\u548c\u65e7\u5361\u8fde\u4e0a\u4e86\u3002",
    trustState: "supported",
    createdAt,
    estimatedReadMinutes: 1,
    difficulty: "beginner",
    confidence: "high",
    thread: [],
    graphEdges: [],
    reviewPrompts: [],
    nextActions: [],
    harnessVersion: "connection-note-v1",
    connectionNote: details
  };
}

export function evaluateConnectionNoteCandidates(input: ConnectionNoteGenerationInput): ConnectionNoteCandidate[] {
  const now = normalizeDate(input.now ?? new Date());
  const resolver = createConceptAliasResolver([
    ...(input.conceptAliases ?? []),
    ...createAutomaticConceptAliases([...input.existingPosts, ...input.newPosts], input.conceptAliases, now.toISOString())
  ]);
  const oldPosts = input.existingPosts.filter((post) => post.kind !== "connection_note");
  const index = buildConceptGraphIndex(oldPosts, resolver);
  const dismissedPostIds = new Set((input.dismissedPosts ?? []).map((record) => record.postId));
  const latestSignalByPostId = buildLatestSignalByPostId(input.interactionSignals ?? []);
  const candidates: ConnectionNoteCandidate[] = [];

  for (const newPost of input.newPosts.filter((post) => post.kind !== "connection_note")) {
    for (const edge of newPost.graphEdges ?? []) {
      if (!edge.evidence.trim()) {
        continue;
      }

      const sourceConcept = resolver.resolveConcept(edge.sourceConcept);
      const targetConcept = resolver.resolveConcept(edge.targetConcept);
      const sourceSlug = resolver.slugConcept(sourceConcept);
      const targetSlug = resolver.slugConcept(targetConcept);

      if (!sourceSlug || !targetSlug || sourceSlug === targetSlug) {
        continue;
      }

      if (index.hubSlugs.has(sourceSlug) || index.hubSlugs.has(targetSlug)) {
        continue;
      }

      const oldSourceCards = index.cardsByConcept.get(sourceSlug) ?? [];
      const oldTargetCards = index.cardsByConcept.get(targetSlug) ?? [];
      const distantPath = shortestPathLength(index.adjacency, sourceSlug, targetSlug);

      if (distantPath === Infinity || distantPath >= 3) {
        const oldPost = chooseOldPost([...oldSourceCards, ...oldTargetCards], now);

        if (oldPost) {
          candidates.push({
            reason: "distant_cluster",
            oldPost,
            newPost,
            edge,
            sourceConcept,
            targetConcept,
            daysSinceOldCard: daysBetween(oldPost.createdAt, now),
            score: distantPath === Infinity ? 120 : 100 + Math.min(distantPath, 12)
          });
        }
      }

      for (const endpoint of [
        { cards: oldSourceCards, concept: sourceConcept },
        { cards: oldTargetCards, concept: targetConcept }
      ]) {
        const wake = classifyWake(endpoint.cards, dismissedPostIds, latestSignalByPostId, now);

        if (!wake) {
          continue;
        }

        candidates.push({
          reason: wake.reason,
          oldPost: wake.oldPost,
          newPost,
          edge,
          sourceConcept,
          targetConcept,
          daysSinceOldCard: daysBetween(wake.oldPost.createdAt, now),
          restorePostId: wake.reason === "wake_dismissed" ? wake.oldPost.id : undefined,
          score: wake.reason === "wake_dismissed" ? 90 : 80 + Math.min(daysBetween(wake.oldPost.createdAt, now), 60)
        });
      }
    }
  }

  return dedupeCandidates(candidates).sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.newPost.id.localeCompare(right.newPost.id) || left.oldPost.id.localeCompare(right.oldPost.id);
  });
}

export function buildConnectionNoteBody(details: ConnectionNoteDetails, language: "zh" | "en" = "zh"): string {
  if (language === "en") {
    return `Your card from ${details.daysSinceOldCard} days ago, "${details.oldPostTitle}", connected to the newly imported "${details.newPostTitle}": ${details.evidence}`;
  }

  return `\u4f60 ${details.daysSinceOldCard} \u5929\u524d\u5b66\u8fc7\u7684\u300a${details.oldPostTitle}\u300b\u548c\u521a\u5bfc\u5165\u7684\u300a${details.newPostTitle}\u300b\u8fde\u4e0a\u4e86:${details.evidence}`;
}

function buildConceptGraphIndex(
  posts: KnowledgeCard[],
  resolver: ReturnType<typeof createConceptAliasResolver>
): ConceptGraphIndex {
  const adjacency = new Map<string, Set<string>>();
  const cardsByConcept = new Map<string, KnowledgeCard[]>();

  const ensureNode = (slug: string) => {
    if (slug && !adjacency.has(slug)) {
      adjacency.set(slug, new Set());
    }
  };
  const addConceptCard = (concept: string, card: KnowledgeCard) => {
    const slug = resolver.slugConcept(concept);

    if (!slug) {
      return;
    }

    ensureNode(slug);
    const cards = cardsByConcept.get(slug) ?? [];

    if (!cards.some((item) => item.id === card.id)) {
      cards.push(card);
      cardsByConcept.set(slug, cards);
    }
  };
  const addEdge = (leftConcept: string, rightConcept: string) => {
    const left = resolver.slugConcept(leftConcept);
    const right = resolver.slugConcept(rightConcept);

    if (!left || !right || left === right) {
      return;
    }

    ensureNode(left);
    ensureNode(right);
    adjacency.get(left)?.add(right);
    adjacency.get(right)?.add(left);
  };

  for (const post of posts) {
    for (const concept of post.concepts) {
      addConceptCard(concept, post);
    }

    for (const edge of post.graphEdges ?? []) {
      addConceptCard(edge.sourceConcept, post);
      addConceptCard(edge.targetConcept, post);
      addEdge(edge.sourceConcept, edge.targetConcept);
    }

    for (let index = 0; index < post.concepts.length - 1; index += 1) {
      addEdge(post.concepts[index], post.concepts[index + 1]);
    }
  }

  return {
    adjacency,
    cardsByConcept,
    hubSlugs: findHubSlugs(adjacency)
  };
}

function findHubSlugs(adjacency: Map<string, Set<string>>): Set<string> {
  if (adjacency.size === 0) {
    return new Set();
  }

  const ranked = [...adjacency.entries()]
    .map(([slug, neighbors]) => ({ slug, degree: neighbors.size }))
    .filter((item) => item.degree > 0)
    .sort((left, right) => right.degree - left.degree || left.slug.localeCompare(right.slug));
  const count = Math.max(1, Math.ceil(ranked.length * 0.1));

  return new Set(ranked.slice(0, count).map((item) => item.slug));
}

function shortestPathLength(adjacency: Map<string, Set<string>>, source: string, target: string): number {
  if (source === target) {
    return 0;
  }

  if (!adjacency.has(source) || !adjacency.has(target)) {
    return Infinity;
  }

  const queue: Array<{ slug: string; distance: number }> = [{ slug: source, distance: 0 }];
  const seen = new Set([source]);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];

    for (const next of adjacency.get(current.slug) ?? []) {
      if (next === target) {
        return current.distance + 1;
      }

      if (!seen.has(next)) {
        seen.add(next);
        queue.push({ slug: next, distance: current.distance + 1 });
      }
    }
  }

  return Infinity;
}

function classifyWake(
  cards: KnowledgeCard[],
  dismissedPostIds: Set<string>,
  latestSignalByPostId: Map<string, string>,
  now: Date
): { reason: "wake_dormant" | "wake_dismissed"; oldPost: KnowledgeCard } | null {
  if (!cards.length) {
    return null;
  }

  const dismissed = cards.find((card) => dismissedPostIds.has(card.id));

  if (dismissed) {
    return { reason: "wake_dismissed", oldPost: dismissed };
  }

  const allDormant = cards.every((card) => {
    const latest = latestSignalByPostId.get(card.id) ?? card.createdAt;

    return daysBetween(latest, now) >= dormantDays;
  });

  if (!allDormant) {
    return null;
  }

  return { reason: "wake_dormant", oldPost: chooseOldPost(cards, now) ?? cards[0] };
}

function chooseOldPost(cards: KnowledgeCard[], now: Date): KnowledgeCard | undefined {
  return [...cards].sort((left, right) => {
    const leftDays = daysBetween(left.createdAt, now);
    const rightDays = daysBetween(right.createdAt, now);

    if (leftDays !== rightDays) {
      return rightDays - leftDays;
    }

    return left.id.localeCompare(right.id);
  })[0];
}

function buildLatestSignalByPostId(signals: InteractionSignal[]): Map<string, string> {
  const latest = new Map<string, string>();

  for (const signal of signals) {
    const current = latest.get(signal.postId);

    if (!current || normalizeDate(signal.createdAt).getTime() > normalizeDate(current).getTime()) {
      latest.set(signal.postId, signal.createdAt);
    }
  }

  return latest;
}

function dedupeCandidates(candidates: ConnectionNoteCandidate[]): ConnectionNoteCandidate[] {
  const byKey = new Map<string, ConnectionNoteCandidate>();

  for (const candidate of candidates) {
    const key = [candidate.oldPost.id, candidate.newPost.id, candidate.edge.id, candidate.reason].join("|");
    const existing = byKey.get(key);

    if (!existing || candidate.score > existing.score) {
      byKey.set(key, candidate);
    }
  }

  return Array.from(byKey.values());
}

function buildConnectionNoteId(details: ConnectionNoteDetails, createdAt: string): string {
  return `connection-note-${hashText(
    [details.oldPostId, details.newPostId, details.evidence, details.reason, createdAt].join("|")
  )}`;
}

function daysBetween(value: string, now: Date): number {
  const then = normalizeDate(value);
  const days = Math.floor((now.getTime() - then.getTime()) / (24 * 60 * 60 * 1000));

  return Number.isFinite(days) ? Math.max(0, days) : 0;
}

function isSameUtcDay(value: string, date: Date): boolean {
  return normalizeDate(value).toISOString().slice(0, 10) === date.toISOString().slice(0, 10);
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function hashText(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

export { slugConceptKey as slugConnectionConcept };
