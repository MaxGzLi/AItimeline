// @ts-check

import {
  applyDailyAutoJobBudget,
  buildSkillTree,
  getDayKey,
  normalizeConceptKey
} from "../../../../packages/core/dist/index.js";
import {
  HttpError,
  createSingleJobPlan,
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  getSnapshotUserMemory,
  hashText,
  normalizeIsoDate,
  requireString,
  summarizeSnapshot,
  uniqueStrings
} from "./shared.mjs";
import { buildConceptBriefInput, createConceptBriefJob } from "./briefsDeepRead.mjs";

export function handleListLearningGoals({ persistenceStore, curationStore, userId, contentLanguage, now }) {
  let snapshot = persistenceStore.getSnapshot();
  const achievementResult = markAchievedLearningGoals({
    persistenceStore,
    snapshot,
    userId,
    contentLanguage,
    now
  });

  snapshot = achievementResult.snapshot;

  const activeTrees = snapshot.learningGoals
    .filter((record) => record.status === "active")
    .flatMap((record) => {
      const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);

      return treeResult.tree ? [treeResult.tree] : [];
    });
  const productionResult = queueGapConceptBriefsForSkillTrees({
    trees: activeTrees,
    persistenceStore,
    curationStore,
    snapshot,
    contentLanguage,
    now,
    limit: 3
  });

  snapshot = productionResult.snapshot;

  return {
    records: snapshot.learningGoals.map((record) => decorateLearningGoalRecord(record, snapshot, userId)),
    achieved: achievementResult.achievedGoals,
    gapProduction: omitSnapshotFromProductionResult(productionResult),
    snapshotSummary: summarizeSnapshot(snapshot)
  };
}

export function handleCreateLearningGoal({ body, persistenceStore, curationStore, userId, contentLanguage }) {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Request body must be an object.");
  }

  requireString(body.concept, "concept");
  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  let snapshot = markAchievedLearningGoals({
    persistenceStore,
    snapshot: persistenceStore.getSnapshot(),
    userId,
    contentLanguage,
    now
  }).snapshot;
  const treeResult = buildLearningGoalTree(snapshot, body.concept, userId);

  if (!treeResult.tree) {
    throw new HttpError(400, "Learning goal concept must exist in the knowledge graph.");
  }

  const goalKey = treeResult.tree.goalId;
  const existingActive = snapshot.learningGoals.find(
    (record) =>
      record.status === "active" &&
      buildLearningGoalTree(snapshot, record.concept, userId).tree?.goalId === goalKey
  );

  if (existingActive) {
    const productionResult = queueGapConceptBriefsForSkillTrees({
      trees: [treeResult.tree],
      persistenceStore,
      curationStore,
      snapshot,
      contentLanguage,
      now,
      limit: 3
    });

    snapshot = productionResult.snapshot;

    return {
      record: decorateLearningGoalRecord(existingActive, snapshot, userId),
      records: snapshot.learningGoals.map((record) => decorateLearningGoalRecord(record, snapshot, userId)),
      gapProduction: omitSnapshotFromProductionResult(productionResult),
      snapshotSummary: summarizeSnapshot(snapshot)
    };
  }

  if (snapshot.learningGoals.filter((record) => record.status === "active").length >= 3) {
    throw new HttpError(400, "At most 3 active learning goals are allowed.");
  }

  const record = {
    id: `learning-goal-${hashText(`${goalKey}|${now}`)}`,
    concept: treeResult.tree.goalConcept,
    createdAt: now,
    status: "active"
  };

  snapshot = persistenceStore.saveLearningGoals([record], now);
  const achievementResult = markAchievedLearningGoals({
    persistenceStore,
    snapshot,
    userId,
    contentLanguage,
    now
  });

  snapshot = achievementResult.snapshot;

  const savedRecord = snapshot.learningGoals.find((item) => item.id === record.id) ?? record;
  const savedTreeResult = buildLearningGoalTree(snapshot, savedRecord.concept, userId);
  const productionResult =
    savedRecord.status === "active" && savedTreeResult.tree
      ? queueGapConceptBriefsForSkillTrees({
          trees: [savedTreeResult.tree],
          persistenceStore,
          curationStore,
          snapshot,
          contentLanguage,
          now,
          limit: 3
        })
      : { snapshot, queued: false, records: [], budget: undefined, discardedJobIds: [], skippedConcepts: [] };

  snapshot = productionResult.snapshot;

  return {
    record: decorateLearningGoalRecord(savedRecord, snapshot, userId),
    records: snapshot.learningGoals.map((item) => decorateLearningGoalRecord(item, snapshot, userId)),
    achieved: achievementResult.achievedGoals,
    gapProduction: omitSnapshotFromProductionResult(productionResult),
    snapshotSummary: summarizeSnapshot(snapshot)
  };
}

