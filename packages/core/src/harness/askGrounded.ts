import { getChunksForSource, getRegistryChunk, getRegistrySource } from "../source/sourceRegistry.js";
import type { KnowledgeChunk, KnowledgePost, SourceOrigin, SourceRegistry } from "../types.js";
import { getGroundedAnswerLanguagePolicy, type ContentLanguage } from "./contentLanguage.js";
import { validateClaimSupport } from "./groundingGate.js";
import type { ModelClient } from "./modelRunner.js";

export interface GroundedAnswerCitation {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  quote: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  origin?: SourceOrigin;
}

export interface GroundedAnswer {
  answer: string;
  citations: GroundedAnswerCitation[];
  grounded: boolean;
  runnerKind: "model" | "deterministic";
}

export interface AskGroundedInput {
  post: KnowledgePost;
  registry: SourceRegistry;
  question: string;
}

export interface AskGroundedOptions {
  client?: ModelClient;
  contentLanguage?: ContentLanguage;
  maxChunks?: number;
  temperature?: number;
}

interface GroundedExcerpt extends GroundedAnswerCitation {
  index: number;
}

const defaultMaxChunks = 6;
const maxQuoteLength = 280;

export async function askGrounded(
  input: AskGroundedInput,
  options: AskGroundedOptions = {}
): Promise<GroundedAnswer> {
  const contentLanguage = options.contentLanguage ?? "zh";
  const excerpts = resolveExcerpts(input.post, input.registry, options.maxChunks ?? defaultMaxChunks);

  if (!excerpts.length) {
    return buildInsufficientEvidenceAnswer(contentLanguage, "deterministic");
  }

  if (!options.client) {
    return buildDeterministicAnswer(input, excerpts, contentLanguage);
  }

  return buildModelAnswer(input, excerpts, options.client, options.temperature ?? 0.2, contentLanguage);
}

function resolveExcerpts(post: KnowledgePost, registry: SourceRegistry, maxChunks: number): GroundedExcerpt[] {
  const chunks: KnowledgeChunk[] = [];
  const seen = new Set<string>();
  const addChunk = (chunk: KnowledgeChunk | undefined) => {
    if (chunk && !seen.has(chunk.id)) {
      seen.add(chunk.id);
      chunks.push(chunk);
    }
  };

  for (const citation of post.citations ?? []) {
    if (citation.chunkId) {
      addChunk(getRegistryChunk(registry, citation.chunkId));
      continue;
    }

    getChunksForSource(registry, citation.sourceId).forEach(addChunk);
  }

  if (!chunks.length) {
    for (const source of post.sources) {
      getChunksForSource(registry, source.id).forEach(addChunk);
    }
  }

  return chunks.slice(0, maxChunks).map((chunk, index) => {
    const source = getRegistrySource(registry, chunk.sourceId);

    return {
      index: index + 1,
      sourceId: chunk.sourceId,
      sourceTitle: source?.title ?? post.sources[0]?.title ?? chunk.sourceId,
      chunkId: chunk.id,
      quote: trimQuote(chunk.content),
      startTimeSeconds: chunk.startTimeSeconds,
      endTimeSeconds: chunk.endTimeSeconds,
      origin: source?.origin
    };
  });
}

async function buildModelAnswer(
  input: AskGroundedInput,
  excerpts: GroundedExcerpt[],
  client: ModelClient,
  temperature: number,
  contentLanguage: ContentLanguage
): Promise<GroundedAnswer> {
  const response = await client.complete({
    messages: [
      { role: "system", content: getAskSystemPrompt(contentLanguage) },
      { role: "user", content: buildAskUserPrompt(input.post, input.question, excerpts) }
    ],
    responseFormat: "json_object",
    temperature
  });
  const parsed = parseModelAnswer(response.content);

  if (parsed) {
    const citations = mapCitedExcerpts(parsed.citedExcerpts, excerpts);
    const support = validateClaimSupport(
      parsed.answer,
      citations.map((citation) => citation.quote),
      {
        minOverlap: 1,
        minimumSharedTokens: 2,
        checkProperNouns: true,
        allowBeyondSource: false
      }
    );

    if (citations.length && support.supported) {
      return {
        answer: parsed.answer,
        citations,
        grounded: true,
        runnerKind: "model"
      };
    }
  }

  return buildInsufficientEvidenceAnswer(contentLanguage, "model");
}

function buildInsufficientEvidenceAnswer(
  contentLanguage: ContentLanguage,
  runnerKind: GroundedAnswer["runnerKind"]
): GroundedAnswer {
  return {
    answer:
      contentLanguage === "en"
        ? "There is not enough evidence in your library to answer this question."
        : "库内暂无足够依据回答这个问题。",
    citations: [],
    grounded: false,
    runnerKind
  };
}

