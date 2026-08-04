// @ts-check

import {
  createAutomaticConceptAliases,
  createConnectionNoteForImport,
  createSourcePostReleasePlan,
  fetchArticle,
  fetchYouTubeTranscript,
  mergeTranscriptSegments,
  previewSourceImportApplications,
  settleDailyAutoJobBudget,
  transformArticleUrl,
  transformYouTubeUrl
} from "../../../../packages/core/dist/index.js";
import {
  applySourceCandidateOutcome,
  classifyTerminalImportSource,
  isNetworkFailureMessage,
  isTranscriptUnavailableMessage,
  sourceCandidateFailureMessages
} from "./importSettlement.mjs";
import { persistDiscoveredCandidates, updateAgentTurn } from "./research.mjs";
import {
  getDailyAutoJobBudgetLimit,
  getDailyAutoJobBudgetRecord,
  maybePersistConnectionNote,
  persistAutomaticConceptAliases,
  requireString
} from "./shared.mjs";

// Terminal write-back for import_source jobs; every lane funnels through here.
function settleTerminalImportSource(persistenceStore, record, sourceImport, now) {
  const candidateId = record.job.sourceCandidate?.id;
  const snapshot = persistenceStore.getSnapshot();
  const candidateRecord = candidateId
    ? snapshot.sourceCandidates.find((item) => item.candidate.id === candidateId)
    : undefined;
  const outcome = classifyTerminalImportSource({ record, sourceImport, candidateRecord });

  if (candidateRecord) {
    persistenceStore.saveSourceCandidateRecords([applySourceCandidateOutcome(candidateRecord, outcome, now)], now);
  }

  persistenceStore.saveDailyAutoJobBudgetRecords(
    [
      settleDailyAutoJobBudget({
        budget: getDailyAutoJobBudgetRecord(persistenceStore.getSnapshot(), now),
        outcome: outcome.settlement,
        limit: getDailyAutoJobBudgetLimit(process.env),
        now
      })
    ],
    now
  );

  return outcome;
}

export async function importArticle(body, runner, mediaRootDir, contentLanguage, userContext, fetchImpl) {
  requireString(body.url, "url");
  const result = await transformArticleUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause,
    runner,
    mediaRootDir,
    contentLanguage,
    userContext,
    fetch: fetchImpl
  });

  return toSourceImportWorkerResult(result);
}

export async function importYouTube(body, runner, mediaRootDir, contentLanguage, userContext, fetchImpl) {
  requireString(body.url, "url");
  const result = await transformYouTubeUrl(body.url, {
    createdAt: body.createdAt,
    recommendedBecause: body.recommendedBecause,
    runner,
    mediaRootDir,
    contentLanguage,
    userContext,
    fetch: fetchImpl
  });

  return toSourceImportWorkerResult(result);
}

function toSourceImportWorkerResult(result) {
  return {
    importRecord: result.importRecord,
    source: result.source,
    assets: result.assets ?? [result.asset],
    chunks: result.chunks,
    sourceRegistry: result.sourceRegistry,
    posts: result.cards,
    validation: result.validation,
    harnessRun: result.harnessRun
  };
}

export function persistImportAndReleasePlan(persistenceStore, importResult, options = {}) {
  const beforeImport = persistenceStore.getSnapshot();
  const savedAt = options.savedAt ?? new Date().toISOString();
  persistenceStore.saveSourceImportResult(importResult, savedAt);
  let snapshot = persistenceStore.getSnapshot();
  snapshot = persistAutomaticConceptAliases(persistenceStore, snapshot, savedAt);
  snapshot = maybePersistConnectionNote(persistenceStore, {
    beforeImport,
    newPosts: importResult.posts,
    now: savedAt,
    contentLanguage: options.contentLanguage
  });
  const releasePlan = createSourcePostReleasePlan({ posts: importResult.posts, generatedAt: savedAt });
  snapshot = persistenceStore.saveReleasePlan(releasePlan, savedAt);

  return { snapshot, releasePlan };
}

