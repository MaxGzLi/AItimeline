// @ts-check

import {
  applyUserMemoryEdits,
  askGrounded,
  buildDiscoveryConfirmationQuestions,
  createAITimelinePersistenceStore,
  createEmptyUserMemory,
  createMemoryRevisionedStorageAdapter,
  createSourcePostReleasePlan,
  evaluateInteraction,
  mergeSourceRegistries,
  normalizeConceptKey,
  previewSourceImportApplications,
  runConversationTurn,
  runSourceDiscovery
} from "../../../../packages/core/dist/index.js";
import {
  HttpError,
  buildInteractionSignalRecordId,
  buildSourceQualityUserContext,
  createSingleJobPlan,
  deriveTopicState,
  hashText,
  isSupportedSourceCandidateType,
  maybePersistConnectionNote,
  persistAutomaticConceptAliases,
  requireString,
  summarizeSnapshot,
  tokenizeText,
  toUserSignals
} from "./shared.mjs";
import {
  collectKnownSourceTitles,
  collectKnownSourceUrls,
  getKnowledgePosts
} from "./importSettlement.mjs";
import { collectActiveLearningGoalConcepts } from "./learningGoals.mjs";

export async function handleAgentAsk(body, userId, persistenceStore, client, searchProvider, contentLanguage) {
  const snapshot = persistenceStore.getSnapshot();
  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const knowledgePosts = getKnowledgePosts(snapshot.posts);
  const registry = mergeSourceRegistries(...snapshot.sourceRegistries.map((record) => record.registry));
  const threadId =
    typeof body.threadId === "string" && body.threadId.trim()
      ? body.threadId.trim()
      : `agent-thread-${hashText(`${userId}|${body.question}|${now}`)}`;
  const turnRecordId = `agent-turn-${hashText(`${userId}|${threadId}|${body.question}|${now}`)}`;
  let turn = await runConversationTurn(
    {
      question: body.question,
      postId: typeof body.postId === "string" ? body.postId : undefined,
      posts: knowledgePosts,
      registry,
      memory,
      userSignals: toUserSignals(snapshot.interactionSignals),
      previousTurns: getPreviousTurns(snapshot, userId, threadId),
      conceptAliases: snapshot.conceptAliases,
      now
    },
    { client, contentLanguage }
  );

  if (turn.answer) {
    turn = {
      ...turn,
      answer: annotateAnswerWithSourceOrigins(turn.answer, registry, turnRecordId, contentLanguage)
    };
  }

  const hasConfirmAction = turn.actions.some((action) => action.kind === "confirm_discovery");
  const discoveredCandidates = hasConfirmAction
    ? []
    : await executeDiscoveryAction(turn, snapshot, memory, searchProvider, persistenceStore, now, contentLanguage);

  if (turn.signal) {
    persistenceStore.saveInteractionSignalRecords(
      [
        {
          id: buildInteractionSignalRecordId(turn.signal),
          signal: turn.signal,
          feedback: evaluateInteraction(turn.signal, deriveTopicState(turn.signal)),
          createdAt: now
        }
      ],
      now
    );
  }

  const memoryEditResult = applyUserMemoryEdits(
    memory ?? createEmptyUserMemory(),
    [
      {
        kind: "add",
        field: "interaction.recentQuestions",
        value: turn.question,
        reason: "User asked the agent a question."
      }
    ],
    now
  );

  persistenceStore.saveUserMemory(userId, memoryEditResult.memory, memoryEditResult.events, now);

  const turnRecord = {
    id: turnRecordId,
    userId,
    question: turn.question,
    intent: turn.intent,
    tier: turn.tier,
    zone: turn.zone,
    status: hasConfirmAction ? "pending_confirmation" : "answered",
    threadId,
    answerCardId: turn.answerCardId,
    createdAt: now
  };
  const finalSnapshot = persistenceStore.saveAgentTurnRecords([turnRecord], now);

  return {
    turn,
    discoveredCandidates,
    turnRecord,
    snapshotSummary: summarizeSnapshot(finalSnapshot)
  };
}

