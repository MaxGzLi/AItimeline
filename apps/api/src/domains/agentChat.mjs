// @ts-check

// agent 运行时 v1 的数据面:装配七个工具、持久化对话轮、暴露三个端点用的处理器。
//
// 对话轮存在独立文件 agent-chat.json(不进主快照——主快照 v2 加集合会拒载),
// 这也顺手修掉了 #166 的「答案刷新就丢」:回答正文和事件流都落在这里,
// 界面刷新后靠 GET 列表重建对话流。
//
// 接地铁律:说给用户的知识内容只能来自 ask_grounded 的返回;循环内一律不出网,
// 出网只有 propose_discovery -> 用户确认 -> 既有 research_question 任务路径。

import { randomUUID } from "node:crypto";

import {
  PersistenceDecodeError,
  applyDailyAutoJobBudget,
  applyUserMemoryEdits,
  askGrounded,
  buildConceptSurfaceForms,
  buildDiscoveryConfirmationQuestions,
  commitWithRetry,
  createConceptAliasResolver,
  decodeJson,
  decodeRecordCollection,
  deepClone,
  expectArray,
  expectEnum,
  expectIsoDate,
  expectNonEmptyString,
  expectNonNegativeInteger,
  expectObject,
  expectString,
  getDueReviewStates,
  getHardDismissedPostIds,
  mergeSourceRegistries,
  readAgentLoopMaxSteps,
  runAgentLoop,
  textMentionsSurfaceForm
} from "../../../../packages/core/dist/index.js";
import {
  createSingleJobPlan,
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  getSnapshotUserMemory,
  hashText,
  roundScore,
  tokenizeText
} from "./shared.mjs";
import { getKnowledgePosts } from "./importSettlement.mjs";
import { backfillLegacyReviewStates, selectReviewPrompt } from "./review.mjs";
import { normalizeSourceCandidate } from "./supply.mjs";
import { normalizeUrlKey } from "./subscriptions.mjs";
import { dispatchAgentTask, listAgentTasks } from "./agentTasks.mjs";

const maxStoredTurns = 200;
const chatTurnStatuses = ["running", "succeeded", "failed", "awaiting_confirmation"];
const chatEventTypes = ["plan", "tool", "tool_result", "say", "error"];
// 记忆字段白名单:九个列表字段 + explanationStyle,和 userMemoryControls 的
// 字段集一一对应;reason 必填由工具层把关。
const memoryEditFields = new Set([
  "profile.interests",
  "profile.goals",
  "profile.explanationStyle",
  "knowledge.knownConcepts",
  "knowledge.weakConcepts",
  "knowledge.savedConcepts",
  "interaction.recentCardIds",
  "interaction.recentQuestions",
  "agent.topicAgents",
  "agent.preferredSourceTypes"
]);
const memoryEditKinds = new Set(["add", "remove", "replace", "clear", "set"]);

// ---------------------------------------------------------------------------
// 独立存储:照 backgroundCurationQueue 的存储层模板——空文件兜底、解码缓存、
// 所有写走 commitWithRetry。
// ---------------------------------------------------------------------------

/**
 * @param {{ read(): string | null | undefined, compareAndSwap(expectedRevision: number, serialized: string): boolean, close?(): void }} storage
 * @param {{ onLoadIssue?: (issue: any) => void, contentLanguage?: "zh" | "en" }} [options]
 */
