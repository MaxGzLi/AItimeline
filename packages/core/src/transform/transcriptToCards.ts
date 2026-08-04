import { runDeterministicAgentHarness } from "../harness/runner.js";
import { createSourceRegistry } from "../source/sourceRegistry.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import type {
  AgentHarnessRun,
  HarnessValidationResult,
  KnowledgeChunk,
  KnowledgePost,
  Source,
  SourceAsset,
  SourceRegistry
} from "../types.js";

export interface TranscriptSegment {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

export interface TranscriptTransformResult {
  source: Source;
  chunks: KnowledgeChunk[];
  cards: KnowledgePost[];
  sourceRegistry: SourceRegistry;
  harnessRun: AgentHarnessRun;
  validation: HarnessValidationResult[];
}

export interface TranscriptTransformOptions {
  createdAt?: string;
  recommendedBecause?: string;
  asset?: SourceAsset;
  contentLanguage?: ContentLanguage;
}

// 字幕轴一条只有三四十个字符(半句话),直接当 chunk 会让来源质检的
// 首/中/尾取样只看到一百来个字符,判成「内容密度极低」。先攒成段落体量。
const transcriptChunkTargetLength = 320;

export function mergeTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const merged: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;

  for (const segment of segments) {
    const text = segment.text.trim();

    if (!text) {
      continue;
    }

    if (!current) {
      current = { ...segment, text };
      continue;
    }

    const next: string = `${current.text} ${text}`;

    if (next.length >= transcriptChunkTargetLength) {
      merged.push(current);
      current = { ...segment, text };
      continue;
    }

    current = { startTimeSeconds: current.startTimeSeconds, endTimeSeconds: segment.endTimeSeconds, text: next };
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}

export function buildTranscriptChunks(source: Source, segments: TranscriptSegment[]): KnowledgeChunk[] {
  return mergeTranscriptSegments(segments).map((segment, index) => ({
    id: `${source.id}-chunk-${index + 1}`,
    sourceId: source.id,
    content: segment.text,
    startTimeSeconds: segment.startTimeSeconds,
    endTimeSeconds: segment.endTimeSeconds,
    conceptHints: extractConcepts(segment.text)
  }));
}

export function transformTranscriptToCards(
  source: Source,
  segments: TranscriptSegment[],
  options: TranscriptTransformOptions = {}
): TranscriptTransformResult {
  const createdAt = options.createdAt ?? new Date().toISOString();

  const chunks = buildTranscriptChunks(source, segments);

  const sourceRegistry = createSourceRegistry({
    sources: [source],
    assets: options.asset ? [options.asset] : [],
    chunks,
    createdAt
  });

  const harnessResult = runDeterministicAgentHarness({
    source,
    chunks,
    sourceRegistry,
    contentLanguage: options.contentLanguage,
    createdAt,
    recommendedBecause: options.recommendedBecause
  });

  return {
    source,
    chunks,
    cards: harnessResult.posts,
    sourceRegistry,
    harnessRun: harnessResult.run,
    validation: harnessResult.validation
  };
}

function extractConcepts(text: string): string[] {
  const conceptCandidates = [
    "AI Agent",
    "RAG",
    "Knowledge Graph",
    "Memory",
    "Recommendation",
    "Evaluation",
    "NotebookLM",
    "YouTube"
  ];

  const lowerText = text.toLowerCase();

  return conceptCandidates.filter((concept) => lowerText.includes(concept.toLowerCase()));
}