export function handleAgentConfirm(body, userId, persistenceStore, curationStore, contentLanguage) {
  requireString(body.turnId, "turnId");
  const choices = normalizeChoiceMap(body.choices);

  if (Object.keys(choices).length === 0) {
    throw new HttpError(400, "choices must include at least one confirmation answer.");
  }

  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const turnRecord = snapshot.agentTurns.find((record) => record.id === body.turnId && record.userId === userId);

  if (!turnRecord) {
    throw new HttpError(404, "Agent turn not found.");
  }

  if (turnRecord.status !== "pending_confirmation" && turnRecord.status !== "researching") {
    throw new HttpError(409, "Agent turn is not waiting for discovery confirmation.");
  }

  const job = createResearchQuestionJob(turnRecord, choices, contentLanguage, now);
  const records = curationStore.enqueuePlan(createSingleJobPlan(job, now), now);
  persistenceStore.saveCurationJobRecords(records, now);

  const nextTurnRecord = {
    ...turnRecord,
    status: "researching"
  };
  const nextSnapshot = persistenceStore.saveAgentTurnRecords([nextTurnRecord], now);

  return {
    accepted: true,
    records,
    turnRecord: nextTurnRecord,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

export function handleIdeaResearchRequest(body, userId, persistenceStore, curationStore, contentLanguage) {
  requireString(body.turnId, "turnId");
  requireString(body.question, "question");

  const now = typeof body.now === "string" ? body.now : new Date().toISOString();
  const snapshot = persistenceStore.getSnapshot();
  const turnRecord = snapshot.agentTurns.find((record) => record.id === body.turnId && record.userId === userId);

  if (!turnRecord) {
    throw new HttpError(404, "Agent turn not found.");
  }

  if (turnRecord.intent !== "idea_observation") {
    throw new HttpError(409, "Agent turn is not an idea observation.");
  }

  const job = createResearchIdeaJob(
    turnRecord,
    body.question,
    toTrimmedStrings(body.concepts).slice(0, 5),
    contentLanguage,
    now
  );
  const records = curationStore.enqueuePlan(createSingleJobPlan(job, now), now);
  persistenceStore.saveCurationJobRecords(records, now);

  const nextTurnRecord = {
    ...turnRecord,
    status: "researching"
  };
  const nextSnapshot = persistenceStore.saveAgentTurnRecords([nextTurnRecord], now);

  return {
    accepted: true,
    records,
    turnRecord: nextTurnRecord,
    snapshotSummary: summarizeSnapshot(nextSnapshot)
  };
}

export async function runResearchWithStagedPersistence(initialSnapshot, effectAt, execute) {
  const adapter = createMemoryRevisionedStorageAdapter(JSON.stringify(initialSnapshot));
  const stagedStore = createAITimelinePersistenceStore(adapter);
  const result = await execute(stagedStore);
  const sourceImports = result.sourceImports ?? (result.sourceImport ? [result.sourceImport] : []);
  const preview = previewSourceImportApplications(initialSnapshot, sourceImports, effectAt);
  const stagedSnapshot = stagedStore.getSnapshot();
  const changedById = (next, previous, key = "id") => {
    const previousById = new Map(previous.map((record) => [record[key], record]));
    return next.filter((record) => JSON.stringify(previousById.get(record[key])) !== JSON.stringify(record));
  };
  const previewPostsById = new Map(preview.nextSnapshot.posts.map((post) => [post.id, post]));
  const materializationPlan = {
    version: 1,
    effectAt,
    sourceImports: preview.preparedResults,
    discoveredSourceCandidates: [],
    sourceCandidateRecords: changedById(stagedSnapshot.sourceCandidates, initialSnapshot.sourceCandidates),
    releasePlans: stagedSnapshot.releasePlans.filter(
      (plan) => !initialSnapshot.releasePlans.some((previous) => JSON.stringify(previous) === JSON.stringify(plan))
    ),
    conceptBriefs: changedById(stagedSnapshot.conceptBriefs, initialSnapshot.conceptBriefs),
    deepReadArticles: changedById(stagedSnapshot.deepReadArticles, initialSnapshot.deepReadArticles),
    conceptAliases: changedById(stagedSnapshot.conceptAliases, initialSnapshot.conceptAliases, "canonical"),
    extraPosts: stagedSnapshot.posts.filter(
      (post) => JSON.stringify(previewPostsById.get(post.id)) !== JSON.stringify(post)
    ),
    notifications: changedById(stagedSnapshot.notifications, initialSnapshot.notifications),
    agentTurnRecords: changedById(stagedSnapshot.agentTurns, initialSnapshot.agentTurns),
    agentTurnPatches: []
  };
  return {
    ...result,
    sourceImports: preview.preparedResults,
    materializationPlan
  };
}

function createResearchQuestionJob(turnRecord, choices, contentLanguage, now) {
  return {
    id: `research-question-${turnRecord.id}`,
    kind: "research_question",
    postId: turnRecord.answerCardId,
    topicId: `question-${hashText(turnRecord.id)}`,
    conceptIds: [],
    priority: 1,
    reason: "User confirmed a dark-zone question for background research.",
    createdAt: now,
    runAfter: now,
    researchQuestion: {
      turnId: turnRecord.id,
      threadId: turnRecord.threadId,
      userId: turnRecord.userId,
      question: turnRecord.question,
      choices,
      contentLanguage
    }
  };
}

function createResearchIdeaJob(turnRecord, question, concepts, contentLanguage, now) {
  const queryGroups = buildIdeaResearchQueries(question);

  return {
    id: `research-idea-${turnRecord.id}-${hashText(question)}`,
    kind: "research_idea",
    postId: turnRecord.answerCardId,
    topicId: `idea-${hashText(turnRecord.id)}`,
    conceptIds: concepts,
    priority: 1,
    reason: "User asked for supporting and opposing evidence for an idea.",
    createdAt: now,
    runAfter: now,
    researchIdea: {
      turnId: turnRecord.id,
      threadId: turnRecord.threadId,
      userId: turnRecord.userId,
      question,
      ideaPostId: turnRecord.answerCardId,
      supportQueries: queryGroups.support,
      challengeQueries: queryGroups.challenge,
      contentLanguage
    }
  };
}

function normalizeChoiceMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, choice]) => typeof key === "string" && key.trim() && typeof choice === "string" && choice.trim())
      .map(([key, choice]) => [key.trim(), choice.trim()])
  );
}