export function ensureMaterializationPlan(curationStore, record, snapshot, contentLanguage) {
  if (record.result?.materializationPlan) return record;
  const effectAt = record.completedAt ?? record.updatedAt;
  const sourceImports = record.result?.sourceImports ?? (record.result?.sourceImport ? [record.result.sourceImport] : []);
  const preview = previewSourceImportApplications(snapshot, sourceImports, effectAt);
  const releasePlans = preview.preparedResults
    .filter((result) => result.posts.length > 0)
    .map((result) => createSourcePostReleasePlan({ posts: result.posts, generatedAt: effectAt }));
  const conceptAliases = createAutomaticConceptAliases(
    preview.nextSnapshot.posts,
    preview.nextSnapshot.conceptAliases,
    effectAt
  );
  const connectionNote = preview.effectivePosts.length
    ? createConnectionNoteForImport({
        existingPosts: snapshot.posts,
        newPosts: preview.effectivePosts,
        interactionSignals: snapshot.interactionSignals.map((item) => item.signal),
        dismissedPosts: snapshot.dismissedPosts,
        conceptAliases: [...preview.nextSnapshot.conceptAliases, ...conceptAliases],
        now: effectAt,
        contentLanguage
      })
    : undefined;
  const materializationPlan = {
    version: 1,
    effectAt,
    sourceImports: preview.preparedResults,
    discoveredSourceCandidates: record.result?.discoveredSourceCandidates ?? [],
    releasePlans,
    conceptBriefs: record.result?.conceptBrief ? [record.result.conceptBrief] : [],
    deepReadArticles: record.result?.deepReadArticle ? [record.result.deepReadArticle] : [],
    conceptAliases,
    connectionNote,
    notifications: [],
    agentTurnPatches: []
  };
  return curationStore.updateTerminalResult(record.id, {
    ...(record.result ?? { kind: record.job.kind }),
    sourceImports: preview.preparedResults,
    materializationPlan
  });
}

export function materializeCurationJobRecords(
  persistenceStore,
  curationStore,
  records,
  { appliedAt, contentLanguage }
) {
  const plannedRecords = records.map((record) =>
    ensureMaterializationPlan(curationStore, curationStore.get(record.id) ?? record, persistenceStore.getSnapshot(), contentLanguage)
  );

  for (const record of plannedRecords) {
    const plan = record.result?.materializationPlan;
    if (!plan) throw new Error(`Terminal curation record is missing a materialization plan: ${record.id}`);
    const effectAt = plan.effectAt ?? record.completedAt ?? appliedAt;
    for (const candidate of plan.discoveredSourceCandidates ?? []) {
      persistDiscoveredCandidates(persistenceStore, [candidate], effectAt);
    }
    if (plan.sourceCandidateRecords?.length) {
      persistenceStore.saveSourceCandidateRecords(plan.sourceCandidateRecords, effectAt);
    }
    for (const sourceImport of plan.sourceImports ?? []) {
      persistenceStore.saveSourceImportResult(sourceImport, effectAt);
    }
    if (record.job.kind === "import_source") {
      settleTerminalImportSource(persistenceStore, record, plan.sourceImports?.[0], effectAt);
    }
    for (const releasePlan of plan.releasePlans ?? []) persistenceStore.saveReleasePlan(releasePlan, effectAt);
    if (plan.conceptBriefs?.length) persistenceStore.saveConceptBriefs(plan.conceptBriefs, effectAt);
    if (plan.deepReadArticles?.length) persistenceStore.saveDeepReadArticles(plan.deepReadArticles, effectAt);
    if (plan.conceptAliases?.length) {
      const snapshot = persistenceStore.getSnapshot();
      persistenceStore.saveConceptAliases([...snapshot.conceptAliases, ...plan.conceptAliases], effectAt);
    }
    if (plan.connectionNote) persistenceStore.savePosts([plan.connectionNote], effectAt);
    if (plan.extraPosts?.length) persistenceStore.savePosts(plan.extraPosts, effectAt);
    if (plan.notifications?.length) persistenceStore.saveNotifications(plan.notifications, effectAt);
    if (plan.agentTurnRecords?.length) persistenceStore.saveAgentTurnRecords(plan.agentTurnRecords, effectAt);
    for (const turnPatch of plan.agentTurnPatches ?? []) {
      updateAgentTurn(persistenceStore, turnPatch.id, turnPatch.patch, effectAt);
    }
  }

  const marked = curationStore.markMaterialized(
    plannedRecords.map((record) => record.id),
    appliedAt
  );
  persistenceStore.replaceCurationJobRecords(curationStore.list(), appliedAt);
  return marked;
}

