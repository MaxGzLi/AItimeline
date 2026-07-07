import type { ModelClient, ModelMessage } from "../harness/modelRunner.js";
import type {
  AgentHarnessUserContext,
  KnowledgeChunk,
  Source,
  SourceQualityGateRunnerKind,
  SourceQualityVerdict
} from "../types.js";

export interface SourceQualityGateInput {
  source: Source;
  chunks: KnowledgeChunk[];
  userContext?: AgentHarnessUserContext;
  conceptHints?: string[];
  createdAt?: string;
}

export interface SourceQualityGateRunner {
  id: string;
  kind: SourceQualityGateRunnerKind;
  evaluate(input: SourceQualityGateInput): Promise<SourceQualityVerdict> | SourceQualityVerdict;
}

export interface CreateModelSourceQualityGateOptions {
  client: ModelClient;
  id?: string;
  temperature?: number;
  fallback?: SourceQualityGateRunner;
}

interface ParsedModelVerdict {
  score?: unknown;
  verdict?: unknown;
  reasons?: unknown;
}

const rejectThreshold = 0.45;
const maxSampleCharacters = 4200;

export const deterministicSourceQualityGate: SourceQualityGateRunner = {
  id: "deterministic-source-quality-gate",
  kind: "deterministic",
  evaluate: evaluateSourceQualityDeterministic
};

export function createModelSourceQualityGate(options: CreateModelSourceQualityGateOptions): SourceQualityGateRunner {
  const fallback = options.fallback ?? deterministicSourceQualityGate;

  return {
    id: options.id ?? "model-source-quality-gate",
    kind: "model",
    async evaluate(input) {
      try {
        const response = await options.client.complete({
          messages: buildModelMessages(input),
          responseFormat: "json_object",
          temperature: options.temperature ?? 0.1
        });
        const parsed = parseModelVerdict(response.content);
        const verdict = normalizeModelVerdict(parsed, input, "model");

        if (verdict) {
          return verdict;
        }
      } catch {
        // Fall through to the deterministic gate. The import pipeline should
        // degrade to cheap local screening when the model path is unavailable.
      }

      const fallbackVerdict = await fallback.evaluate(input);

      return {
        ...fallbackVerdict,
        reasons: dedupeReasons([
          ...fallbackVerdict.reasons,
          "Model quality gate unavailable; deterministic fallback was used."
        ])
      };
    }
  };
}