export function createAgentChatStore(storage, options = {}) {
  const initialRaw = storage.read();
  const initialDecoded = initialRaw
    ? decodeAgentChatStoreSnapshot(initialRaw)
    : { snapshot: { version: /** @type {2} */ (2), revision: 0, turns: [] }, issues: [] };
  const reportedLoadIssues = new Set();
  const reportLoadIssues = (issues) => {
    for (const issue of issues) {
      const key = `${issue.collection}|${issue.index}|${issue.jsonPath}|${issue.message}`;
      if (reportedLoadIssues.has(key)) continue;
      reportedLoadIssues.add(key);
      options.onLoadIssue?.(issue);
    }
  };
  reportLoadIssues(initialDecoded.issues);
  let snapshot = initialDecoded.snapshot;
  let decodeMemo = initialRaw ? { serialized: initialRaw, snapshot: initialDecoded.snapshot } : null;

  const readLatest = () => {
    const raw = storage.read();
    if (!raw) return deepClone(snapshot);
    if (decodeMemo && decodeMemo.serialized === raw) return decodeMemo.snapshot;
    const decoded = decodeAgentChatStoreSnapshot(raw);
    reportLoadIssues(decoded.issues);
    decodeMemo = { serialized: raw, snapshot: decoded.snapshot };
    return decoded.snapshot;
  };
  const commit = (mutate) => {
    const result = commitWithRetry({
      readAndDecode: readLatest,
      mutate,
      serialize: JSON.stringify,
      compareAndSwap: storage.compareAndSwap.bind(storage)
    });
    snapshot = result.value;
    if (result.committed) {
      const written = storage.read();
      if (written) decodeMemo = { serialized: written, snapshot: result.value };
    }
    return result;
  };

  const store = {
    /** @param {any} turn */
    insertTurn(turn) {
      commit((base) => ({
        ...base,
        turns: capTurns([...base.turns.filter((entry) => entry.id !== turn.id), deepClone(turn)])
      }));
      return deepClone(turn);
    },
    /**
     * @param {string} id
     * @param {(turn: any) => any} mutate
     */
    updateTurn(id, mutate) {
      let updated;
      commit((base) => {
        updated = undefined;
        const index = base.turns.findIndex((entry) => entry.id === id);
        if (index < 0) return undefined;
        const turns = [...base.turns];
        turns[index] = mutate(deepClone(turns[index]));
        updated = turns[index];
        return { ...base, turns };
      });
      return updated ? deepClone(updated) : undefined;
    },
    /** @param {string} id */
    get(id) {
      const turn = readLatest().turns.find((entry) => entry.id === id);
      return turn ? deepClone(turn) : undefined;
    },
    /** @param {number} [limit] */
    list(limit = 50) {
      const bounded = Math.max(1, Math.min(limit, maxStoredTurns));
      const turns = [...readLatest().turns].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      return turns.slice(-bounded).map((turn) => deepClone(turn));
    },
    close() {
      storage.close?.();
    }
  };

  // 写锁保证单写者:刚打开存储时没有任何循环在跑,还挂着 running 的轮次
  // 一定是上个进程中断留下的,如实标为失败,免得界面永远轮询下去。
  const interruptedText =
    options.contentLanguage === "en"
      ? "The process restarted; this turn was interrupted."
      : "进程重启,这轮对话中断了。";
  const interrupted = snapshot.turns.filter((turn) => turn.status === "running");
  for (const turn of interrupted) {
    const at = new Date().toISOString();
    store.updateTurn(turn.id, (entry) => ({
      ...entry,
      status: "failed",
      events: [...entry.events, { type: "error", at, text: interruptedText }],
      updatedAt: at
    }));
  }

  return store;
}

function capTurns(turns) {
  const sorted = [...turns].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return sorted.slice(-maxStoredTurns);
}

function decodeAgentChatStoreSnapshot(serialized) {
  /** @type {any[]} */
  const issues = [];
  const root = expectObject(decodeJson(serialized, "agent-chat"), "$");

  if (root.version !== 2) {
    throw new PersistenceDecodeError("$.version", "expected version 2");
  }

  const revision = expectNonNegativeInteger(root.revision, "$.revision");
  const turns = decodeRecordCollection({
    snapshotKind: "agent-chat",
    collection: "turns",
    value: root.turns ?? [],
    issues,
    decodeRecord: decodeAgentChatTurn
  });

  return { snapshot: { version: /** @type {2} */ (2), revision, turns }, issues };
}

