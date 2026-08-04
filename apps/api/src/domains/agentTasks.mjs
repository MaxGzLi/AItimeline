// @ts-check

// 任务客户端的数据面。把两条本来分居的流合成一条「观察员做过的事」:
// 策展队列里的后台任务(curation-jobs.json)和你问过的问题(快照 agentTurns)。
//
// 列表端点只回一行需要的字段。快照现在是 19MB 的全量美化输出,任务列表如果
// 继续吃 /api/snapshot,开一次客户端就得等它传完——所以这里所有取数都走
// 队列存储和快照里的定点字段,不整份序列化。

import { parsePreferenceIntent } from "../../../../packages/core/dist/index.js";
import { handlePreferenceChat } from "./preferences.mjs";
import { handleAgentAsk } from "./research.mjs";
import { sanitizeCurationRecordForResponse } from "./responses.mjs";

// 用户自己发起的任务:队列记录不带「谁发起的」字段,所以按两条确凿线索判定
// ——任务 id 前缀(我们自己排队时写的)和来源候选的进料方式。判不出的一律
// 算观察员自发,宁可少认领,不冒领。
const userInitiatedJobIdPrefixes = ["preference-discover-", "user-task-"];
const userInitiatedIntakeKinds = new Set(["browser_share", "user_paste", "manual"]);

// `sanitizeFailedCurationRecord` 把所有失败原因收敛成下面这三句之一再出网,
// 所以要翻译的就这三句;别的写法到不了这里,不用先猜着占位。
const failureReplies = {
  "Source could not be fetched.": "抓不到这个来源(网络或对方站点的问题)。",
  "Source import failed.": "导入这个来源时失败了。",
  "Background job failed.": "这个后台任务失败了。"
};

const kindLabels = {
  zh: {
    import_source: "导入来源",
    discover_sources: "找来源",
    generate_followup: "做跟进卡",
    concept_brief: "写概念简介",
    research_question: "研究问题",
    research_idea: "琢磨想法",
    deep_read_article: "深读长文",
    schedule_review: "安排复习",
    ask_clarifying_question: "追问澄清",
    cooldown_topic: "给主题降温",
    question: "提问"
  },
  en: {
    import_source: "Import source",
    discover_sources: "Find sources",
    generate_followup: "Write follow-up",
    concept_brief: "Concept brief",
    research_question: "Research question",
    research_idea: "Explore idea",
    deep_read_article: "Deep read",
    schedule_review: "Schedule review",
    ask_clarifying_question: "Ask a clarifying question",
    cooldown_topic: "Cool down topic",
    question: "Question"
  }
};

/**
 * 列表:队列记录 + 提问轮次,按最后动静倒序。
 *
 * @param {object} input
 * @param {any} input.persistenceStore
 * @param {any} input.curationStore
 * @param {"zh" | "en"} input.contentLanguage
 * @param {number} [input.limit]
 * @param {string} [input.status]
 */
export function listAgentTasks({ persistenceStore, curationStore, contentLanguage, limit = 60, status }) {
  const snapshot = persistenceStore.getSnapshot();
  const jobTasks = curationStore
    .list()
    .map((record) => summarizeJobRecord(sanitizeCurationRecordForResponse(record, false), contentLanguage));
  const questionTasks = (snapshot.agentTurns ?? []).map((turn) => summarizeAgentTurn(turn, contentLanguage));
  const all = [...jobTasks, ...questionTasks]
    .filter((task) => (status ? task.status === status : true))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return {
    tasks: all.slice(0, Math.max(1, Math.min(limit, 200))),
    total: all.length,
    running: all.filter((task) => task.status === "running").length,
    failed: all.filter((task) => task.status === "failed").length
  };
}

/**
 * 详情:把一条任务摊成有时间顺序的步骤流,外加它产出的东西。
 *
 * @param {object} input
 * @param {string} input.id
 * @param {any} input.persistenceStore
 * @param {any} input.curationStore
 * @param {"zh" | "en"} input.contentLanguage
 */