export function evaluateSourceQualityDeterministic(input: SourceQualityGateInput): SourceQualityVerdict {
  const text = input.chunks.map((chunk) => chunk.content).join("\n\n");
  const normalizedText = normalizeWhitespace(text);
  const title = normalizeWhitespace(input.source.title);
  const words = tokenize(`${title} ${normalizedText}`);
  const wordCount = words.length;
  const uniqueRatio = words.length ? new Set(words).size / words.length : 0;
  const linkCount = countMatches(normalizedText, /https?:\/\//gi);
  const linkRatio = wordCount ? linkCount / wordCount : 0;
  const numericCount = countMatches(normalizedText, /\b\d+(?:[.,]\d+)?%?\b/g);
  const mechanismMatches = countKeywordMatches(normalizedText, mechanismKeywords);
  const marketingMatches = countKeywordMatches(`${title} ${normalizedText}`, marketingKeywords);
  const titleBaitMatches = countKeywordMatches(title, titleBaitKeywords);
  const conceptOverlap = scoreConceptOverlap(input, `${title} ${normalizedText}`);
  const sourceTrust = scoreSourceTrust(input.source);
  const lengthScore = scoreLength(wordCount);
  const densityScore = clampScore(
    numericCount * 0.045 + mechanismMatches * 0.055 + uniqueRatio * 0.45 - marketingMatches * 0.035
  );
  const hygieneScore = clampScore(0.78 - linkRatio * 8 - titleBaitMatches * 0.1 - marketingMatches * 0.025);
  const score = roundScore(
    lengthScore * 0.28 +
      densityScore * 0.32 +
      conceptOverlap * 0.18 +
      sourceTrust * 0.14 +
      hygieneScore * 0.08
  );
  const reasons = buildDeterministicReasons({
    wordCount,
    linkRatio,
    numericCount,
    mechanismMatches,
    marketingMatches,
    titleBaitMatches,
    conceptOverlap,
    sourceTrust,
    score
  });

  return {
    url: normalizeSourceUrl(input.source.url),
    sourceId: input.source.id,
    sourceTitle: input.source.title,
    score,
    verdict: score >= rejectThreshold ? "accept" : "reject",
    reasons,
    runnerKind: "deterministic",
    evaluatedAt: normalizeDate(input.createdAt).toISOString()
  };
}

export function findCachedSourceQualityVerdict(
  source: Pick<Source, "url">,
  cache: SourceQualityVerdict[] = []
): SourceQualityVerdict | undefined {
  const sourceUrl = normalizeSourceUrl(source.url);

  return cache.find((record) => normalizeSourceUrl(record.url) === sourceUrl);
}

export function normalizeSourceUrl(value: string): string {
  try {
    const url = new URL(value);

    url.hash = "";

    for (const param of Array.from(url.searchParams.keys())) {
      if (/^(utm_|ref$|fbclid$|gclid$)/i.test(param)) {
        url.searchParams.delete(param);
      }
    }

    url.hostname = url.hostname.toLowerCase();

    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function buildModelMessages(input: SourceQualityGateInput): ModelMessage[] {
  const concepts = collectConcepts(input).slice(0, 30);
  const sample = sampleSourceText(input.chunks);

  return [
    {
      role: "system",
      content: [
        "You are AITimeline's source quality gate.",
        "Score a fetched source before card generation.",
        "Return JSON only: {\"score\":0-1,\"verdict\":\"accept\"|\"reject\",\"reasons\":[\"...\"]}.",
        "Judge four dimensions: content density, relevance to the user's current graph, source credibility, and first-hand vs second-hand value.",
        "Accept sources with concrete mechanisms, data, verifiable claims, implementation details, papers, official docs, or substantial technical analysis.",
        "First-hand sources include papers, official blogs/docs, author-owned writeups, and first-party implementations.",
        "Second-hand sources summarize or restate someone else's result. Accept them when they add original analysis, experiments, comparisons, synthesis, or practical interpretation.",
        "Lean reject on pure second-hand recaps that only paraphrase a paper/report/blog without adding new information; when rejecting for this, include the phrase \"二手复述\" in reasons.",
        "Reject obvious SEO/marketing filler: slogans, keyword stuffing, listicles with no specific claims, thin ultimate-guide pages, or pages that mainly sell a product.",
        "Use a permissive threshold. Reject only when the source is not worth learning from."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          source: {
            title: input.source.title,
            url: input.source.url,
            type: input.source.type,
            author: input.source.author,
            publishedAt: input.source.publishedAt
          },
          currentConcepts: concepts,
          textSample: sample,
          rejectExample:
            "Ultimate guide to AI success. Unlock innovation, boost productivity, transform your business. This article repeats keywords without mechanisms, data, or verifiable claims."
        },
        null,
        2
      )
    }
  ];
}

function parseModelVerdict(content: string): ParsedModelVerdict | null {
  try {
    const parsed = JSON.parse(content) as unknown;

    return isRecord(parsed) ? parsed : null;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      const parsed = JSON.parse(match[0]) as unknown;

      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function normalizeModelVerdict(
  parsed: ParsedModelVerdict | null,
  input: SourceQualityGateInput,
  runnerKind: SourceQualityGateRunnerKind
): SourceQualityVerdict | null {
  if (!parsed) {
    return null;
  }

  const score = typeof parsed.score === "number" && Number.isFinite(parsed.score) ? clampScore(parsed.score) : null;
  const verdict = parsed.verdict === "accept" || parsed.verdict === "reject" ? parsed.verdict : null;
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons
        .filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
        .map((reason) => reason.trim())
    : [];

  if (score === null || !verdict) {
    return null;
  }

  return {
    url: normalizeSourceUrl(input.source.url),
    sourceId: input.source.id,
    sourceTitle: input.source.title,
    score: roundScore(score),
    verdict,
    reasons: reasons.length ? dedupeReasons(reasons).slice(0, 6) : [`Model scored this source ${roundScore(score)}.`],
    runnerKind,
    evaluatedAt: normalizeDate(input.createdAt).toISOString()
  };
}

function sampleSourceText(chunks: KnowledgeChunk[]): string {
  const paragraphs = chunks.map((chunk) => normalizeWhitespace(chunk.content)).filter(Boolean);

  if (paragraphs.length <= 3) {
    return paragraphs.join("\n\n").slice(0, maxSampleCharacters);
  }

  const middle = paragraphs[Math.floor(paragraphs.length / 2)];
  const sample = [paragraphs[0], middle, paragraphs[paragraphs.length - 1]].join("\n\n");

  return sample.slice(0, maxSampleCharacters);
}

function collectConcepts(input: SourceQualityGateInput): string[] {
  const memory = input.userContext?.memory;
  const concepts = [
    ...(input.conceptHints ?? []),
    ...(memory?.profile.interests ?? []),
    ...(memory?.knowledge.knownConcepts ?? []),
    ...(memory?.knowledge.savedConcepts ?? []),
    ...(memory?.knowledge.weakConcepts ?? []),
    ...(input.userContext?.topicStates?.map((topic) => topic.topicId) ?? [])
  ];

  return Array.from(new Set(concepts.map((concept) => concept.trim()).filter(Boolean)));
}

function scoreConceptOverlap(input: SourceQualityGateInput, text: string): number {
  const concepts = collectConcepts(input);

  if (!concepts.length) {
    return 0.58;
  }

  const normalizedText = text.toLowerCase();
  const matched = concepts.filter((concept) => normalizedText.includes(concept.toLowerCase())).length;

  return clampScore(0.25 + (matched / concepts.length) * 0.75);
}

function scoreSourceTrust(source: Source): number {
  const url = safeUrl(source.url);
  const host = url?.hostname.replace(/^www\./, "") ?? "";

  if (source.type === "paper" || host.includes("arxiv.org") || host.endsWith(".edu")) {
    return 0.92;
  }

  if (host.includes("github.com") || host.includes("docs.") || /(^|\.)developer\./.test(host)) {
    return 0.84;
  }

  if (source.type === "blog" || source.type === "article") {
    return 0.62;
  }

  if (source.type === "news") {
    return 0.56;
  }

  return 0.5;
}

function scoreLength(wordCount: number): number {
  if (wordCount >= 700) return 0.95;
  if (wordCount >= 350) return 0.78;
  if (wordCount >= 180) return 0.58;
  if (wordCount >= 90) return 0.34;

  return 0.12;
}

function buildDeterministicReasons(input: {
  wordCount: number;
  linkRatio: number;
  numericCount: number;
  mechanismMatches: number;
  marketingMatches: number;
  titleBaitMatches: number;
  conceptOverlap: number;
  sourceTrust: number;
  score: number;
}): string[] {
  const reasons: string[] = [];

  if (input.wordCount < 180) {
    reasons.push("Body is too short to support a learning card.");
  } else {
    reasons.push(`Body has enough readable text (${input.wordCount} tokens).`);
  }

  if (input.mechanismMatches + input.numericCount < 2) {
    reasons.push("Few concrete mechanisms, data points, or verifiable claims were found.");
  } else {
    reasons.push("Text includes concrete mechanisms, data, or checkable claims.");
  }

  if (input.marketingMatches >= 5 || input.titleBaitMatches > 0) {
    reasons.push("SEO or marketing-style phrasing is prominent.");
  }

  if (input.linkRatio > 0.04) {
    reasons.push("Link density is high relative to body text.");
  }

  if (input.conceptOverlap < 0.4) {
    reasons.push("Low lexical overlap with confirmed user concepts.");
  }

  if (input.sourceTrust >= 0.8) {
    reasons.push("Source type/domain has stronger credibility signals.");
  }

  reasons.push(`Deterministic quality score ${input.score}.`);

  return dedupeReasons(reasons).slice(0, 6);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function countKeywordMatches(value: string, keywords: RegExp[]): number {
  return keywords.reduce((count, pattern) => count + countMatches(value, pattern), 0);
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons.map((reason) => reason.trim()).filter(Boolean)));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(clampScore(value) * 100) / 100;
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const titleBaitKeywords = [
  /\bdeep dive\b/gi,
  /\bexplained\b/gi,
  /\bguide to\b/gi,
  /\bpart\s+\d+\b/gi,
  /\(\s*\d+\s*\/\s*\d+\s*\)/g,
  /第\s*[0-9一二三四五六七八九十百]+\s*部分/g,
  /\bultimate guide\b/gi,
  /\badvanced guide\b/gi,
  /\bmastering\b/gi,
  /\bcomplete guide\b/gi,
  /\beverything you need to know\b/gi
];

const marketingKeywords = [
  /\bunlock\b/gi,
  /\bboost\b/gi,
  /\btransform\b/gi,
  /\brevolutioni[sz]e\b/gi,
  /\bgame[- ]changing\b/gi,
  /\bseamless\b/gi,
  /\bempower\b/gi,
  /\bleverage\b/gi,
  /\bcutting[- ]edge\b/gi,
  /\binnovative solutions?\b/gi,
  /\bskyrocket\b/gi,
  /\bultimate\b/gi
];

const mechanismKeywords = [
  /\barchitecture\b/gi,
  /\balgorithm\b/gi,
  /\bbenchmark\b/gi,
  /\bevaluation\b/gi,
  /\bexperiment\b/gi,
  /\bimplementation\b/gi,
  /\bprotocol\b/gi,
  /\bmethod\b/gi,
  /\bmechanism\b/gi,
  /\blatency\b/gi,
  /\bthroughput\b/gi,
  /\bparameter\b/gi,
  /\bdataset\b/gi,
  /\berror\b/gi,
  /\btrade[- ]off\b/gi,
  /\bcase study\b/gi,
  /\b代码\b/g,
  /\b架构\b/g,
  /\b机制\b/g,
  /\b实验\b/g,
  /\b数据\b/g,
  /\b延迟\b/g,
  /\b吞吐\b/g,
  /\b评估\b/g
];