function buildResearchQueries(question, choices, contentLanguage) {
  const selectedOptions = getSelectedConfirmationOptions(choices, contentLanguage);
  const modifiers = selectedOptions.map((option) => option.queryModifier).filter(Boolean);
  const queries = [
    [question, ...modifiers].join(" "),
    [question, modifiers[0]].filter(Boolean).join(" "),
    [question, modifiers[1]].filter(Boolean).join(" ")
  ];

  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean))).slice(0, 3);
}

function buildIdeaResearchQueries(question) {
  const base = question.trim().slice(0, 180);

  return {
    support: [
      `${base} evidence case`,
      `${base} supporting evidence examples`
    ],
    challenge: [
      `${base} criticism limitations counterexample`,
      `${base} contrary evidence limitations`
    ]
  };
}

function getResearchImportLimit(choices, contentLanguage) {
  const depthOption = getSelectedConfirmationOptions(choices, contentLanguage).find(
    (option) => typeof option.importLimit === "number"
  );

  return Math.max(1, Math.min(4, depthOption?.importLimit ?? 2));
}

function getSelectedConfirmationOptions(choices, contentLanguage) {
  const questions = buildDiscoveryConfirmationQuestions(contentLanguage);

  return questions.flatMap((question) => {
    const selectedId = choices[question.id];
    const selected = question.options.find((option) => option.id === selectedId);

    return selected ? [selected] : [];
  });
}

function deriveResearchConcepts(question) {
  return Array.from(tokenizeText(question)).slice(0, 4);
}

function rankResearchCandidates(candidates, question) {
  const questionTokens = tokenizeText(question);

  return candidates
    .filter((candidate) => isSupportedSourceCandidateType(candidate?.source?.type))
    .map((candidate) => {
      const haystack = tokenizeText(
        [candidate.source.title, candidate.reason, candidate.source.url, candidate.conceptIds.join(" ")].join(" ")
      );
      const overlap = questionTokens.size
        ? Array.from(questionTokens).filter((token) => haystack.has(token)).length / questionTokens.size
        : 0;
      const sourceTypeWeight =
        candidate.source.type === "paper" || candidate.source.type === "article" || candidate.source.type === "blog"
          ? 0.08
          : candidate.source.type === "news"
            ? 0.04
            : 0;
      const score =
        candidate.relevanceScore * 0.42 +
        candidate.qualityScore * 0.28 +
        candidate.noveltyScore * 0.12 +
        overlap * 0.1 +
        sourceTypeWeight;

      return { candidate, score };
    })
    .sort((left, right) => right.score - left.score)
    .map((item) => item.candidate);
}

function withCandidateOrigin(candidate, origin) {
  return {
    ...candidate,
    source: {
      ...candidate.source,
      origin
    }
  };
}

function resolveMergedImportPosts(sourceImport, savedSnapshot) {
  const mergedIds = new Set(
    savedSnapshot.mergedSources
      .filter((record) => record.sourceImportId === sourceImport.importRecord.id)
      .map((record) => record.mergedIntoPostId)
  );

  return savedSnapshot.posts.filter((post) => mergedIds.has(post.id));
}

function researchRecommendedBecause(candidate, contentLanguage) {
  if (contentLanguage === "en") {
    return `You asked the agent to research this question, so this source was imported: ${candidate.reason}`;
  }

  return `你委托智能体研究这个问题,所以自动导入这个来源:${candidate.reason}`;
}

function selectResearchAnswerPost(posts, question) {
  const questionTokens = tokenizeText(question);

  return (
    posts
      .map((post) => {
        const haystack = tokenizeText([post.title, post.summary, post.keyTakeaway, post.concepts.join(" ")].join(" "));
        const overlap = questionTokens.size
          ? Array.from(questionTokens).filter((token) => haystack.has(token)).length / questionTokens.size
          : 0;

        return { post, score: overlap };
      })
      .sort((left, right) => right.score - left.score || right.post.createdAt.localeCompare(left.post.createdAt))[0]
      ?.post ?? posts[0]
  );
}