export function reconcileAndMaterializeCurationQueue(persistenceStore, curationStore, contentLanguage) {
  const startupAt = new Date().toISOString();
  // 清扫上次启动前已结算的终结记录:result 大血包压成摘要(晚一拍压缩,
  // 保证刚结算记录的 run 响应契约与结算前崩溃的重放材料完好)。
  curationStore.compactMaterializedResults(startupAt);
  persistenceStore.replaceCurationJobRecords(curationStore.list(), startupAt);
  const pending = curationStore.list().filter(
    (record) => ["succeeded", "failed", "skipped"].includes(record.status) && !record.materializedAt
  );
  const replayable = [];
  const alreadyApplied = [];
  const snapshot = persistenceStore.getSnapshot();
  for (const record of pending) {
    if (record.result?.materializationPlan || record.result?.sourceImport || record.result?.sourceImports?.length) {
      replayable.push(record);
      continue;
    }
    if (record.job.kind === "research_question" || record.job.kind === "research_idea") {
      const turnId = record.job.researchQuestion?.turnId ?? record.job.researchIdea?.turnId;
      const hasEvidence = snapshot.notifications.some((notification) => notification.turnId === turnId) &&
        snapshot.agentTurns.some((turn) => turn.id === turnId && turn.status !== "researching");
      if (!hasEvidence) {
        console.warn(`[aitimeline] legacy research job ${record.id} has no replayable manifest; compensation retry is required.`);
        continue;
      }
    }
    alreadyApplied.push(record.id);
  }
  if (alreadyApplied.length) curationStore.markMaterialized(alreadyApplied, startupAt);
  if (replayable.length) {
    materializeCurationJobRecords(persistenceStore, curationStore, replayable, {
      appliedAt: startupAt,
      contentLanguage
    });
  } else {
    persistenceStore.replaceCurationJobRecords(curationStore.list(), startupAt);
  }
}

export function normalizeFollowupDedupeTitle(title) {
  return typeof title === "string" ? title.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

export function filterDuplicateFollowupCurationRecords(records, existingPosts, warn = console.warn) {
  const knownTitles = new Set(
    existingPosts.map((post) => normalizeFollowupDedupeTitle(post.title)).filter(Boolean)
  );

  return records.map((record) => {
    if (record.job.kind !== "generate_followup" || !record.result?.sourceImport) {
      return record;
    }

    const sourceImport = filterDuplicateFollowupSourceImport(record.result.sourceImport, knownTitles, warn);

    if (sourceImport === record.result.sourceImport) {
      return record;
    }

    return {
      ...record,
      result: {
        ...record.result,
        sourceImport
      }
    };
  });
}

export function sanitizeFailedCurationRecord(record, logCause = true) {
  if (record.status !== "failed" || typeof record.lastError !== "string" || !record.lastError.trim()) {
    return record;
  }

  if (logCause) {
    console.error(`[aitimeline] background curation job failed (${record.job.id}).`, record.lastError);
  }

  const lastError =
    record.job.kind === "import_source"
      ? isNetworkFailureMessage(record.lastError)
        ? sourceCandidateFailureMessages.unreachable
        : sourceCandidateFailureMessages.importFailed
      : "Background job failed.";

  return { ...record, lastError };
}

function filterDuplicateFollowupSourceImport(sourceImport, knownTitles, warn) {
  const skippedPostIds = new Set();
  const posts = [];

  for (const post of sourceImport.posts) {
    const normalizedTitle = normalizeFollowupDedupeTitle(post.title);

    if (normalizedTitle && knownTitles.has(normalizedTitle)) {
      skippedPostIds.add(post.id);
      warn(
        `[aitimeline] skipped duplicate follow-up post "${post.title}" (${post.id}); normalized title already exists in the snapshot.`
      );
      continue;
    }

    posts.push(post);

    if (normalizedTitle) {
      knownTitles.add(normalizedTitle);
    }
  }

  if (!skippedPostIds.size) {
    return sourceImport;
  }

  const validation = sourceImport.validation.filter(
    (result) => !result.postId || !skippedPostIds.has(result.postId)
  );
  const harnessRun = sourceImport.harnessRun
    ? {
        ...sourceImport.harnessRun,
        outputPostIds: sourceImport.harnessRun.outputPostIds.filter((postId) => !skippedPostIds.has(postId)),
        validation: sourceImport.harnessRun.validation.filter(
          (result) => !result.postId || !skippedPostIds.has(result.postId)
        )
      }
    : undefined;

  return {
    ...sourceImport,
    posts,
    validation,
    harnessRun
  };
}

// Mirrors the article chunking defaults in packages/core/src/transform/articleImport.ts
// so captured text and fetched articles feed the same-shaped chunks downstream.
const capturedTextMaxChunks = 24;
const capturedTextMinParagraphLength = 80;

// Split client-captured body text (e.g. a clipped tweet) into chunk paragraphs.
// Tweets are often shorter than one article paragraph, so when no blank-line
// paragraph clears the minimum length the whole text becomes a single chunk.
export function splitCapturedTextIntoParagraphs(text) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const substantial = paragraphs.filter((paragraph) => paragraph.length >= capturedTextMinParagraphLength);

  return (substantial.length ? substantial : [paragraphs.join(" ").trim()].filter(Boolean)).slice(
    0,
    capturedTextMaxChunks
  );
}

