import type { ContentLanguage } from "../harness/contentLanguage.js";
import type { ModelClient } from "../harness/modelRunner.js";
import { createConceptAliasResolver, normalizeConceptKey, normalizeConceptLabel } from "../graph/conceptAliases.js";
import { buildSkillTree, type SkillTreeView } from "../graph/skillTree.js";
import type {
  ConceptAliasRecord,
  DeepReadArticleRecord,
  DeepReadArticleRunnerKind,
  DeepReadChapter,
  DeepReadChapterContract,
  DeepReadChapterSource,
  DeepReadCitation,
  DeepReadConflictPair,
  DeepReadDeletedParagraphLog,
  DeepReadDiscardedMaterial,
  DeepReadKeyFact,
  DeepReadMaterialPointer,
  DeepReadParagraph,
  DeepReadParagraphGateReport,
  KnowledgeCard,
  KnowledgeChunk,
  Source,
  SourceQualityVerdict,
  SourceRegistry
} from "../types.js";
import {
  DEEP_READ_ANTI_SLOP_RULES,
  DEEP_READ_BANNED_PHRASES,
  DEEP_READ_GENERIC_OPENERS,
  DEEP_READ_MODEL_PARAGRAPH_COUNT_RANGE,
  DEEP_READ_MODEL_PARAGRAPH_LENGTH_RANGE,
  DEEP_READ_MODEL_SENTENCE_COUNT_RANGE,
  DEEP_READ_STRUCTURE_RULES,
  DEEP_READ_WRITING_REQUIREMENTS,
  deepReadPipelineVersion
} from "./constants.js";

export {
  DEEP_READ_ANTI_SLOP_RULES,
  DEEP_READ_BANNED_PHRASES,
  DEEP_READ_GENERIC_OPENERS,
  DEEP_READ_MODEL_PARAGRAPH_COUNT_RANGE,
  DEEP_READ_MODEL_PARAGRAPH_LENGTH_RANGE,
  DEEP_READ_MODEL_SENTENCE_COUNT_RANGE,
  DEEP_READ_STRUCTURE_RULES,
  DEEP_READ_WRITING_REQUIREMENTS,
  deepReadPipelineVersion
} from "./constants.js";

export interface DeepReadSourceRegistryRecordLike {
  id: string;
  sourceId: string;
  registry: SourceRegistry;
  createdAt: string;
}

export interface CreateDeepReadArticleInput {
  topic: string;
  goalId?: string;
  userId?: string;
  cards: readonly KnowledgeCard[];
  sourceRegistries: readonly DeepReadSourceRegistryRecordLike[];
  conceptAliases?: readonly ConceptAliasRecord[];
  sourceQualityVerdicts?: readonly SourceQualityVerdict[];
  knownConcepts?: readonly string[];
  libraryVersion?: string;
  contentLanguage?: ContentLanguage;
  maxTokens?: number;
}

export interface CreateDeepReadArticleOptions {
  deepReadClient?: ModelClient;
  defaultClient?: ModelClient;
  now?: string | Date | (() => string | Date);
}

export interface DeepReadSelectedMaterial {
  pointer: DeepReadMaterialPointer;
  cardTitle: string;
  cardSummary: string;
  cardConcepts: string[];
  sourceTitle: string;
  sourceUrl: string;
  sourceType: Source["type"];
  chunkText: string;
  admissionScore: number;
  admissionReasons: string[];
  keyFacts: DeepReadKeyFact[];
}

export interface DeepReadSelectionResult {
  topic: string;
  topicKey: string;
  tree: SkillTreeView | null;
  closureConcepts: string[];
  masteredConcepts: string[];
  gapConcepts: string[];
  materials: DeepReadSelectedMaterial[];
  discardedMaterials: DeepReadDiscardedMaterial[];
  conflicts: DeepReadConflictPair[];
}

export interface DeepReadOutlineResult {
  contracts: DeepReadChapterContract[];
  reviewNotes: string[];
  truncated: boolean;
  budgetNotes: string[];
}

export interface DeepReadChapterDraft {
  contract: DeepReadChapterContract;
  paragraphs: DeepReadParagraph[];
  takeaway?: string;
}

export interface DeepReadChapterGateResult {
  chapter: DeepReadChapter;
  deletedParagraphLog: DeepReadDeletedParagraphLog[];
}

export interface DeepReadMaterialContext {
  materials: DeepReadSelectedMaterial[];
  materialByPointerKey: Map<string, DeepReadSelectedMaterial>;
  chunkByPointerKey: Map<string, KnowledgeChunk>;
  literalAllowlistValues: string[];
}

export interface DeepReadWrittenChapterSummary {
  title: string;
  takeaway: string;
}

const defaultMaxTokens = 100000;

export async function createDeepReadArticle(
  input: CreateDeepReadArticleInput,
  options: CreateDeepReadArticleOptions = {}
): Promise<DeepReadArticleRecord> {
  const createdAt = normalizeNow(options.now);
  const selection = selectDeepReadMaterials(input);
  const maxTokens = normalizeDeepReadMaxTokens(input.maxTokens);
  const modelClients = [options.deepReadClient, options.defaultClient].filter(Boolean) as ModelClient[];
  const runnerKind: DeepReadArticleRunnerKind = modelClients.length ? "model" : "deterministic_fallback";

  for (const client of modelClients) {
    try {
      return await createDeepReadArticleWithClient(input, selection, client, {
        createdAt,
        maxTokens,
        runnerKind: "model"
      });
    } catch {
      // Fall through to the next configured model, then to deterministic fallback.
    }
  }

  return createDeepReadArticleWithClient(input, selection, undefined, {
    createdAt,
    maxTokens,
    runnerKind: runnerKind === "model" ? "deterministic_fallback" : runnerKind
  });
}

async function createDeepReadArticleWithClient(
  input: CreateDeepReadArticleInput,
  selection: DeepReadSelectionResult,
  client: ModelClient | undefined,
  options: {
    createdAt: string;
    maxTokens: number;
    runnerKind: DeepReadArticleRunnerKind;
  }
): Promise<DeepReadArticleRecord> {
  const outline = await createDeepReadOutlineContracts(selection, {
    client,
    contentLanguage: input.contentLanguage,
    maxTokens: options.maxTokens
  });
  const context = createDeepReadMaterialContext(selection.materials, {
    topic: selection.topic,
    conceptAliases: input.conceptAliases
  });
  const chapters: DeepReadChapter[] = [];
  const deletedParagraphLog: DeepReadDeletedParagraphLog[] = [];
  const previousChapters: DeepReadWrittenChapterSummary[] = [];

  for (const contract of outline.contracts) {
    if (!contract.materialPointers.length) {
      chapters.push(createDeepReadGapChapter(contract, context, input.contentLanguage, options.createdAt));
      continue;
    }

    const draft = await generateDeepReadChapterDraft(contract, context, {
      client,
      contentLanguage: input.contentLanguage,
      previousChapters
    });
    const gated = await gateDeepReadChapter(draft, context, {
      client,
      contentLanguage: input.contentLanguage,
      now: options.createdAt,
      previousChapters
    });

    chapters.push(gated.chapter);
    deletedParagraphLog.push(...gated.deletedParagraphLog);

    if (gated.chapter.status === "complete") {
      previousChapters.push(summarizeWrittenChapter(gated.chapter, draft.takeaway));
    }
  }

  return assembleDeepReadArticle({
    input,
    selection,
    chapters,
    deletedParagraphLog,
    outline,
    runnerKind: options.runnerKind,
    createdAt: options.createdAt,
    maxTokens: options.maxTokens,
    client
  });
}

