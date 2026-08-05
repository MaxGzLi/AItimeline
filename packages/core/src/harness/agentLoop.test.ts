import { describe, expect, it } from "vitest";

import {
  extractJsonPayload,
  parseAgentLoopDecision,
  readAgentLoopMaxSteps,
  runAgentLoop,
  type AgentLoopToolbox
} from "./agentLoop.js";
import type { ModelCompletionRequest } from "./modelRunner.js";

function createScriptedClient(responses: string[]) {
  const requests: ModelCompletionRequest[] = [];
  let index = 0;

  return {
    requests,
    complete: async (request: ModelCompletionRequest) => {
      requests.push(structuredClone(request));
      const content = responses[Math.min(index, responses.length - 1)] ?? "";
      index += 1;
      return { content };
    }
  };
}

function createEchoToolbox(): AgentLoopToolbox {
  return {
    echo: {
      description: "Echo the given value back.",
      argsHint: '{"value":"..."}',
      run: (args) => {
        if (typeof args.value !== "string" || !args.value.trim()) {
          throw new Error("value is required.");
        }

        return { echoed: args.value };
      }
    }
  };
}

describe("extractJsonPayload", () => {
  it("strips markdown fences", () => {
    expect(extractJsonPayload('```json\n{"action":"say"}\n```')).toBe('{"action":"say"}');
    expect(extractJsonPayload('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("returns bare objects untouched", () => {
    expect(extractJsonPayload('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("slices the outermost object out of surrounding prose", () => {
    expect(extractJsonPayload('Sure, here you go: {"a":{"b":2}} hope that helps')).toBe('{"a":{"b":2}}');
  });
});

describe("parseAgentLoopDecision", () => {
  it("parses tool decisions and defaults args to an object", () => {
    const parsed = parseAgentLoopDecision('{"action":"tool","tool":"echo","why":"testing"}');

    expect(parsed).toEqual({ decision: { action: "tool", tool: "echo", args: {}, why: "testing" } });
  });

  it("defaults say done to true", () => {
    const parsed = parseAgentLoopDecision('{"action":"say","text":"done here"}');

    expect(parsed).toEqual({ decision: { action: "say", text: "done here", done: true } });
  });

  it("rejects unknown actions", () => {
    expect(parseAgentLoopDecision('{"action":"think"}')).toHaveProperty("error");
    expect(parseAgentLoopDecision("not json at all")).toHaveProperty("error");
  });
});

describe("readAgentLoopMaxSteps", () => {
  it("defaults to 6 and rejects invalid values", () => {
    expect(readAgentLoopMaxSteps({})).toBe(6);
    expect(readAgentLoopMaxSteps({ AITIMELINE_AGENT_MAX_STEPS: "abc" })).toBe(6);
    expect(readAgentLoopMaxSteps({ AITIMELINE_AGENT_MAX_STEPS: "0" })).toBe(6);
    expect(readAgentLoopMaxSteps({ AITIMELINE_AGENT_MAX_STEPS: "3" })).toBe(3);
  });
});

describe("runAgentLoop", () => {
  it("finishes on a fenced say and uses temperature 0.2", async () => {
    const client = createScriptedClient(['```json\n{"action":"say","text":"你好","done":true}\n```']);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox() });

    expect(result.status).toBe("succeeded");
    expect(result.finalText).toBe("你好");
    expect(result.modelCalls).toBe(1);
    expect(result.events.map((event) => event.type)).toEqual(["say"]);
    expect(client.requests[0]?.temperature).toBe(0.2);
  });

  it("retries bad JSON once, then succeeds", async () => {
    const client = createScriptedClient(["nonsense", '{"action":"say","text":"recovered","done":true}']);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox() });

    expect(result.status).toBe("succeeded");
    expect(result.modelCalls).toBe(2);
    const retryMessage = client.requests[1]?.messages.at(-1);
    expect(retryMessage?.role).toBe("user");
    expect(retryMessage?.content).toContain("invalid");
    expect(result.events.some((event) => event.type === "error")).toBe(true);
  });

  it("gives up after a second consecutive parse failure", async () => {
    const client = createScriptedClient(["nonsense", "still nonsense"]);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox() });

    expect(result.status).toBe("failed");
    expect(result.modelCalls).toBe(2);
    expect(result.failureReason).toContain("retry");
  });

  it("runs tools and feeds compact results back to the model", async () => {
    const client = createScriptedClient([
      '{"action":"tool","tool":"echo","args":{"value":"ping"},"why":"need the echo"}',
      '{"action":"say","text":"echoed","done":true}'
    ]);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox() });

    expect(result.status).toBe("succeeded");
    expect(result.events.map((event) => event.type)).toEqual(["plan", "tool", "tool_result", "say"]);
    const feedback = client.requests[1]?.messages.at(-1);
    expect(feedback?.role).toBe("user");
    expect(feedback?.content).toContain('"echoed":"ping"');
  });

  it("reports unknown tool names back to the model and keeps looping", async () => {
    const client = createScriptedClient([
      '{"action":"tool","tool":"nope","args":{}}',
      '{"action":"say","text":"ok","done":true}'
    ]);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox() });

    expect(result.status).toBe("succeeded");
    expect(result.events.some((event) => event.type === "error" && event.text.includes("nope"))).toBe(true);
    const feedback = client.requests[1]?.messages.at(-1);
    expect(feedback?.content).toContain('Unknown tool "nope"');
    expect(feedback?.content).toContain("echo");
  });

  it("feeds tool argument errors back to the model", async () => {
    const client = createScriptedClient([
      '{"action":"tool","tool":"echo","args":{}}',
      '{"action":"say","text":"ok","done":true}'
    ]);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox() });

    expect(result.status).toBe("succeeded");
    expect(result.events.some((event) => event.type === "error" && event.text.includes("echo"))).toBe(true);
    const feedback = client.requests[1]?.messages.at(-1);
    expect(feedback?.content).toContain("value is required.");
  });

  it("forces a closing say when the step limit is reached", async () => {
    const client = createScriptedClient([
      '{"action":"tool","tool":"echo","args":{"value":"a"}}',
      '{"action":"tool","tool":"echo","args":{"value":"b"}}',
      '{"action":"say","text":"time is up","done":true}'
    ]);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox(), maxSteps: 2 });

    expect(result.status).toBe("succeeded");
    expect(result.finalText).toBe("time is up");
    expect(result.modelCalls).toBe(3);
    const forcedMessage = client.requests[2]?.messages.at(-1);
    expect(forcedMessage?.role).toBe("user");
    expect(forcedMessage?.content).toContain("Step limit reached");
  });

  it("fails when the model still refuses to close after the step limit", async () => {
    const client = createScriptedClient(['{"action":"tool","tool":"echo","args":{"value":"a"}}']);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox(), maxSteps: 2 });

    expect(result.status).toBe("failed");
    expect(result.failureReason).toContain("closing say");
    expect(result.modelCalls).toBe(3);
  });

  it("keeps looping after a say with done:false", async () => {
    const client = createScriptedClient([
      '{"action":"say","text":"先看一眼库","done":false}',
      '{"action":"say","text":"看完了","done":true}'
    ]);
    const result = await runAgentLoop({ text: "hi", client, tools: createEchoToolbox() });

    expect(result.status).toBe("succeeded");
    expect(result.events.filter((event) => event.type === "say")).toHaveLength(2);
    expect(result.finalText).toBe("看完了");
  });
});
