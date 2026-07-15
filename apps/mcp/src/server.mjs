#!/usr/bin/env node
// AITimeline MCP server: a thin stdio bridge that lets external agents
// (Claude Code, Claude, ...) deposit learning traces into the local
// AITimeline API while the user studies inside a conversation.
//
// This process never talks to model providers and never touches snapshot
// files directly — every tool call becomes an HTTP request against the
// local API (AITIMELINE_API_URL, default http://127.0.0.1:8787).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const apiBaseUrl = (process.env.AITIMELINE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const apiToken = process.env.AITIMELINE_API_TOKEN ?? "";

export const serverInstructions = [
  "AITimeline is the user's personal knowledge timeline. Use these tools to capture what the user is LEARNING in this conversation, so it becomes reviewable knowledge cards.",
  "",
  "When to capture:",
  "- The user is clearly studying a topic (asking to understand concepts, papers, videos, technology) — not casually chatting.",
  "- capture_source: whenever a concrete URL (article, video, paper) was read, cited, or recommended as part of the learning. One call per URL.",
  "- capture_conversation: when a substantial explanation wraps up (you finished teaching a concept, answered a deep question). Submit the key exchange verbatim — the user's question plus the load-bearing part of your explanation — as the excerpt. Do not paraphrase into new claims; the excerpt is the citable source text.",
  "- get_learning_context: optionally call once near the start of a learning conversation to see what the user already knows, and calibrate your teaching depth.",
  "",
  "When NOT to capture:",
  "- Coding/debugging sessions, task execution, casual conversation, or anything the user is doing rather than learning.",
  "- Personal, private, or sensitive details about the user. Excerpts must contain only subject-matter content.",
  "- Do not bulk-capture: at most a handful of captures per conversation, each genuinely worth reviewing later.",
  "",
  "If unsure whether something counts as learning, ask the user before capturing."
].join("\n");

async function callApi(path, { method = "GET", body } = {}) {
  const headers = { "content-type": "application/json" };

  if (apiToken) {
    headers.authorization = `Bearer ${apiToken}`;
  }

  let response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    throw new Error(
      `AITimeline API is unreachable at ${apiBaseUrl} (${error instanceof Error ? error.message : String(error)}). ` +
        "Start it with `npm run dev:api` in the AITimeline repo, or set AITIMELINE_API_URL."
    );
  }

  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`AITimeline API responded ${response.status}: ${payload.error ?? text.slice(0, 300)}`);
  }

  return payload;
}

function toolResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export function createAitimelineMcpServer({ api = callApi } = {}) {
  const server = new McpServer(
    { name: "aitimeline", version: "0.1.0" },
    { instructions: serverInstructions }
  );

  server.registerTool(
    "capture_source",
    {
      title: "Capture a learning source URL",
      description:
        "Save a URL the user read, cited, or was recommended while learning. AITimeline imports it into a source-grounded knowledge card through its normal quality gate and daily budget.",
      inputSchema: {
        url: z.string().describe("The article/video/paper URL that is part of what the user is learning."),
        topic: z.string().optional().describe("Short topic label for what the user is learning, e.g. 'options pricing'."),
        reason: z.string().optional().describe("One sentence on why this source matters in the conversation.")
      }
    },
    async ({ url, topic, reason }) => toolResult(await callOrThrow(api, "/api/captures/source", { url, topic, reason }))
  );

  server.registerTool(
    "capture_conversation",
    {
      title: "Capture a learning exchange from this conversation",
      description:
        "Save a finished teaching exchange (user question + the key part of the explanation, verbatim) as a citable conversation source. AITimeline turns it into a knowledge card whose citations point back to this excerpt, visibly labeled as conversation-derived.",
      inputSchema: {
        topic: z.string().describe("Short topic label, e.g. 'Black-Scholes assumptions'."),
        excerpt: z
          .string()
          .describe(
            "The verbatim exchange: the user's question and the load-bearing explanation. 200-4000 characters. This text becomes the citable source; do not add claims that were not in the conversation."
          ),
        agentName: z.string().optional().describe("Which agent produced the explanation, e.g. 'claude-code'."),
        sourceUrls: z
          .array(z.string())
          .optional()
          .describe("URLs that the explanation drew on, if any were cited in the conversation.")
      }
    },
    async ({ topic, excerpt, agentName, sourceUrls }) =>
      toolResult(await callOrThrow(api, "/api/captures/conversation", { topic, excerpt, agentName, sourceUrls }))
  );

  server.registerTool(
    "get_learning_context",
    {
      title: "Read the user's learning context",
      description:
        "Read-only summary of what the user has been learning recently (topics and confirmed concepts, no card bodies). Use it once to calibrate teaching depth.",
      inputSchema: {}
    },
    async () => toolResult(await api("/api/captures/context"))
  );

  return server;
}

async function callOrThrow(api, path, body) {
  return api(path, { method: "POST", body });
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  const server = createAitimelineMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}
