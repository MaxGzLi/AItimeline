import type {
  AgentHarnessRun,
  KnowledgePostAgentRunner,
  Source,
  SourceAsset,
  SourceImport
} from "../types.js";
import { runSourceImport } from "../source/sourceImportWorker.js";
import { createSourceRegistry } from "../source/sourceRegistry.js";
import {
  buildTranscriptChunks,
  type TranscriptSegment,
  type TranscriptTransformResult
} from "./transcriptToCards.js";
import { parseYouTubeVideoId } from "./mockYoutubeImport.js";

export interface YouTubeTranscriptTrack {
  baseUrl: string;
  languageCode: string;
  name: string;
  kind?: string;
}

export interface YouTubeTranscriptFetchOptions {
  fetch?: typeof fetch;
  languagePreferences?: string[];
  createdAt?: string;
}

export interface YouTubeTranscriptFetchResult {
  videoId: string;
  source: Source;
  asset: SourceAsset;
  segments: TranscriptSegment[];
  track: YouTubeTranscriptTrack;
}

export interface YouTubeTransformOptions extends YouTubeTranscriptFetchOptions {
  recommendedBecause?: string;
  runner?: KnowledgePostAgentRunner;
}

export interface YouTubeTransformResult extends Omit<TranscriptTransformResult, "harnessRun"> {
  harnessRun?: AgentHarnessRun;
  asset: SourceAsset;
  importRecord: SourceImport;
  track: YouTubeTranscriptTrack;
}

interface YouTubePlayerResponse {
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: YouTubeCaptionTrack[];
    };
  };
}

interface YouTubeCaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
}

interface YouTubeJson3Transcript {
  events?: Array<{
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }>;
}

const defaultLanguagePreferences = ["en", "en-US", "zh", "zh-CN"];

export async function fetchYouTubeTranscript(
  url: string,
  options: YouTubeTranscriptFetchOptions = {}
): Promise<YouTubeTranscriptFetchResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("A fetch implementation is required to import a YouTube transcript.");
  }

  const videoId = parseYouTubeVideoId(url);

  if (!videoId) {
    throw new Error("Please enter a valid YouTube URL.");
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  const watchHtml = await fetchText(fetchImpl, buildWatchUrl(videoId));
  const playerResponse = extractPlayerResponse(watchHtml);
  const track = selectCaptionTrack(
    playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [],
    options.languagePreferences ?? defaultLanguagePreferences
  );
  const timedText = await fetchText(fetchImpl, buildTimedTextUrl(track.baseUrl));
  const segments = parseTranscriptSegments(timedText);

  if (!segments.length) {
    throw new Error("YouTube transcript did not contain any readable segments.");
  }

  const source: Source = {
    id: `youtube-${videoId}`,
    title: playerResponse.videoDetails?.title ?? `YouTube video ${videoId}`,
    url,
    type: "youtube",
    author: playerResponse.videoDetails?.author,
    durationSeconds: parseDurationSeconds(playerResponse.videoDetails?.lengthSeconds)
  };
  const asset: SourceAsset = {
    id: `${source.id}-transcript`,
    sourceId: source.id,
    kind: "transcript",
    content: segments.map((segment) => segment.text).join("\n\n"),
    createdAt
  };

  return {
    videoId,
    source,
    asset,
    segments,
    track
  };
}

export async function transformYouTubeUrl(
  url: string,
  options: YouTubeTransformOptions = {}
): Promise<YouTubeTransformResult> {
  const fetched = await fetchYouTubeTranscript(url, options);
  const createdAt = options.createdAt ?? fetched.asset.createdAt;
  const chunks = buildTranscriptChunks(fetched.source, fetched.segments);
  const sourceRegistry = createSourceRegistry({
    sources: [fetched.source],
    assets: [fetched.asset],
    chunks,
    createdAt
  });
  const importResult = await runSourceImport(
    {
      source: fetched.source,
      assets: [fetched.asset],
      chunks,
      sourceRegistry,
      createdAt,
      recommendedBecause:
        options.recommendedBecause ??
        "你导入了这个 YouTube 视频,所以把字幕里的要点转成了时间线卡片。"
    },
    options.runner
  );

  return {
    source: fetched.source,
    chunks,
    cards: importResult.posts,
    sourceRegistry: importResult.sourceRegistry,
    harnessRun: importResult.harnessRun,
    validation: importResult.validation,
    asset: fetched.asset,
    track: fetched.track,
    importRecord: importResult.importRecord
  };
}

