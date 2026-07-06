import { t } from "./i18n";

export const apiBaseUrl = (import.meta.env.VITE_AITIMELINE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
export const sampleSourceUrl = `${apiBaseUrl}/fixtures/article`;

export async function apiRequest<T>(
  path: string,
  options: { method?: "GET" | "POST" | "DELETE"; body?: unknown; keepalive?: boolean } = {}
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    keepalive: options.keepalive
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : t("api.requestFailed", { status: response.status });

    throw new Error(message);
  }

  return payload as T;
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.hostname.includes("youtube.com") || parsedUrl.hostname.includes("youtu.be");
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
  origin: "paper" | "derived";
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