function decodeAgentChatTurn(value, path) {
  const record = expectObject(value, path);
  const events = expectArray(record.events ?? [], `${path}.events`).map((event, index) =>
    decodeAgentChatEvent(event, `${path}.events[${index}]`)
  );

  return {
    id: expectNonEmptyString(record.id, `${path}.id`),
    userId: expectNonEmptyString(record.userId, `${path}.userId`),
    text: expectString(record.text, `${path}.text`),
    status: expectEnum(record.status, chatTurnStatuses, `${path}.status`),
    events,
    ...(record.answer !== undefined ? { answer: decodeAgentChatAnswer(record.answer, `${path}.answer`) } : {}),
    ...(record.actions !== undefined ? { actions: expectArray(record.actions, `${path}.actions`) } : {}),
    ...(record.turnRecordId !== undefined
      ? { turnRecordId: expectNonEmptyString(record.turnRecordId, `${path}.turnRecordId`) }
      : {}),
    createdAt: expectIsoDate(record.createdAt, `${path}.createdAt`),
    updatedAt: expectIsoDate(record.updatedAt, `${path}.updatedAt`)
  };
}

function decodeAgentChatEvent(value, path) {
  const record = expectObject(value, path);

  return {
    type: expectEnum(record.type, chatEventTypes, `${path}.type`),
    at: expectIsoDate(record.at, `${path}.at`),
    text: expectString(record.text, `${path}.text`),
    ...(record.data !== undefined ? { data: record.data } : {})
  };
}

function decodeAgentChatAnswer(value, path) {
  const record = expectObject(value, path);

  return {
    text: expectString(record.text, `${path}.text`),
    citations: expectArray(record.citations ?? [], `${path}.citations`)
  };
}

// ---------------------------------------------------------------------------
// 端点处理器
// ---------------------------------------------------------------------------

/**
 * POST /api/agent/chat:立即落一条 running 的 turn,循环异步跑,事件边产生边写入。
 *
 * @param {object} input
 * @param {any} input.body
 * @param {string} input.userId
 * @param {any} input.agentChatStore
 * @param {any} input.persistenceStore
 * @param {any} input.curationStore
 * @param {any} input.askModelClient
 * @param {any} input.searchProvider
 * @param {"zh" | "en"} input.contentLanguage
 * @param {Record<string, string | undefined>} [input.env]
 */
export function handleAgentChatMessage({
  body,
  userId,
  agentChatStore,
  persistenceStore,
  curationStore,
  askModelClient,
  searchProvider,
  contentLanguage,
  env = process.env
}) {
  const text = String(body.text ?? "").trim();
  const now = new Date().toISOString();
  const turn = {
    id: `chat-turn-${hashText(`${userId}|${text}|${now}|${randomUUID()}`)}`,
    userId,
    text,
    status: "running",
    events: [],
    createdAt: now,
    updatedAt: now
  };

  agentChatStore.insertTurn(turn);
  setImmediate(() => {
    runAgentChatTurn({
      chatTurnId: turn.id,
      text,
      userId,
      agentChatStore,
      persistenceStore,
      curationStore,
      askModelClient,
      searchProvider,
      contentLanguage,
      env
    }).catch((error) => {
      console.error("[aitimeline] agent chat turn crashed.", error);
      try {
        const at = new Date().toISOString();
        agentChatStore.updateTurn(turn.id, (entry) => ({
          ...entry,
          status: "failed",
          events: [
            ...entry.events,
            { type: "error", at, text: contentLanguage === "en" ? "The turn failed." : "这一轮失败了。" }
          ],
          updatedAt: at
        }));
      } catch (updateError) {
        console.error("[aitimeline] agent chat failure could not be recorded.", updateError);
      }
    });
  });

  return { chatTurnId: turn.id, status: "running" };
}

/**
 * @param {object} input
 * @param {any} input.agentChatStore
 * @param {number} [input.limit]
 */
export function listAgentChatTurns({ agentChatStore, limit }) {
  const turns = agentChatStore.list(limit ?? 50);

  return { turns, total: turns.length };
}

