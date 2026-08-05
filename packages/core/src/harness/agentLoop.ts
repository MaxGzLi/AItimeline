import type { ModelClient, ModelMessage } from "./modelRunner.js";

/**
 * Protocol loop engine for the agent runtime: the model looks at the
 * conversation, picks a tool or speaks, sees the tool result, and decides
 * again — all over the existing plain-completion interface. Tools are
 * injected by the caller; the engine itself never touches storage or the
 * network.
 */

export interface AgentLoopTool {
  description: string;
  argsHint?: string;
  run(args: Record<string, unknown>): Promise<unknown> | unknown;
}

export type AgentLoopToolbox = Record<string, AgentLoopTool>;

export type AgentLoopEventType = "plan" | "tool" | "tool_result" | "say" | "error";

export interface AgentLoopEvent {
  type: AgentLoopEventType;
  at: string;
  text: string;
  data?: unknown;
}

export type AgentLoopDecision =
  | { action: "tool"; tool: string; args: Record<string, unknown>; why?: string }
  | { action: "say"; text: string; done: boolean };

export type AgentLoopParseResult = { decision: AgentLoopDecision } | { error: string };

export interface RunAgentLoopInput {
  text: string;
  client: ModelClient;
  tools: AgentLoopToolbox;
  /** Extra lines appended to the system prompt (user context, language policy...). */
  contextLines?: string[];
  maxSteps?: number;
  temperature?: number;
  now?: () => string;
  onEvent?: (event: AgentLoopEvent) => void;
}

export interface AgentLoopResult {
  status: "succeeded" | "failed";
  events: AgentLoopEvent[];
  finalText?: string;
  modelCalls: number;
  failureReason?: string;
}

export const defaultAgentLoopMaxSteps = 6;

const maxToolResultFeedbackChars = 2000;

/**
 * Shared JSON extraction for model replies: strips markdown fences, then falls
 * back to the outermost object slice. This is the exported public version of
 * the previously file-private copies in modelRunner.ts and askGrounded.ts —
 * responseFormat "json_object" cannot be relied on (the command model client
 * drops it), so every parser must peel fences itself.
 */
export function extractJsonPayload(content: string): string {
  const trimmed = content.trim();
  const fencedJson = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedJson?.[1]) {
    return fencedJson[1].trim();
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  return trimmed;
}

export function parseAgentLoopDecision(content: string): AgentLoopParseResult {
  const payload = extractJsonPayload(content);
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload) as unknown;
  } catch (error) {
    return { error: `response must be parseable JSON: ${error instanceof Error ? error.message : "parse failed"}` };
  }

  if (!isRecord(parsed)) {
    return { error: "response must be a single JSON object." };
  }

  if (parsed.action === "say") {
    if (typeof parsed.text !== "string" || !parsed.text.trim()) {
      return { error: 'a "say" action requires a non-empty "text" string.' };
    }

    return {
      decision: {
        action: "say",
        text: parsed.text.trim(),
        done: parsed.done !== false
      }
    };
  }

  if (parsed.action === "tool") {
    if (typeof parsed.tool !== "string" || !parsed.tool.trim()) {
      return { error: 'a "tool" action requires a non-empty "tool" name.' };
    }

    return {
      decision: {
        action: "tool",
        tool: parsed.tool.trim(),
        args: isRecord(parsed.args) ? parsed.args : {},
        why: typeof parsed.why === "string" && parsed.why.trim() ? parsed.why.trim() : undefined
      }
    };
  }

  return { error: '"action" must be either "tool" or "say".' };
}

export function readAgentLoopMaxSteps(env: Record<string, string | undefined> = {}): number {
  const parsed = Number.parseInt(env.AITIMELINE_AGENT_MAX_STEPS ?? "", 10);

  return Number.isFinite(parsed) && parsed >= 1 ? parsed : defaultAgentLoopMaxSteps;
}

