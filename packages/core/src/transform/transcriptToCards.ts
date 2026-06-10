import { runDeterministicAgentHarness } from "../harness/runner.js";
import { createSourceRegistry } from "../source/sourceRegistry.js";
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
}

export function transformTranscriptToCards(
  source: Source,
  segments: TranscriptSegment[],
  options: TranscriptTransformOptions = {}
): TranscriptTransformResult {
  const createdAt = options.createdAt ?? new Date().toISOString();

  const chunks = segments.map((segment, index) => ({
    id: `${source.id}-chunk-${index + 1}`,
    sourceId: source.id,
    content: segment.text,
    startTimeSeconds: segment.startTimeSeconds,
    endTimeSeconds: segment.endTimeSeconds,
    conceptHints: extractConcepts(segment.text)
  }));

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
