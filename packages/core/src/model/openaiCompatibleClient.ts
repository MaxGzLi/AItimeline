import type {
  ModelClient,
  ModelCompletionRequest,
  ModelCompletionResponse,
  ModelMessage
} from "../harness/modelRunner.js";

export interface OpenAICompatibleModelClientOptions {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  organization?: string;
  project?: string;
  timeoutMs?: number;
  maxTokens?: number;
  extraBody?: Record<string, unknown>;
}

export interface OpenAICompatibleModelClientEnv {
  AITIMELINE_MODEL_API_KEY?: string;
  AITIMELINE_MODEL_BASE_URL?: string;
  AITIMELINE_MODEL_DEEPREAD_API_KEY?: string;
  AITIMELINE_MODEL_DEEPREAD_BASE_URL?: string;
  AITIMELINE_MODEL_DEEPREAD_MAX_TOKENS?: string;
  AITIMELINE_MODEL_DEEPREAD_NAME?: string;
  AITIMELINE_MODEL_MAX_TOKENS?: string;
  AITIMELINE_MODEL_NAME?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

const defaultBaseUrl = "https://api.openai.com/v1";
const defaultMaxTokens = 8192;

export function createOpenAICompatibleModelClient(options: OpenAICompatibleModelClientOptions): ModelClient {
  const endpoint = `${normalizeBaseUrl(options.baseUrl ?? defaultBaseUrl)}/chat/completions`;

  return {
    complete: (request) => completeChat(endpoint, options, request)
  };
}

export function createOpenAICompatibleModelClientFromEnv(
  env: OpenAICompatibleModelClientEnv,
  overrides: Partial<OpenAICompatibleModelClientOptions> = {}
): ModelClient {
  const model = overrides.model ?? env.AITIMELINE_MODEL_NAME ?? env.OPENAI_MODEL;

  if (!model) {
    throw new Error("AITIMELINE_MODEL_NAME or OPENAI_MODEL is required to create a model client.");
  }

  return createOpenAICompatibleModelClient({
    ...overrides,
    model,
    apiKey: overrides.apiKey ?? env.AITIMELINE_MODEL_API_KEY ?? env.OPENAI_API_KEY,
    baseUrl: overrides.baseUrl ?? env.AITIMELINE_MODEL_BASE_URL ?? env.OPENAI_BASE_URL ?? defaultBaseUrl,
    maxTokens: overrides.maxTokens ?? parsePositiveInteger(env.AITIMELINE_MODEL_MAX_TOKENS) ?? defaultMaxTokens
  });
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function completeChat(
  endpoint: string,
  options: OpenAICompatibleModelClientOptions,
  request: ModelCompletionRequest
): Promise<ModelCompletionResponse> {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("A fetch implementation is required to call an OpenAI-compatible model endpoint.");
  }

  const timeoutMs = options.timeoutMs ?? 60000;
  const controller = new AbortController();
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: buildHeaders(options),
      body: JSON.stringify(buildRequestBody(options, request)),
      signal: controller.signal
    });
    const responseText = await response.text();
    const parsed = parseResponseBody(responseText);

    if (!response.ok) {
      throw new Error(
        `model request failed with ${response.status}: ${extractApiError(parsed) ?? responseText}`
      );
    }

    return {
      content: extractAssistantContent(parsed),
      raw: parsed
    };
  } catch (error) {
    if (controller.signal.aborted && error instanceof Error && error.name === "AbortError") {
      throw new Error(`model request timed out after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function buildHeaders(options: OpenAICompatibleModelClientOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(options.headers ?? {})
  };

  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }

  if (options.organization) {
    headers["OpenAI-Organization"] = options.organization;
  }

  if (options.project) {
    headers["OpenAI-Project"] = options.project;
  }

  return headers;
}

function buildRequestBody(
  options: OpenAICompatibleModelClientOptions,
  request: ModelCompletionRequest
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: request.messages.map(toChatMessage),
    ...(options.extraBody ?? {})
  };

  if (typeof request.temperature === "number") {
    body.temperature = request.temperature;
  }

  if (typeof options.maxTokens === "number") {
    body.max_tokens = options.maxTokens;
  }

  if (request.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  return body;
}

function toChatMessage(message: ModelMessage): { role: ModelMessage["role"]; content: string } {
  return {
    role: message.role,
    content: message.content
  };
}

function parseResponseBody(responseText: string): unknown {
  try {
    return responseText ? (JSON.parse(responseText) as unknown) : {};
  } catch (error) {
    throw new Error(
      `model response was not parseable JSON: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}

function extractAssistantContent(parsed: unknown): string {
  if (!isChatCompletionResponse(parsed)) {
    throw new Error("model response did not match the chat completion shape.");
  }

  const content = parsed.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("model response did not include assistant message content.");
  }

  return content;
}

function extractApiError(parsed: unknown): string | undefined {
  if (isChatCompletionResponse(parsed) && parsed.error?.message) {
    return parsed.error.message;
  }

  return undefined;
}

function isChatCompletionResponse(value: unknown): value is ChatCompletionResponse {
  return typeof value === "object" && value !== null;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