export function handleArchiveLearningGoal(goalId, body, persistenceStore) {
  if (!body || typeof body !== "object" || body.status !== "archived") {
    throw new HttpError(400, "Only status \"archived\" is supported.");
  }

  const snapshot = persistenceStore.getSnapshot();
  const record = snapshot.learningGoals.find((item) => item.id === goalId);

  if (!record) {
    throw new HttpError(404, "Learning goal not found.");
  }

  const now = new Date().toISOString();
  const nextRecord = { ...record, status: "archived" };
  const nextSnapshot = persistenceStore.saveLearningGoals([nextRecord], now);

  return {
    record: nextSnapshot.learningGoals.find((item) => item.id === goalId) ?? nextRecord,
    records: nextSnapshot.learningGoals,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

function decorateLearningGoalRecord(record, snapshot, userId) {
  if (record.status !== "active") {
    return record;
  }

  const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);

  return {
    ...record,
    tree: treeResult.tree,
    treeReason: treeResult.reason
  };
}

export function buildLearningGoalTree(snapshot, concept, userId = "local-user") {
  const memory = getSnapshotUserMemory(snapshot, userId);

  return buildSkillTree({
    goalConcept: concept,
    cards: snapshot.posts,
    conceptAliases: snapshot.conceptAliases,
    knownConcepts: memory.knowledge.knownConcepts
  });
}

export function markAchievedLearningGoals({ persistenceStore, snapshot, userId, contentLanguage, now }) {
  const achievedAt = normalizeIsoDate(now);
  const achievedGoals = [];
  const updates = [];

  for (const record of snapshot.learningGoals) {
    if (record.status !== "active") {
      continue;
    }

    const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);
    const goalNode = treeResult.tree?.nodes.find((node) => node.id === treeResult.tree?.goalId);

    if (!goalNode?.mastered) {
      continue;
    }

    const nextRecord = {
      ...record,
      status: "achieved",
      achievedAt
    };

    updates.push(nextRecord);
    achievedGoals.push(nextRecord);
  }

  if (!updates.length) {
    return { snapshot, achievedGoals: [] };
  }

  let nextSnapshot = persistenceStore.saveLearningGoals(updates, achievedAt);

  nextSnapshot = persistenceStore.saveNotifications(
    updates.map((record) => createLearningGoalAchievedNotification(record, snapshot, userId, contentLanguage, achievedAt)),
    achievedAt
  );

  return { snapshot: nextSnapshot, achievedGoals: updates };
}

function createLearningGoalAchievedNotification(record, snapshot, userId, contentLanguage, createdAt) {
  const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);
  const goalNode = treeResult.tree?.nodes.find((node) => node.id === treeResult.tree?.goalId);
  const body =
    contentLanguage === "en"
      ? `#${record.concept} learning goal achieved. The path is now complete.`
      : `#${record.concept} 学习目标已达成,这条路径已完成。`;

  return {
    id: `notification-${hashText(`learning_goal_achieved|${record.id}`)}`,
    kind: "learning_goal_achieved",
    turnId: `learning-goal-${hashText(record.id)}`,
    postIds: goalNode?.postIds ?? [],
    body,
    createdAt
  };
}