export function selectDeepReadMaterials(input: CreateDeepReadArticleInput): DeepReadSelectionResult {
  const topic = normalizeConceptLabel(input.topic);
  const resolver = createConceptAliasResolver(input.conceptAliases ?? []);
  const resolvedTopic = normalizeConceptLabel(resolver.resolveConcept(topic));
  const topicKey = normalizeConceptKey(resolvedTopic);
  const tree = buildSkillTree({
    goalConcept: resolvedTopic,
    cards: input.cards,
    conceptAliases: input.conceptAliases,
    knownConcepts: input.knownConcepts
  }).tree;
  const closureConcepts = tree?.nodes.map((node) => node.concept) ?? [resolvedTopic];
  const closureKeys = new Set(closureConcepts.map((concept) => normalizeConceptKey(resolver.resolveConcept(concept))));
  const masteredConcepts = tree?.nodes.filter((node) => node.mastered).map((node) => node.concept) ?? [];
  const gapConcepts = tree?.gapConcepts ?? [];
  const chunkIndex = indexRegistryChunks(input.sourceRegistries);
  const sourceIndex = indexRegistrySources(input.sourceRegistries);
  const verdictIndex = indexSourceQualityVerdicts(input.sourceQualityVerdicts ?? []);
  const materials: DeepReadSelectedMaterial[] = [];
  const discardedMaterials: DeepReadDiscardedMaterial[] = [];
  const seenPointers = new Set<string>();

  for (const card of input.cards) {
    if (card.kind === "connection_note") {
      discardedMaterials.push({
        cardId: card.id,
        title: card.title,
        score: 0,
        reasons: ["connection_note cards are not source material for deep-read articles"]
      });
      continue;
    }

    const overlap = collectCardConcepts(card, resolver).filter((concept) =>
      closureKeys.has(normalizeConceptKey(concept))
    );

    if (!overlap.length && !card.concepts.some((concept) => normalizeConceptKey(concept) === topicKey)) {
      continue;
    }

    const candidatePointers = resolveCardCitationPointers(card, chunkIndex);

    if (!candidatePointers.length) {
      discardedMaterials.push({
        cardId: card.id,
        title: card.title,
        score: 0.2,
        reasons: ["no registered source chunk could be resolved for this card"]
      });
      continue;
    }

    for (const pointer of candidatePointers.slice(0, 3)) {
      const pointerKey = toPointerKey(pointer);

      if (seenPointers.has(pointerKey)) {
        continue;
      }

      seenPointers.add(pointerKey);
      const chunk = chunkIndex.get(toChunkKey(pointer.sourceId, pointer.chunkId));
      const source = sourceIndex.get(pointer.sourceId);

      if (!chunk || !source) {
        discardedMaterials.push({
          cardId: card.id,
          sourceId: pointer.sourceId,
          chunkId: pointer.chunkId,
          title: card.title,
          score: 0,
          reasons: ["citation points to a missing source or chunk"]
        });
        continue;
      }

      const verdict = verdictIndex.get(pointer.sourceId) ?? verdictIndex.get(normalizeUrlKey(source.url));
      const scored = scoreMaterialAdmission({ card, source, chunk, overlapCount: overlap.length, closureSize: closureKeys.size, verdict });

      if (scored.score < 0.55) {
        discardedMaterials.push({
          cardId: card.id,
          sourceId: pointer.sourceId,
          chunkId: pointer.chunkId,
          title: card.title,
          score: scored.score,
          reasons: scored.reasons
        });
        continue;
      }

      const keyFacts = extractDeepReadKeyFacts(chunk.content, pointer);

      materials.push({
        pointer,
        cardTitle: card.title,
        cardSummary: card.summary || card.keyTakeaway || card.title,
        cardConcepts: card.concepts,
        sourceTitle: source.title,
        sourceUrl: source.url,
        sourceType: source.type,
        chunkText: chunk.content,
        admissionScore: scored.score,
        admissionReasons: scored.reasons,
        keyFacts
      });
    }
  }

  const sortedMaterials = materials
    .sort(
      (left, right) =>
        right.admissionScore - left.admissionScore ||
        left.cardTitle.localeCompare(right.cardTitle) ||
        left.pointer.chunkId.localeCompare(right.pointer.chunkId)
    )
    .slice(0, 24);

  return {
    topic: resolvedTopic,
    topicKey,
    tree,
    closureConcepts,
    masteredConcepts,
    gapConcepts,
    materials: sortedMaterials,
    discardedMaterials: discardedMaterials.sort(compareDiscardedMaterials),
    conflicts: detectDeepReadConflicts(sortedMaterials)
  };
}

export async function createDeepReadOutlineContracts(
  selection: DeepReadSelectionResult,
  options: {
    client?: ModelClient;
    contentLanguage?: ContentLanguage;
    maxTokens?: number;
  } = {}
): Promise<DeepReadOutlineResult> {
  const maxTokens = normalizeDeepReadMaxTokens(options.maxTokens);
  const maxChapters = Math.max(1, Math.min(12, Math.floor(maxTokens / 8000)));
  const modelContracts = options.client
    ? await createModelOutlineContracts(selection, options.client, options.contentLanguage)
    : [];
  const allContracts = modelContracts.length
    ? modelContracts
    : createDeterministicOutlineContracts(selection, options.contentLanguage);
  const reviewNotes = reviewDeepReadOutlineContracts(allContracts, selection, options.contentLanguage);
  const truncated = allContracts.length > maxChapters;
  const contracts = allContracts.slice(0, maxChapters);

  return {
    contracts,
    reviewNotes,
    truncated,
    budgetNotes: truncated
      ? [
          formatLine(
            options.contentLanguage,
            `预算限制保留前 ${contracts.length} 章,其余章节未生成。`,
            `Budget limited this article to ${contracts.length} chapters.`
          )
        ]
      : []
  };
}

export function createDeterministicOutlineContracts(
  selection: DeepReadSelectionResult,
  contentLanguage: ContentLanguage = "zh"
): DeepReadChapterContract[] {
  const materialsByConceptKey = new Map<string, DeepReadSelectedMaterial[]>();
  const resolver = createConceptAliasResolver([]);
  const orderedConcepts = selection.tree
    ? selection.tree.nodes
        .slice()
        .sort((left, right) => right.layer - left.layer || left.concept.localeCompare(right.concept))
        .map((node) => node.concept)
    : selection.closureConcepts;

  for (const material of selection.materials) {
    const keys = material.cardConcepts.map((concept) => normalizeConceptKey(resolver.resolveConcept(concept)));
    const matchedKey =
      orderedConcepts.map(normalizeConceptKey).find((key) => keys.includes(key)) ?? normalizeConceptKey(selection.topic);
    const list = materialsByConceptKey.get(matchedKey) ?? [];

    list.push(material);
    materialsByConceptKey.set(matchedKey, list);
  }

  const contracts: DeepReadChapterContract[] = [];
  const usedPointerKeys = new Set<string>();

  for (const concept of orderedConcepts) {
    const conceptKey = normalizeConceptKey(concept);
    const conceptMaterials = (materialsByConceptKey.get(conceptKey) ?? [])
      .filter((material) => !usedPointerKeys.has(toPointerKey(material.pointer)))
      .slice(0, 4);
    const treeNode = selection.tree?.nodes.find((node) => node.id === conceptKey);

    if (!conceptMaterials.length && !treeNode?.gap && conceptKey !== selection.topicKey) {
      continue;
    }

    for (const material of conceptMaterials) {
      usedPointerKeys.add(toPointerKey(material.pointer));
    }

    contracts.push(
      buildChapterContract({
        id: `chapter-${contracts.length + 1}-${sanitizeId(concept)}`,
        title: concept,
        question: formatLine(
          contentLanguage,
          `理解「${concept}」时,这些来源真正能支撑什么?`,
          `What do the available sources actually support about ${concept}?`
        ),
        materials: conceptMaterials,
        selection,
        gapStatement:
          conceptMaterials.length === 0
            ? formatLine(
                contentLanguage,
                `当前素材不足以支撑「${concept}」的完整章节。`,
                `The current library does not have enough source material to support a full chapter on ${concept}.`
              )
            : conceptMaterialsIndependentSourceCount(conceptMaterials) < 2
              ? formatLine(
                  contentLanguage,
                  `本章只有一个独立来源,结论只能当作单源读法。`,
                  `This chapter has only one independent source, so its conclusion is single-source.`
                )
              : undefined
      })
    );
  }

  const remainingMaterials = selection.materials.filter((material) => !usedPointerKeys.has(toPointerKey(material.pointer)));

  if (remainingMaterials.length) {
    contracts.push(
      buildChapterContract({
        id: `chapter-${contracts.length + 1}-evidence`,
        title: formatLine(contentLanguage, "剩余证据", "Remaining evidence"),
        question: formatLine(
          contentLanguage,
          `还有哪些材料能补充「${selection.topic}」的主线?`,
          `Which remaining materials add to the main line for ${selection.topic}?`
        ),
        materials: remainingMaterials.slice(0, 4),
        selection
      })
    );
  }

  if (!contracts.length) {
    contracts.push(
      buildChapterContract({
        id: "chapter-1-gap",
        title: selection.topic,
        question: formatLine(
          contentLanguage,
          `目前能否写出关于「${selection.topic}」的有据长文?`,
          `Can the current library support a sourced long read on ${selection.topic}?`
        ),
        materials: [],
        selection,
        gapStatement: formatLine(
          contentLanguage,
          "没有通过准入的来源片段,只能生成缺口章。",
          "No source chunks passed admission, so only a gap chapter can be generated."
        )
      })
    );
  }

  return contracts;
}

export async function generateDeepReadChapterDraft(
  contract: DeepReadChapterContract,
  context: DeepReadMaterialContext,
  options: {
    client?: ModelClient;
    contentLanguage?: ContentLanguage;
    previousChapters?: readonly DeepReadWrittenChapterSummary[];
  } = {}
): Promise<DeepReadChapterDraft> {
  if (options.client && contract.materialPointers.length) {
    const modelDraft = await generateModelChapterDraft(contract, context, options.client, options.contentLanguage, {
      previousChapters: options.previousChapters
    });

    if (modelDraft?.paragraphs.length) {
      return modelDraft;
    }
  }

  return {
    contract,
    paragraphs: generateDeterministicParagraphs(contract, context, options.contentLanguage)
  };
}