/**
 * @param {object} input
 * @param {any} input.agentChatStore
 * @param {string} input.id
 */
export function getAgentChatTurn({ agentChatStore, id }) {
  const turn = agentChatStore.get(id);

  return turn ? { turn } : null;
}

// ---------------------------------------------------------------------------
// 循环执行与兜底
// ---------------------------------------------------------------------------

async function runAgentChatTurn({
  chatTurnId,
  text,
  userId,
  agentChatStore,
  persistenceStore,
  curationStore,
  askModelClient,
  searchProvider,
  contentLanguage,
  env
}) {
  const zh = contentLanguage !== "en";
  const appendEvent = (event) => {
    agentChatStore.updateTurn(chatTurnId, (turn) => ({
      ...turn,
      events: [...turn.events, event],
      updatedAt: event.at
    }));
  };
  const finalize = (fields) => {
    const at = new Date().toISOString();
    agentChatStore.updateTurn(chatTurnId, (turn) => ({
      ...turn,
      status: fields.status,
      ...(fields.answer ? { answer: fields.answer } : {}),
      ...(fields.actions?.length ? { actions: fields.actions } : {}),
      ...(fields.turnRecordId ? { turnRecordId: fields.turnRecordId } : {}),
      updatedAt: at
    }));
  };

  try {
    if (!askModelClient) {
      finalize(
        await runDeterministicChatTurn({
          text,
          userId,
          persistenceStore,
          curationStore,
          askModelClient,
          searchProvider,
          contentLanguage,
          appendEvent
        })
      );
      return;
    }

    // 工具通过这个共享 state 把要进 turn 的字段交回来:ask_grounded 的原样
    // 回答、propose_discovery 的确认动作和 turnRecordId。
    const state = { answer: undefined, actions: undefined, turnRecordId: undefined, awaitingConfirmation: false };
    const tools = buildAgentChatTools({
      persistenceStore,
      curationStore,
      askModelClient,
      contentLanguage,
      userId,
      chatTurnId,
      state,
      env
    });
    const result = await runAgentLoop({
      text,
      client: askModelClient,
      tools,
      contentLanguage,
      maxSteps: readAgentLoopMaxSteps(env),
      contextLines: [
        zh
          ? "面向用户的话用简体中文说,技术术语保留英文。"
          : "Speak to the user in natural English; keep technical terms in their original wording."
      ],
      onEvent: appendEvent
    });

    if (result.status === "succeeded") {
      finalize({
        status: state.awaitingConfirmation ? "awaiting_confirmation" : "succeeded",
        answer: state.answer,
        actions: state.actions,
        turnRecordId: state.turnRecordId
      });
      return;
    }

    appendEvent({
      type: "error",
      at: new Date().toISOString(),
      text: zh ? "模型循环没能完成,改用确定性路径收尾。" : "The model loop did not finish; falling back to the deterministic path."
    });
    // 兜底必须彻底无模型:模型这一轮刚证明了不可靠(超时/断连/协议失守),
    // 再把它传回去,里面的有据问答还会再等一次超时才轮到自己的回退。
    finalize(
      await runDeterministicChatTurn({
        text,
        userId,
        persistenceStore,
        curationStore,
        askModelClient: undefined,
        searchProvider,
        contentLanguage,
        appendEvent
      })
    );
  } catch (error) {
    console.error("[aitimeline] agent chat turn failed.", error);
    const at = new Date().toISOString();
    appendEvent({ type: "error", at, text: zh ? "这一轮失败了。" : "The turn failed." });
    agentChatStore.updateTurn(chatTurnId, (turn) => ({ ...turn, status: "failed", updatedAt: at }));
  }
}

