import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAitimelineMcpServer, serverInstructions } from "../apps/mcp/src/server.mjs";

// The MCP server is a thin bridge: every tool call must become exactly one
// local API request. A stub API keeps this smoke network-free.
const apiCalls = [];
const stubApi = async (path, options = {}) => {
  apiCalls.push({ path, method: options.method ?? "GET", body: options.body });

  if (path === "/api/captures/source") {
    return { status: "queued", alreadyKnown: false, queued: 1 };
  }

  if (path === "/api/captures/conversation") {
    return { post: { id: "conversation-smoke-post", title: options.body?.topic }, alreadyCaptured: false, sources: [] };
  }

  if (path === "/api/captures/context") {
    return { topics: [], learningGoals: [], recentCards: [], cardCount: 0 };
  }

  throw new Error(`Unexpected API path: ${path}`);
};

const server = createAitimelineMcpServer({ api: stubApi });
const client = new Client({ name: "smoke-client", version: "0.0.1" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

assert.equal(serverInstructions.length > 200, true, "server instructions should carry the capture guidelines");
assert.equal(
  (client.getInstructions() ?? "").includes("capture_source"),
  true,
  "capture guidelines should reach the client during the handshake"
);

const listed = await client.listTools();
const toolNames = listed.tools.map((tool) => tool.name).sort();

assert.deepEqual(
  toolNames,
  ["capture_conversation", "capture_source", "get_learning_context"],
  "the server should expose exactly the three capture tools"
);

const sourceResult = await client.callTool({
  name: "capture_source",
  arguments: { url: "https://example.com/article", topic: "options pricing", reason: "cited in chat" }
});

assert.equal(sourceResult.isError ?? false, false, "capture_source should succeed against the API");
assert.equal(JSON.parse(sourceResult.content[0].text).status, "queued", "capture_source should surface the API status");
assert.equal(apiCalls.at(-1).path, "/api/captures/source", "capture_source should call the captures/source endpoint");
assert.equal(apiCalls.at(-1).method, "POST", "capture_source should POST");

const conversationResult = await client.callTool({
  name: "capture_conversation",
  arguments: {
    topic: "options pricing",
    excerpt:
      "User asked how implied volatility differs from realized volatility. Explanation: implied volatility is the market's forward-looking estimate backed out of option prices, while realized volatility measures what actually happened historically.",
    agentName: "smoke-agent",
    sourceUrls: ["https://example.com/vol"]
  }
});

assert.equal(conversationResult.isError ?? false, false, "capture_conversation should succeed against the API");
assert.equal(
  JSON.parse(conversationResult.content[0].text).post.id,
  "conversation-smoke-post",
  "capture_conversation should surface the created card"
);
assert.equal(
  apiCalls.at(-1).body.sourceUrls.length,
  1,
  "capture_conversation should forward cited source URLs"
);

const contextResult = await client.callTool({ name: "get_learning_context", arguments: {} });

assert.equal(contextResult.isError ?? false, false, "get_learning_context should succeed against the API");
assert.equal(
  JSON.parse(contextResult.content[0].text).cardCount,
  0,
  "get_learning_context should surface the API payload"
);
assert.equal(apiCalls.at(-1).method, "GET", "get_learning_context should be read-only");

await client.close();
await server.close();

console.log("MCP smoke passed");