export async function gateDeepReadChapter(
  draft: DeepReadChapterDraft,
  context: DeepReadMaterialContext,
  options: {
    client?: ModelClient;
    contentLanguage?: ContentLanguage;
    now?: string | Date;
    previousChapters?: readonly DeepReadWrittenChapterSummary[];
  } = {}
): Promise<DeepReadChapterGateResult> {
  const checkedAt = normalizeDate(options.now ?? new Date()).toISOString();
  const initial = await gateDeepReadChapterOnce(draft, context, {
    client: options.client,
    contentLanguage: options.contentLanguage,
    checkedAt
  });

  if (!options.client || initial.deletedParagraphLog.length <= draft.paragraphs.length / 3) {
    return initial;
  }

  const regenerated = await generateModelChapterDraft(draft.contract, context, options.client, options.contentLanguage, {
    previousChapters: options.previousChapters,
    gateFeedback: collectChapterGateFeedback(initial.deletedParagraphLog)
  });

  if (!regenerated?.paragraphs.length) {
    return initial;
  }

  const retry = await gateDeepReadChapterOnce(regenerated, context, {
    client: options.client,
    contentLanguage: options.contentLanguage,
    checkedAt
  });

  return {
    chapter: retry.chapter,
    deletedParagraphLog: [...initial.deletedParagraphLog, ...retry.deletedParagraphLog]
  };
}

async function gateDeepReadChapterOnce(
  draft: DeepReadChapterDraft,
  context: DeepReadMaterialContext,
  options: {
    client?: ModelClient;
    contentLanguage?: ContentLanguage;
    checkedAt: string;
  }
): Promise<DeepReadChapterGateResult> {
  const checkedAt = options.checkedAt;
  const accepted: DeepReadParagraph[] = [];
  const deletedParagraphLog: DeepReadDeletedParagraphLog[] = [];

  for (const paragraph of draft.paragraphs) {
    let report = await gateDeepReadParagraph(paragraph, draft.contract, context, {
      client: options.client,
      checkedAt
    });
    let candidate = { ...paragraph, gate: report };

    if (!report.passed && options.client) {
      const rewritten = await rewriteDeepReadParagraph(candidate, draft.contract, context, options.client, options.contentLanguage);

      if (rewritten) {
        report = await gateDeepReadParagraph(rewritten, draft.contract, context, {
          client: options.client,
          checkedAt
        });
        candidate = { ...rewritten, gate: report };
      }
    }

    if (report.passed) {
      accepted.push(candidate);
      continue;
    }

    if (canDowngradeFactParagraph(candidate, report, context)) {
      const downgraded: DeepReadParagraph = {
        ...candidate,
        kind: "synthesis"
      };
      const downgradedReport = await gateDeepReadParagraph(downgraded, draft.contract, context, {
        client: options.client,
        checkedAt
      });

      if (downgradedReport.passed) {
        accepted.push({ ...downgraded, gate: downgradedReport });
        continue;
      }

      report = downgradedReport;
    }

    deletedParagraphLog.push({
      chapterId: draft.contract.id,
      paragraphId: paragraph.id,
      kind: paragraph.kind,
      text: paragraph.text,
      reasons: report.issues,
      deletedAt: checkedAt
    });
  }

  const degraded = draft.paragraphs.length > 0 && deletedParagraphLog.length > draft.paragraphs.length / 2;
  const finalParagraphs = degraded
    ? [
        {
          id: `${draft.contract.id}-gap`,
          kind: "synthesis" as const,
          text:
            draft.contract.gapStatement ??
            formatLine(
              options.contentLanguage,
              "本文来源不足以支撑本章,已降级为缺口章。",
              "The available sources are not enough to support this chapter, so it has been downgraded to a gap chapter."
            ),
          citations: [],
          gate: {
            passed: true,
            issues: [],
            checkedAt
          }
        }
      ]
    : accepted;

  return {
    chapter: {
      id: draft.contract.id,
      title: draft.contract.title,
      question: draft.contract.question,
      status: degraded || draft.contract.materialPointers.length === 0 ? "gap" : "complete",
      singleSource: draft.contract.singleSource,
      gapStatement: degraded
        ? draft.contract.gapStatement ??
          formatLine(
            options.contentLanguage,
            "门禁删除超过半数段落,本章只保留缺口声明。",
            "More than half of the paragraphs were removed by gates; this chapter keeps only a gap statement."
          )
        : draft.contract.gapStatement,
      contract: draft.contract,
      paragraphs: finalParagraphs,
      sources: buildChapterSources(draft.contract, context)
    },
    deletedParagraphLog
  };
}

export async function gateDeepReadParagraph(
  paragraph: DeepReadParagraph,
  contract: DeepReadChapterContract,
  context: DeepReadMaterialContext,
  options: {
    client?: ModelClient;
    checkedAt?: string;
  } = {}
): Promise<DeepReadParagraphGateReport> {
  const issues = [
    ...validateDeepReadCitationExistence(paragraph, context),
    ...validateDeepReadKeyFactsLiteral(paragraph, contract, context),
    ...validateMechanicalAntiSlop(paragraph)
  ];

  if (paragraph.kind === "fact" && paragraph.citations.length === 0) {
    issues.push("fact paragraphs must include at least one citation");
  }

  if (options.client && issues.length === 0) {
    const modelIssues =
      paragraph.kind === "fact"
        ? await validateFactParagraphEntailment(paragraph, context, options.client)
        : await validateSynthesisParagraphOverstatement(paragraph, contract, context, options.client);

    issues.push(...modelIssues);
  }

  return {
    passed: issues.length === 0,
    issues,
    checkedAt: options.checkedAt ?? new Date().toISOString()
  };
}

export function validateDeepReadCitationExistence(
  paragraph: Pick<DeepReadParagraph, "citations">,
  context: DeepReadMaterialContext
): string[] {
  const issues: string[] = [];

  paragraph.citations.forEach((citation, index) => {
    const key = toPointerKey({ cardId: citation.cardId ?? "", sourceId: citation.sourceId, chunkId: citation.chunkId });
    const chunkKey = toChunkKey(citation.sourceId, citation.chunkId);
    const exists =
      (citation.cardId ? context.materialByPointerKey.has(key) : false) ||
      Array.from(context.chunkByPointerKey.values()).some(
        (chunk) => chunk.sourceId === citation.sourceId && chunk.id === citation.chunkId
      );

    if (!exists || !context.chunkByPointerKey.has(chunkKey)) {
      issues.push(`citation ${index + 1} points to an unknown sourceId/chunkId`);
    }
  });

  return issues;
}

export function validateDeepReadKeyFactsLiteral(
  paragraph: Pick<DeepReadParagraph, "kind" | "text" | "citations">,
  contract: Pick<DeepReadChapterContract, "keyFacts">,
  context: DeepReadMaterialContext
): string[] {
  const paragraphFacts = extractLooseFacts(paragraph.text);
  const evidenceText = paragraph.citations
    .map((citation) => context.chunkByPointerKey.get(toChunkKey(citation.sourceId, citation.chunkId))?.content ?? "")
    .join("\n");

  if (paragraph.kind !== "fact") {
    // Numbers, dates and versions stay literally grounded in every paragraph:
    // otherwise a digit can dodge the gate by riding in synthesis prose.
    const strictFacts = paragraphFacts.filter((fact) => isStrictLiteralFactKind(fact.kind));

    if (!strictFacts.length) {
      return [];
    }

    if (!evidenceText.trim()) {
      return [
        `synthesis paragraph contains strict numeric/date/version tokens but cites no resolvable evidence: ${strictFacts
          .map((fact) => fact.value)
          .join(", ")}`
      ];
    }

    const missingStrict = strictFacts.filter((fact) => !containsNormalizedToken(evidenceText, fact.normalizedValue));

    return missingStrict.length
      ? [
          `synthesis paragraph contains strict numeric/date/version tokens absent from cited chunks: ${missingStrict
            .map((fact) => fact.value)
            .join(", ")}`
        ]
      : [];
  }

  if (!evidenceText.trim()) {
    return ["fact paragraph has no resolvable cited evidence"];
  }

  const strictMissing = paragraphFacts.filter(
    (fact) => isStrictLiteralFactKind(fact.kind) && !containsNormalizedToken(evidenceText, fact.normalizedValue)
  );
  const allowedProperNouns = buildProperNounAllowlist(contract, context);
  const missingProperNouns = paragraphFacts.filter(
    (fact) =>
      fact.kind === "proper_noun" &&
      !containsNormalizedToken(evidenceText, fact.normalizedValue) &&
      !allowedProperNouns.has(fact.normalizedValue) &&
      !isAbbreviationForEvidencePhrase(fact.value, evidenceText)
  );
  const issues: string[] = [];

  if (strictMissing.length) {
    issues.push(
      `fact paragraph contains strict numeric/date/version tokens absent from cited chunks: ${strictMissing
        .map((fact) => fact.value)
        .join(", ")}`
    );
  }

  if (missingProperNouns.length) {
    issues.push(
      `fact paragraph contains proper-noun tokens absent from cited chunks: ${missingProperNouns
        .map((fact) => fact.value)
        .join(", ")}`
    );
  }

  return issues;
}