export function getAgentTask({ id, persistenceStore, curationStore, contentLanguage }) {
  const snapshot = persistenceStore.getSnapshot();
  const record = findJobRecord(curationStore, id);

  if (record) {
    const sanitized = sanitizeCurationRecordForResponse(record, false);

    return {
      task: summarizeJobRecord(sanitized, contentLanguage),
      steps: buildJobSteps(sanitized, contentLanguage),
      produced: resolveProducedCards(collectProducedPostIds(sanitized.result), snapshot),
      conceptBrief: sanitized.result?.conceptBrief ?? null
    };
  }

  const turn = (snapshot.agentTurns ?? []).find((entry) => entry.id === id);

  if (!turn) {
    return null;
  }

  return {
    task: summarizeAgentTurn(turn, contentLanguage),
    steps: buildTurnSteps(turn, contentLanguage),
    produced: resolveProducedCards(turn.answerCardId ? [turn.answerCardId] : [], snapshot),
    conceptBrief: null
  };
}

/**
 * 派活:顶部输入框里的一句话。
 *
 * 能解析成学习意图的(「我最近想搞懂 ___」)走喜好那条:写进用户记忆 + 排一个
 * 找来源的后台任务。其余当成提问,走已有的对话轮。两条都是现成的处理器,这里
 * 只做分流,不新造第三种行为。
 *
 * @param {object} input
 * @param {any} input.body
 * @param {string} input.userId
 * @param {any} input.persistenceStore
 * @param {any} input.curationStore
 * @param {any} input.askModelClient
 * @param {any} input.searchProvider
 * @param {"zh" | "en"} input.contentLanguage
 */
export async function dispatchAgentTask({
  body,
  userId,
  persistenceStore,
  curationStore,
  askModelClient,
  searchProvider,
  contentLanguage
}) {
  const text = String(body.text ?? "").trim();

  if (parsePreferenceIntent(text)) {
    const result = handlePreferenceChat({ ...body, text }, userId, persistenceStore, curationStore, contentLanguage);

    return { route: "preference", taskId: result.curation?.jobId ?? null, ...result };
  }

  const result = await handleAgentAsk(
    { ...body, question: text },
    userId,
    persistenceStore,
    askModelClient,
    searchProvider,
    contentLanguage
  );

  return { route: "question", taskId: result.turnRecord?.id ?? null, ...result };
}

/**
 * 重试:失败的任务重新排队。
 *
 * 走队列自己的 `enqueueRetry`——它按 originalJobId 的血缘算新 id,所以不会像
 * 直接用老 id 排队那样撞上那条已经躺在队列里的终态记录、被 `enqueuePlan`
 * 当成「已存在」静默丢掉。这正是「保存了一条推却再也没变成卡」的病根。
 * 这个原语一直在内核里,只是此前没人接。
 *
 * @param {object} input
 * @param {string} input.id
 * @param {any} input.persistenceStore
 * @param {any} input.curationStore
 * @param {"zh" | "en"} input.contentLanguage
 * @param {string} input.now
 */
export function retryAgentTask({ id, persistenceStore, curationStore, contentLanguage, now }) {
  const record = findJobRecord(curationStore, id);

  if (!record) {
    return {
      retried: false,
      reason: "not_found",
      reply: contentLanguage === "en" ? "That task no longer exists." : "找不到这条任务了。"
    };
  }

  if (record.status !== "failed") {
    return {
      retried: false,
      reason: "not_failed",
      reply:
        contentLanguage === "en"
          ? "Only failed tasks can be retried; this one has not failed."
          : "只有失败的任务需要重试,这条没有失败。"
    };
  }

  const retryRecord = curationStore.enqueueRetry(record.id, now);

  persistenceStore.saveCurationJobRecords([retryRecord], now);

  // 血缘里已经有一条在排队/在跑时,enqueueRetry 会把那条还给我们而不是新建。
  const reused = retryRecord.id !== record.id && retryRecord.attempt === record.attempt;

  return {
    retried: true,
    taskId: retryRecord.id,
    reused,
    reply:
      contentLanguage === "en"
        ? "Queued again; the observer picks it up on the next run."
        : "已经重新排队,观察员下一轮就会捡起来。"
  };
}

// 前端手里的 id 可能是记录 id,也可能是任务 id(重试记录两者相同,首次入队也相同,
// 但历史数据里存在不一致的记录),两种都认。
function findJobRecord(curationStore, id) {
  const records = curationStore.list();

  return records.find((entry) => entry.id === id) ?? records.find((entry) => entry.job.id === id);
}

