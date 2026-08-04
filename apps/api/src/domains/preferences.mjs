// @ts-check

import {
  applyDailyAutoJobBudget,
  applyUserMemoryEdits,
  createEmptyUserMemory,
  normalizeConceptKey,
  parsePreferenceIntent
} from "../../../../packages/core/dist/index.js";
import {
  createSingleJobPlan,
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  hashText,
  summarizeSnapshot
} from "./shared.mjs";

// 一句话调喜好:确定性意图解析 -> 把主题写进用户记忆(profile.interests)->
// 给策展队列排一个 discover_sources 任务 -> 返回如实描述这两个动作的确认。
// 记忆里的兴趣会被 getConfirmedDiscoveryConcepts 认作已确认概念,所以这个
// discover_sources 任务在下一轮 /api/curation/run 会真的去搜这个主题。
export function handlePreferenceChat(body, userId, persistenceStore, curationStore, contentLanguage, env = process.env) {
  const intent = parsePreferenceIntent(String(body.text));
  const now = new Date().toISOString();

  if (!intent) {
    return {
      understood: false,
      reply:
        contentLanguage === "en"
          ? 'Sorry, I did not catch a topic. Try "I want to figure out ___".'
          : "没听懂,试试「我最近想搞懂 ___」。",
      snapshotSummary: summarizeSnapshot(persistenceStore.getSnapshot())
    };
  }

  const topic = intent.topic;
  const topicKey = normalizeConceptKey(topic);
  const snapshot = persistenceStore.getSnapshot();
  const currentMemory =
    snapshot.userMemories.find((record) => record.userId === userId)?.memory ?? createEmptyUserMemory();
  const alreadyInterested = currentMemory.profile.interests.some(
    (interest) => normalizeConceptKey(interest) === topicKey
  );
  let events = [];

  if (!alreadyInterested) {
    const editResult = applyUserMemoryEdits(
      currentMemory,
      [
        {
          kind: "add",
          field: "profile.interests",
          value: topic,
          reason: `preference_chat: ${String(body.text).trim()}`
        }
      ],
      now
    );

    events = editResult.events;
    persistenceStore.saveUserMemory(userId, editResult.memory, events, now);
  }

  // 同主题已有未执行的来源搜寻任务时不重复排队,确认文案也如实说明。
  const alreadyQueued = curationStore
    .list()
    .some(
      (record) =>
        record.job.kind === "discover_sources" &&
        (record.status === "queued" || record.status === "running") &&
        normalizeConceptKey(record.job.topicId) === topicKey
    );
  let queuedRecord = null;
  let budgetExhausted = false;

  if (!alreadyQueued) {
    const job = {
      id: `preference-discover-${hashText(`${topicKey}|${now}`)}`,
      kind: "discover_sources",
      topicId: topic,
      conceptIds: [topic],
      priority: 0.8,
      reason:
        contentLanguage === "en"
          ? `You said you want to figure out ${topic}, so the observer will hunt for sources about it.`
          : `你说想搞懂「${topic}」,观察员会去找这方面的来源。`,
      createdAt: now,
      runAfter: now
    };
    const budgetResult = applyDailyAutoJobBudget({
      plan: createSingleJobPlan(job, now),
      budget: getDailyAutoJobBudgetRecord(snapshot, now),
      limit: getDailyAutoJobBudgetLimit(env),
      now
    });
    const records = curationStore.enqueuePlan(budgetResult.plan, now);

    persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], now);

    if (records.length) {
      persistenceStore.saveCurationJobRecords(records, now);
      queuedRecord = records[0];
    } else {
      budgetExhausted = true;
    }
  }

  return {
    understood: true,
    topic,
    memoryChanged: !alreadyInterested,
    events,
    curation: {
      queued: Boolean(queuedRecord),
      alreadyQueued,
      budgetExhausted,
      jobId: queuedRecord?.job.id
    },
    reply: buildPreferenceReply({
      topic,
      alreadyInterested,
      queued: Boolean(queuedRecord),
      alreadyQueued,
      contentLanguage
    }),
    snapshotSummary: summarizeSnapshot(persistenceStore.getSnapshot())
  };
}

// 确认文案由「记忆动作 + 策展动作」两个如实分句拼成,不夸大没发生的事。
function buildPreferenceReply({ topic, alreadyInterested, queued, alreadyQueued, contentLanguage }) {
  if (contentLanguage === "en") {
    const memoryClause = alreadyInterested
      ? `"${topic}" is already one of your focus areas`
      : `Added "${topic}" to your focus areas`;
    const curationClause = queued
      ? "the observer will go find sources about it, and your timeline will lean that way."
      : alreadyQueued
        ? "a source hunt for it is already queued."
        : "today's automatic job budget is used up, so the source hunt resumes tomorrow.";

    return `${memoryClause}; ${curationClause}`;
  }

  const memoryClause = alreadyInterested
    ? `「${topic}」本来就在你的关注方向里`
    : `已把「${topic}」加进你的关注方向`;
  const curationClause = queued
    ? "观察员接下来会去找这方面的来源,时间线会朝这边倾斜。"
    : alreadyQueued
      ? "这方面的来源搜寻已经在排队了,不用再交代一遍。"
      : "今天的自动任务额度已经用完,来源搜寻从明天接着来。";

  return `${memoryClause},${curationClause}`;
}
