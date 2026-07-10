import { getRegistryChunk, getRegistrySource } from "../source/sourceRegistry.js";
import type {
  Citation,
  EvidenceSpan,
  GroundingCheck,
  GroundingClaimCheck,
  HarnessValidationIssue,
  KnowledgePost,
  SourceClaim,
  SourceClaimKind,
  SourceRegistry
} from "../types.js";

export interface GroundingGateOptions {
  minSourceFactOverlap: number;
  minInterpretationOverlap: number;
  sameSourceFollowup: boolean;
}

export interface ClaimSupportOptions {
  minOverlap?: number;
  minimumSharedTokens?: number;
  checkProperNouns?: boolean;
  checkDirection?: boolean;
  checkNegation?: boolean;
  requireClaimPolarityCue?: boolean;
  allowBeyondSource?: boolean;
}

export interface ClaimSupportResult {
  supported: boolean;
  overlapScore: number;
  reason: string;
  issueKind: "supported" | "missing_evidence" | "overlap" | "numeric" | "direction" | "negation" | "proper_noun";
}

export const defaultGroundingGateOptions: GroundingGateOptions = {
  minSourceFactOverlap: 0.08,
  minInterpretationOverlap: 0.03,
  sameSourceFollowup: false
};

const stopwords = new Set([
  "a",
  "an",
  "and",
  "about",
  "after",
  "again",
  "also",
  "another",
  "because",
  "before",
  "being",
  "between",
  "could",
  "can",
  "every",
  "from",
  "have",
  "into",
  "its",
  "more",
  "should",
  "that",
  "their",
  "there",
  "this",
  "the",
  "then",
  "to",
  "of",
  "or",
  "when",
  "where",
  "which",
  "with",
  "would",
  "一个",
  "这个",
  "这些",
  "以及",
  "可以",
  "来源",
  "材料",
  "系统"
]);

const beyondSourcePattern = /^\s*\[(?:beyond source|超出来源)\]/i;

export function validateGrounding(
  post: KnowledgePost,
  registry: SourceRegistry,
  options: Partial<GroundingGateOptions> = {}
): GroundingCheck {
  const gateOptions = { ...defaultGroundingGateOptions, ...options };
  const citationIssues = validateCitationsAgainstRegistry(post.citations, registry);
  const claims = createSourceClaims(post);
  const checks = claims.map((claim) => validateClaimGrounding(claim, post, registry, post.citations, gateOptions));
  const checkIssues = checks.flatMap((check) => checkToIssues(check));
  const issues = [...citationIssues, ...checkIssues];

  return {
    postId: post.id,
    valid: !issues.some((issue) => issue.severity === "error"),
    checks,
    issues
  };
}

export function createSourceClaims(post: KnowledgePost): SourceClaim[] {
  const claims: SourceClaim[] = [
    createClaim(post, "$.summary", "source_fact", post.summary),
    createClaim(post, "$.thesis", "source_fact", post.thesis),
    createClaim(post, "$.shortBody", "source_fact", post.shortBody),
    createClaim(post, "$.keyTakeaway", "interpretation", post.keyTakeaway),
    createClaim(post, "$.title", "interpretation", post.title),
    createClaim(post, "$.hook", "interpretation", post.hook)
  ];

  for (const [index, block] of post.thread.entries()) {
    claims.push(
      createClaim(post, `$.thread[${index}].title`, "interpretation", block.title),
      createClaim(
        post,
        `$.thread[${index}].body`,
        threadKindToClaimKind(block.kind),
        block.body
      )
    );

    if (block.prompt) {
      claims.push(createClaim(post, `$.thread[${index}].prompt`, "question", block.prompt));
    }
  }

  for (const [index, edge] of post.graphEdges.entries()) {
    claims.push(createClaim(post, `$.graphEdges[${index}].evidence`, "source_fact", edge.evidence));
  }

  for (const [index, prompt] of post.reviewPrompts.entries()) {
    claims.push(
      createClaim(post, `$.reviewPrompts[${index}].prompt`, "question", prompt.prompt),
      createClaim(post, `$.reviewPrompts[${index}].answerHint`, "question", prompt.answerHint)
    );
  }

  for (const [index, concept] of post.concepts.entries()) {
    claims.push(createClaim(post, `$.concepts[${index}]`, "source_fact", concept));
  }

  claims.push(createClaim(post, "$.recommendedBecause", "interpretation", post.recommendedBecause));

  for (const [index, media] of (post.media ?? []).entries()) {
    claims.push(createClaim(post, `$.media[${index}].caption`, "source_fact", media.caption));
  }

  return claims.filter((claim) => claim.claim.trim().length > 0);
}