export async function runAgentLoop(input: RunAgentLoopInput): Promise<AgentLoopResult> {
  const maxSteps = Math.max(1, input.maxSteps ?? defaultAgentLoopMaxSteps);
  const temperature = input.temperature ?? 0.2;
  const clock = input.now ?? (() => new Date().toISOString());
  const events: AgentLoopEvent[] = [];
  const emit = (event: Omit<AgentLoopEvent, "at">): void => {
    const full = { ...event, at: clock() };
    events.push(full);
    input.onEvent?.(full);
  };
  const messages: ModelMessage[] = [
    { role: "system", content: buildAgentLoopSystemPrompt(input.tools, maxSteps, input.contextLines) },
    { role: "user", content: input.text }
  ];
  let modelCalls = 0;
  let parseFailureStreak = 0;
  let finalText: string | undefined;
  const complete = async (): Promise<string> => {
    const response = await input.client.complete({ messages, temperature });
    modelCalls += 1;
    return response.content;
  };
  const fail = (failureReason: string): AgentLoopResult => ({
    status: "failed",
    events,
    finalText,
    modelCalls,
    failureReason
  });

  while (modelCalls < maxSteps) {
    const content = await complete();
    const parsed = parseAgentLoopDecision(content);

    if ("error" in parsed) {
      emit({ type: "error", text: `协议解析失败:${parsed.error}` });
      parseFailureStreak += 1;

      if (parseFailureStreak > 1) {
        return fail(`model output could not be parsed after a retry: ${parsed.error}`);
      }

      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Your previous reply was invalid: ${parsed.error} Reply again with exactly one JSON object following the protocol, and nothing else.`
      });
      continue;
    }

    parseFailureStreak = 0;
    messages.push({ role: "assistant", content });
    const decision = parsed.decision;

    if (decision.action === "say") {
      emit({ type: "say", text: decision.text });
      finalText = decision.text;

      if (decision.done) {
        return { status: "succeeded", events, finalText, modelCalls };
      }

      messages.push({
        role: "user",
        content: 'Noted. Continue: call a tool, or finish with {"action":"say","text":"...","done":true}.'
      });
      continue;
    }

    if (decision.why) {
      emit({ type: "plan", text: decision.why });
    }

    const tool = input.tools[decision.tool];

    if (!tool) {
      emit({ type: "error", text: `未知工具:${decision.tool}` });
      messages.push({
        role: "user",
        content: `Unknown tool "${decision.tool}". Available tools: ${Object.keys(input.tools).join(", ")}. Reply with the protocol JSON.`
      });
      continue;
    }

    emit({ type: "tool", text: decision.tool, data: { args: decision.args } });

    try {
      const result = await tool.run(decision.args);
      emit({ type: "tool_result", text: decision.tool, data: result });
      messages.push({
        role: "user",
        content: `Tool result:\n${truncate(JSON.stringify({ tool: decision.tool, result }), maxToolResultFeedbackChars)}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "error", text: `工具 ${decision.tool} 执行失败:${message}` });
      messages.push({
        role: "user",
        content: `Tool result:\n${truncate(JSON.stringify({ tool: decision.tool, error: message }), maxToolResultFeedbackChars)}`
      });
    }
  }

  // Step budget exhausted: force one closing "say" so the turn never ends on
  // a dangling tool call.
  messages.push({
    role: "user",
    content: 'Step limit reached. Reply now with {"action":"say","text":"...","done":true} summarizing where things stand, and nothing else.'
  });
  const closingContent = await complete();
  const closingParsed = parseAgentLoopDecision(closingContent);

  if ("decision" in closingParsed && closingParsed.decision.action === "say") {
    emit({ type: "say", text: closingParsed.decision.text });
    finalText = closingParsed.decision.text;
    return { status: "succeeded", events, finalText, modelCalls };
  }

  emit({ type: "error", text: "到达步数上限后模型仍未收尾。" });
  return fail("model did not produce a closing say after the step limit.");
}

function buildAgentLoopSystemPrompt(
  tools: AgentLoopToolbox,
  maxSteps: number,
  contextLines?: string[]
): string {
  const toolLines = Object.entries(tools).map(
    ([name, tool]) => `- ${name}: ${tool.description}${tool.argsHint ? ` (args: ${tool.argsHint})` : ""}`
  );

  return [
    "You are the AITimeline agent runtime. You coordinate tools over the user's local knowledge library.",
    "",
    "Tools:",
    ...toolLines,
    "",
    "Protocol — every reply must be exactly one JSON object, with no markdown fences and no prose around it:",
    '- To call a tool: {"action":"tool","tool":"<name>","args":{...},"why":"one short sentence"}',
    '- To speak to the user: {"action":"say","text":"...","done":true}',
    '- Set "done": false only when you intend to keep working after speaking.',
    "",
    "Rules:",
    "- Knowledge content shown to the user must come from ask_grounded tool results; your own say text is coordination only (plans, status, follow-up questions). Never answer knowledge questions from your own memory.",
    "- Never fetch the web yourself; to research outside the library, use propose_discovery and wait for the user's confirmation.",
    `- You have at most ${maxSteps} steps in this turn; always finish with a done say.`,
    ...(contextLines?.length ? ["", ...contextLines] : [])
  ].join("\n");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...[truncated]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
