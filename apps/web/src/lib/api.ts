export const apiBaseUrl = (import.meta.env.VITE_AITIMELINE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
export const sampleSourceUrl = `${apiBaseUrl}/fixtures/article`;

export async function apiRequest<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `AITimeline API 请求失败,状态码 ${response.status}。`;

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