function validateCitationsAgainstRegistry(citations: Citation[] | undefined, registry: SourceRegistry): HarnessValidationIssue[] {
  const issues: HarnessValidationIssue[] = [];

  if (!citations?.length) {
    return [{ path: "$.citations", message: "post must include at least one source citation.", severity: "error" }];
  }

  citations.forEach((citation, index) => {
    const source = getRegistrySource(registry, citation.sourceId);
    const chunk = citation.chunkId ? getRegistryChunk(registry, citation.chunkId) : undefined;

    if (!source) {
      issues.push({
        path: `$.citations[${index}].sourceId`,
        message: "citation sourceId is not registered in SourceRegistry.",
        severity: "error"
      });
    }

    if (!citation.chunkId) {
      issues.push({
        path: `$.citations[${index}].chunkId`,
        message: "citation must include a chunkId so claims can be grounded at chunk level.",
        severity: "error"
      });
    } else if (!chunk) {
      issues.push({
        path: `$.citations[${index}].chunkId`,
        message: "citation chunkId is not registered in SourceRegistry.",
        severity: "error"
      });
    } else if (chunk.sourceId !== citation.sourceId) {
      issues.push({
        path: `$.citations[${index}].chunkId`,
        message: "citation chunkId must belong to the cited sourceId.",
        severity: "error"
      });
    }
  });

  return issues;
}

function validateClaimGrounding(
  claim: SourceClaim,
  post: KnowledgePost,
  registry: SourceRegistry,
  citations: Citation[] | undefined,
  options: GroundingGateOptions
): GroundingClaimCheck {
  const evidence = resolveEvidenceSpans(registry, citations);
  const evidenceChunkIds = evidence.map((span) => span.chunkId);
  const evidenceTexts = collectClaimEvidenceTexts(registry, citations, evidence);

  if (beyondSourcePattern.test(claim.claim)) {
    return buildClaimCheck(claim, "passed", evidenceChunkIds, 1, "Claim is explicitly marked as beyond-source context.");
  }

  if (claim.fieldPath.startsWith("$.concepts[")) {
    const supported = Boolean(
      evidence.some(
        (span) =>
          normalizedConceptAppearsInText(claim.claim, span.quote) &&
          isConceptPolarityCompatibleWithText(claim.claim, span.quote)
      )
    );

    return buildClaimCheck(
      claim,
      supported ? "passed" : options.sameSourceFollowup ? "warning" : "failed",
      evidenceChunkIds,
      supported ? 1 : 0,
      supported
        ? "Concept appears in cited evidence text."
        : "Concept does not appear in cited evidence text."
    );
  }

  if (claim.fieldPath.startsWith("$.media[")) {
    return validateMediaCaptionGrounding(claim, post, registry, citations, evidenceChunkIds);
  }

  if (!evidence.length) {
    return buildClaimCheck(
      claim,
      isHardGroundingClaim(claim) && !options.sameSourceFollowup ? "failed" : "warning",
      evidenceChunkIds,
      0,
      "No citation chunk could be resolved for this claim."
    );
  }

  const support = validateClaimSupport(claim.claim, evidenceTexts, getClaimSupportOptions(claim, options));

  if (support.supported) {
    return buildClaimCheck(
      claim,
      "passed",
      evidenceChunkIds,
      support.overlapScore,
      "Claim is grounded by registered source evidence."
    );
  }

  // Every unmarked user-visible claim is fail-closed. Interpretations are not
  // exempt from fabricated entities or unsupported factual continuations.
  const wouldFail = true;
  // Same-source follow-ups intentionally reuse a generated seed as their local
  // source. Their established policy is to retain weak support as a warning so
  // learning-loop expansion is down-ranked rather than hard-blocked.
  const status = wouldFail && !options.sameSourceFollowup ? "failed" : "warning";
  const reason =
    support.issueKind === "overlap" && claim.kind === "source_fact"
      ? `Source fact does not overlap enough with cited evidence. ${support.reason}`
      : support.issueKind === "overlap" && claim.kind === "interpretation"
        ? `Interpretation is grounded by citation, but lexical overlap is weak. ${support.reason}`
        : support.reason;

  return buildClaimCheck(claim, status, evidenceChunkIds, support.overlapScore, reason);
}

function buildClaimCheck(
  claim: SourceClaim,
  status: GroundingClaimCheck["status"],
  evidenceChunkIds: string[],
  overlapScore: number,
  reason: string
): GroundingClaimCheck {
  return {
    claimId: claim.id,
    fieldPath: claim.fieldPath,
    kind: claim.kind,
    status,
    evidenceChunkIds,
    overlapScore,
    reason
  };
}

function isHardGroundingClaim(claim: SourceClaim): boolean {
  return claim.kind === "source_fact" || claim.kind === "example" || claim.kind === "question";
}

