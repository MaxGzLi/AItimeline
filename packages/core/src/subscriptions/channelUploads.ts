export interface ChannelUploadsVideo {
  videoId: string;
  title: string;
  publishedText?: string;
}

export interface ChannelUploadsResult {
  videos: ChannelUploadsVideo[];
  truncated: boolean;
}

export interface FetchChannelUploadsOptions {
  fetch?: typeof fetch;
  maxPages?: number;
}

const youtubeChannelIdPattern = /^UC[A-Za-z0-9_-]{20,}$/;
const defaultMaxPages = 10;

export function buildUploadsPlaylistUrl(channelId: string): string {
  if (!youtubeChannelIdPattern.test(channelId)) {
    throw new Error("A YouTube channel id starting with UC is required.");
  }

  const url = new URL("https://www.youtube.com/playlist");
  url.searchParams.set("list", `UU${channelId.slice(2)}`);

  return url.toString();
}

// Enumerates a channel's full uploads playlist (newest first). The RSS feed
// only exposes the latest ~15 videos, so backlog cataloging must read the
// playlist page instead; pagination goes through the InnerTube browse
// endpoint the page itself uses.
export async function fetchChannelUploads(
  channelId: string,
  options: FetchChannelUploadsOptions = {}
): Promise<ChannelUploadsResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("A fetch implementation is required to enumerate channel uploads.");
  }

  const maxPages = options.maxPages ?? defaultMaxPages;
  const html = await fetchText(fetchImpl, buildUploadsPlaylistUrl(channelId));
  const initialData = extractInitialData(html);
  const byVideoId = new Map<string, ChannelUploadsVideo>();
  let continuationToken = collectPlaylistPage(initialData, byVideoId);
  let pagesFetched = 1;

  if (continuationToken) {
    const innertube = extractInnertubeConfig(html);

    while (continuationToken && pagesFetched < maxPages) {
      const page = await fetchContinuationPage(fetchImpl, innertube, continuationToken);

      continuationToken = collectPlaylistPage(page, byVideoId);
      pagesFetched += 1;
    }
  }

  if (!byVideoId.size) {
    throw new Error("No videos were found on the uploads playlist page.");
  }

  return {
    videos: Array.from(byVideoId.values()),
    truncated: Boolean(continuationToken)
  };
}

interface InnertubeConfig {
  apiKey: string;
  clientVersion: string;
}

async function fetchContinuationPage(
  fetchImpl: typeof fetch,
  innertube: InnertubeConfig,
  continuationToken: string
): Promise<unknown> {
  const url = new URL("https://www.youtube.com/youtubei/v1/browse");
  url.searchParams.set("key", innertube.apiKey);
  url.searchParams.set("prettyPrint", "false");

  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: innertube.clientVersion } },
      continuation: continuationToken
    })
  });

  if (!response.ok) {
    throw new Error(`Uploads playlist request failed with ${response.status}.`);
  }

  return response.json();
}

// Walks the whole response instead of hard-coding renderer paths: YouTube
// serves the classic playlistVideoRenderer layout or the newer
// lockupViewModel layout depending on rollout, and moves both between
// wrappers, but the leaf object shapes are stable.
function collectPlaylistPage(value: unknown, byVideoId: Map<string, ChannelUploadsVideo>): string | undefined {
  let continuationToken: string | undefined;
  const addVideo = (video: ChannelUploadsVideo | undefined) => {
    if (video && !byVideoId.has(video.videoId)) {
      byVideoId.set(video.videoId, video);
    }
  };

  visitObjects(value, (node) => {
    const classicRenderer = node.playlistVideoRenderer;

    if (isRecord(classicRenderer)) {
      addVideo(readClassicPlaylistVideo(classicRenderer));
    }

    const lockup = node.lockupViewModel;

    if (isRecord(lockup)) {
      addVideo(readLockupVideo(lockup));
    }

    // Matches both continuation shapes: the classic
    // continuationEndpoint.continuationCommand.token and the lockup-era
    // innertubeCommand.continuationCommand.token.
    const command = node.continuationCommand;

    if (
      !continuationToken &&
      isRecord(command) &&
      typeof command.token === "string" &&
      command.token.trim()
    ) {
      continuationToken = command.token;
    }
  });

  return continuationToken;
}