export async function ingestSourceCandidate(candidate, fetchImpl) {
  // A candidate that carries its own captured body (browser clipping) never
  // needs a fetch — login-walled pages like x.com only exist as the capture.
  if (typeof candidate.capturedText === "string" && candidate.capturedText.trim()) {
    const paragraphs = splitCapturedTextIntoParagraphs(candidate.capturedText);

    return {
      assets: [
        {
          id: `${candidate.source.id}-text`,
          sourceId: candidate.source.id,
          kind: "text",
          content: paragraphs.join("\n\n"),
          createdAt: candidate.discoveredAt
        }
      ],
      chunks: paragraphs.map((paragraph, index) => ({
        id: `${candidate.source.id}-chunk-${index + 1}`,
        sourceId: candidate.source.id,
        content: paragraph,
        conceptHints: candidate.conceptIds
      })),
      recommendedBecause: `Saved from the browser: ${candidate.reason}`
    };
  }

  if (candidate.source.type === "article" || candidate.source.type === "blog" || candidate.source.type === "news") {
    const fetched = await fetchArticle(candidate.source.url, { fetch: fetchImpl });

    return {
      assets: [
        {
          ...fetched.asset,
          id: `${candidate.source.id}-text`,
          sourceId: candidate.source.id
        }
      ],
      chunks: fetched.paragraphs.map((paragraph, index) => ({
        id: `${candidate.source.id}-chunk-${index + 1}`,
        sourceId: candidate.source.id,
        content: paragraph,
        conceptHints: candidate.conceptIds
      })),
      recommendedBecause: `Background curation selected this source: ${candidate.reason}`
    };
  }

  if (candidate.source.type === "youtube") {
    const fetched = await fetchYouTubeTranscript(candidate.source.url, { fetch: fetchImpl });

    return {
      assets: [
        {
          ...fetched.asset,
          id: `${candidate.source.id}-transcript`,
          sourceId: candidate.source.id
        }
      ],
      // 攒成段落体量再切块,否则来源质检只看得到三条碎字幕轴。
      chunks: mergeTranscriptSegments(fetched.segments).map((segment, index) => ({
        id: `${candidate.source.id}-chunk-${index + 1}`,
        sourceId: candidate.source.id,
        content: segment.text,
        startTimeSeconds: segment.startTimeSeconds,
        endTimeSeconds: segment.endTimeSeconds,
        conceptHints: candidate.conceptIds
      })),
      recommendedBecause: `Background curation selected this source: ${candidate.reason}`
    };
  }

  throw new Error(`Background source ingestion does not support ${candidate.source.type} yet.`);
}

export async function ingestSourceCandidateForBackground(candidate, ingestSource) {
  try {
    return await ingestSource(candidate);
  } catch (error) {
    console.error("[aitimeline] background source ingestion failed.", error);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      isTranscriptUnavailableMessage(message)
        ? sourceCandidateFailureMessages.transcriptUnavailable
        : isNetworkFailureMessage(message)
          ? sourceCandidateFailureMessages.unreachable
          : sourceCandidateFailureMessages.unprocessable
    );
  }
}
