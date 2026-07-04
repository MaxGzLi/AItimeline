// 手机端 API 客户端。逻辑参考 apps/web/src/lib/api.ts,但 baseUrl 不再来自
// import.meta.env,而是从设置页(AsyncStorage)注入,方便真机改成局域网 IP。
import type { InteractionSignal } from "@aitimeline/core";

import type {
  ApiCurationRunResponse,
  ApiNoteResponse,
  ApiReplyResponse,
  ApiSnapshot,
  ApiTimelineResponse
} from "./types";

export const defaultApiBaseUrl = "http://127.0.0.1:8787";

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
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

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const result = await apiRequest<{ ok?: boolean }>(baseUrl, "/health");
    return result.ok === true;
  } catch {
    return false;
  }
}

export function fetchTimeline(baseUrl: string): Promise<ApiTimelineResponse> {
  return apiRequest<ApiTimelineResponse>(baseUrl, "/api/timeline");
}

export function fetchSnapshot(baseUrl: string): Promise<ApiSnapshot> {
  return apiRequest<ApiSnapshot>(baseUrl, "/api/snapshot");
}

export function postSignal(baseUrl: string, signal: InteractionSignal): Promise<unknown> {
  return apiRequest(baseUrl, "/api/signals", { method: "POST", body: { signal } });
}

export function postNote(baseUrl: string, text: string): Promise<ApiNoteResponse> {
  return apiRequest<ApiNoteResponse>(baseUrl, "/api/notes", { method: "POST", body: { text } });
}

export function postReply(baseUrl: string, postId: string, text: string): Promise<ApiReplyResponse> {
  return apiRequest<ApiReplyResponse>(baseUrl, `/api/posts/${encodeURIComponent(postId)}/replies`, {
    method: "POST",
    body: { text }
  });
}

export function runCuration(baseUrl: string): Promise<ApiCurationRunResponse> {
  return apiRequest<ApiCurationRunResponse>(baseUrl, "/api/curation/run", { method: "POST", body: {} });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