async function researchIdeaSide({
  side,
  payload,
  concepts,
  queries,
  persistenceStore,
  sourceImportWorker,
  searchProvider,
  contentLanguage,
  now,
  ingestSource
}) {
  const snapshot = persistenceStore.getSnapshot();
  const researchConcepts = concepts?.length ? concepts : deriveResearchConcepts(payload.question);
  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts: researchConcepts,
    queries,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    maxQueries: queries.length,
    maxCandidates: 6,
    contentLanguage,
    now
  });
  const rankedCandidates = rankResearchCandidates(discovery.candidates, payload.question);
  const unsupportedCandidateCount = discovery.candidates.length - rankedCandidates.length;
  const candidatesToImport = rankedCandidates.slice(0, 2);
  const remainingCandidates = rankedCandidates.slice(2);
  const importedResults = [];
  const errors = [];

  if (discovery.errors.length) {
    console.error(`[aitimeline] ${side} idea source discovery failed.`, discovery.errors);
    errors.push("Source discovery failed.");
  }

  if (unsupportedCandidateCount > 0) {
    console.warn(`[aitimeline] ${side} idea research skipped ${unsupportedCandidateCount} unsupported candidate(s).`);
    errors.push("Source candidate type is not supported.");
  }

  if (remainingCandidates.length) {
    persistDiscoveredCandidates(persistenceStore, remainingCandidates, now);
  }

  for (const candidate of candidatesToImport) {
    const candidateWithOrigin = withCandidateOrigin(candidate, {
      turnId: payload.turnId,
      question: payload.question,
      createdAt: now
    });

    try {
      const ingested = await ingestSource(candidateWithOrigin);
      const sourceImport = await sourceImportWorker.run({
        source: candidateWithOrigin.source,
        assets: ingested.assets,
        chunks: ingested.chunks,
        sourceRegistry: ingested.sourceRegistry,
        createdAt: now,
        contentLanguage,
        recommendedBecause: ideaResearchRecommendedBecause(candidateWithOrigin, side, contentLanguage),
        userContext: buildSourceQualityUserContext(persistenceStore.getSnapshot(), payload.userId),
        qualityGateConceptHints: candidateWithOrigin.conceptIds,
        sourceQualityVerdicts: persistenceStore.getSnapshot().sourceQualityVerdicts
      });

      const savedSnapshot = persistenceStore.saveSourceImportResult(sourceImport, now);

      if (sourceImport.importRecord.status === "failed") {
        if (sourceImport.errorMessage) {
          console.error(`[aitimeline] ${side} idea source import worker failed.`, sourceImport.errorMessage);
        }
        errors.push("Source import failed.");
        continue;
      }

      if (sourceImport.posts.length === 0) {
        const mergedPosts = resolveMergedImportPosts(sourceImport, savedSnapshot);

        if (mergedPosts.length) {
          importedResults.push({ ...sourceImport, posts: mergedPosts });
        } else {
          if (sourceImport.errorMessage) {
            console.error(`[aitimeline] ${side} idea source import produced no usable posts.`, sourceImport.errorMessage);
          }
          errors.push("Source import failed.");
        }
        continue;
      }

      persistenceStore.saveReleasePlan(createSourcePostReleasePlan({ posts: sourceImport.posts, generatedAt: now }), now);
      importedResults.push(sourceImport);
    } catch (error) {
      console.error(`[aitimeline] ${side} idea source import failed.`, error);
      errors.push("Source import failed.");
    }
  }

  return {
    side,
    sourceImports: importedResults,
    posts: importedResults.flatMap((result) => result.posts),
    remainingCandidates,
    errors
  };
}

function ideaResearchRecommendedBecause(candidate, side, contentLanguage) {
  if (contentLanguage === "en") {
    return side === "support"
      ? `You asked for evidence that may support this idea, so this source was imported: ${candidate.reason}`
      : `You asked for evidence that may challenge this idea, so this source was imported: ${candidate.reason}`;
  }

  return side === "support"
    ? `你要求寻找可能支持这个想法的证据,所以自动导入这个来源:${candidate.reason}`
    : `你要求寻找可能反驳这个想法的证据,所以自动导入这个来源:${candidate.reason}`;
}

function formatIdeaResearchNotificationBody(supportPosts, challengePosts, contentLanguage) {
  const formatPosts = (posts, emptyText) =>
    posts.length
      ? posts.map((post) => {
          const sourceTitle = post.sources[0]?.title;
          const source = sourceTitle
            ? contentLanguage === "en"
              ? ` Source: ${sourceTitle}.`
              : ` 出处:《${sourceTitle}》。`
            : "";

          return `- ${contentLanguage === "en" ? `"${post.title}"` : `《${post.title}》`}.${source} ${post.keyTakeaway}`;
        })
      : [`- ${emptyText}`];

  if (contentLanguage === "en") {
    return [
      "Supporting evidence",
      ...formatPosts(supportPosts, "No reliable source was found for this side."),
      "",
      "Opposing voices",
      ...formatPosts(challengePosts, "No reliable source was found for this side.")
    ].join("\n");
  }

  return [
    "支持的证据",
    ...formatPosts(supportPosts, "没找到这一侧的靠谱来源。"),
    "",
    "相反的声音",
    ...formatPosts(challengePosts, "没找到这一侧的靠谱来源。")
  ].join("\n");
}

