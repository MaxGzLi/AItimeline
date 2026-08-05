// agent 运行时 v1 的冒烟:无模型、不出网,三个场景。
// 1. 提问 -> 轮询到终态 -> 拿到确定性回答或「暂无依据」+ 行动按钮;
// 2. 说一句喜好 -> 记忆变更事件可见,记忆真的变了;
// 3. 重开服务(重建 store)-> GET 列表还能看到刚才的 turn(持久化生效)。
// 日期一律用相对当前时间,不写死任何日期。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiServer, listen } from "../apps/api/src/server.mjs";

const previousEnv = {
  AITIMELINE_CONTENT_LANGUAGE: process.env.AITIMELINE_CONTENT_LANGUAGE,
  AITIMELINE_TIMEZONE: process.env.AITIMELINE_TIMEZONE,
  AITIMELINE_MODEL_NAME: process.env.AITIMELINE_MODEL_NAME,
  AITIMELINE_MODEL_COMMAND: process.env.AITIMELINE_MODEL_COMMAND,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  AITIMELINE_SEARCH_API_KEY: process.env.AITIMELINE_SEARCH_API_KEY,
  AITIMELINE_AUTH_TOKEN: process.env.AITIMELINE_AUTH_TOKEN,
  AITIMELINE_AGENT_MAX_STEPS: process.env.AITIMELINE_AGENT_MAX_STEPS
};

process.env.AITIMELINE_CONTENT_LANGUAGE = "zh";
process.env.AITIMELINE_TIMEZONE = "UTC";
// 无模型、无搜索、无鉴权:三个场景必须全走确定性路径。
delete process.env.AITIMELINE_MODEL_NAME;
delete process.env.AITIMELINE_MODEL_COMMAND;
delete process.env.OPENAI_MODEL;
delete process.env.AITIMELINE_SEARCH_API_KEY;
delete process.env.AITIMELINE_AUTH_TOKEN;
delete process.env.AITIMELINE_AGENT_MAX_STEPS;

const tempDir = await mkdtemp(join(tmpdir(), "aitimeline-agent-"));
const serverPaths = {
  dataPath: join(tempDir, "aitimeline.json"),
  curationDataPath: join(tempDir, "curation-jobs.json"),
  agentChatDataPath: join(tempDir, "agent-chat.json"),
  mediaRootDir: join(tempDir, "media")
};
await mkdir(serverPaths.mediaRootDir, { recursive: true });

let server;
let baseUrl = "";

async function startServer() {
  server = createApiServer(serverPaths);
  const address = await listen(server, 0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer() {
  await new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json();

  assert.equal(response.ok, true, `${options.method ?? "GET"} ${path} failed: ${JSON.stringify(payload)}`);

  return payload;
}

async function pollTurnUntilTerminal(chatTurnId, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let latest;

  while (Date.now() < deadline) {
    const detail = await requestJson(`/api/agent/chat/${chatTurnId}`);
    latest = detail.turn;

    if (latest.status !== "running") {
      return latest;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }

  assert.fail(`Timed out after ${timeoutMs}ms waiting for chat turn ${chatTurnId}; latest=${JSON.stringify(latest ?? null)}`);
}

try {
  await startServer();

  // 场景 1:无模型提问 -> 终态 -> 确定性回答或「暂无依据」+ 行动按钮。
  const asked = await requestJson("/api/agent/chat", {
    method: "POST",
    body: { text: "什么是 Transformer 的注意力机制?" }
  });

  assert.equal(asked.status, "running", "POST /api/agent/chat must return a running turn immediately");
  assert.ok(asked.chatTurnId, "POST /api/agent/chat must return a chatTurnId");

  const questionTurn = await pollTurnUntilTerminal(asked.chatTurnId);

  assert.notEqual(questionTurn.status, "failed", "the no-model question turn must not fail");
  assert.ok(
    ["succeeded", "awaiting_confirmation"].includes(questionTurn.status),
    `question turn must reach a terminal status, got ${questionTurn.status}`
  );
  assert.ok(
    questionTurn.answer?.text || questionTurn.actions?.length,
    "question turn must carry either a deterministic answer or action buttons"
  );
  assert.ok(
    questionTurn.events.some((event) => event.type === "say" && event.text.trim()),
    "question turn must contain at least one say event"
  );

  // 空库提问落在库外:走既有确认流,行动按钮里必须有确认研究范围。
  if (questionTurn.status === "awaiting_confirmation") {
    assert.ok(questionTurn.turnRecordId, "awaiting_confirmation must expose turnRecordId for /api/agent/confirm");
    assert.ok(
      questionTurn.actions.some((action) => action.kind === "confirm_discovery"),
      "awaiting_confirmation must include a confirm_discovery action"
    );
  }

  // 场景 2:说一句喜好 -> 记忆变更事件可见 + 记忆真的变了。
  const preference = await requestJson("/api/agent/chat", {
    method: "POST",
    body: { text: "我最近想搞懂 Transformer" }
  });
  const preferenceTurn = await pollTurnUntilTerminal(preference.chatTurnId);

  assert.equal(preferenceTurn.status, "succeeded", "the preference turn must succeed");
  assert.ok(
    preferenceTurn.events.some(
      (event) => event.type === "tool_result" && Array.isArray(event.data?.memoryEvents) && event.data.memoryEvents.length > 0
    ),
    "the preference turn must expose the memory change events"
  );

  const memoryReadback = await requestJson("/api/memory", { method: "POST", body: { edits: [] } });

  assert.ok(
    memoryReadback.memory.profile.interests.includes("Transformer"),
    `profile.interests must contain the topic, got ${JSON.stringify(memoryReadback.memory.profile.interests)}`
  );

  // 场景 3:重开服务(同一批数据文件重建 store)-> 列表还能看到刚才的 turn。
  await stopServer();
  await startServer();

  const listed = await requestJson("/api/agent/chat?limit=10");

  assert.ok(Array.isArray(listed.turns), "GET /api/agent/chat must return a turns array");

  const persistedQuestion = listed.turns.find((turn) => turn.id === asked.chatTurnId);
  const persistedPreference = listed.turns.find((turn) => turn.id === preference.chatTurnId);

  assert.ok(persistedQuestion, "the question turn must survive a store rebuild");
  assert.ok(persistedPreference, "the preference turn must survive a store rebuild");
  assert.equal(persistedQuestion.status, questionTurn.status, "the persisted question turn must keep its terminal status");
  assert.ok(
    persistedQuestion.events.some((event) => event.type === "say"),
    "the persisted question turn must keep its say events"
  );
  assert.ok(
    persistedPreference.events.some(
      (event) => event.type === "tool_result" && Array.isArray(event.data?.memoryEvents) && event.data.memoryEvents.length > 0
    ),
    "the persisted preference turn must keep its memory change events"
  );

  console.log("smoke-agent passed: no-model chat turn, preference memory change, and turn persistence across a store rebuild.");
} finally {
  if (server) {
    await stopServer().catch(() => {});
  }

  await rm(tempDir, { recursive: true, force: true });

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