// 无模型兜底:复用 dispatchAgentTask 的既有分流(parsePreferenceIntent -> 喜好路;
// 否则 handleAgentAsk),把结果包装成同形状 turn 事件。界面只认识一种数据形状,
// 感知不到有没有模型。
async function runDeterministicChatTurn({
  text,
  userId,
  persistenceStore,
  curationStore,
  askModelClient,
  searchProvider,
  contentLanguage,
  appendEvent
}) {
  const zh = contentLanguage !== "en";
  const at = () => new Date().toISOString();
  // dispatchAgentTask 的两条分流返回不同形状,靠 route 字段区分;联合类型不带
  // 判别式,这里放宽成 any 再按 route 分支取字段。
  const result = /** @type {any} */ (
    await dispatchAgentTask({
      body: { text },
      userId,
      persistenceStore,
      curationStore,
      askModelClient,
      searchProvider,
      contentLanguage
    })
  );

  if (result.route === "preference") {
    if (Array.isArray(result.events) && result.events.length) {
      appendEvent({
        type: "tool_result",
        at: at(),
        text: zh ? "已更新用户记忆" : "User memory updated",
        data: { memoryEvents: result.events }
      });
    }

    appendEvent({ type: "say", at: at(), text: result.reply });
    return { status: "succeeded" };
  }

  const turnResult = result.turn;

  for (const note of turnResult?.notes ?? []) {
    appendEvent({ type: "say", at: at(), text: note });
  }

  let answer;

  if (turnResult?.answer) {
    answer = { text: turnResult.answer.answer, citations: turnResult.answer.citations ?? [] };
    appendEvent({ type: "say", at: at(), text: turnResult.answer.answer, data: { grounded: turnResult.answer.grounded } });
  }

  return {
    status: result.turnRecord?.status === "pending_confirmation" ? "awaiting_confirmation" : "succeeded",
    answer,
    actions: turnResult?.actions?.length ? turnResult.actions : undefined,
    turnRecordId: result.turnRecord?.id
  };
}

// ---------------------------------------------------------------------------
// 工具箱:七个已核实原语的薄封装
// ---------------------------------------------------------------------------

/**
 * @param {object} input
 * @param {any} input.persistenceStore
 * @param {any} input.curationStore
 * @param {any} input.askModelClient
 * @param {"zh" | "en"} input.contentLanguage
 * @param {string} input.userId
 * @param {string} input.chatTurnId
 * @param {{ answer?: any, actions?: any[], turnRecordId?: string, awaitingConfirmation: boolean }} input.state
 * @param {Record<string, string | undefined>} [input.env]
 */