function buildPostCitations(posts, snapshot) {
  return posts.flatMap((post) => {
    const citation = post.citations?.[0];
    const source = citation ? post.sources.find((item) => item.id === citation.sourceId) : post.sources[0];
    const registry = source
      ? snapshot.sourceRegistries.find((record) => record.sourceId === source.id)?.registry
      : undefined;
    const chunk = citation?.chunkId
      ? registry?.chunks.find((item) => item.id === citation.chunkId)
      : registry?.chunks[0];

    if (!citation || !source || !chunk) {
      return [];
    }

    return [
      {
        sourceId: source.id,
        sourceTitle: source.title,
        chunkId: citation.chunkId ?? "",
        quote: chunk.content.slice(0, 240)
      }
    ];
  });
}

export function updateAgentTurn(persistenceStore, turnId, patch, now) {
  const snapshot = persistenceStore.getSnapshot();
  const turnRecord = snapshot.agentTurns.find((record) => record.id === turnId);

  if (!turnRecord) {
    return snapshot;
  }

  return persistenceStore.saveAgentTurnRecords([{ ...turnRecord, ...patch }], now);
}

function getPreviousTurns(snapshot, userId, threadId) {
  return snapshot.agentTurns
    .filter((record) => record.userId === userId && record.threadId === threadId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-5);
}

function annotateAnswerWithSourceOrigins(answer, registry, currentTurnId, contentLanguage) {
  const originNotes = [];
  const seen = new Set();

  for (const citation of answer.citations) {
    const origin =
      citation.origin ??
      registry.sources.find((source) => source.id === citation.sourceId)?.origin;

    if (!origin || origin.turnId === currentTurnId || seen.has(origin.turnId)) {
      continue;
    }

    seen.add(origin.turnId);
    originNotes.push(formatOriginNote(origin, contentLanguage));
  }

  if (!originNotes.length) {
    return answer;
  }

  return {
    ...answer,
    answer: `${answer.answer}\n\n${originNotes.join("\n")}`
  };
}

function formatOriginNote(origin, contentLanguage) {
  const date = new Date(origin.createdAt);

  if (contentLanguage === "en") {
    return `This evidence came from your ${date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    })} question "${origin.question}".`;
  }

  return `这条证据来自你 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日的提问『${origin.question}』。`;
}

export function researchCopy(contentLanguage, key, vars = {}) {
  const templates =
    contentLanguage === "en"
      ? {
          unconfigured: "Search is not configured. Set AITIMELINE_SEARCH_API_KEY in .env and try again.",
          empty: "I searched for sources but did not find any new importable candidates.",
          searchFailed: "Source search failed before any importable candidate was found: {detail}",
          importFailed: "Research finished, but every imported source failed or was blocked by validation: {detail}"
        }
      : {
          unconfigured: "搜索服务未配置,请在 .env 设置 AITIMELINE_SEARCH_API_KEY 后再试。",
          empty: "已经搜索来源,但没有找到可导入的新候选。",
          searchFailed: "来源搜索失败,还没有找到可导入候选:{detail}",
          importFailed: "研究已完成,但导入的来源都没有通过门禁或导入失败:{detail}"
        };
  const template = templates[key] ?? "";

  return Object.entries(vars).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template
  );
}

// Execute the discovery proposal inline when a provider is configured;
// otherwise the proposal is returned for the client to display.
export async function executeDiscoveryAction(turn, snapshot, memory, searchProvider, persistenceStore, now, contentLanguage) {
  const discoverAction = turn.actions.find((action) => action.kind === "discover_sources");

  if (!discoverAction || !searchProvider) {
    return [];
  }

  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts: discoverAction.concepts,
    queries: discoverAction.queries,
    goals: memory?.profile.goals,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    contentLanguage,
    now
  });
  const candidates = discovery.candidates.filter((candidate) =>
    isSupportedSourceCandidateType(candidate?.source?.type)
  );

  if (candidates.length) {
    persistDiscoveredCandidates(persistenceStore, candidates, now);
  }

  return candidates;
}

// On-demand discovery for the reply chip: the user clicks "为这个问题找来源".
// Without a configured search provider this reports configured=false instead
// of erroring, so the UI can point at manual import.
export async function handleDiscoveryRun(body, userId, persistenceStore, searchProvider, contentLanguage) {
  const queries = toTrimmedStrings(body.queries).slice(0, 3);
  const concepts = toTrimmedStrings(body.concepts).slice(0, 5);

  if (!queries.length && !concepts.length) {
    throw new HttpError(400, "discovery needs at least one query or concept.");
  }

  if (!searchProvider) {
    return { configured: false, candidates: [] };
  }

  const snapshot = persistenceStore.getSnapshot();
  const memory = snapshot.userMemories.find((record) => record.userId === userId)?.memory;
  const now = new Date().toISOString();
  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts,
    queries,
    goals: memory?.profile.goals,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    contentLanguage,
    now
  });
  const candidates = discovery.candidates.filter((candidate) =>
    isSupportedSourceCandidateType(candidate?.source?.type)
  );

  if (candidates.length) {
    persistDiscoveredCandidates(persistenceStore, candidates, now);
  }

  return { configured: true, candidates };
}

function toTrimmedStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

export function cloneAnswerCitations(answer) {
  return answer?.citations ? structuredClone(answer.citations) : [];
}

export async function discoverSourcesForJob(job, searchProvider, persistenceStore, contentLanguage) {
  if (!searchProvider) {
    return [];
  }

  const snapshot = persistenceStore.getSnapshot();
  const concepts = getConfirmedDiscoveryConcepts(snapshot, job.conceptIds);

  if (!concepts.length) {
    return [];
  }

  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts,
    topicId: job.topicId,
    nextAction: job.nextAction,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    contentLanguage
  });

  const supportedCandidates = discovery.candidates.filter((candidate) =>
    isSupportedSourceCandidateType(candidate?.source?.type)
  );

  if (supportedCandidates.length !== discovery.candidates.length) {
    console.warn(
      `[aitimeline] background discovery skipped ${discovery.candidates.length - supportedCandidates.length} unsupported candidate(s).`
    );
  }

  return supportedCandidates;
}

function getConfirmedDiscoveryConcepts(snapshot, proposedConcepts) {
  const confirmed = new Set(collectConfirmedDiscoveryConcepts(snapshot).map(normalizeConceptKey));

  return toTrimmedStrings(proposedConcepts).filter((concept) => confirmed.has(normalizeConceptKey(concept)));
}

export function collectConfirmedDiscoveryConcepts(snapshot) {
  const confirmed = new Set();

  for (const record of snapshot.topicStates) {
    if (record.topicId) {
      confirmed.add(record.topicId.trim());
    }
  }

  for (const record of snapshot.interactionSignals) {
    const signal = record.signal;
    const confirmedByInteraction = signal.liked || signal.saved || signal.askedQuestion || signal.reviewed;

    if (!confirmedByInteraction) {
      continue;
    }

    for (const concept of [signal.topicId, ...(signal.conceptIds ?? [])]) {
      if (typeof concept === "string" && concept.trim()) {
        confirmed.add(concept.trim());
      }
    }
  }

  for (const memoryRecord of snapshot.userMemories) {
    for (const concept of [
      ...(memoryRecord.memory.profile.interests ?? []),
      ...(memoryRecord.memory.knowledge.knownConcepts ?? []),
      ...(memoryRecord.memory.knowledge.savedConcepts ?? []),
      ...(memoryRecord.memory.knowledge.weakConcepts ?? [])
    ]) {
      if (typeof concept === "string" && concept.trim()) {
        confirmed.add(concept.trim());
      }
    }
  }

  for (const concept of collectActiveLearningGoalConcepts(snapshot, "local-user")) {
    if (typeof concept === "string" && concept.trim()) {
      confirmed.add(concept.trim());
    }
  }

  return Array.from(confirmed);
}

export function persistDiscoveredCandidates(persistenceStore, candidates, now) {
  const snapshot = persistenceStore.getSnapshot();
  const existingIds = new Set(snapshot.sourceCandidates.map((record) => record.id));
  const newRecords = candidates
    .filter((candidate) => {
      if (isSupportedSourceCandidateType(candidate?.source?.type)) {
        return true;
      }

      console.warn(
        `[aitimeline] skipped unsupported discovered source candidate (${candidate?.id ?? "unknown"}); supported types are article, blog, news, and youtube.`
      );
      return false;
    })
    .filter((candidate) => !existingIds.has(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      candidate,
      status: "pending",
      intakeKind: "agent_discovery",
      createdAt: now,
      updatedAt: now
    }));

  return newRecords.length ? persistenceStore.saveSourceCandidateRecords(newRecords, now) : snapshot;
}

