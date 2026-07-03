import type { Source, SourceAsset, SourceImport } from "../types.js";
import {
  transformTranscriptToCards,
  type TranscriptSegment,
  type TranscriptTransformResult
} from "./transcriptToCards.js";

export interface MockYouTubeImportResult extends TranscriptTransformResult {
  asset: SourceAsset;
  importRecord: SourceImport;
}

export function transformMockYouTubeUrl(url: string, createdAt = new Date().toISOString()): MockYouTubeImportResult {
  const videoId = parseYouTubeVideoId(url);

  if (!videoId) {
    throw new Error("Please enter a valid YouTube URL.");
  }

  const source: Source = {
    id: `youtube-${videoId}`,
    title: "How to turn source material into a personal knowledge timeline",
    url,
    type: "youtube",
    author: "AITimeline Demo Channel",
    publishedAt: "2026-06-08T00:00:00.000Z",
    durationSeconds: 934
  };

  const asset: SourceAsset = {
    id: `${source.id}-transcript`,
    sourceId: source.id,
    kind: "transcript",
    content: demoYouTubeTranscript.map((segment) => segment.text).join("\n\n"),
    createdAt
  };

  const transformed = transformTranscriptToCards(source, demoYouTubeTranscript, {
    asset,
    createdAt,
    recommendedBecause: "You imported this YouTube video, so the agent converted timestamped ideas into timeline cards."
  });

  return {
    ...transformed,
    asset,
    importRecord: {
      id: `${source.id}-import`,
      source,
      status: "ready",
      createdAt
    }
  };
}

export function parseYouTubeVideoId(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      return normalizeVideoId(parsedUrl.pathname.slice(1));
    }

    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoParam = parsedUrl.searchParams.get("v");

      if (videoParam) {
        return normalizeVideoId(videoParam);
      }

      // Only known video path shapes count; /results, /playlist etc. are not videos.
      const pathMatch = parsedUrl.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);

      return pathMatch ? normalizeVideoId(pathMatch[1]) : null;
    }
  } catch {
    return null;
  }

  return null;
}

const demoYouTubeTranscript: TranscriptSegment[] = [
  {
    startTimeSeconds: 42,
    endTimeSeconds: 126,
    text:
      "A useful AI Agent does not simply summarize a YouTube video. It extracts the parts that can become durable knowledge: the main claim, supporting context, open questions, and concepts that should connect to memory."
  },
  {
    startTimeSeconds: 127,
    endTimeSeconds: 236,
    text:
      "The NotebookLM pattern is source grounding. The timeline pattern is resurfacing. AITimeline should keep citations and timestamp links, then recommend the transformed card again when it matches the user's weak concepts."
  },
  {
    startTimeSeconds: 237,
    endTimeSeconds: 388,
    text:
      "Recommendation should combine user Memory, Knowledge Graph distance, freshness, and review urgency. The ranker should explain why a card appears so the feed feels like a learning system instead of a random stream."
  },
  {
    startTimeSeconds: 389,
    endTimeSeconds: 540,
    text:
      "RAG and Evaluation matter after import. The system needs to answer questions from the transcript with citations, then test whether the generated cards actually help the user remember and use the idea later."
  }
];

function normalizeVideoId(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^[a-zA-Z0-9_-]{6,}$/);

  return match ? trimmed : null;
}
