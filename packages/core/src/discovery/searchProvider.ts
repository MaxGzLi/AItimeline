import type { SourceType } from "../types.js";

export interface DiscoveredSource {
  url: string;
  title: string;
  snippet?: string;
  publishedAt?: string;
  sourceType?: SourceType;
}

export interface SearchProviderOptions {
  limit?: number;
}

export interface SearchProvider {
  id: string;
  search(query: string, options?: SearchProviderOptions): Promise<DiscoveredSource[]>;
}

/**
 * Deterministic provider for tests and offline demos: returns the configured
 * results for an exact query match, otherwise the fallback list.
 */
export function createStaticSearchProvider(
  resultsByQuery: Record<string, DiscoveredSource[]>,
  fallback: DiscoveredSource[] = []
): SearchProvider {
  return {
    id: "static",
    async search(query, options = {}) {
      const results = resultsByQuery[query] ?? fallback;

      return results.slice(0, options.limit ?? results.length);
    }
  };
}

export interface TavilySearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface TavilyResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
  }>;
}

const defaultTavilyBaseUrl = "https://api.tavily.com";

export function createTavilySearchProvider(options: TavilySearchProviderOptions): SearchProvider {
  const endpoint = `${(options.baseUrl ?? defaultTavilyBaseUrl).replace(/\/+$/, "")}/search`;

  return {
    id: "tavily",
    async search(query, searchOptions = {}) {
      const fetchImpl = options.fetch ?? globalThis.fetch;

      if (!fetchImpl) {
        throw new Error("A fetch implementation is required to call the Tavily search API.");
      }

      const timeoutMs = options.timeoutMs ?? 20000;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: options.apiKey,
            query,
            max_results: searchOptions.limit ?? 5
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`search request failed with ${response.status}.`);
        }

        const parsed = (await response.json()) as TavilyResponse;

        return (parsed.results ?? [])
          .filter((result) => typeof result.url === "string" && result.url)
          .map((result) => ({
            url: result.url as string,
            title: result.title?.trim() || (result.url as string),
            snippet: result.content,
            publishedAt: result.published_date
          }));
      } catch (error) {
        if (controller.signal.aborted && error instanceof Error && error.name === "AbortError") {
          throw new Error(`search request timed out after ${timeoutMs}ms`);
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