export function validateMechanicalAntiSlop(paragraph: Pick<DeepReadParagraph, "text">): string[] {
  const lower = paragraph.text.toLowerCase();
  const issues: string[] = [];
  const bannedHits = DEEP_READ_BANNED_PHRASES.filter((phrase) => lower.includes(phrase.toLowerCase()));

  if (bannedHits.length) {
    issues.push(`mechanical anti-slop banned phrase hit: ${bannedHits.join(", ")}`);
  }

  if (/不是.{1,18}而是/.test(paragraph.text) || /not\s+.+\s+but\s+/i.test(paragraph.text)) {
    issues.push("mechanical anti-slop detected a not-X-but-Y structure");
  }

  const firstSentence = splitSentences(paragraph.text)[0]?.toLowerCase() ?? "";

  if (DEEP_READ_GENERIC_OPENERS.some((opener) => firstSentence.includes(opener.toLowerCase()))) {
    issues.push("paragraph opening sentence is removable generic scaffolding");
  }

  return issues;
}

function canDowngradeFactParagraph(
  paragraph: DeepReadParagraph,
  report: DeepReadParagraphGateReport,
  context: DeepReadMaterialContext
): boolean {
  return (
    paragraph.kind === "fact" &&
    paragraph.citations.length > 0 &&
    validateDeepReadCitationExistence(paragraph, context).length === 0 &&
    !report.issues.some(isStrictLiteralGateIssue)
  );
}

function isStrictLiteralGateIssue(issue: string): boolean {
  return (
    issue.includes("strict numeric/date/version") ||
    issue.includes("fact paragraph has no resolvable cited evidence") ||
    issue.includes("fact paragraphs must include at least one citation") ||
    issue.includes("points to an unknown sourceId/chunkId")
  );
}

function buildProperNounAllowlist(
  contract: Pick<DeepReadChapterContract, "keyFacts">,
  context: DeepReadMaterialContext
): Set<string> {
  const values = [
    ...context.literalAllowlistValues,
    ...contract.keyFacts.filter((fact) => fact.kind === "proper_noun").map((fact) => fact.value)
  ];

  return new Set(values.map(normalizeFactValue).filter(Boolean));
}

function isStrictLiteralFactKind(kind: DeepReadKeyFact["kind"]): boolean {
  return kind === "number" || kind === "date" || kind === "version";
}

function isAbbreviationForEvidencePhrase(value: string, evidenceText: string): boolean {
  const abbreviation = normalizeAcronym(value);

  if (abbreviation.length < 2 || abbreviation.length > 10) {
    return false;
  }

  return extractAcronymCandidates(evidenceText).some((candidate) => normalizeAcronym(candidate) === abbreviation);
}

export async function runDeepReadNewReaderTest(
  chapters: readonly DeepReadChapter[],
  client: ModelClient | undefined,
  contentLanguage: ContentLanguage = "zh"
): Promise<DeepReadArticleRecord["qualityReport"]["newReaderTest"]> {
  if (client) {
    try {
      const response = await client.complete({
        responseFormat: "json_object",
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "Read the article in a clean context. Return JSON only."
          },
          {
            role: "user",
            content: JSON.stringify({
              task:
                "For each chapter question, answer only from the draft. Also list contradictions and ambiguities.",
              chapters: chapters.map((chapter) => ({
                id: chapter.id,
                title: chapter.title,
                question: chapter.question,
                text: chapter.paragraphs.map((paragraph) => paragraph.text).join("\n")
              })),
              schema: {
                answers: [{ chapterId: "string", question: "string", answer: "string" }],
                contradictions: ["string"],
                ambiguities: ["string"]
              }
            })
          }
        ]
      });
      const parsed = parseJsonObject(response.content);

      if (parsed && Array.isArray(parsed.answers)) {
        return {
          runnerKind: "model",
          answers: parsed.answers
            .filter(isRecord)
            .map((answer) => ({
              chapterId: String(answer.chapterId ?? ""),
              question: String(answer.question ?? ""),
              answer: String(answer.answer ?? "")
            }))
            .filter((answer) => answer.chapterId && answer.answer),
          contradictions: normalizeStringArray(parsed.contradictions),
          ambiguities: normalizeStringArray(parsed.ambiguities)
        };
      }
    } catch {
      // Keep release non-blocking; deterministic reader test is enough for first version.
    }
  }

  return {
    runnerKind: "deterministic_fallback",
    answers: chapters.map((chapter) => ({
      chapterId: chapter.id,
      question: chapter.question,
      answer:
        firstMeaningfulSentence(chapter.paragraphs.map((paragraph) => paragraph.text).join(" ")) ??
        formatLine(contentLanguage, "本章没有足够材料回答。", "This chapter does not have enough material to answer.")
    })),
    contradictions: [],
    ambiguities: chapters
      .filter((chapter) => chapter.status === "gap" || chapter.singleSource)
      .map((chapter) =>
        chapter.singleSource
          ? formatLine(
              contentLanguage,
              `${chapter.title} 只有单一来源支撑。`,
              `${chapter.title} is supported by only one source.`
            )
          : chapter.gapStatement ?? chapter.title
      )
  };
}

function createDeepReadGapChapter(
  contract: DeepReadChapterContract,
  context: DeepReadMaterialContext,
  contentLanguage: ContentLanguage | undefined,
  checkedAt: string
): DeepReadChapter {
  const gapStatement =
    contract.gapStatement ??
    formatLine(
      contentLanguage,
      "当前来源覆盖不到本章问题,不能写成有据正文。",
      "The current sources do not cover this chapter question enough to write supported body text."
    );

  return {
    id: contract.id,
    title: contract.title,
    question: contract.question,
    status: "gap",
    singleSource: false,
    gapStatement,
    contract,
    paragraphs: [
      {
        id: `${contract.id}-gap`,
        kind: "synthesis",
        text: gapStatement,
        citations: [],
        gate: {
          passed: true,
          issues: [],
          checkedAt
        }
      }
    ],
    sources: buildChapterSources(contract, context)
  };
}

function aggregateDeepReadGapChapters(
  chapters: readonly DeepReadChapter[],
  contentLanguage: ContentLanguage | undefined,
  checkedAt: string
): DeepReadChapter[] {
  const bodyChapters = chapters.filter(
    (chapter) => chapter.status === "complete" && chapter.contract.materialPointers.length > 0
  );
  const gapChapters = chapters.filter(
    (chapter) => chapter.status === "gap" || chapter.contract.materialPointers.length === 0
  );

  if (!gapChapters.length) {
    return bodyChapters;
  }

  const gapTitle = formatLine(contentLanguage, "本文来源覆盖不到的部分", "What the sources do not cover");
  const gapQuestion = formatLine(
    contentLanguage,
    "哪些问题不能从当前来源中写成有据正文?",
    "Which questions cannot be written as supported body text from the current sources?"
  );
  const gapStatement = formatLine(
    contentLanguage,
    "下面这些章节没有足够来源覆盖,或在门禁后只剩缺口说明。",
    "The following chapters are not covered by enough sources, or were reduced to gap notes by the gates."
  );
  const gapContract: DeepReadChapterContract = {
    id: "chapter-source-coverage-gaps",
    title: gapTitle,
    question: gapQuestion,
    materialPointers: [],
    keyFacts: [],
    gapStatement,
    conflictInstructions: [],
    singleSource: false,
    readerPositioning: {
      masteredConcepts: uniqueStrings(gapChapters.flatMap((chapter) => chapter.contract.readerPositioning.masteredConcepts)),
      gapConcepts: uniqueStrings(gapChapters.flatMap((chapter) => chapter.contract.readerPositioning.gapConcepts))
    }
  };

  return [
    ...bodyChapters,
    {
      id: gapContract.id,
      title: gapTitle,
      question: gapQuestion,
      status: "gap" as const,
      singleSource: false,
      gapStatement,
      contract: gapContract,
      paragraphs: gapChapters.map((chapter, index) => ({
        id: `${gapContract.id}-p${index + 1}`,
        kind: "synthesis" as const,
        text: formatLine(
          contentLanguage,
          `「${chapter.title}」:${chapter.gapStatement ?? firstMeaningfulSentence(chapter.paragraphs.map((paragraph) => paragraph.text).join(" ")) ?? chapter.question}`,
          `${chapter.title}: ${chapter.gapStatement ?? firstMeaningfulSentence(chapter.paragraphs.map((paragraph) => paragraph.text).join(" ")) ?? chapter.question}`
        ),
        citations: [],
        gate: {
          passed: true,
          issues: [],
          checkedAt
        }
      })),
      sources: []
    }
  ];
}