function getClaimSupportOptions(
  claim: SourceClaim,
  options: GroundingGateOptions
): ClaimSupportOptions {
  if (claim.fieldPath === "$.recommendedBecause") {
    return {
      minOverlap: 1,
      minimumSharedTokens: 1,
      checkProperNouns: true,
      checkDirection: true,
      checkNegation: true
    };
  }

  if (claim.kind === "question") {
    return {
      minOverlap: 1,
      minimumSharedTokens: 1,
      checkProperNouns: true,
      checkDirection: true,
      checkNegation: true,
      // A question can still assert a false premise. If its recalled evidence
      // is negated, omitting that negation is a deterministic contradiction.
      requireClaimPolarityCue: false
    };
  }

  if (claim.kind === "interpretation") {
    return {
      minOverlap: 1,
      minimumSharedTokens: 1,
      checkProperNouns: true,
      requireClaimPolarityCue: true
    };
  }

  return {
    minOverlap: 1,
    minimumSharedTokens: 2,
    checkProperNouns: true
  };
}

function collectClaimEvidenceTexts(
  _registry: SourceRegistry,
  _citations: Citation[] | undefined,
  evidence: EvidenceSpan[]
): string[] {
  // Only resolved chunk text is factual support. Source titles, authors and
  // model-provided concept hints are discovery metadata, not evidence spans.
  return evidence.map((span) => span.quote.trim()).filter(Boolean);
}

function validateMediaCaptionGrounding(
  claim: SourceClaim,
  post: KnowledgePost,
  registry: SourceRegistry,
  citations: Citation[] | undefined,
  evidenceChunkIds: string[]
): GroundingClaimCheck {
  const indexMatch = claim.fieldPath.match(/^\$\.media\[(\d+)\]\.caption$/);
  const media = indexMatch ? post.media?.[Number(indexMatch[1])] : undefined;
  const asset = media ? registry.assets.find((candidate) => candidate.id === media.assetId && candidate.kind === "image") : undefined;
  const citedSourceIds = new Set((citations ?? []).map((citation) => citation.sourceId));
  const normalizedClaim = normalizeCaptionForComparison(claim.claim);
  const normalizedCaption = asset?.kind === "image" ? normalizeCaptionForComparison(asset.caption) : "";
  const supported = Boolean(
    asset &&
      citedSourceIds.has(asset.sourceId) &&
      normalizedClaim &&
      normalizedClaim === normalizedCaption
  );

  return buildClaimCheck(
    claim,
    supported ? "passed" : "failed",
    evidenceChunkIds,
    supported ? 1 : 0,
    supported
      ? "Media caption matches a cited registered image asset."
      : "Media caption must match a registered image asset belonging to a cited source."
  );
}

function resolveEvidenceSpans(registry: SourceRegistry, citations: Citation[] | undefined): EvidenceSpan[] {
  if (!citations?.length) {
    return [];
  }

  return citations.flatMap((citation) => {
    if (citation.chunkId) {
      const chunk = getRegistryChunk(registry, citation.chunkId);

      return chunk && chunk.sourceId === citation.sourceId
        ? [
            {
              sourceId: chunk.sourceId,
              chunkId: chunk.id,
              quote: chunk.content,
              startTimeSeconds: chunk.startTimeSeconds,
              endTimeSeconds: chunk.endTimeSeconds
            }
          ]
        : [];
    }

    return registry.chunks
      .filter((chunk) => chunk.sourceId === citation.sourceId)
      .map((chunk) => ({
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        quote: chunk.content,
        startTimeSeconds: chunk.startTimeSeconds,
        endTimeSeconds: chunk.endTimeSeconds
      }));
  });
}

function checkToIssues(check: GroundingClaimCheck): HarnessValidationIssue[] {
  if (check.status === "passed") {
    return [];
  }

  return [
    {
      path: check.fieldPath,
      message: check.reason,
      severity: check.status === "failed" ? "error" : "warning"
    }
  ];
}

function createClaim(post: KnowledgePost, fieldPath: string, kind: SourceClaimKind, claim: string): SourceClaim {
  return {
    id: `${post.id}-${fieldPath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`,
    postId: post.id,
    fieldPath,
    kind,
    claim,
    evidence: []
  };
}

function threadKindToClaimKind(kind: KnowledgePost["thread"][number]["kind"]): SourceClaimKind {
  if (kind === "example") {
    return "example";
  }

  if (kind === "quiz") {
    return "question";
  }

  return "interpretation";
}