function queueGapConceptBriefsForSkillTrees({
  trees,
  persistenceStore,
  curationStore,
  snapshot,
  contentLanguage,
  now,
  limit
}) {
  const nowIso = normalizeIsoDate(now);
  const existingBriefKeys = new Set(snapshot.conceptBriefs.map((brief) => normalizeConceptKey(brief.concept)));
  const existingJobKeys = new Set(
    curationStore
      .list()
      .filter((record) => record.job.kind === "concept_brief" && record.status !== "failed")
      .map((record) => normalizeConceptKey(record.job.topicId))
  );
  const selectedConcepts = [];
  const selectedKeys = new Set();

  for (const tree of trees) {
    for (const node of tree.nodes) {
      const key = normalizeConceptKey(node.concept);

      if (
        !node.gap ||
        node.mastered ||
        !key ||
        selectedKeys.has(key) ||
        existingBriefKeys.has(key) ||
        existingJobKeys.has(key)
      ) {
        continue;
      }

      selectedKeys.add(key);
      selectedConcepts.push(node.concept);

      if (selectedConcepts.length >= limit) {
        break;
      }
    }

    if (selectedConcepts.length >= limit) {
      break;
    }
  }

  if (!selectedConcepts.length) {
    return {
      snapshot,
      queued: false,
      records: [],
      budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
      discardedJobIds: [],
      skippedConcepts: []
    };
  }

  const jobs = selectedConcepts.map((concept) => {
    const input = buildConceptBriefInput(snapshot, concept, contentLanguage, nowIso);

    return createConceptBriefJob(input.concept, input.cards.length, nowIso);
  });
  const rawPlan = createSingleJobPlan(jobs, nowIso);
  const budgetResult = applyDailyAutoJobBudget({
    plan: rawPlan,
    budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
    limit: getDailyAutoJobBudgetLimit(process.env),
    now: nowIso
  });
  const records = curationStore.enqueuePlan(budgetResult.plan, nowIso);
  let nextSnapshot = persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], nowIso);

  if (records.length) {
    nextSnapshot = persistenceStore.saveCurationJobRecords(records, nowIso);
  }

  return {
    snapshot: nextSnapshot,
    queued: records.length > 0,
    records,
    budget: budgetResult.budget,
    discardedJobIds: budgetResult.discardedJobIds,
    skippedConcepts: selectedConcepts.filter(
      (concept) => !records.some((record) => normalizeConceptKey(record.job.topicId) === normalizeConceptKey(concept))
    )
  };
}

export function queueDailyLearningGoalProductionGuarantee({
  persistenceStore,
  curationStore,
  userId,
  contentLanguage,
  now
}) {
  const nowIso = normalizeIsoDate(now);
  const date = getDayKey(nowIso);
  const snapshot = persistenceStore.getSnapshot();
  const jobs = [];
  // Goals with overlapping closures must not pick the same demand twice in one
  // run, or one piece of work would consume two budget slots.
  const selectedBriefKeys = new Set();
  const selectedFollowupKeys = new Set();

  for (const goal of snapshot.learningGoals.filter((record) => record.status === "active")) {
    const treeResult = buildLearningGoalTree(snapshot, goal.concept, userId);
    const tree = treeResult.tree;

    if (!tree || hasGoalProductionForDate({ snapshot, curationStore, tree, date })) {
      continue;
    }

    const closureKeys = createTreeConceptKeySet(tree);

    if (jobs.some((job) => jobOverlapsTree(job, closureKeys))) {
      continue;
    }

    const demand =
      selectGoalGapConceptBriefDemand({ snapshot, curationStore, tree, contentLanguage, now: nowIso, selectedBriefKeys }) ??
      selectGoalFollowupDemand({ snapshot, curationStore, tree, goal, now: nowIso, date, selectedFollowupKeys });

    if (demand) {
      if (demand.kind === "concept_brief") {
        selectedBriefKeys.add(normalizeConceptKey(demand.topicId));
      } else {
        selectedFollowupKeys.add(`${demand.postId}|${demand.nextAction}`);
      }

      jobs.push(demand);
    }
  }

  if (!jobs.length) {
    return {
      snapshot,
      queued: false,
      records: [],
      budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
      discardedJobIds: [],
      skippedConcepts: []
    };
  }

  const rawPlan = createSingleJobPlan(jobs, nowIso);
  const budgetResult = applyDailyAutoJobBudget({
    plan: rawPlan,
    budget: getDailyAutoJobBudgetRecord(snapshot, nowIso),
    limit: getDailyAutoJobBudgetLimit(process.env),
    now: nowIso
  });
  const records = curationStore.enqueuePlan(budgetResult.plan, nowIso);
  const queuedJobIds = new Set(records.map((record) => record.job.id));
  let nextSnapshot = persistenceStore.saveDailyAutoJobBudgetRecords([budgetResult.budget], nowIso);

  if (records.length) {
    nextSnapshot = persistenceStore.saveCurationJobRecords(records, nowIso);
  }

  return {
    snapshot: nextSnapshot,
    queued: records.length > 0,
    records,
    budget: budgetResult.budget,
    discardedJobIds: budgetResult.discardedJobIds,
    skippedConcepts: jobs.filter((job) => !queuedJobIds.has(job.id)).map((job) => job.topicId)
  };
}

function hasGoalProductionForDate({ snapshot, curationStore, tree, date }) {
  const closureKeys = createTreeConceptKeySet(tree);

  if (
    snapshot.conceptBriefs.some(
      (brief) =>
        brief.generatedAt &&
        getDayKey(brief.generatedAt) === date &&
        closureKeys.has(normalizeConceptKey(brief.concept))
    )
  ) {
    return true;
  }

  return curationStore
    .list()
    .some(
      (record) =>
        record.status !== "failed" &&
        [record.createdAt, record.completedAt, record.updatedAt].some(
          (value) => value && getDayKey(value) === date
        ) &&
        isLearningGoalProductionJob(record.job) &&
        jobOverlapsTree(record.job, closureKeys)
    );
}

