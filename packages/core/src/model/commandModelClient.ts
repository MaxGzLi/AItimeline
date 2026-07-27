import type {
  ModelClient,
  ModelCompletionRequest,
  ModelCompletionResponse,
  ModelMessage
} from "../harness/modelRunner.js";

export interface CommandModelClientOptions {
  /** Full shell command; it runs through `sh -c` and reads the prompt on stdin. */
  command: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface CommandModelClientEnv {
  AITIMELINE_MODEL_COMMAND?: string;
  AITIMELINE_MODEL_COMMAND_TIMEOUT_MS?: string;
}

interface NodeReadableSubset {
  on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
}

interface NodeWritableSubset {
  on(event: "error", listener: (error: Error) => void): unknown;
  end(chunk: string): unknown;
}

interface NodeChildProcessSubset {
  stdin: NodeWritableSubset;
  stdout: NodeReadableSubset;
  stderr: NodeReadableSubset;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill(signal: string): unknown;
}

interface NodeChildProcessSubsetModule {
  spawn(
    command: string,
    options: { shell: boolean; stdio: [string, string, string] }
  ): NodeChildProcessSubset;
}

const defaultTimeoutMs = 120000;
const defaultMaxOutputBytes = 1024 * 1024;
const stderrExcerptLength = 400;

export function createCommandModelClient(options: CommandModelClientOptions): ModelClient {
  const command = options.command.trim();

  if (!command) {
    throw new Error("A non-empty command is required to create a command model client.");
  }

  return {
    complete: (request) => runCommandCompletion(command, options, request)
  };
}

export function createCommandModelClientFromEnv(
  env: CommandModelClientEnv,
  overrides: Partial<CommandModelClientOptions> = {}
): ModelClient {
  const command = overrides.command ?? env.AITIMELINE_MODEL_COMMAND;

  if (!command || !command.trim()) {
    throw new Error("AITIMELINE_MODEL_COMMAND is required to create a command model client.");
  }

  return createCommandModelClient({
    ...overrides,
    command,
    timeoutMs:
      overrides.timeoutMs ?? parsePositiveInteger(env.AITIMELINE_MODEL_COMMAND_TIMEOUT_MS) ?? defaultTimeoutMs
  });
}

/**
 * Serializes chat messages into one plain-text prompt: system messages first, the rest
 * in order, separated by blank lines. Request options a command cannot express
 * (temperature, response format) are ignored.
 */
export function serializeCommandPrompt(messages: readonly ModelMessage[]): string {
  const systemMessages = messages.filter((message) => message.role === "system");
  const otherMessages = messages.filter((message) => message.role !== "system");

  return [...systemMessages, ...otherMessages].map((message) => message.content).join("\n\n");
}

async function runCommandCompletion(
  command: string,
  options: CommandModelClientOptions,
  request: ModelCompletionRequest
): Promise<ModelCompletionResponse> {
  const { spawn } = await importNodeModule<NodeChildProcessSubsetModule>("node:child_process");
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const maxOutputBytes = options.maxOutputBytes ?? defaultMaxOutputBytes;
  const prompt = serializeCommandPrompt(request.messages);

  return new Promise<ModelCompletionResponse>((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    let stdoutBytes = 0;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const settle = (error?: Error, response?: ModelCompletionResponse): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeout) {
        clearTimeout(timeout);
      }

      if (error) {
        reject(error);
        return;
      }

      resolve(response as ModelCompletionResponse);
    };

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill("SIGKILL");
        settle(new Error(`model command timed out after ${timeoutMs}ms: ${command}`));
      }, timeoutMs);
    }

    child.on("error", (error) => {
      settle(new Error(`model command failed to start: ${error.message}`));
    });

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;

      if (stdoutBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        settle(new Error(`model command produced more than ${maxOutputBytes} bytes of output.`));
        return;
      }

      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (code) => {
      const stderr = decodeChunks(stderrChunks).trim();

      if (code !== 0) {
        settle(
          new Error(`model command exited with code ${code ?? "null"}: ${truncate(stderr, stderrExcerptLength)}`)
        );
        return;
      }

      const content = decodeChunks(stdoutChunks).trim();

      if (!content) {
        settle(new Error(`model command produced no output: ${truncate(stderr, stderrExcerptLength)}`));
        return;
      }

      settle(undefined, { content });
    });

    // A command that ignores stdin closes the pipe early; that EPIPE is not a failure
    // by itself, so the exit code and stdout stay the only success signal.
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated]`;
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

// Keeps the static import graph free of node: specifiers so browser bundles of
// @aitimeline/core stay buildable; mirrors arxivHtmlImport's media writer.
async function importNodeModule<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<T>;

  return dynamicImport(specifier);
}