async function fetchText(fetchImpl: typeof fetch, url: string): Promise<string> {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`YouTube transcript request failed with ${response.status}.`);
  }

  return response.text();
}

function buildWatchUrl(videoId: string): string {
  const url = new URL("https://www.youtube.com/watch");
  url.searchParams.set("v", videoId);

  return url.toString();
}

function buildTimedTextUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", "json3");

  return url.toString();
}

function extractPlayerResponse(html: string): YouTubePlayerResponse {
  const markerIndex = html.indexOf("ytInitialPlayerResponse");

  if (markerIndex < 0) {
    throw new Error("Could not find YouTube player response in watch page.");
  }

  const objectStart = html.indexOf("{", markerIndex);
  const objectJson = extractBalancedJsonObject(html, objectStart);

  return JSON.parse(objectJson) as YouTubePlayerResponse;
}

function extractBalancedJsonObject(value: string, objectStart: number): string {
  if (objectStart < 0) {
    throw new Error("Could not find YouTube player response JSON.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return value.slice(objectStart, index + 1);
      }
    }
  }

  throw new Error("YouTube player response JSON was incomplete.");
}

function selectCaptionTrack(
  tracks: YouTubeCaptionTrack[],
  languagePreferences: string[]
): YouTubeTranscriptTrack {
  if (!tracks.length) {
    throw new Error("This YouTube video does not expose transcript tracks.");
  }

  const selected =
    languagePreferences
      .map((language) => tracks.find((track) => track.languageCode === language))
      .find(Boolean) ??
    tracks.find((track) => track.kind !== "asr") ??
    tracks[0];

  if (!selected?.baseUrl || !selected.languageCode) {
    throw new Error("YouTube transcript track is missing a URL or language code.");
  }

  return {
    baseUrl: selected.baseUrl,
    languageCode: selected.languageCode,
    kind: selected.kind,
    name: selected.name?.simpleText ?? selected.name?.runs?.map((run) => run.text ?? "").join("") ?? selected.languageCode
  };
}

function parseTranscriptSegments(timedText: string): TranscriptSegment[] {
  try {
    const parsed = JSON.parse(timedText) as YouTubeJson3Transcript;
    const segments = parseJson3Segments(parsed);

    if (segments.length) {
      return segments;
    }
  } catch {
    return parseXmlSegments(timedText);
  }

  return parseXmlSegments(timedText);
}

function parseJson3Segments(transcript: YouTubeJson3Transcript): TranscriptSegment[] {
  return (transcript.events ?? [])
    .map((event) => {
      const text = normalizeTranscriptText((event.segs ?? []).map((segment) => segment.utf8 ?? "").join(""));

      if (!text || typeof event.tStartMs !== "number") {
        return null;
      }

      const startTimeSeconds = roundSeconds(event.tStartMs / 1000);
      const endTimeSeconds = roundSeconds((event.tStartMs + (event.dDurationMs ?? 0)) / 1000);

      return {
        startTimeSeconds,
        endTimeSeconds: endTimeSeconds > startTimeSeconds ? endTimeSeconds : startTimeSeconds,
        text
      };
    })
    .filter((segment): segment is TranscriptSegment => segment !== null);
}

function parseXmlSegments(xml: string): TranscriptSegment[] {
  return Array.from(xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g))
    .map((match) => {
      const attributes = match[1] ?? "";
      const start = Number.parseFloat(readXmlAttribute(attributes, "start") ?? "");
      const duration = Number.parseFloat(readXmlAttribute(attributes, "dur") ?? "0");
      const text = normalizeTranscriptText(decodeHtmlEntities(match[2] ?? ""));

      if (!Number.isFinite(start) || !text) {
        return null;
      }

      return {
        startTimeSeconds: roundSeconds(start),
        endTimeSeconds: roundSeconds(start + duration),
        text
      };
    })
    .filter((segment): segment is TranscriptSegment => segment !== null);
}

function readXmlAttribute(attributes: string, key: string): string | undefined {
  return attributes.match(new RegExp(`${key}="([^"]*)"`))?.[1];
}

function normalizeTranscriptText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseDurationSeconds(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const duration = Number.parseInt(value, 10);

  return Number.isFinite(duration) ? duration : undefined;
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}