export async function handleResearchQuestionJob(
  job,
  persistenceStore,
  sourceImportWorker,
  searchProvider,
  askModelClient,
  defaultContentLanguage,
  now,
  ingestSource
) {
  const payload = job.researchQuestion;

  if (!payload) {
    return {
      kind: job.kind,
      message: "Skipped: research_question job is missing its payload."
    };
  }

  const contentLanguage = payload.contentLanguage ?? defaultContentLanguage;

  if (!searchProvider) {
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body: researchCopy(contentLanguage, "unconfigured"),
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      message: "Search provider is not configured; notification was created."
    };
  }

  const snapshot = persistenceStore.getSnapshot();
  const queries = buildResearchQueries(payload.question, payload.choices, contentLanguage);
  const concepts = deriveResearchConcepts(payload.question);
  const discovery = await runSourceDiscovery({
    provider: searchProvider,
    concepts,
    queries,
    existingUrls: collectKnownSourceUrls(snapshot),
    existingTitles: collectKnownSourceTitles(snapshot),
    maxQueries: 3,
    maxCandidates: 8,
    contentLanguage,
    now
  });
  const rankedCandidates = rankResearchCandidates(discovery.candidates, payload.question);
  const unsupportedCandidateCount = discovery.candidates.length - rankedCandidates.length;
  const importLimit = getResearchImportLimit(payload.choices, contentLanguage);
  const candidatesToImport = rankedCandidates.slice(0, importLimit);
  const remainingCandidates = rankedCandidates.slice(importLimit);

  if (remainingCandidates.length) {
    persistDiscoveredCandidates(persistenceStore, remainingCandidates, now);
  }

  if (!rankedCandidates.length) {
    if (discovery.errors.length) {
      console.error("[aitimeline] research source discovery failed.", discovery.errors);
    }

    if (unsupportedCandidateCount > 0) {
      console.warn(`[aitimeline] research skipped ${unsupportedCandidateCount} unsupported source candidate(s).`);
    }

    const body = discovery.errors.length
      ? researchCopy(contentLanguage, "searchFailed", { detail: "Source discovery failed." })
      : unsupportedCandidateCount > 0
        ? researchCopy(contentLanguage, "importFailed", { detail: "Source candidate type is not supported." })
        : researchCopy(contentLanguage, "empty");
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body,
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      discoveredSourceCandidates: remainingCandidates,
      message: "Research question search produced no importable candidates."
    };
  }

  const origin = {
    turnId: payload.turnId,
    question: payload.question,
    createdAt: now
  };
  const importedResults = [];
  const importFailures = [];

  for (const candidate of candidatesToImport) {
    const candidateWithOrigin = withCandidateOrigin(candidate, origin);

    try {
      const ingested = await ingestSource(candidateWithOrigin);
      const sourceImport = await sourceImportWorker.run({
        source: candidateWithOrigin.source,
        assets: ingested.assets,
        chunks: ingested.chunks,
        sourceRegistry: ingested.sourceRegistry,
        createdAt: now,
        contentLanguage,
        recommendedBecause: researchRecommendedBecause(candidateWithOrigin, contentLanguage),
        userContext: buildSourceQualityUserContext(persistenceStore.getSnapshot(), payload.userId),
        qualityGateConceptHints: candidateWithOrigin.conceptIds,
        sourceQualityVerdicts: persistenceStore.getSnapshot().sourceQualityVerdicts
      });

      const savedSnapshot = persistenceStore.saveSourceImportResult(sourceImport, now);

      if (sourceImport.importRecord.status === "failed") {
        if (sourceImport.errorMessage) {
          console.error("[aitimeline] research source import worker failed.", sourceImport.errorMessage);
        }
        importFailures.push("Source import failed.");
        continue;
      }

      if (sourceImport.posts.length === 0) {
        const mergedPosts = resolveMergedImportPosts(sourceImport, savedSnapshot);

        if (mergedPosts.length) {
          importedResults.push({ ...sourceImport, posts: mergedPosts });
        } else {
          if (sourceImport.errorMessage) {
            console.error("[aitimeline] research source import produced no usable posts.", sourceImport.errorMessage);
          }
          importFailures.push("Source import failed.");
        }
        continue;
      }

      persistenceStore.saveReleasePlan(createSourcePostReleasePlan({ posts: sourceImport.posts, generatedAt: now }), now);
      importedResults.push(sourceImport);
    } catch (error) {
      console.error("[aitimeline] research source import failed.", error);
      importFailures.push("Source import failed.");
    }
  }

  const importedPosts = importedResults.flatMap((result) => result.posts);

  if (!importedPosts.length) {
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body: researchCopy(contentLanguage, "importFailed", {
        detail: importFailures.slice(0, 3).join("; ") || "No imported cards passed validation."
      }),
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      sourceImports: importedResults,
      discoveredSourceCandidates: remainingCandidates,
      message: "Research question imports all failed or were blocked by validation."
    };
  }

  persistAutomaticConceptAliases(persistenceStore, persistenceStore.getSnapshot(), now);
  maybePersistConnectionNote(persistenceStore, {
    beforeImport: snapshot,
    newPosts: importedPosts,
    now,
    contentLanguage
  });

  const answerPost = selectResearchAnswerPost(importedPosts, payload.question);
  const answerRegistry = mergeSourceRegistries(...importedResults.map((result) => result.sourceRegistry));
  const answer = annotateAnswerWithSourceOrigins(
    await askGrounded({ post: answerPost, registry: answerRegistry, question: payload.question }, { client: askModelClient, contentLanguage }),
    answerRegistry,
    payload.turnId,
    contentLanguage
  );
  const notification = createResearchNotification({
    kind: "agent_answer",
    turnId: payload.turnId,
    question: payload.question,
    body: answer.answer,
    postIds: importedPosts.map((post) => post.id),
    citations: answer.citations.map((citation) => ({
      sourceId: citation.sourceId,
      sourceTitle: citation.sourceTitle,
      chunkId: citation.chunkId,
      quote: citation.quote
    })),
    createdAt: now
  });

  persistenceStore.saveNotifications([notification], now);
  updateAgentTurn(persistenceStore, payload.turnId, { status: "answered", answerCardId: answerPost.id }, now);

  return {
    kind: job.kind,
    sourceImports: importedResults,
    discoveredSourceCandidates: remainingCandidates,
    message: `Research question answered with ${importedResults.length} imported sources.`
  };
}