export function validateClaimSupport(
  claim: string,
  evidenceTexts: readonly string[],
  options: ClaimSupportOptions = {}
): ClaimSupportResult {
  const evidence = evidenceTexts.map((text) => text.trim()).filter(Boolean);
  const exactSubstring = evidence.some((text) => hasExactLexicalSupport(claim, text));

  if (beyondSourcePattern.test(claim) && options.allowBeyondSource === false) {
    return {
      supported: false,
      overlapScore: 0,
      reason: "Beyond-source markers are not allowed in this grounded output.",
      issueKind: "overlap"
    };
  }

  if (!evidence.length || beyondSourcePattern.test(claim)) {
    return validateSingleClaimSupport(claim, evidence, options);
  }

  if (exactSubstring) {
    return {
      supported: true,
      overlapScore: 1,
      reason: "Normalized claim text appears verbatim in cited evidence.",
      issueKind: "supported"
    };
  }

  const claimClauses = splitSupportClauses(claim);
  const evidenceClauses = evidence.flatMap(splitSupportClauses);

  if (claimClauses.length <= 1) {
    return validateSingleClaimSupport(claim, evidenceClauses.length ? evidenceClauses : evidence, options);
  }

  let lowestOverlap = 1;

  for (const clause of claimClauses) {
    const support = validateSingleClaimSupport(clause, evidenceClauses, options);
    lowestOverlap = Math.min(lowestOverlap, support.overlapScore);

    if (!support.supported) {
      return {
        ...support,
        reason: `Unsupported claim clause "${clause}": ${support.reason}`
      };
    }
  }

  return {
    supported: true,
    overlapScore: lowestOverlap,
    reason: "Every claim clause passes deterministic lexical support checks.",
    issueKind: "supported"
  };
}

function validateSingleClaimSupport(
  claim: string,
  evidenceTexts: readonly string[],
  options: ClaimSupportOptions
): ClaimSupportResult {
  const evidence = evidenceTexts.map((text) => text.trim()).filter(Boolean);

  if (!evidence.length) {
    return {
      supported: false,
      overlapScore: 0,
      reason: "No evidence text is available for this claim.",
      issueKind: "missing_evidence"
    };
  }

  if (beyondSourcePattern.test(claim) && options.allowBeyondSource !== false) {
    return {
      supported: true,
      overlapScore: 1,
      reason: "Claim is explicitly marked as beyond-source context.",
      issueKind: "supported"
    };
  }

  const candidates = evidence.flatMap(splitEvidenceCandidates);
  const bestEvidence = selectBestEvidenceCandidate(claim, candidates);
  const overlapScore = bestEvidence ? calculateOverlapScore(claim, bestEvidence) : 0;
  const localEvidence = bestEvidence ? [bestEvidence] : evidence;
  const claimTokens = Array.from(new Set(tokenize(claim)));
  const evidenceTokens = new Set(tokenize(bestEvidence ?? ""));
  const sharedTokenCount = claimTokens.filter((token) => evidenceTokens.has(token)).length;
  const orderedLexicalSupport = bestEvidence ? hasOrderedLexicalSupport(claim, bestEvidence) : false;
  const minimumSharedTokens = options.minimumSharedTokens ?? Math.min(2, claimTokens.length);
  const candidateWasRecalled = sharedTokenCount >= Math.max(1, minimumSharedTokens);
  const claimHasPolarityCue =
    hasNegation(claim) || collectDirections(claim).size > 0 || extractNumericTokens(claim).length > 0;
  const ungroundedNumbers = findUngroundedNumericTokens(claim, localEvidence);

  if (ungroundedNumbers.length) {
    return {
      supported: false,
      overlapScore,
      reason: `Claim contains numbers that do not appear in cited evidence with the same sign, unit, or percentage marker: ${ungroundedNumbers.join(", ")}.`,
      issueKind: "numeric"
    };
  }

  if ((options.checkDirection ?? true) && bestEvidence && candidateWasRecalled) {
    const directionMismatch = findDirectionMismatch(claim, bestEvidence);

    if (directionMismatch) {
      return {
        supported: false,
        overlapScore,
        reason: directionMismatch,
        issueKind: "direction"
      };
    }
  }

  if ((options.checkNegation ?? true) && bestEvidence && hasScopedNegationOfClaim(claim, bestEvidence)) {
    return {
      supported: false,
      overlapScore,
      reason: "Claim is explicitly refuted by the closest cited evidence.",
      issueKind: "negation"
    };
  }

  if (
    (options.checkNegation ?? true) &&
    bestEvidence &&
    candidateWasRecalled &&
    (!(options.requireClaimPolarityCue ?? false) || claimHasPolarityCue) &&
    hasNegationMismatch(claim, bestEvidence)
  ) {
    return {
      supported: false,
      overlapScore,
      reason: "Claim negation does not match the closest cited evidence.",
      issueKind: "negation"
    };
  }

  if (options.checkProperNouns) {
    // Entity existence is scoped to the cited evidence set; unlike numbers and
    // polarity, the same proper noun need not repeat in every local clause.
    const unsupportedProperNouns = findUnsupportedProperNouns(claim, evidence);

    if (unsupportedProperNouns.length) {
      return {
        supported: false,
        overlapScore,
        reason: `Claim contains proper nouns that do not appear in cited evidence: ${unsupportedProperNouns.join(", ")}.`,
        issueKind: "proper_noun"
      };
    }
  }

  const exactSubstring = evidence.some((text) => hasExactLexicalSupport(claim, text));

  if (exactSubstring) {
    return {
      supported: true,
      overlapScore: 1,
      reason: "Normalized claim text appears verbatim in cited evidence.",
      issueKind: "supported"
    };
  }

  // Overlap chooses the closest evidence candidate; it is never sufficient for
  // acceptance. Without semantic NLU, fail closed unless every meaningful
  // claim token is present in that local candidate.
  const minOverlap = Math.max(1, options.minOverlap ?? 1);

  if (overlapScore < minOverlap || sharedTokenCount < minimumSharedTokens || !orderedLexicalSupport) {
    return {
      supported: false,
      overlapScore,
      reason: `Claim does not preserve complete ordered lexical support in the closest cited evidence (${sharedTokenCount} shared anchor(s)).`,
      issueKind: "overlap"
    };
  }

  return {
    supported: true,
    overlapScore,
    reason: "Claim passes deterministic lexical support checks.",
    issueKind: "supported"
  };
}