function summarizeJobRecord(record, contentLanguage) {
  const producedPostIds = collectProducedPostIds(record.result);

  return {
    id: record.id,
    origin: isUserInitiatedJob(record.job) ? "you" : "agent",
    kind: record.job.kind,
    kindLabel: labelForKind(record.job.kind, contentLanguage),
    title: describeJob(record.job, contentLanguage),
    reason: record.job.reason ?? null,
    status: record.status,
    attempts: record.attempts ?? 0,
    createdAt: record.createdAt ?? record.job.createdAt,
    updatedAt: record.updatedAt ?? record.completedAt ?? record.createdAt ?? record.job.createdAt,
    producedCount: producedPostIds.length,
    failureReason: record.status === "failed" ? localizeFailure(record.lastError, contentLanguage) : null,
    retryable: record.status === "failed"
  };
}

function summarizeAgentTurn(turn, contentLanguage) {
  return {
    id: turn.id,
    origin: "you",
    kind: "question",
    kindLabel: labelForKind("question", contentLanguage),
    title: turn.question,
    reason: null,
    status: mapTurnStatus(turn.status),
    attempts: 0,
    createdAt: turn.createdAt,
    updatedAt: turn.createdAt,
    producedCount: turn.answerCardId ? 1 : 0,
    failureReason: null,
    retryable: false
  };
}

// 提问轮次的状态词和队列的不是一套,合并成一条列表前先归一。
function mapTurnStatus(status) {
  if (status === "answered" || status === "closed") return "succeeded";
  if (status === "researching") return "running";

  return "queued";
}

/**
 * 步骤流。只在记录里**真有**那个时间戳时才给 `at`——没有的步骤(比如检索到
 * 的候选来源本身不带时间)留空,界面就不显示时间,不编造。
 */
function buildJobSteps(record, contentLanguage) {
  const zh = contentLanguage !== "en";
  const steps = [];
  const queuedAt = record.createdAt ?? record.job.createdAt;

  if (queuedAt) {
    const scheduled = record.job.runAfter && record.job.runAfter > queuedAt ? record.job.runAfter : null;

    steps.push({
      kind: "queued",
      at: queuedAt,
      text: zh ? "排队" : "Queued",
      note: scheduled ? (zh ? `计划 ${formatClock(scheduled)} 开跑` : `Scheduled for ${formatClock(scheduled)}`) : null
    });
  }

  if (record.claimedAt ?? record.startedAt) {
    steps.push({
      kind: "claimed",
      at: record.claimedAt ?? record.startedAt,
      text: zh ? "观察员领取" : "Observer picked it up",
      note: record.attempts > 1 ? (zh ? `第 ${record.attempts} 次尝试` : `Attempt ${record.attempts}`) : null
    });
  }

  const discovered = record.result?.discoveredSourceCandidates ?? [];

  if (discovered.length) {
    steps.push({
      kind: "discovered",
      at: null,
      text: zh ? `检索到 ${discovered.length} 条候选来源` : `Found ${discovered.length} candidate sources`,
      note: null,
      items: discovered.slice(0, 8).map((candidate) => ({
        title: candidate.source?.title ?? candidate.id,
        url: candidate.source?.url ?? null,
        relevanceScore: typeof candidate.relevanceScore === "number" ? candidate.relevanceScore : null
      }))
    });
  }

  const importedTitle = record.result?.sourceImport?.source?.title;

  if (importedTitle) {
    steps.push({
      kind: "imported",
      at: null,
      text: zh ? `读了来源:${importedTitle}` : `Read source: ${importedTitle}`,
      note: null
    });
  }

  if (record.status === "failed") {
    steps.push({
      kind: "failed",
      at: record.completedAt ?? record.updatedAt ?? null,
      text: localizeFailure(record.lastError, contentLanguage),
      note: null
    });
  } else if (record.status === "succeeded") {
    const produced = collectProducedPostIds(record.result).length;

    steps.push({
      kind: "succeeded",
      at: record.completedAt ?? record.updatedAt ?? null,
      text: zh ? "完成" : "Done",
      note: produced ? (zh ? `产出 ${produced} 张卡` : `${produced} card(s) produced`) : null
    });
  }

  return steps;
}