function selectGoalGapConceptBriefDemand({ snapshot, curationStore, tree, contentLanguage, now, selectedBriefKeys }) {
  const existingBriefKeys = new Set(snapshot.conceptBriefs.map((brief) => normalizeConceptKey(brief.concept)));
  const existingJobKeys = new Set(
    curationStore
      .list()
      .filter((record) => record.job.kind === "concept_brief" && record.status !== "failed")
      .map((record) => normalizeConceptKey(record.job.topicId))
  );

  for (const node of tree.nodes) {
    const key = normalizeConceptKey(node.concept);

    if (
      !node.gap ||
      node.mastered ||
      !key ||
      existingBriefKeys.has(key) ||
      existingJobKeys.has(key) ||
      selectedBriefKeys?.has(key)
    ) {
      continue;
    }

    const input = buildConceptBriefInput(snapshot, node.concept, contentLanguage, now);

    return createConceptBriefJob(input.concept, input.cards.length, now);
  }

  return null;
}

function selectGoalFollowupDemand({ snapshot, curationStore, tree, goal, now, date, selectedFollowupKeys }) {
  const closureKeys = createTreeConceptKeySet(tree);
  const existingFollowupKeys = new Set(
    curationStore
      .list()
      .filter((record) => record.job.kind === "generate_followup" && record.status !== "failed")
      .map((record) => `${record.job.postId ?? ""}|${record.job.nextAction ?? ""}`)
  );

  for (const key of selectedFollowupKeys ?? []) {
    existingFollowupKeys.add(key);
  }
  const candidates = snapshot.posts
    .filter((post) => post.kind !== "connection_note")
    .map((post) => {
      const overlap = post.concepts.filter((concept) => closureKeys.has(normalizeConceptKey(concept)));
      const nextAction = selectFollowupNextAction(post.nextActions ?? []);

      return { post, overlap, nextAction };
    })
    .filter(({ post, overlap, nextAction }) => {
      if (!overlap.length || !nextAction) {
        return false;
      }

      return !existingFollowupKeys.has(`${post.id}|${nextAction}`);
    })
    .sort(
      (left, right) =>
        right.overlap.length - left.overlap.length ||
        right.post.createdAt.localeCompare(left.post.createdAt) ||
        left.post.id.localeCompare(right.post.id)
    );
  const selected = candidates[0];

  if (!selected) {
    return null;
  }

  return {
    id: `daily-goal-followup-${hashText(`${goal.id}|${selected.post.id}|${selected.nextAction}|${date}`)}`,
    kind: "generate_followup",
    postId: selected.post.id,
    topicId: tree.goalConcept,
    conceptIds: Array.from(new Set([...selected.overlap, tree.goalConcept])),
    nextAction: selected.nextAction,
    priority: 0.62,
    reason: `Reserve one daily production slot for the active learning goal ${tree.goalConcept}.`,
    createdAt: now,
    runAfter: now
  };
}

function selectFollowupNextAction(nextActions) {
  for (const action of ["continue_deeper", "expand_broader", "reframe_simpler"]) {
    if (nextActions.includes(action)) {
      return action;
    }
  }

  return null;
}

function isLearningGoalProductionJob(job) {
  return job.kind === "concept_brief" || job.kind === "generate_followup";
}

function jobOverlapsTree(job, closureKeys) {
  return [job.topicId, ...(job.conceptIds ?? [])].some((concept) => closureKeys.has(normalizeConceptKey(concept)));
}

function createTreeConceptKeySet(tree) {
  return new Set(tree.nodes.map((node) => normalizeConceptKey(node.concept)).filter(Boolean));
}

export function omitSnapshotFromProductionResult(result) {
  return {
    queued: result.queued,
    records: result.records.map((record) => ({ id: record.id, status: record.status, job: record.job })),
    budget: result.budget,
    discardedJobIds: result.discardedJobIds,
    skippedConcepts: result.skippedConcepts
  };
}

export function collectActiveLearningGoalConcepts(snapshot, userId = "local-user") {
  const concepts = [];

  for (const record of snapshot.learningGoals) {
    if (record.status !== "active") {
      continue;
    }

    const treeResult = buildLearningGoalTree(snapshot, record.concept, userId);

    for (const node of treeResult.tree?.nodes ?? []) {
      if (!node.mastered) {
        concepts.push(node.concept);
      }
    }
  }

  return uniqueStrings(concepts);
}
