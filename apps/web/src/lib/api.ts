import { t } from "./i18n";

export const apiBaseUrl = (import.meta.env.VITE_AITIMELINE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
export const sampleSourceUrl = `${apiBaseUrl}/fixtures/article`;

/** HTTP error with the response status, so callers can tell business 4xx from outages. */
export class ApiHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

/** Transport-level failures (fetch rejection, timeout) — the only errors that mean "offline". */
export function isTransportError(error: unknown): boolean {
  if (error instanceof ApiHttpError) {
    return false;
  }

  return error instanceof TypeError || isAbortError(error);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Aborts reach callers in several shapes (DOMException, plain Error with
 * name "AbortError", or a wrapped message), and none of them are readable
 * enough to show a user.
 */
export function isAbortLikeError(error: unknown): boolean {
  if (isAbortError(error) || error instanceof DOMException) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message.toLowerCase().includes("abort");
}

const defaultTimeoutMs = 20000;

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
    keepalive?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  // Every request gets a timeout so a hung endpoint cannot accumulate open
  // connections across polls; callers can additionally pass their own signal.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);
  const forwardAbort = () => controller.abort();

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", forwardAbort, { once: true });
    }
  }

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "content-type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      keepalive: options.keepalive,
      signal: controller.signal
    });
    const payload = (await response.json()) as unknown;

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : t("api.requestFailed", { status: response.status });

      throw new ApiHttpError(message, response.status);
    }

    return payload as T;
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();

    return (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be"
    );
  } catch {
    return false;
  }
}

// Channel-shaped YouTube URLs cannot be imported as a single video; the
// import form redirects them to the subscription flow instead.
export function isYouTubeChannelUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();

    if (host !== "youtube.com" && !host.endsWith(".youtube.com")) {
      return false;
    }

    if (parsedUrl.pathname === "/feeds/videos.xml") {
      return parsedUrl.searchParams.has("channel_id");
    }

    const firstSegment = parsedUrl.pathname.split("/").filter(Boolean)[0] ?? "";

    return firstSegment.startsWith("@") || firstSegment === "channel" || firstSegment === "c" || firstSegment === "user";
  } catch {
    return false;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface CardMediaItem {
  assetId: string;
  caption: string;
  origin: "paper" | "derived" | "article" | "video";
  url?: string;
  figureLabel?: string;
}

export function getCardMedia(card: unknown): CardMediaItem[] {
  if (!isRecord(card) || !Array.isArray(card.media)) {
    return [];
  }

  return card.media.filter(
    (item): item is CardMediaItem =>
      isRecord(item) && typeof item.assetId === "string" && typeof item.caption === "string" && typeof item.url === "string"
  );
}

export function resolveMediaUrl(url: string): string {
  return url.startsWith("/") ? `${apiBaseUrl}${url}` : url;
}
