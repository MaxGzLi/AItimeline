import type { BackgroundSourceCandidate } from "../agents/backgroundCuration.js";
import type { NextActionPolicy, SourceType } from "../types.js";
import type { DiscoveredSource, SearchProvider } from "./searchProvider.js";

export interface PlanDiscoveryQueriesInput {
  concepts: string[];
  topicId?: string;
  nextAction?: NextActionPolicy;
  goals?: string[];
  maxQueries?: number;
}

/**
 * Deterministic query planning: interest direction decides the query shape,
 * user goals add one goal-flavored query when available.
 */
export function planDiscoveryQueries(input: PlanDiscoveryQueriesInput): string[] {
  const concepts = dedupeStrings(input.concepts.map((concept) => concept.trim()).filter(Boolean)).slice(0, 3);
  const queries: string[] = [];

  for (const concept of concepts) {
    if (input.nextAction === "continue_deeper") {
      queries.push(`${concept} advanced deep dive`);
    } else if (input.nextAction === "expand_broader") {
      queries.push(`${concept} applications and comparisons`);
    } else {
      queries.push(`${concept} explained analysis`);
    }
  }

  const goal = input.goals?.find((item) => item.trim());

  if (goal && concepts.length) {
    queries.push(`${goal.trim()} ${concepts[0]}`);
  }

  return dedupeStrings(queries).slice(0, input.maxQueries ?? 4);
}

export interface ScreenDiscoveredSourcesInput {
  discovered: DiscoveredSource[];
  concepts: string[];
  topicId?: string;
  query?: string;
  existingUrls?: string[];
  existingTitles?: string[];
  now?: string | Date;
}

/**
 * The candidate gate: normalize + dedupe URLs against everything the system
 * already knows, then score relevance/novelty/quality deterministically.
 */
export function screenDiscoveredSources(input: ScreenDiscoveredSourcesInput): BackgroundSourceCandidate[] {
  const now = normalizeDate(input.now).toISOString();
  const existingUrls = new Set((input.existingUrls ?? []).map(normalizeUrl).filter(Boolean));
  const existingTitles = (input.existingTitles ?? []).map((title) => title.toLowerCase().trim());
  const seenUrls = new Set<string>();
  const candidates: BackgroundSourceCandidate[] = [];

  for (const item of input.discovered) {
    const normalizedUrl = normalizeUrl(item.url);

    if (!normalizedUrl || seenUrls.has(normalizedUrl) || existingUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);

    const parsedUrl = new URL(normalizedUrl);
    const type = item.sourceType ?? inferSourceType(parsedUrl);
    const sourceId = buildSourceId(type, parsedUrl);
    const title = item.title.trim() || parsedUrl.hostname;

    candidates.push({
      id: `candidate-${sourceId}`,
      source: {
        id: sourceId,
        title,
        url: normalizedUrl,
        type,
        publishedAt: item.publishedAt
      },
      topicId: input.topicId,
      conceptIds: dedupeStrings(input.concepts),
      relevanceScore: scoreRelevance(item, input.concepts),
      noveltyScore: scoreNovelty(title, existingTitles),
      qualityScore: scoreQuality(item, parsedUrl),
      reason: buildReason(input.concepts, input.query),
      discoveredAt: now
    });
  }

  return candidates;
}

export interface RunSourceDiscoveryInput {
  provider: SearchProvider;
  concepts: string[];
  topicId?: string;
  nextAction?: NextActionPolicy;
  goals?: string[];
  queries?: string[];
  existingUrls?: string[];
  existingTitles?: string[];
  maxQueries?: number;
  limitPerQuery?: number;
  maxCandidates?: number;
  now?: string | Date;
}

export interface SourceDiscoveryResult {
  queries: string[];
  candidates: BackgroundSourceCandidate[];
  errors: string[];
}

/**
 * Plan -> search -> screen. A failing query is recorded, not fatal, so one
 * provider hiccup cannot kill the whole discovery batch.
 */
export async function runSourceDiscovery(input: RunSourceDiscoveryInput): Promise<SourceDiscoveryResult> {
  const queries =
    input.queries && input.queries.length
      ? dedupeStrings(input.queries).slice(0, input.maxQueries ?? 4)
      : planDiscoveryQueries({
          concepts: input.concepts,
          topicId: input.topicId,
          nextAction: input.nextAction,
          goals: input.goals,
          maxQueries: input.maxQueries
        });
  const discovered: DiscoveredSource[] = [];
  const errors: string[] = [];

  for (const query of queries) {
    try {
      discovered.push(...(await input.provider.search(query, { limit: input.limitPerQuery ?? 5 })));
    } catch (error) {
      errors.push(`${query}: ${error instanceof Error ? error.message : "unknown search error"}`);
    }
  }

  const candidates = screenDiscoveredSources({
    discovered,
    concepts: input.concepts,
    topicId: input.topicId,
    query: queries[0],
    existingUrls: input.existingUrls,
    existingTitles: input.existingTitles,
    now: input.now
  }).slice(0, input.maxCandidates ?? 8);

  return { queries, candidates, errors };
}

function scoreRelevance(item: DiscoveredSource, concepts: string[]): number {
  if (!concepts.length) {
    return 0.6;
  }

  const haystack = `${item.title} ${item.snippet ?? ""}`.toLowerCase();
  const matched = concepts.filter((concept) => concept.trim() && haystack.includes(concept.toLowerCase())).length;

  return roundScore(0.5 + (matched / concepts.length) * 0.45);
}

function scoreNovelty(title: string, existingTitles: string[]): number {
  const normalizedTitle = title.toLowerCase().trim();
  const nearDuplicate = existingTitles.some(
    (existing) => existing && (existing.includes(normalizedTitle) || normalizedTitle.includes(existing))
  );

  return nearDuplicate ? 0.35 : 0.7;
}

function scoreQuality(item: DiscoveredSource, url: URL): number {
  let score = 0.5;

  if (url.protocol === "https:") {
    score += 0.1;
  }

  if (item.title.trim().length >= 15 && item.title.trim().length <= 120) {
    score += 0.15;
  }

  if ((item.snippet ?? "").length >= 80) {
    score += 0.15;
  }

  return roundScore(Math.min(0.9, score));
}

function buildReason(concepts: string[], query?: string): string {
  const conceptText = concepts.length ? concepts.slice(0, 3).join(", ") : "your recent interests";
  const queryText = query ? ` via "${query}"` : "";

  return `Discovered for ${conceptText}${queryText}.`;
}

function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";

    for (const param of Array.from(url.searchParams.keys())) {
      if (/^(utm_|ref$|fbclid$|gclid$)/.test(param)) {
        url.searchParams.delete(param);
      }
    }

    url.hostname = url.hostname.toLowerCase();

    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function inferSourceType(url: URL): SourceType {
  const host = url.hostname.replace(/^www\./, "");

  if (host.includes("youtube.com") || host === "youtu.be") {
    return "youtube";
  }

  if (host.includes("github.com")) {
    return "repo";
  }

  if (host.includes("arxiv.org")) {
    return "paper";
  }

  return "article";
}

function buildSourceId(type: SourceType, url: URL): string {
  return `${type}-${sanitizeSlug(`${url.hostname}-${url.pathname}-${url.search}`)}`;
}

function sanitizeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "source";
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}
