import type { KnowledgeCard, KnowledgeChunk, Source } from "../types";

export interface TranscriptSegment {
  startTimeSeconds: number;
  endTimeSeconds: number;
  text: string;
}

export interface TranscriptTransformResult {
  source: Source;
  chunks: KnowledgeChunk[];
  cards: KnowledgeCard[];
}

export function transformTranscriptToCards(source: Source, segments: TranscriptSegment[]): TranscriptTransformResult {
  const chunks = segments.map((segment, index) => ({
    id: `${source.id}-chunk-${index + 1}`,
    sourceId: source.id,
    content: segment.text,
    startTimeSeconds: segment.startTimeSeconds,
    endTimeSeconds: segment.endTimeSeconds,
    conceptHints: extractConcepts(segment.text)
  }));

  const cards = chunks.map((chunk, index) => {
    const concepts = chunk.conceptHints?.length ? chunk.conceptHints : ["Imported Knowledge"];

    return {
      id: `${source.id}-card-${index + 1}`,
      title: buildCardTitle(chunk.content, concepts[0]),
      summary: chunk.content,
      keyTakeaway: buildTakeaway(chunk.content),
      concepts,
      sources: [source],
      citations: [
        {
          sourceId: source.id,
          chunkId: chunk.id,
          url: source.url,
          startTimeSeconds: chunk.startTimeSeconds,
          endTimeSeconds: chunk.endTimeSeconds
        }
      ],
      recommendedBecause: "This source was imported and converted into timeline-ready knowledge.",
      trustState: "emerging" as const,
      createdAt: new Date().toISOString(),
      estimatedReadMinutes: Math.max(1, Math.ceil(chunk.content.length / 900))
    };
  });

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

function buildCardTitle(text: string, fallbackConcept: string): string {
  const sentence = text.split(/[.!?。！？]/).find((part) => part.trim().length > 16);
  const title = sentence?.trim() ?? `${fallbackConcept} from imported source`;

  return title.length > 96 ? `${title.slice(0, 93)}...` : title;
}

function buildTakeaway(text: string): string {
  const sentence = text.split(/[.!?。！？]/).find((part) => part.trim().length > 20);
  const takeaway = sentence?.trim() ?? text.trim();

  return takeaway.length > 140 ? `${takeaway.slice(0, 137)}...` : takeaway;
}