export function buildAgentChatTools({
  persistenceStore,
  curationStore,
  askModelClient,
  contentLanguage,
  userId,
  chatTurnId,
  state,
  env = process.env
}) {
  const zh = contentLanguage !== "en";

  return {
    search_library: {
      description: "Search knowledge cards already in the library by word overlap.",
      argsHint: '{"query":"..."}',
      run(args) {
        const query = requireToolString(args.query, "query");
        const snapshot = persistenceStore.getSnapshot();
        const posts = getKnowledgePosts(snapshot.posts);
        const matches = rankPostsForQuestion(posts, query, snapshot.conceptAliases)
          .slice(0, 5)
          .map(({ postId, title, overlapScore }) => ({ postId, title, overlapScore }));

        return { matches };
      }
    },
    ask_grounded: {
      description:
        "Answer a question with citations from the library. The only allowed source of knowledge content. Pass postId when you already know the card; otherwise the best-matching card is picked internally.",
      argsHint: '{"question":"...","postId":"optional"}',
      async run(args) {
        const question = requireToolString(args.question, "question");
        const snapshot = persistenceStore.getSnapshot();
        const posts = getKnowledgePosts(snapshot.posts);
        const requestedPostId = typeof args.postId === "string" && args.postId.trim() ? args.postId.trim() : undefined;
        const post = requestedPostId
          ? posts.find((candidate) => candidate.id === requestedPostId)
          : rankPostsForQuestion(posts, question, snapshot.conceptAliases)[0]?.post;

        if (!post) {
          return {
            found: false,
            message: requestedPostId
              ? `No post found for id ${requestedPostId}.`
              : "No library card matches this question; consider propose_discovery."
          };
        }

        const sourceIds = new Set(post.sources.map((source) => source.id));
        const registries = snapshot.sourceRegistries
          .filter((record) => sourceIds.has(record.sourceId))
          .map((record) => record.registry);
        const answer = await askGrounded(
          { post, registry: mergeSourceRegistries(...registries), question },
          { client: askModelClient, contentLanguage }
        );

        state.answer = { text: answer.answer, citations: answer.citations };

        return {
          found: true,
          postId: post.id,
          answer: answer.answer,
          citations: answer.citations,
          grounded: answer.grounded
        };
      }
    },
    enqueue_import: {
      description: "Queue a URL for background import into cited knowledge cards (does not fetch immediately).",
      argsHint: '{"url":"https://...","reason":"why this source"}',
      run(args) {
        const url = requireToolString(args.url, "url");
        const reason = requireToolString(args.reason, "reason");
        const now = new Date().toISOString();
        const snapshot = persistenceStore.getSnapshot();
        const candidate = normalizeSourceCandidate({ url, reason }, now);
        // 先查重再扣费:同一 URL 已有排队/在跑的导入任务时,enqueuePlan 会按
        // 语义键去重返回已有记录——任务没新建,预算却已经扣掉。照 preferences
        // 判 alreadyQueued 的模式,这种情况直接复用,不碰预算。
        const urlKey = normalizeUrlKey(candidate.source.url);
        const existing = curationStore
          .list()
          .find(
            (record) =>
              record.job.kind === "import_source" &&
              (record.status === "queued" || record.status === "running") &&
              normalizeUrlKey(record.job.sourceCandidate?.source?.url ?? "") === urlKey
          );

        if (existing) {
          return { queued: true, alreadyQueued: true, taskId: existing.id };
        }

        const job = {
          // user-task- 前缀让任务台账把它认作用户发起的任务。
          id: `user-task-import-${hashText(`${candidate.id}|${now}`)}`,
          kind: "import_source",
          topicId: candidate.topicId ?? candidate.source.title,
          conceptIds: candidate.conceptIds,
          priority: 0.7,
          reason,
          createdAt: now,
          runAfter: now,
          sourceCandidate: { ...candidate, intakeKind: "user_paste" }
        };
        const budgetResult = applyDailyAutoJobBudget({
          plan: createSingleJobPlan(job, now),
          budget: getDailyAutoJobBudgetRecord(snapshot, now),
          limit: getDailyAutoJobBudgetLimit(env),
          now
        });
        const records = curationStore.enqueuePlan(budgetResult.plan, now);

        persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], now);

        if (!records.length) {
          return { queued: false, budgetExhausted: true };
        }

        persistenceStore.saveCurationJobRecords(records, now);

        return { queued: true, taskId: records[0].id };
      }
    },
    propose_discovery: {
      description:
        "Propose a web search for sources on a topic. Does NOT execute anything: it creates a confirmation question the user must answer first.",
      argsHint: '{"topic":"..."}',
      run(args) {
        const topic = requireToolString(args.topic, "topic");
        const now = new Date().toISOString();
        const turnRecord = {
          id: `agent-turn-${hashText(`${userId}|${chatTurnId}|${topic}|${now}`)}`,
          userId,
          question: topic,
          intent: "discovery_proposal",
          tier: "free",
          zone: "dark",
          status: "pending_confirmation",
          threadId: chatTurnId,
          createdAt: now
        };

        persistenceStore.saveAgentTurnRecords([turnRecord], now);

        const questions = buildDiscoveryConfirmationQuestions(contentLanguage);

        state.turnRecordId = turnRecord.id;
        state.awaitingConfirmation = true;
        state.actions = [
          {
            kind: "confirm_discovery",
            label: zh ? "确认研究范围" : "Confirm research scope",
            concepts: [],
            question: topic,
            queries: [topic.slice(0, 120)],
            questions
          }
        ];

        return { turnRecordId: turnRecord.id, awaitingConfirmation: true, questions };
      }
    },
    get_due_reviews: {
      description: "List knowledge cards whose spaced review is due now.",
      argsHint: "{}",
      run() {
        const now = new Date().toISOString();
        const snapshot = backfillLegacyReviewStates(persistenceStore, now);
        const hardDismissedPostIds = getHardDismissedPostIds(snapshot.dismissedPosts);
        const postById = new Map(snapshot.posts.map((post) => [post.id, post]));
        const due = getDueReviewStates(snapshot.reviewStates, now)
          .filter((reviewState) => !hardDismissedPostIds.has(reviewState.postId))
          .filter((reviewState) => postById.has(reviewState.postId))
          .map(({ postId, intervalDays, dueAt }) => ({
            postId,
            title: postById.get(postId).title,
            intervalDays,
            dueAt,
            reviewPrompt: selectReviewPrompt(postById.get(postId), intervalDays)
          }));

        return { due: due.slice(0, 10), total: due.length };
      }
    },
    read_memory: {
      description: "Read the user's editable memory (interests, goals, known/weak concepts, preferences).",
      argsHint: "{}",
      run() {
        return { memory: getSnapshotUserMemory(persistenceStore.getSnapshot(), userId) };
      }
    },
    edit_memory: {
      description:
        "Edit the user's memory. Allowed fields: profile.interests, profile.goals, profile.explanationStyle, knowledge.knownConcepts, knowledge.weakConcepts, knowledge.savedConcepts, interaction.recentCardIds, interaction.recentQuestions, agent.topicAgents, agent.preferredSourceTypes. reason is required.",
      argsHint: '{"edits":[{"kind":"add","field":"profile.interests","value":"..."}],"reason":"..."}',
      run(args) {
        const reason = requireToolString(args.reason, "reason");

        if (!Array.isArray(args.edits) || args.edits.length === 0) {
          throw new Error("edits must be a non-empty array.");
        }

        const edits = args.edits.map((edit, index) => {
          if (typeof edit !== "object" || edit === null) {
            throw new Error(`edits[${index}] must be an object.`);
          }

          if (!memoryEditKinds.has(edit.kind)) {
            throw new Error(`edits[${index}].kind must be one of: ${[...memoryEditKinds].join(", ")}.`);
          }

          if (!memoryEditFields.has(edit.field)) {
            throw new Error(`edits[${index}].field must be one of: ${[...memoryEditFields].join(", ")}.`);
          }

          return {
            kind: edit.kind,
            field: edit.field,
            ...(typeof edit.value === "string" ? { value: edit.value } : {}),
            ...(Array.isArray(edit.values) ? { values: edit.values } : {}),
            reason
          };
        });
        const now = new Date().toISOString();
        const memory = getSnapshotUserMemory(persistenceStore.getSnapshot(), userId);
        const editResult = applyUserMemoryEdits(memory, edits, now);

        persistenceStore.saveUserMemory(userId, editResult.memory, editResult.events, now);

        return { memoryChanged: true, memoryEvents: editResult.events };
      }
    },
    list_recent_tasks: {
      description: "List the observer's recent background tasks and question turns.",
      argsHint: "{}",
      run() {
        const result = listAgentTasks({ persistenceStore, curationStore, contentLanguage, limit: 10 });

        return {
          tasks: result.tasks.map((task) => ({
            id: task.id,
            kindLabel: task.kindLabel,
            title: task.title,
            status: task.status,
            updatedAt: task.updatedAt
          })),
          total: result.total,
          running: result.running,
          failed: result.failed
        };
      }
    }
  };
}