function buildTurnSteps(turn, contentLanguage) {
  const zh = contentLanguage !== "en";
  const steps = [{ kind: "queued", at: turn.createdAt, text: zh ? "你问的" : "You asked", note: null }];

  if (turn.status === "researching") {
    steps.push({ kind: "claimed", at: null, text: zh ? "观察员正在查" : "Observer is researching", note: null });
  }

  if (turn.answerCardId) {
    steps.push({
      kind: "succeeded",
      at: null,
      text: zh ? "答完了,依据下面这张卡" : "Answered from the card below",
      note: null
    });
  } else if (turn.status === "pending_confirmation") {
    steps.push({
      kind: "queued",
      at: null,
      text: zh ? "等你确认要不要往下查" : "Waiting for you to confirm the research scope",
      note: null
    });
  }

  return steps;
}

// 结算压缩会把产出卡削到只剩 id(见 #136),所以这里只收 id,正文回快照取。
function collectProducedPostIds(result) {
  if (!result) return [];

  const ids = new Set();

  for (const post of result.sourceImport?.posts ?? []) {
    if (post?.id) ids.add(post.id);
  }

  for (const sourceImport of result.sourceImports ?? []) {
    for (const post of sourceImport?.posts ?? []) {
      if (post?.id) ids.add(post.id);
    }
  }

  return [...ids];
}

// 只回列表要显示的字段 + 第一条逐字引文,不整张卡塞进响应。
function resolveProducedCards(postIds, snapshot) {
  if (!postIds.length) return [];

  const byId = new Map((snapshot.posts ?? []).map((post) => [post.id, post]));

  return postIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((post) => {
      const citation = (post.thread ?? []).flatMap((block) => block.citations ?? []).find((entry) => entry?.quote);
      const source = post.sources?.[0] ?? null;

      return {
        id: post.id,
        title: post.title,
        keyTakeaway: post.keyTakeaway ?? post.thesis ?? null,
        concepts: (post.concepts ?? []).slice(0, 4),
        quote: citation?.quote ?? null,
        source: source ? { title: source.title, url: source.url, author: source.author ?? null } : null
      };
    });
}

function isUserInitiatedJob(job) {
  if (userInitiatedJobIdPrefixes.some((prefix) => job.id.startsWith(prefix))) return true;

  return userInitiatedIntakeKinds.has(job.sourceCandidate?.intakeKind);
}

function labelForKind(kind, contentLanguage) {
  const table = contentLanguage === "en" ? kindLabels.en : kindLabels.zh;

  return table[kind] ?? kind;
}

// 失败文案在 sanitizeFailedCurationRecord 里已经收敛成固定几句英文,这里按
// 那几句做定值映射;认不出的原样透出,不猜。
function localizeFailure(lastError, contentLanguage) {
  if (typeof lastError !== "string" || !lastError.trim()) {
    return contentLanguage === "en" ? "The task failed." : "任务失败了。";
  }

  if (contentLanguage === "en") return lastError;

  return failureReplies[lastError] ?? lastError;
}

// 标题:一眼看出这条任务在干什么。用任务自带的主题/概念,不引入新数据。
function describeJob(job, contentLanguage) {
  const zh = contentLanguage !== "en";
  const topic = job.topicId || job.conceptIds?.[0] || "";
  const label = labelForKind(job.kind, contentLanguage);

  if (job.kind === "import_source") {
    const title = job.sourceCandidate?.source?.title || topic;

    return title ? (zh ? `导入来源:${title}` : `Import source: ${title}`) : label;
  }

  // researchQuestion 是一整个对象({turnId, question, choices, ...}),要的是里面那句问题。
  if (job.kind === "research_question" && job.researchQuestion?.question) {
    const asked = job.researchQuestion.question;

    return zh ? `研究问题:${asked}` : `Research question: ${asked}`;
  }

  if (!topic) return label;

  return zh ? `${label}:${topic}` : `${label}: ${topic}`;
}

function formatClock(isoDate) {
  const parsed = new Date(isoDate);

  if (Number.isNaN(parsed.getTime())) return isoDate;

  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

export const __testing = { describeJob, buildJobSteps, collectProducedPostIds, isUserInitiatedJob, mapTurnStatus };