async function assembleDeepReadArticle({
  input,
  selection,
  chapters,
  deletedParagraphLog,
  outline,
  runnerKind,
  createdAt,
  maxTokens,
  client
}: {
  input: CreateDeepReadArticleInput;
  selection: DeepReadSelectionResult;
  chapters: DeepReadChapter[];
  deletedParagraphLog: DeepReadDeletedParagraphLog[];
  outline: DeepReadOutlineResult;
  runnerKind: DeepReadArticleRunnerKind;
  createdAt: string;
  maxTokens: number;
  client?: ModelClient;
}): Promise<DeepReadArticleRecord> {
  const assembledChapters = aggregateDeepReadGapChapters(chapters, input.contentLanguage, createdAt);
  const dedupedChapters = dedupeArticleParagraphs(assembledChapters);
  const sourceList = buildArticleSources(selection.materials);
  const density = calculateKnowledgeDensity(dedupedChapters);
  const newReaderTest = await runDeepReadNewReaderTest(dedupedChapters, client, input.contentLanguage);
  const sourceCardIds = uniqueStrings(selection.materials.map((material) => material.pointer.cardId));
  const sourceChunkIds = uniqueStrings(selection.materials.map((material) => material.pointer.chunkId));
  const fallbackLabel =
    runnerKind === "deterministic_fallback"
      ? formatLine(
          input.contentLanguage,
          "确定性拼装稿:按概念树成章,逐章罗列已通过准入的卡片要点和原文片段。",
          "Deterministic fallback draft: chapters follow the concept tree and list admitted card points with source chunks."
        )
      : "";
  const title = formatLine(input.contentLanguage, `${selection.topic} 深读`, `Deep Read: ${selection.topic}`);

  return {
    id: `deepread-${sanitizeId(selection.topic)}-${hashText(`${selection.topic}|${createdAt}`)}`,
    version: deepReadPipelineVersion,
    status: dedupedChapters.some((chapter) => chapter.status === "complete" && chapter.contract.materialPointers.length > 0)
      ? "ready"
      : "failed",
    runnerKind,
    topic: selection.topic,
    topicKey: selection.topicKey,
    goalId: input.goalId,
    userId: input.userId ?? "local-user",
    title,
    introduction: formatLine(
      input.contentLanguage,
      `${fallbackLabel ? `${fallbackLabel} ` : ""}这篇文章只使用当前知识库中能回到原文 chunk 的材料;不能支撑的部分会标为缺口。`,
      `${fallbackLabel ? `${fallbackLabel} ` : ""}This article uses only library materials that resolve back to source chunks; unsupported areas are marked as gaps.`
    ),
    conclusion: formatLine(
      input.contentLanguage,
      `读完后,你应该能回答每章问题;边界是:本文没有开放网络检索,也不会把单一来源写成共识。`,
      `After reading, you should be able to answer each chapter question. Boundary: this did not use open web search and does not turn a single source into consensus.`
    ),
    chapters: dedupedChapters,
    sources: sourceList,
    sourceCardIds,
    sourceChunkIds,
    discardedMaterials: selection.discardedMaterials,
    conflicts: selection.conflicts,
    deletedParagraphLog,
    qualityReport: {
      runnerKind,
      generatedAt: createdAt,
      newReaderTest,
      density,
      notes: [...outline.reviewNotes, ...outline.budgetNotes]
    },
    libraryVersion: input.libraryVersion ?? createdAt,
    budget: {
      maxTokens,
      truncated: outline.truncated,
      notes: outline.budgetNotes
    },
    createdAt,
    updatedAt: createdAt
  };
}

async function createModelOutlineContracts(
  selection: DeepReadSelectionResult,
  client: ModelClient,
  contentLanguage: ContentLanguage | undefined
): Promise<DeepReadChapterContract[]> {
  try {
    const draftResponse = await client.complete({
      temperature: 0.1,
      responseFormat: "json_object",
      messages: [
        {
          role: "system",
          content: "Draft a generic article skeleton from parameter knowledge. Return JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            topic: selection.topic,
            language: contentLanguage ?? "zh",
            schema: { chapters: [{ title: "string", question: "string" }] }
          })
        }
      ]
    });
    const draftParsed = parseJsonObject(draftResponse.content);
    const draftSkeleton = Array.isArray(draftParsed?.chapters) ? draftParsed.chapters : [];
    const response = await client.complete({
      temperature: 0.1,
      responseFormat: "json_object",
      messages: [
        {
          role: "system",
          content:
            "Refine the draft skeleton using only these materials. Drop nodes without material or mark them as gaps. Chapters must ask mutually exclusive questions — merge overlapping chapters instead of keeping near-duplicates. Return JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            topic: selection.topic,
            draftSkeleton,
            materials: selection.materials.map((material) => ({
              pointer: material.pointer,
              pointerId: toPointerKey(material.pointer),
              title: material.cardTitle,
              concepts: material.cardConcepts,
              excerpt: trimText(material.chunkText, 700)
            })),
            conflicts: selection.conflicts,
            schema: {
              chapters: [
                {
                  title: "string",
                  question: "string",
                  pointerIds: ["cardId|sourceId|chunkId"],
                  gapStatement: "string optional"
                }
              ]
            }
          })
        }
      ]
    });
    const parsed = parseJsonObject(response.content);
    const chapters = Array.isArray(parsed?.chapters) ? parsed.chapters : [];
    const materialByPointer = new Map(selection.materials.map((material) => [toPointerKey(material.pointer), material]));
    const contracts: DeepReadChapterContract[] = [];

    for (const chapter of chapters) {
      if (!isRecord(chapter) || typeof chapter.title !== "string" || typeof chapter.question !== "string") {
        continue;
      }

      const pointerIds = normalizeStringArray(chapter.pointerIds);
      const materials = pointerIds.flatMap((id) => {
        const material = materialByPointer.get(id);

        return material ? [material] : [];
      });

      contracts.push(
        buildChapterContract({
          id: `chapter-${contracts.length + 1}-${sanitizeId(chapter.title)}`,
          title: chapter.title,
          question: chapter.question,
          materials,
          selection,
          gapStatement: typeof chapter.gapStatement === "string" ? chapter.gapStatement : undefined
        })
      );
    }

    return contracts.filter((contract) => contract.materialPointers.length > 0 || contract.gapStatement);
  } catch {
    return [];
  }
}