export async function handleResearchIdeaJob(
  job,
  persistenceStore,
  sourceImportWorker,
  searchProvider,
  defaultContentLanguage,
  now,
  ingestSource
) {
  const payload = job.researchIdea;

  if (!payload) {
    return {
      kind: job.kind,
      message: "Skipped: research_idea job is missing its payload."
    };
  }

  const contentLanguage = payload.contentLanguage ?? defaultContentLanguage;
  const queryGroups = {
    support: payload.supportQueries ?? [],
    challenge: payload.challengeQueries ?? []
  };

  if (!searchProvider) {
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body: researchCopy(contentLanguage, "unconfigured"),
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      ideaResearchQueries: queryGroups,
      message: "Search provider is not configured; notification was created."
    };
  }

  const beforeImport = persistenceStore.getSnapshot();
  const support = await researchIdeaSide({
    side: "support",
    payload,
    concepts: job.conceptIds,
    queries: queryGroups.support,
    persistenceStore,
    sourceImportWorker,
    searchProvider,
    contentLanguage,
    now,
    ingestSource
  });
  const challenge = await researchIdeaSide({
    side: "challenge",
    payload,
    concepts: job.conceptIds,
    queries: queryGroups.challenge,
    persistenceStore,
    sourceImportWorker,
    searchProvider,
    contentLanguage,
    now,
    ingestSource
  });
  const importedPosts = [...support.posts, ...challenge.posts];

  if (!importedPosts.length) {
    const allErrors = [...support.errors, ...challenge.errors];
    const body = allErrors.length
      ? researchCopy(contentLanguage, "importFailed", {
          detail: allErrors.slice(0, 3).join("; ") || "No imported cards passed validation."
        })
      : researchCopy(contentLanguage, "empty");
    const notification = createResearchNotification({
      kind: "research_progress",
      turnId: payload.turnId,
      question: payload.question,
      body,
      postIds: [],
      createdAt: now
    });

    persistenceStore.saveNotifications([notification], now);
    updateAgentTurn(persistenceStore, payload.turnId, { status: "closed" }, now);

    return {
      kind: job.kind,
      ideaResearchQueries: queryGroups,
      sourceImports: [...support.sourceImports, ...challenge.sourceImports],
      discoveredSourceCandidates: [...support.remainingCandidates, ...challenge.remainingCandidates],
      message: "Idea research produced no imported evidence."
    };
  }

  persistAutomaticConceptAliases(persistenceStore, persistenceStore.getSnapshot(), now);
  maybePersistConnectionNote(persistenceStore, {
    beforeImport,
    newPosts: importedPosts,
    now,
    contentLanguage
  });

  const notification = createResearchNotification({
    kind: "agent_answer",
    turnId: payload.turnId,
    question: payload.question,
    body: formatIdeaResearchNotificationBody(support.posts, challenge.posts, contentLanguage),
    postIds: importedPosts.map((post) => post.id),
    citations: buildPostCitations(importedPosts, persistenceStore.getSnapshot()),
    createdAt: now
  });

  persistenceStore.saveNotifications([notification], now);
  updateAgentTurn(persistenceStore, payload.turnId, { status: "answered", answerCardId: importedPosts[0]?.id }, now);

  return {
    kind: job.kind,
    ideaResearchQueries: queryGroups,
    sourceImports: [...support.sourceImports, ...challenge.sourceImports],
    discoveredSourceCandidates: [...support.remainingCandidates, ...challenge.remainingCandidates],
    message: `Idea research imported ${importedPosts.length} sources across both sides.`
  };
}

/**
 * citations is optional: several idea-research call sites omit it on purpose
 * (the notification then carries `citations: undefined`, matching the
 * pre-split runtime behavior).
 * @param {{ kind: string, turnId: any, question: any, body: any, postIds: any, citations?: any, createdAt: any }} input
 */
function createResearchNotification({ kind, turnId, question, body, postIds, citations, createdAt }) {
  return {
    id: `notification-${hashText(`${kind}|${turnId}|${createdAt}|${body}`)}`,
    kind,
    turnId,
    question,
    postIds,
    body,
    citations,
    createdAt
  };
}