// 选卡对齐确定性路径(runConversationTurn)的做法:先做概念命中——库内概念名
// 与别名(含 conceptSurfaceForms 派生的缩写/中文写法,#168 验证过的原语)在问题
// 里做贴边子串匹配;概念没命中再退词面重合。纯词面重合对中文全盲(没有空格
// 分词,整句变成单个 token),所以补一路 CJK 字符二元组重合当补充信号。
// 全部零命中就返回空,让调用方诚实报 found:false,不盲目兜底 posts[0]。
function rankPostsForQuestion(posts, question, conceptAliases) {
  const matchedSlugs = matchQuestionConceptSlugs(posts, question, conceptAliases);
  const resolver = createConceptAliasResolver(conceptAliases ?? []);
  const questionTokens = tokenizeText(question);
  const questionBigrams = cjkBigrams(question);

  return posts
    .map((post) => {
      const conceptHits = (post.concepts ?? []).filter((concept) =>
        matchedSlugs.has(resolver.slugConcept(concept))
      ).length;
      const haystackText = [post.title, post.summary, post.keyTakeaway, (post.concepts ?? []).join(" ")].join(" ");
      const haystackTokens = tokenizeText(haystackText);
      const tokenOverlap = questionTokens.size
        ? Array.from(questionTokens).filter((token) => haystackTokens.has(token)).length / questionTokens.size
        : 0;
      const haystackBigrams = cjkBigrams(haystackText);
      const bigramOverlap = questionBigrams.size
        ? Array.from(questionBigrams).filter((bigram) => haystackBigrams.has(bigram)).length / questionBigrams.size
        : 0;
      const lexicalOverlap = Math.max(tokenOverlap, bigramOverlap);

      return {
        postId: post.id,
        title: post.title,
        overlapScore: roundScore(Math.min(1, lexicalOverlap + conceptHits * 0.5)),
        conceptHits,
        lexicalOverlap,
        post
      };
    })
    .filter((entry) => entry.conceptHits > 0 || entry.lexicalOverlap > 0)
    .sort(
      (left, right) =>
        right.conceptHits - left.conceptHits ||
        right.lexicalOverlap - left.lexicalOverlap ||
        right.post.createdAt.localeCompare(left.post.createdAt)
    );
}