function splitSupportClauses(value: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(value))
    .flatMap((entry) => expandSharedPredicateCoordination(entry.segment))
    .flatMap((entry) =>
      entry.split(
        /[;；\n—–()[\]（）【】]+|\s+-\s+|[:：](?!\d)|\b(?:and|but|while|whereas|which|who|because|as|so|therefore|thus|hence)\b|(?:并且|而且|但是|同时|因为|所以|因此|从而|且|却)/giu
      )
    )
    .flatMap(splitOnNonNumericCommas)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function expandSharedPredicateCoordination(value: string): string[] {
  const directionPattern = /\b(?:increase[ds]?|increasing|rise[sn]?|rose|risen|rising|grow(?:s|th|ing)?|grew|higher|above|decrease[ds]?|decreasing|fall(?:s|en|ing)?|fell|drop(?:s|ped|ping)?|lower|below|reduce[ds]?|reducing|decline[ds]?)\b|增加|增长|增幅|上升|提高|提升|上调|高于|超过|减少|下降|降低|减幅|下调|衰减|低于|下跌/iu;
  const direction = directionPattern.exec(value);

  if (direction?.index === undefined || !extractNumericTokens(value.slice(direction.index)).length) {
    return [value];
  }

  const subjectPrefix = value.slice(0, direction.index).trim();
  const predicate = value.slice(direction.index).trim();
  const coordinatedSubjects = subjectPrefix.match(/^(.+?)\s+(?:and|以及|和|与)\s+(.+)$/iu);

  if (!coordinatedSubjects) {
    return [value];
  }

  const left = coordinatedSubjects[1]?.trim() ?? "";
  const right = coordinatedSubjects[2]?.trim() ?? "";

  if (
    !left ||
    !right ||
    extractNumericTokens(left).length ||
    extractNumericTokens(right).length ||
    collectDirections(left).size ||
    collectDirections(right).size
  ) {
    return [value];
  }

  return [`${left} ${predicate}`, `${right} ${predicate}`];
}

function splitOnNonNumericCommas(value: string): string[] {
  const clauses: string[] = [];
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "," && value[index] !== "，") {
      continue;
    }

    const previous = value[index - 1] ?? "";
    const following = value.slice(index + 1);
    const thousandsGroup = /^\d{3}(?!\d)/.test(following);

    if (/\d/.test(previous) && thousandsGroup) {
      continue;
    }

    clauses.push(value.slice(start, index));
    start = index + 1;
  }

  clauses.push(value.slice(start));
  return clauses;
}

function findUngroundedNumericTokens(claim: string, evidence: readonly string[]): string[] {
  const claimNumbers = extractNumericTokens(claim);

  if (!claimNumbers.length) {
    return [];
  }

  const evidenceNumbers = new Set(evidence.flatMap(extractNumericTokens));

  return Array.from(new Set(claimNumbers.filter((token) => !evidenceNumbers.has(token))));
}

function extractNumericTokens(value: string): string[] {
  const unit = [
    "%",
    "％",
    "°\\s*[cfk]",
    "degrees?\\s*(?:celsius|fahrenheit|kelvin)",
    "celsius|fahrenheit|kelvin",
    "percent(?:age)?",
    "points?",
    "years?",
    "months?",
    "days?",
    "hours?",
    "minutes?",
    "seconds?",
    "milliseconds?",
    "steps?",
    "cases?",
    "items?",
    "times?",
    "people",
    "users?",
    "(?:tokens?|requests?|items?|bytes?|m|km|cm|mm)\\s*\\/\\s*(?:s|sec(?:ond)?s?)",
    "(?:meters?|kilometers?)\\s+per\\s+seconds?",
    "tokens?",
    "bytes?",
    "kib|mib|gib|tib|kb|mb|gb|tb",
    "hz|khz|mhz|ghz|ms|km|cm|mm|kg",
    "个百分点|百分比|年|个月|月|日|天|小时|分钟|秒|毫秒|步|步骤|个|项|次|人|倍|元|美元|千米|公里|米|厘米|毫米|千克|公斤|克"
  ].join("|");
  const currency = "(?:[$€£¥￥]|usd|eur|gbp|jpy|cny|rmb)";
  const comparator = "(?:no\\s+(?:more|less)\\s+than|at\\s+(?:least|most)|more\\s+than|less\\s+than|up\\s+to|over|under|>=|<=|=>|=<|[<>≤≥~≈])";
  const semanticPrefix = `(?:${currency}|${comparator}|[+\\-−])`;
  const pattern = new RegExp(
    `(?:${semanticPrefix}\\s*)*(?:(?:\\d{1,3}(?:,\\d{3})+)|\\d+|\\.\\d+)(?:\\.\\d+)?(?:\\s*(?:${unit}|${currency}))?`,
    "giu"
  );
  const matches = value.normalize("NFKC").match(pattern) ?? [];

  return matches.map((token) => token.toLowerCase().replace(/[\s,]+/g, "").replace(/−/g, "-"));
}