async function generateModelChapterDraft(
  contract: DeepReadChapterContract,
  context: DeepReadMaterialContext,
  client: ModelClient,
  contentLanguage: ContentLanguage | undefined,
  options: {
    previousChapters?: readonly DeepReadWrittenChapterSummary[];
    gateFeedback?: readonly string[];
  } = {}
): Promise<DeepReadChapterDraft | undefined> {
  try {
    const materials = contract.materialPointers.flatMap((pointer) => {
      const material = context.materialByPointerKey.get(toPointerKey(pointer));

      return material
        ? [
            {
              pointer,
              sourceTitle: material.sourceTitle,
              text: material.chunkText
            }
          ]
        : [];
    });
    const response = await client.complete({
      temperature: 0.2,
      responseFormat: "json_object",
      messages: [
        {
          role: "system",
          content: [
            "Write one readable article chapter. Use only the provided chapter materials. Return JSON only.",
            "This is body prose for a human reader, not bullet notes, not a table, and not a list of tiny fragments.",
            `Paragraph count: ${DEEP_READ_MODEL_PARAGRAPH_COUNT_RANGE.min}-${DEEP_READ_MODEL_PARAGRAPH_COUNT_RANGE.max}. Sentences per paragraph: ${DEEP_READ_MODEL_SENTENCE_COUNT_RANGE.min}-${DEEP_READ_MODEL_SENTENCE_COUNT_RANGE.max}. Paragraph length: about ${DEEP_READ_MODEL_PARAGRAPH_LENGTH_RANGE.min}-${DEEP_READ_MODEL_PARAGRAPH_LENGTH_RANGE.max} Chinese characters or comparable English words.`,
            "Writing requirements:",
            ...DEEP_READ_WRITING_REQUIREMENTS,
            "Structure rules:",
            ...DEEP_READ_STRUCTURE_RULES,
            "Anti-slop rules:",
            ...DEEP_READ_ANTI_SLOP_RULES
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            language: contentLanguage ?? "zh",
            contract,
            previousChapters: options.previousChapters ?? [],
            gateFeedback: options.gateFeedback ?? [],
            continuity:
              "Do not repeat previous chapters. Continue their line of thought and make the final sentence reconnect this chapter to the article's main topic.",
            materials,
            schema: {
              takeaway: "string optional, one sentence summary of this chapter's contribution",
              paragraphs: [
                {
                  text: "string",
                  kind: "fact | synthesis",
                  citations: [{ sourceId: "string", chunkId: "string", cardId: "string optional" }]
                }
              ]
            }
          })
        }
      ]
    });
    const parsed = parseJsonObject(response.content);
    const paragraphs = Array.isArray(parsed?.paragraphs) ? parsed.paragraphs : [];
    const normalized = paragraphs.flatMap((paragraph, index) => {
      if (!isRecord(paragraph) || typeof paragraph.text !== "string") {
        return [];
      }

      const kind = paragraph.kind === "synthesis" ? "synthesis" : "fact";
      const citations = normalizeCitations(paragraph.citations);

      return [
        {
          id: `${contract.id}-p${index + 1}`,
          kind,
          text: paragraph.text.trim(),
          citations
        } satisfies DeepReadParagraph
      ];
    });

    return normalized.length
      ? {
          contract,
          paragraphs: normalized,
          takeaway: typeof parsed?.takeaway === "string" ? parsed.takeaway.trim() : summarizeParagraphsForPrompt(normalized)
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function generateDeterministicParagraphs(
  contract: DeepReadChapterContract,
  context: DeepReadMaterialContext,
  contentLanguage: ContentLanguage = "zh"
): DeepReadParagraph[] {
  const materials = contract.materialPointers.flatMap((pointer) => {
    const material = context.materialByPointerKey.get(toPointerKey(pointer));

    return material ? [material] : [];
  });

  if (!materials.length) {
    return [
      {
        id: `${contract.id}-p1`,
        kind: "synthesis",
        text:
          contract.gapStatement ??
          formatLine(
            contentLanguage,
            "当前知识库没有足够的原文片段支撑本章。",
            "The current library does not have enough source chunks to support this chapter."
          ),
        citations: []
      }
    ];
  }

  const paragraphs: DeepReadParagraph[] = materials.slice(0, 3).map((material, index) => ({
    id: `${contract.id}-p${index + 1}`,
    kind: "fact",
    text: formatLine(
      contentLanguage,
      `来源片段显示:${firstMeaningfulSentence(material.chunkText) ?? trimText(material.chunkText, 180)}`,
      // No capitalized template words here: the literal fact gate extracts
      // proper nouns from fact paragraphs and requires them in the cited chunk.
      `${firstMeaningfulSentence(material.chunkText) ?? trimText(material.chunkText, 180)} (quoted from the cited chunk)`
    ),
    citations: [material.pointer]
  }));

  if (materials.length >= 2) {
    paragraphs.push({
      id: `${contract.id}-p${paragraphs.length + 1}`,
      kind: "synthesis",
      text: formatLine(
        contentLanguage,
        `把这些材料放在一起看,本章的有限结论是:「${contract.question}」只能在这些引用覆盖的范围内回答。`,
        `Read together, the limited conclusion is that "${contract.question}" can only be answered within the cited scope.`
      ),
      citations: materials.slice(0, 3).map((material) => material.pointer)
    });
  }

  if (contract.singleSource) {
    paragraphs.push({
      id: `${contract.id}-single-source`,
      kind: "synthesis",
      text:
        contract.gapStatement ??
        formatLine(
          contentLanguage,
          "这一章目前只有单一来源支撑,不能写成多方共识。",
          "This chapter is currently supported by a single source and should not be presented as consensus."
        ),
      citations: materials.slice(0, 1).map((material) => material.pointer)
    });
  }

  return paragraphs;
}

function summarizeWrittenChapter(chapter: DeepReadChapter, draftTakeaway: string | undefined): DeepReadWrittenChapterSummary {
  return {
    title: chapter.title,
    takeaway: draftTakeaway?.trim() || summarizeParagraphsForPrompt(chapter.paragraphs)
  };
}

function summarizeParagraphsForPrompt(paragraphs: readonly DeepReadParagraph[]): string {
  const firstText = paragraphs.map((paragraph) => paragraph.text).find((text) => text.trim().length > 0) ?? "";
  const firstSentence = firstMeaningfulSentence(firstText) ?? trimText(firstText, 120);

  return trimText(firstSentence, 160);
}

function collectChapterGateFeedback(logs: readonly DeepReadDeletedParagraphLog[]): string[] {
  return logs.map((log) => `${log.paragraphId}: ${log.reasons.join("; ")} | ${trimText(log.text, 180)}`);
}

async function rewriteDeepReadParagraph(
  paragraph: DeepReadParagraph,
  contract: DeepReadChapterContract,
  context: DeepReadMaterialContext,
  client: ModelClient,
  contentLanguage: ContentLanguage | undefined
): Promise<DeepReadParagraph | undefined> {
  try {
    const evidence = paragraph.citations.map((citation) => ({
      citation,
      text: context.chunkByPointerKey.get(toChunkKey(citation.sourceId, citation.chunkId))?.content ?? ""
    }));
    const response = await client.complete({
      temperature: 0.1,
      responseFormat: "json_object",
      messages: [
        {
          role: "system",
          content: "Rewrite one paragraph to satisfy the gate. Return JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            language: contentLanguage ?? "zh",
            contract,
            paragraph,
            evidence,
            schema: {
              text: "string",
              kind: "fact | synthesis",
              citations: [{ sourceId: "string", chunkId: "string", cardId: "string optional" }]
            }
          })
        }
      ]
    });
    const parsed = parseJsonObject(response.content);

    if (!parsed || typeof parsed.text !== "string") {
      return undefined;
    }

    const citations = normalizeCitations(parsed.citations);

    // Keep the original kind and never drop citations: a failing fact paragraph
    // must not be laundered into an uncited synthesis paragraph.
    return {
      id: paragraph.id,
      kind: paragraph.kind,
      text: parsed.text.trim(),
      citations: citations.length ? citations : paragraph.citations
    };
  } catch {
    return undefined;
  }
}

async function validateFactParagraphEntailment(
  paragraph: DeepReadParagraph,
  context: DeepReadMaterialContext,
  client: ModelClient
): Promise<string[]> {
  try {
    const evidence = paragraph.citations.map((citation) => ({
      citation,
      text: context.chunkByPointerKey.get(toChunkKey(citation.sourceId, citation.chunkId))?.content ?? ""
    }));
    const response = await client.complete({
      temperature: 0,
      responseFormat: "json_object",
      messages: [
        { role: "system", content: "Judge whether every factual sentence is entailed by the evidence. Return JSON only." },
        { role: "user", content: JSON.stringify({ paragraph: paragraph.text, evidence, schema: { passed: true, issues: ["string"] } }) }
      ]
    });
    const parsed = parseJsonObject(response.content);

    return parsed?.passed === false ? normalizeStringArray(parsed.issues).slice(0, 4) : [];
  } catch {
    return [];
  }
}

async function validateSynthesisParagraphOverstatement(
  paragraph: DeepReadParagraph,
  contract: DeepReadChapterContract,
  context: DeepReadMaterialContext,
  client: ModelClient
): Promise<string[]> {
  try {
    const evidence = paragraph.citations.map((citation) => ({
      citation,
      text: context.chunkByPointerKey.get(toChunkKey(citation.sourceId, citation.chunkId))?.content ?? ""
    }));
    const response = await client.complete({
      temperature: 0,
      responseFormat: "json_object",
      messages: [
        {
          role: "system",
          content:
            "Detect overstatement in synthesis: unsupported strong claims, marketing language, or correlation upgraded to causation. A claim explicitly attributed to its source (e.g. 'the paper claims', '论文声称/DeepSeek 表示') is NOT overstatement when the cited evidence does make that claim — attributed reporting must pass. Return JSON only."
        },
        {
          role: "user",
          content: JSON.stringify({
            question: contract.question,
            paragraph: paragraph.text,
            evidence,
            schema: { passed: true, issues: ["string"] }
          })
        }
      ]
    });
    const parsed = parseJsonObject(response.content);

    return parsed?.passed === false ? normalizeStringArray(parsed.issues).slice(0, 4) : [];
  } catch {
    return [];
  }
}

function buildChapterContract(input: {
  id: string;
  title: string;
  question: string;
  materials: DeepReadSelectedMaterial[];
  selection: DeepReadSelectionResult;
  gapStatement?: string;
}): DeepReadChapterContract {
  const materialPointers = input.materials.map((material) => material.pointer);
  const keyFacts = input.materials.flatMap((material) => material.keyFacts).slice(0, 30);
  const relevantConflictInstructions = input.selection.conflicts
    .filter((conflict) =>
      materialPointers.some(
        (pointer) =>
          (pointer.chunkId === conflict.left.chunkId && pointer.sourceId === conflict.left.sourceId) ||
          (pointer.chunkId === conflict.right.chunkId && pointer.sourceId === conflict.right.sourceId)
      )
    )
    .map((conflict) => `Conflict on ${conflict.fieldKey}: ${conflict.left.value} vs ${conflict.right.value}.`);

  return {
    id: input.id,
    title: input.title,
    question: input.question,
    materialPointers,
    keyFacts,
    gapStatement: input.gapStatement,
    conflictInstructions: relevantConflictInstructions,
    singleSource: conceptMaterialsIndependentSourceCount(input.materials) === 1,
    readerPositioning: {
      masteredConcepts: input.selection.masteredConcepts,
      gapConcepts: input.selection.gapConcepts
    }
  };
}

