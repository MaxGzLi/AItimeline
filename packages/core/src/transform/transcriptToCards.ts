import { createKnowledgePost } from "../harness/postHarness";
import type { KnowledgeChunk, KnowledgePost, Source } from "../types";

export interface TranscriptSegment {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

export interface TranscriptTransformResult {
  source: Source;
  chunks: KnowledgeChunk[];
  cards: KnowledgePost[];
}

export interface TranscriptTransformOptions {
  createdAt?: string;
  recommendedBecause?: string;
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

  const cards = chunks.map((chunk, index) =>
    createKnowledgePost({
      source,
      chunk,
      index,
      createdAt,
      recommendedBecause:
        options.recommendedBecause ?? "This source was imported and converted into timeline-ready knowledge."
    })
  );

  return { source, chunks, cards };
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