function splitEvidenceCandidates(value: string): string[] {
  return Array.from(new Set(splitSupportClauses(value)));
}

function selectBestEvidenceCandidate(claim: string, evidence: readonly string[]): string | undefined {
  const exact = evidence.find((candidate) => hasExactLexicalSupport(claim, candidate));

  if (exact) {
    return exact;
  }

  return evidence.reduce<string | undefined>((best, candidate) => {
    if (!best) {
      return candidate;
    }

    return calculateOverlapScore(claim, candidate) > calculateOverlapScore(claim, best) ? candidate : best;
  }, undefined);
}

function findDirectionMismatch(claim: string, evidence: string): string | undefined {
  const claimDirections = collectDirections(claim);

  if (!claimDirections.size) {
    return undefined;
  }

  const evidenceDirections = collectDirections(evidence);

  if (claimDirections.has("increase") && !evidenceDirections.has("increase")) {
    return "Claim uses an increase/above direction that does not match the closest cited evidence.";
  }

  if (claimDirections.has("decrease") && !evidenceDirections.has("decrease")) {
    return "Claim uses a decrease/below direction that does not match the closest cited evidence.";
  }

  return undefined;
}

function collectDirections(value: string): Set<"increase" | "decrease"> {
  const normalized = value.normalize("NFKC").toLowerCase();
  const directions = new Set<"increase" | "decrease">();
  const increasePattern = /\b(?:increase[ds]?|increasing|rise[sn]?|rose|risen|rising|grow(?:s|th|ing)?|grew|higher|above)\b|增加|增长|增幅|上升|提高|提升|上调|高于|超过/u;
  const decreasePattern = /\b(?:decrease[ds]?|decreasing|fall(?:s|en|ing)?|fell|drop(?:s|ped|ping)?|lower|below|reduce[ds]?|reducing|decline[ds]?)\b|减少|下降|降低|减幅|下调|衰减|低于|下跌/u;

  if (increasePattern.test(normalized)) {
    directions.add("increase");
  }

  if (decreasePattern.test(normalized)) {
    directions.add("decrease");
  }

  return directions;
}

function hasNegation(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();

  return /\b(?:no|not|never|without|cannot|can't|doesn't|didn't|isn't|aren't|wasn't|weren't|won't)\b|不|未|并非|并不|没有|无法/u.test(normalized);
}

function hasNegationMismatch(claim: string, evidence: string): boolean {
  const claimIsNegated = hasNegation(claim);
  const evidenceIsNegated = hasNegation(evidence);

  if (hasScopedNegationOfClaim(claim, evidence)) {
    return true;
  }

  if (claimIsNegated === evidenceIsNegated) {
    return false;
  }

  if (claimIsNegated) {
    // Adding a negation to positive evidence is always a deterministic reversal.
    return true;
  }

  // Omitting a source negation is a contradiction only when the claim repeats
  // the lexically negated predicate. This rejects "does not reduce" ->
  // "reduce" while allowing neutral prompts such as "What is the lesson?".
  const claimPredicateForms = new Set(tokenize(claim).flatMap(collectSimplePredicateForms));

  return collectNegatedAnchors(evidence).some((anchor) =>
    collectSimplePredicateForms(anchor).some((form) => claimPredicateForms.has(form))
  );
}

function collectSimplePredicateForms(token: string): string[] {
  const forms = new Set([token]);

  if (token.length > 4 && token.endsWith("s")) {
    forms.add(token.slice(0, -1));
  }

  if (token.length > 5 && token.endsWith("es")) {
    forms.add(token.slice(0, -2));
  }

  if (token.length > 5 && token.endsWith("ed")) {
    forms.add(token.slice(0, -1));
    forms.add(token.slice(0, -2));
  }

  if (token.length > 6 && token.endsWith("ing")) {
    const stem = token.slice(0, -3);
    forms.add(stem);
    forms.add(`${stem}e`);
  }

  return Array.from(forms);
}