function reviewDeepReadOutlineContracts(
  contracts: DeepReadChapterContract[],
  selection: DeepReadSelectionResult,
  contentLanguage: ContentLanguage = "zh"
): string[] {
  const notes: string[] = [];

  if (!contracts.some((contract) => contract.conflictInstructions.length) && selection.conflicts.length) {
    notes.push(
      formatLine(
        contentLanguage,
        "对抗审纲:存在冲突对,但没有章节显式处理;已在质量报告记录。",
        "Adversarial outline review: conflicts exist but no chapter handled them explicitly."
      )
    );
  }

  if (contracts.filter((contract) => contract.singleSource && contract.materialPointers.length > 0).length) {
    notes.push(
      formatLine(
        contentLanguage,
        "对抗审纲:部分章节只有单一来源,阅读视图需标注 singleSource。",
        "Adversarial outline review: some chapters are single-source and must be marked."
      )
    );
  }

  if (contracts.some((contract) => !contract.materialPointers.length)) {
    notes.push(
      formatLine(
        contentLanguage,
        "对抗审纲:无素材节点已转为缺口章。",
        "Adversarial outline review: nodes without material were converted to gap chapters."
      )
    );
  }

  return notes;
}

export function createDeepReadMaterialContext(
  materials: DeepReadSelectedMaterial[],
  options: {
    topic?: string;
    conceptAliases?: readonly ConceptAliasRecord[];
  } = {}
): DeepReadMaterialContext {
  const materialByPointerKey = new Map<string, DeepReadSelectedMaterial>();
  const chunkByPointerKey = new Map<string, KnowledgeChunk>();

  for (const material of materials) {
    materialByPointerKey.set(toPointerKey(material.pointer), material);
    chunkByPointerKey.set(toChunkKey(material.pointer.sourceId, material.pointer.chunkId), {
      id: material.pointer.chunkId,
      sourceId: material.pointer.sourceId,
      content: material.chunkText
    });
  }

  return {
    materials,
    materialByPointerKey,
    chunkByPointerKey,
    literalAllowlistValues: buildDeepReadLiteralAllowlist(options.topic, options.conceptAliases ?? [])
  };
}

function buildDeepReadLiteralAllowlist(
  topic: string | undefined,
  conceptAliases: readonly ConceptAliasRecord[]
): string[] {
  const resolver = createConceptAliasResolver(conceptAliases);
  const values: string[] = [];
  const resolvedTopic = topic ? normalizeConceptLabel(resolver.resolveConcept(topic)) : "";
  const topicKey = normalizeConceptKey(resolvedTopic);

  if (topic) {
    values.push(topic, resolvedTopic);
    const acronym = buildAcronym(topic);

    if (acronym) {
      values.push(acronym);
    }
  }

  for (const record of resolver.records) {
    const labels = [record.canonical, ...record.aliases];
    const resolvesToTopic = labels.some((label) => normalizeConceptKey(resolver.resolveConcept(label)) === topicKey);

    if (!resolvesToTopic) {
      continue;
    }

    for (const label of labels) {
      values.push(label);
      const acronym = buildAcronym(label);

      if (acronym) {
        values.push(acronym);
      }
    }
  }

  return uniqueStrings(values);
}

function resolveCardCitationPointers(
  card: KnowledgeCard,
  chunkIndex: Map<string, KnowledgeChunk>
): DeepReadMaterialPointer[] {
  const pointers: DeepReadMaterialPointer[] = [];

  for (const citation of card.citations ?? []) {
    if (citation.chunkId) {
      const chunk =
        chunkIndex.get(toChunkKey(citation.sourceId, citation.chunkId)) ??
        Array.from(chunkIndex.values()).find((candidate) => candidate.id === citation.chunkId);

      if (chunk) {
        pointers.push({
          cardId: card.id,
          sourceId: chunk.sourceId,
          chunkId: chunk.id
        });
      }

      continue;
    }

    const chunks = Array.from(chunkIndex.values())
      .filter((chunk) => chunk.sourceId === citation.sourceId)
      .slice(0, 2);

    for (const chunk of chunks) {
      pointers.push({
        cardId: card.id,
        sourceId: chunk.sourceId,
        chunkId: chunk.id
      });
    }
  }

  return dedupePointers(pointers);
}

function scoreMaterialAdmission(input: {
  card: KnowledgeCard;
  source: Source;
  chunk: KnowledgeChunk;
  overlapCount: number;
  closureSize: number;
  verdict?: SourceQualityVerdict;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const qualityScore = input.verdict?.score ?? 0.65;
  const trustScore =
    input.card.trustState === "supported" ? 0.16 : input.card.trustState === "contested" ? 0.08 : 0.1;
  const confidenceScore =
    input.card.confidence === "high" ? 0.08 : input.card.confidence === "medium" ? 0.05 : 0.02;
  const closureScore = Math.min(0.42, input.overlapCount * 0.16 + (input.overlapCount / Math.max(1, input.closureSize)) * 0.16);
  let score = 0.18 + closureScore + qualityScore * 0.24 + trustScore + confidenceScore + 0.08;

  reasons.push(`closure_overlap=${input.overlapCount}`);
  reasons.push(`source_quality=${roundScore(qualityScore)}`);
  reasons.push(`trust=${input.card.trustState}`);

  if (input.verdict?.verdict === "reject") {
    score -= 0.42;
    reasons.push(`source_quality_reject:${input.verdict.reasons.slice(0, 2).join(";")}`);
  }

  if (!input.chunk.content.trim()) {
    score -= 0.3;
    reasons.push("empty_chunk");
  }

  return { score: roundScore(clamp01(score)), reasons };
}

export function extractDeepReadKeyFacts(text: string, pointer: DeepReadMaterialPointer): DeepReadKeyFact[] {
  return extractLooseFacts(text).map((fact, index) => ({
    ...fact,
    id: `fact-${hashText(`${pointer.sourceId}|${pointer.chunkId}|${fact.kind}|${fact.normalizedValue}|${index}`)}`,
    sourceId: pointer.sourceId,
    chunkId: pointer.chunkId,
    cardId: pointer.cardId
  }));
}

function extractLooseFacts(text: string): Array<Omit<DeepReadKeyFact, "id" | "sourceId" | "chunkId" | "cardId">> {
  const facts: Array<Omit<DeepReadKeyFact, "id" | "sourceId" | "chunkId" | "cardId">> = [];
  const occupied: Array<{ start: number; end: number }> = [];
  const addMatches = (kind: DeepReadKeyFact["kind"], regex: RegExp) => {
    for (const match of text.matchAll(regex)) {
      const value = match[0];
      const start = match.index ?? 0;
      const end = start + value.length;

      if (occupied.some((span) => start < span.end && end > span.start)) {
        continue;
      }

      occupied.push({ start, end });
      facts.push({
        kind,
        value,
        normalizedValue: normalizeFactValue(value),
        fieldKey: buildFactFieldKey(kind, text, start, end)
      });
    }
  };

  addMatches("version", /\bv?\d+(?:\.\d+){1,3}\b/gi);
  addMatches("date", /\b(?:19|20)\d{2}(?:[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?)?\b/g);
  addMatches("number", /\b\d+(?:\.\d+)?%?\b/g);
  addMatches("proper_noun", /\b[A-Z][A-Za-z0-9]{1,}(?:[- ][A-Z][A-Za-z0-9]{1,}){0,3}\b/g);

  return dedupeFacts(facts).slice(0, 40);
}

function detectDeepReadConflicts(materials: readonly DeepReadSelectedMaterial[]): DeepReadConflictPair[] {
  const facts = materials
    .flatMap((material) => material.keyFacts)
    .filter((fact) => fact.kind === "number" || fact.kind === "date" || fact.kind === "version");
  const byField = new Map<string, DeepReadKeyFact[]>();

  for (const fact of facts) {
    const list = byField.get(`${fact.kind}|${fact.fieldKey}`) ?? [];

    list.push(fact);
    byField.set(`${fact.kind}|${fact.fieldKey}`, list);
  }

  const conflicts: DeepReadConflictPair[] = [];

  for (const [fieldKey, list] of byField) {
    for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
        const left = list[leftIndex];
        const right = list[rightIndex];

        if (
          left.normalizedValue !== right.normalizedValue &&
          (left.sourceId !== right.sourceId || left.cardId !== right.cardId)
        ) {
          conflicts.push({
            id: `conflict-${hashText(`${fieldKey}|${left.id}|${right.id}`)}`,
            fieldKey,
            kind: left.kind,
            left,
            right
          });
        }
      }
    }
  }

  return conflicts.slice(0, 20);
}