function readClassicPlaylistVideo(renderer: Record<string, unknown>): ChannelUploadsVideo | undefined {
  const videoId = typeof renderer.videoId === "string" ? renderer.videoId.trim() : "";

  if (!videoId) {
    return undefined;
  }

  return {
    videoId,
    title: readTextRuns(renderer.title) || `YouTube video ${videoId}`,
    publishedText: findPublishedText(renderer.videoInfo)
  };
}

function readLockupVideo(lockup: Record<string, unknown>): ChannelUploadsVideo | undefined {
  if (lockup.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") {
    return undefined;
  }

  const videoId = typeof lockup.contentId === "string" ? lockup.contentId.trim() : "";

  if (!videoId) {
    return undefined;
  }

  let title = "";

  visitObjects(lockup.metadata, (node) => {
    if (!title && isRecord(node.title) && typeof node.title.content === "string" && node.title.content.trim()) {
      title = node.title.content.trim();
    }
  });

  return {
    videoId,
    title: title || `YouTube video ${videoId}`,
    publishedText: findPublishedText(lockup.metadata)
  };
}

function readTextRuns(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }

  if (typeof value.simpleText === "string") {
    return value.simpleText.trim();
  }

  if (Array.isArray(value.runs)) {
    return value.runs
      .map((run) => (isRecord(run) && typeof run.text === "string" ? run.text : ""))
      .join("")
      .trim();
  }

  return "";
}

// Playlist pages only carry relative dates ("3 years ago"); keep the raw
// text for display instead of pretending to know an absolute date.
function findPublishedText(value: unknown): string | undefined {
  const matches: string[] = [];

  visitObjects(value, (node) => {
    for (const candidate of [node.text, node]) {
      if (isRecord(candidate) && typeof candidate.content === "string" && /\bago\b|前/.test(candidate.content)) {
        matches.push(candidate.content.trim());
      }
    }

    if (typeof node.text === "string" && /\bago\b|前/.test(node.text)) {
      matches.push(node.text.trim());
    }

    if (Array.isArray(node.runs)) {
      for (const run of node.runs) {
        if (isRecord(run) && typeof run.text === "string" && /\bago\b|前/.test(run.text)) {
          matches.push(run.text.trim());
        }
      }
    }
  });

  return matches[matches.length - 1];
}

function extractInitialData(html: string): unknown {
  const markerIndex = html.indexOf("ytInitialData");

  if (markerIndex < 0) {
    throw new Error("Could not find playlist data on the uploads playlist page.");
  }

  const objectStart = html.indexOf("{", markerIndex);
  const objectJson = extractBalancedJsonObject(html, objectStart);

  return JSON.parse(objectJson);
}

function extractInnertubeConfig(html: string): InnertubeConfig {
  const apiKey = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1];

  if (!apiKey || !clientVersion) {
    throw new Error("Could not read the playlist pagination settings from the page.");
  }

  return { apiKey, clientVersion };
}

function extractBalancedJsonObject(value: string, objectStart: number): string {
  if (objectStart < 0) {
    throw new Error("Could not find playlist JSON on the uploads playlist page.");
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

  throw new Error("Playlist JSON on the uploads playlist page was incomplete.");
}

function visitObjects(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitObjects(item, visit);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  visit(value);

  for (const item of Object.values(value)) {
    visitObjects(item, visit);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchText(fetchImpl: typeof fetch, url: string): Promise<string> {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Uploads playlist request failed with ${response.status}.`);
  }

  return response.text();
}