function collectNegatedAnchors(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const anchors: string[] = [];
  const englishPattern = /\b(?:no|not|never|without|cannot|can't|doesn't|didn't|isn't|aren't|wasn't|weren't|won't)\b\s+([\p{L}]+)(?:\s+([\p{L}]+))?/gu;
  const negationModifiers = new Set(["always", "actually", "ever", "merely", "necessarily", "really", "simply"]);

  for (const match of normalized.matchAll(englishPattern)) {
    const candidates = [match[1], match[2]].filter((candidate): candidate is string => Boolean(candidate));
    const predicate = candidates.find((candidate) => !negationModifiers.has(candidate));

    if (predicate) {
      anchors.push(...tokenize(predicate).slice(0, 1));
    }
  }

  const chinesePattern = /(?:并非|并不|没有|无法|不|未)([\p{Script=Han}]{1,12})/gu;

  for (const match of normalized.matchAll(chinesePattern)) {
    anchors.push(...tokenize(match[1] ?? "").slice(0, 1));
  }

  return Array.from(new Set(anchors));
}

function findUnsupportedProperNouns(claim: string, evidence: readonly string[]): string[] {
  const ignored = new Set([
    "a",
    "an",
    "the",
    "this",
    "that",
    "these",
    "those",
    "if",
    "what",
    "how",
    "why",
    "when",
    "where",
    "source",
    "card",
    "read",
    "suppose",
    "imagine",
    "look",
    "answer",
    "explain",
    "name",
    "based",
    "evidence",
    "user",
    "users",
    "you",
    "your",
    "we",
    "smoke",
    "test"
  ]);
  const candidates = claim.match(/\b(?:[A-Z]{2,}[A-Z0-9]*|[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)\b/g) ?? [];
  const normalizedEvidence = evidence.map(normalizeForComparison);

  return Array.from(
    new Set(
      candidates.filter((candidate) => {
        const normalized = normalizeForComparison(candidate);

        return normalized && !ignored.has(normalized) && !normalizedEvidence.some((text) => text.includes(normalized));
      })
    )
  );
}

function calculateOverlapScore(claim: string, evidence: string): number {
  if (hasExactLexicalSupport(claim, evidence)) {
    return 1;
  }

  const claimTokens = tokenize(claim);
  const evidenceTokens = new Set(tokenize(evidence));

  if (!claimTokens.length || !evidenceTokens.size) {
    return 0;
  }

  const overlap = claimTokens.filter((token) => evidenceTokens.has(token)).length;

  return overlap / claimTokens.length;
}

function hasOrderedLexicalSupport(claim: string, evidence: string): boolean {
  const claimTokens = tokenize(claim);
  const evidenceTokens = tokenize(evidence);
  let evidenceIndex = 0;

  for (const claimToken of claimTokens) {
    const nextIndex = evidenceTokens.indexOf(claimToken, evidenceIndex);

    if (nextIndex < 0) {
      return false;
    }

    evidenceIndex = nextIndex + 1;
  }

  return claimTokens.length > 0;
}

function tokenize(value: string): string[] {
  const normalized = value.normalize("NFKC");
  const technicalTokens: string[] = [];
  const markerToToken = new Map<string, string>();
  const protectedValue = normalized.replace(
    /\b(?:[A-Za-z][A-Za-z0-9]*(?:\+\+|#)|[A-Za-z0-9]+(?:[/+\-][A-Za-z0-9]+)+)/g,
    (token) => {
      const marker = `AITIMELINETECHTOKEN${technicalTokens.length}`;
      technicalTokens.push(token);
      markerToToken.set(marker.toLowerCase(), token.toLowerCase());
      return ` ${marker} `;
    }
  );

  return Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(protectedValue))
    .filter((entry) => entry.isWordLike)
    .map((entry) => entry.segment.trim())
    .filter(
      (token) =>
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token) ||
        token.length > 1 ||
        isShortSignalToken(token) ||
        /^\d+(?:\.\d+)?$/.test(token)
    )
    .map((token) => markerToToken.get(token.toLowerCase()) ?? token.toLowerCase())
    .filter((token) => !stopwords.has(token));
}

function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function normalizeForExactSupport(value: string): string {
  // Strip layout punctuation while retaining numeric semantics. This keeps the
  // CJK fast path (where spacing and punctuation commonly vary) without making
  // "$5" equal "€5" or ">=5%" equal "<=5%".
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$€£¥￥%+#\-−<>≤≥~≈°/]+/gu, "");
}

function hasExactLexicalSupport(claim: string, evidence: string): boolean {
  const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(claim);
  const hasLatin = /\p{Script=Latin}/u.test(claim);

  if (hasCjk && !hasLatin) {
    const normalizedClaim = normalizeForExactSupport(claim);
    const normalizedEvidence = normalizeForExactSupport(evidence);

    if (!normalizedClaim) {
      return false;
    }

    let index = normalizedEvidence.indexOf(normalizedClaim);

    while (index >= 0) {
      const suffix = normalizedEvidence.slice(index + normalizedClaim.length);

      if (
        !hasScopedNegationPrefix(normalizedEvidence.slice(0, index)) &&
        !hasScopedNegationSuffix(suffix)
      ) {
        return true;
      }

      index = normalizedEvidence.indexOf(normalizedClaim, index + 1);
    }

    return false;
  }

  const normalizedClaim = normalizeForBoundedExact(claim);
  const normalizedEvidence = normalizeForBoundedExact(evidence);

  if (!normalizedClaim) {
    return false;
  }

  let index = normalizedEvidence.indexOf(normalizedClaim);

  while (index >= 0) {
    const before = normalizedEvidence[index - 1] ?? "";
    const after = normalizedEvidence[index + normalizedClaim.length] ?? "";
    const startsWithWord = /^[\p{L}\p{N}]/u.test(normalizedClaim);
    const endsWithWord = /[\p{L}\p{N}]$/u.test(normalizedClaim);
    const leftBoundary = !startsWithWord || !/[\p{L}\p{N}]/u.test(before);
    const rightBoundary = !endsWithWord || !/[\p{L}\p{N}]/u.test(after);

    const suffix = normalizedEvidence.slice(index + normalizedClaim.length);

    if (
      leftBoundary &&
      rightBoundary &&
      !hasScopedNegationPrefix(normalizedEvidence.slice(0, index)) &&
      !hasScopedNegationSuffix(suffix)
    ) {
      return true;
    }

    index = normalizedEvidence.indexOf(normalizedClaim, index + 1);
  }

  return false;
}

function hasScopedNegationOfClaim(claim: string, evidence: string): boolean {
  const hasCjkOnly =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(claim) &&
    !/\p{Script=Latin}/u.test(claim);
  const normalizedClaim = hasCjkOnly
    ? normalizeForExactSupport(claim)
    : normalizeForBoundedExact(claim);
  const normalizedEvidence = hasCjkOnly
    ? normalizeForExactSupport(evidence)
    : normalizeForBoundedExact(evidence);

  if (!normalizedClaim) {
    return false;
  }

  let index = normalizedEvidence.indexOf(normalizedClaim);

  while (index >= 0) {
    const suffix = normalizedEvidence.slice(index + normalizedClaim.length);

    if (
      hasScopedNegationPrefix(normalizedEvidence.slice(0, index)) ||
      hasScopedNegationSuffix(suffix)
    ) {
      return true;
    }

    index = normalizedEvidence.indexOf(normalizedClaim, index + 1);
  }

  return false;
}

function hasScopedNegationPrefix(prefix: string): boolean {
  return /(?:\bnot\s+true\s+that|\bnot\s+the\s+case\s+that|\bdoes\s+not\s+mean\s+that|\bno\s+evidence\s+(?:shows\s+that|that)|\bcannot\s+conclude\s+that)\s*$|(?:并不是说|不是说|并非|不代表|未证明|没有证据(?:表明|说明)|不能说明)$/iu.test(
    prefix
  );
}

function hasScopedNegationSuffix(suffix: string): boolean {
  return /^\s*(?:is\s+not\s+true|is\s+false|is\s+incorrect|is\s+not\s+the\s+case)\b|^(?:并不属实|不属实|是错误的|并非事实|不成立)/iu.test(
    suffix
  );
}

function normalizeForBoundedExact(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$€£¥￥%+#\-−<>≤≥~≈°/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedConceptAppearsInText(concept: string, evidence: string): boolean {
  const normalizedConcept = normalizeForExactSupport(concept);

  if (!normalizedConcept) {
    return false;
  }

  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(concept) ||
    /[$€£¥￥%+#\-−<>≤≥~≈°/]/u.test(concept)
  ) {
    return normalizeForExactSupport(evidence).includes(normalizedConcept);
  }

  const conceptWords = segmentComparableWords(concept);
  const evidenceWords = segmentComparableWords(evidence);

  if (!conceptWords.length || conceptWords.length > evidenceWords.length) {
    return false;
  }

  return evidenceWords.some((_word, index) =>
    conceptWords.every((conceptWord, offset) => evidenceWords[index + offset] === conceptWord)
  );
}

export function isConceptPolarityCompatibleWithText(concept: string, evidence: string): boolean {
  return !hasNegationMismatch(concept, evidence);
}

function segmentComparableWords(value: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(value.normalize("NFKC")))
    .filter((entry) => entry.isWordLike)
    .map((entry) => entry.segment.toLowerCase());
}

function normalizeCaptionForComparison(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// Keep short all-caps tokens ("AI", "RAG", "LLM") that carry meaning; drop other short words.
function isShortSignalToken(token: string): boolean {
  return token.length >= 2 && /^[A-Z0-9]+$/.test(token) && /[A-Z]/.test(token);
}