function buildFactFieldKey(kind: DeepReadKeyFact["kind"], text: string, start: number, end: number): string {
  if (kind === "proper_noun") {
    return `${kind}:identity`;
  }

  const before = text.slice(Math.max(0, start - 60), start);
  const after = text.slice(end, Math.min(text.length, end + 60));
  const context = `${before} {value} ${after}`;
  const tokens = tokenizeForFieldKey(context).filter((token) => token !== "value");

  return `${kind}:${tokens.slice(0, 8).join(" ") || "value"}`;
}

function tokenizeForFieldKey(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}{}]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim().replace(/[{}]/g, ""))
    .filter((token) => token.length > 1 && !fieldStopwords.has(token));
}

const fieldStopwords = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "about",
  "over",
  "under",
  "显示",
  "来源",
  "片段",
  "可以",
  "一个",
  "这种"
]);

function buildChapterSources(contract: DeepReadChapterContract, context: DeepReadMaterialContext): DeepReadChapterSource[] {
  const bySource = new Map<string, DeepReadChapterSource>();

  for (const pointer of contract.materialPointers) {
    const material = context.materialByPointerKey.get(toPointerKey(pointer));

    if (!material) {
      continue;
    }

    const existing = bySource.get(pointer.sourceId) ?? {
      sourceId: pointer.sourceId,
      sourceTitle: material.sourceTitle,
      chunkIds: [],
      cardIds: []
    };

    existing.chunkIds = uniqueStrings([...existing.chunkIds, pointer.chunkId]);
    existing.cardIds = uniqueStrings([...existing.cardIds, pointer.cardId]);
    bySource.set(pointer.sourceId, existing);
  }

  return Array.from(bySource.values()).sort((left, right) => left.sourceTitle.localeCompare(right.sourceTitle));
}

function buildArticleSources(materials: readonly DeepReadSelectedMaterial[]): DeepReadArticleRecord["sources"] {
  const bySource = new Map<string, DeepReadArticleRecord["sources"][number]>();

  for (const material of materials) {
    const existing = bySource.get(material.pointer.sourceId) ?? {
      sourceId: material.pointer.sourceId,
      title: material.sourceTitle,
      url: material.sourceUrl,
      type: material.sourceType,
      chunkIds: [],
      cardIds: []
    };

    existing.chunkIds = uniqueStrings([...existing.chunkIds, material.pointer.chunkId]);
    existing.cardIds = uniqueStrings([...existing.cardIds, material.pointer.cardId]);
    bySource.set(material.pointer.sourceId, existing);
  }

  return Array.from(bySource.values()).sort((left, right) => left.title.localeCompare(right.title));
}

export function dedupeArticleParagraphs(chapters: DeepReadChapter[]): DeepReadChapter[] {
  const seen = new Set<string>();

  return chapters.map((chapter) => ({
    ...chapter,
    paragraphs: chapter.paragraphs.filter((paragraph) => {
      if (chapter.status === "gap" || paragraph.citations.length === 0) {
        return true;
      }

      const key = normalizeTextKey(paragraph.text);

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
  }));
}

function calculateKnowledgeDensity(chapters: readonly DeepReadChapter[]): DeepReadArticleRecord["qualityReport"]["density"] {
  const text = chapters.flatMap((chapter) => chapter.paragraphs.map((paragraph) => paragraph.text)).join("\n");
  const atomicPointCount = new Set(
    chapters.flatMap((chapter) => [
      ...chapter.contract.keyFacts.map((fact) => `${fact.kind}:${fact.normalizedValue}`),
      ...chapter.paragraphs.flatMap((paragraph) => splitSentences(paragraph.text).map(normalizeTextKey))
    ])
  ).size;
  const characterCount = text.length;

  return {
    atomicPointCount,
    characterCount,
    pointsPerThousandChars: characterCount ? roundScore((atomicPointCount / characterCount) * 1000) : 0
  };
}

function indexRegistryChunks(records: readonly DeepReadSourceRegistryRecordLike[]): Map<string, KnowledgeChunk> {
  const chunks = new Map<string, KnowledgeChunk>();

  for (const record of records) {
    for (const chunk of record.registry.chunks) {
      chunks.set(toChunkKey(chunk.sourceId, chunk.id), chunk);
    }
  }

  return chunks;
}

function indexRegistrySources(records: readonly DeepReadSourceRegistryRecordLike[]): Map<string, Source> {
  const sources = new Map<string, Source>();

  for (const record of records) {
    for (const source of record.registry.sources) {
      sources.set(source.id, source);
    }
  }

  return sources;
}

function indexSourceQualityVerdicts(verdicts: readonly SourceQualityVerdict[]): Map<string, SourceQualityVerdict> {
  const index = new Map<string, SourceQualityVerdict>();

  for (const verdict of verdicts) {
    index.set(verdict.sourceId, verdict);
    index.set(normalizeUrlKey(verdict.url), verdict);
  }

  return index;
}

function conceptMaterialsIndependentSourceCount(materials: readonly DeepReadSelectedMaterial[]): number {
  return new Set(materials.map((material) => material.pointer.sourceId)).size;
}

function collectCardConcepts(
  card: KnowledgeCard,
  resolver: ReturnType<typeof createConceptAliasResolver>
): string[] {
  return uniqueStrings(
    [
      ...card.concepts,
      ...(card.graphEdges ?? []).flatMap((edge) => [edge.sourceConcept, edge.targetConcept])
    ].map((concept) => normalizeConceptLabel(resolver.resolveConcept(concept)))
  );
}

function dedupePointers(pointers: DeepReadMaterialPointer[]): DeepReadMaterialPointer[] {
  const byKey = new Map<string, DeepReadMaterialPointer>();

  for (const pointer of pointers) {
    byKey.set(toPointerKey(pointer), pointer);
  }

  return Array.from(byKey.values());
}

function dedupeFacts<T extends { kind: string; normalizedValue: string; fieldKey: string }>(facts: T[]): T[] {
  const byKey = new Map<string, T>();

  for (const fact of facts) {
    byKey.set(`${fact.kind}|${fact.fieldKey}|${fact.normalizedValue}`, fact);
  }

  return Array.from(byKey.values());
}

function normalizeCitations(value: unknown): DeepReadCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.sourceId !== "string" || typeof item.chunkId !== "string") {
      return [];
    }

    return [
      {
        sourceId: item.sourceId,
        chunkId: item.chunkId,
        cardId: typeof item.cardId === "string" ? item.cardId : undefined
      }
    ];
  });
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[。！？.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function firstMeaningfulSentence(value: string): string | undefined {
  return splitSentences(value).find((sentence) => sentence.length >= 12) ?? trimText(value, 180);
}

function containsNormalizedToken(text: string, token: string): boolean {
  return normalizeFactValue(text).includes(token);
}

function normalizeFactValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeAcronym(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

function buildAcronym(value: string): string | undefined {
  const words = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^\p{L}\p{N}-]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);

  if (words.length < 2) {
    return undefined;
  }

  return words.map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function extractAcronymCandidates(text: string): string[] {
  const candidates: string[] = [];
  const words = text.match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];

  for (let start = 0; start < words.length; start += 1) {
    for (let size = 2; size <= 7 && start + size <= words.length; size += 1) {
      const acronym = buildAcronym(words.slice(start, start + size).join(" "));

      if (acronym) {
        candidates.push(acronym);
      }
    }
  }

  return candidates;
}

function normalizeTextKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeUrlKey(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function trimText(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();

  return trimmed.length > maxLength ? `${trimmed.slice(0, Math.max(0, maxLength - 3))}...` : trimmed;
}

function toPointerKey(pointer: DeepReadMaterialPointer): string {
  return `${pointer.cardId}|${pointer.sourceId}|${pointer.chunkId}`;
}

function toChunkKey(sourceId: string, chunkId: string): string {
  return `${sourceId}|${chunkId}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))).sort(
    (left, right) => left.localeCompare(right)
  );
}

function compareDiscardedMaterials(left: DeepReadDiscardedMaterial, right: DeepReadDiscardedMaterial): number {
  return right.score - left.score || (left.title ?? "").localeCompare(right.title ?? "");
}

function formatLine(contentLanguage: ContentLanguage | undefined, zh: string, en: string): string {
  return contentLanguage === "en" ? en : zh;
}

function normalizeDeepReadMaxTokens(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultMaxTokens;
  }

  return Math.max(50000, Math.min(150000, Math.floor(value)));
}

function normalizeNow(value: CreateDeepReadArticleOptions["now"]): string {
  const raw = typeof value === "function" ? value() : value;

  return normalizeDate(raw ?? new Date()).toISOString();
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function sanitizeId(value: string): string {
  return normalizeConceptKey(value).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "") || "article";
}

function hashText(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