function buildDeterministicAnswer(
  input: AskGroundedInput,
  excerpts: GroundedExcerpt[],
  contentLanguage: ContentLanguage
): GroundedAnswer {
  const source = input.post.sources[0];
  const top = excerpts[0];
  const timestamp = top?.startTimeSeconds !== undefined ? ` (${formatTimestamp(top.startTimeSeconds)})` : "";
  const answer = (contentLanguage === "en"
    ? [
        `From "${source?.title ?? "this source"}"${timestamp}: ${input.post.keyTakeaway}`,
        top ? `Evidence: ${top.quote}` : `Evidence: ${input.post.summary}`,
        `Your question: "${input.question}".`
      ]
    : [
        `根据《${source?.title ?? "这个来源"}》${timestamp}:${input.post.keyTakeaway}`,
        top ? `依据:${top.quote}` : `依据:${input.post.summary}`,
        `你的问题是:「${input.question}」。`
      ])
    .filter(Boolean)
    .join("\n\n");

  return {
    answer,
    citations: excerpts.map(toCitation),
    grounded: excerpts.length > 0,
    runnerKind: "deterministic"
  };
}

export function getAskSystemPrompt(language: ContentLanguage = "zh"): string {
  return `You are the AITimeline study assistant.

Answer the learner's question using only the numbered source excerpts provided. Do not use outside knowledge. Cite the excerpts you used by their number. If the excerpts do not contain the answer, say you cannot find it in the source instead of guessing.
Write mathematical formulas in LaTeX: inline \`$...$\`, display \`$$...$$\`; do not flatten them into Unicode subscripts/superscripts.

${getGroundedAnswerLanguagePolicy(language).join("\n")}

Return exactly one JSON object in this shape and nothing else:
{"answer": string, "citedExcerpts": number[]}`;
}

export const askSystemPrompt = getAskSystemPrompt("zh");

function buildAskUserPrompt(post: KnowledgePost, question: string, excerpts: GroundedExcerpt[]): string {
  const excerptText = excerpts.length
    ? excerpts
        .map((excerpt) => {
          const time = excerpt.startTimeSeconds !== undefined ? ` (${formatTimestamp(excerpt.startTimeSeconds)})` : "";
          return `[${excerpt.index}] ${excerpt.sourceTitle}${time}: ${excerpt.quote}`;
        })
        .join("\n")
    : "(no source excerpts are available for this card)";

  return [
    `Card title: ${post.title}`,
    `Card key takeaway: ${post.keyTakeaway}`,
    "",
    "Source excerpts:",
    excerptText,
    "",
    `Question: ${question}`
  ].join("\n");
}

interface ParsedModelAnswer {
  answer: string;
  citedExcerpts: number[];
}

function parseModelAnswer(content: string): ParsedModelAnswer | null {
  const payload = extractJsonPayload(content);

  try {
    const parsed = JSON.parse(payload) as unknown;

    if (!isRecord(parsed) || typeof parsed.answer !== "string" || parsed.answer.trim() === "") {
      return null;
    }

    if (
      !Array.isArray(parsed.citedExcerpts) ||
      !parsed.citedExcerpts.every((value): value is number => typeof value === "number" && Number.isInteger(value))
    ) {
      return null;
    }

    return { answer: parsed.answer.trim(), citedExcerpts: parsed.citedExcerpts };
  } catch {
    return null;
  }
}

function extractJsonPayload(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

function mapCitedExcerpts(citedExcerpts: number[], excerpts: GroundedExcerpt[]): GroundedAnswerCitation[] {
  const byIndex = new Map(excerpts.map((excerpt) => [excerpt.index, excerpt]));

  return dedupeCitations(
    citedExcerpts
      .map((index) => byIndex.get(index))
      .filter((excerpt): excerpt is GroundedExcerpt => excerpt !== undefined)
      .map(toCitation)
  );
}

function dedupeCitations(citations: GroundedAnswerCitation[]): GroundedAnswerCitation[] {
  const seen = new Set<string>();

  return citations.filter((citation) => {
    if (seen.has(citation.chunkId)) {
      return false;
    }

    seen.add(citation.chunkId);
    return true;
  });
}

function toCitation(excerpt: GroundedExcerpt): GroundedAnswerCitation {
  return {
    sourceId: excerpt.sourceId,
    sourceTitle: excerpt.sourceTitle,
    chunkId: excerpt.chunkId,
    quote: excerpt.quote,
    startTimeSeconds: excerpt.startTimeSeconds,
    endTimeSeconds: excerpt.endTimeSeconds,
    origin: excerpt.origin
  };
}

function trimQuote(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  return normalized.length > maxQuoteLength ? `${normalized.slice(0, maxQuoteLength - 3)}...` : normalized;
}

function formatTimestamp(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