// 库内概念词表(概念名 + 用户合并的别名 + 表面形式)里,哪些在问题里被提到了。
// 与 conversationAgent.extractConceptsFromQuestion 同一套公共原语的等价实现。
function matchQuestionConceptSlugs(posts, question, conceptAliases) {
  const resolver = createConceptAliasResolver(conceptAliases ?? []);
  const aliasLabelsBySlug = new Map();

  for (const record of conceptAliases ?? []) {
    const slug = resolver.slugConcept(record.canonical);

    if (!slug) continue;

    aliasLabelsBySlug.set(slug, [
      ...(aliasLabelsBySlug.get(slug) ?? []),
      record.canonical,
      ...record.aliases
    ]);
  }

  const vocabulary = new Map();

  for (const post of posts) {
    for (const concept of post.concepts ?? []) {
      const slug = resolver.slugConcept(concept);

      if (slug && !vocabulary.has(slug)) {
        vocabulary.set(slug, concept);
      }
    }
  }

  const matched = new Set();

  for (const [slug, label] of vocabulary) {
    const forms = new Set([label, ...(aliasLabelsBySlug.get(slug) ?? [])]);

    for (const base of [...forms]) {
      for (const derived of buildConceptSurfaceForms(base)) {
        forms.add(derived);
      }
    }

    if ([...forms].some((form) => textMentionsSurfaceForm(question, form))) {
      matched.add(slug);
    }
  }

  return matched;
}

const hanCharacter = /\p{Script=Han}/u;

function cjkBigrams(value) {
  const text = String(value);
  const bigrams = new Set();

  for (let index = 0; index < text.length - 1; index += 1) {
    if (hanCharacter.test(text[index]) && hanCharacter.test(text[index + 1])) {
      bigrams.add(text[index] + text[index + 1]);
    }
  }

  return bigrams;
}

function requireToolString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

export const __testing = { decodeAgentChatStoreSnapshot, rankPostsForQuestion, matchQuestionConceptSlugs, capTurns };
