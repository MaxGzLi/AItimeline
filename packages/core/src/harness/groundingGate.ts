import { getRegistrySource, resolveCitedChunk } from "../source/sourceRegistry.js";
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
  /**
   * Final-gate strictness for prose that survives the numeric/direction/
   * negation/proper-noun checks (docs/specs/2026-08-03-anchor-grounding.md):
   * - "ordered" (default): every meaningful claim token must appear in order
   *   in the closest evidence candidate — near-extraction only. Kept for
   *   near-extractive surfaces with deterministic fallbacks (deep-read
   *   paragraphs, concept briefs, grounded Q&A).
   * - "anchors": only fact anchors (Latin terms inside CJK prose, technical
   *   symbol tokens) must be traceable; narrative wording is free. Used by the
   *   knowledge-card gate, whose hook/metaphor/thread genre is paraphrase.
   */
  supportMode?: "ordered" | "anchors";
  /**
   * Quiz bodies enumerate deliberately wrong choices ("A. 增加容量；B. 减少
   * 容量"). With this on, a clause that starts with an option marker (A.–E.)
   * skips the direction and negation comparison — offering a choice asserts
   * nothing about the source. Entities, numbers and Latin anchors inside the
   * option are still checked. Enabled only for question-kind claims; the answer
   * and its rationale are ordinary clauses and stay fully checked.
   */
  exemptChoiceOptionPolarity?: boolean;
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
  const threadCitationIssues = validateThreadCitationQuotes(post, registry);
  const claims = createSourceClaims(post);
  const checks = claims.map((claim) =>
    validateClaimGrounding(claim, post, registry, resolveClaimCitations(post, claim.fieldPath), gateOptions)
  );
  const checkIssues = checks.flatMap((check) => checkToIssues(check));
  const issues = [...citationIssues, ...threadCitationIssues, ...checkIssues];

  return {
    postId: post.id,
    valid: !issues.some((issue) => issue.severity === "error"),
    checks,
    issues
  };
}

// A thread block carries its own citations, and they were never used as evidence:
// every block was graded against the card-level list alone, so a block that
// correctly cited the chunk naming its entity still failed on that entity. A
// block's evidence is the card's citations plus its own — the card's citations
// carry the shared subject, the block's carry what that block adds.
function resolveClaimCitations(post: KnowledgePost, fieldPath: string): Citation[] | undefined {
  const blockIndex = Number(fieldPath.match(/^\$\.thread\[(\d+)\]\./)?.[1]);
  const blockCitations = Number.isInteger(blockIndex) ? post.thread[blockIndex]?.citations : undefined;

  if (!blockCitations?.length) {
    return post.citations;
  }

  const cited = new Set((post.citations ?? []).map((citation) => `${citation.sourceId}::${citation.chunkId}`));

  return [
    ...(post.citations ?? []),
    ...blockCitations.filter((citation) => !cited.has(`${citation.sourceId}::${citation.chunkId}`))
  ];
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
    const chunk = resolveCitedChunk(registry, citation);

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

function validateThreadCitationQuotes(
  post: KnowledgePost,
  registry: SourceRegistry
): HarnessValidationIssue[] {
  const issues: HarnessValidationIssue[] = [];

  post.thread.forEach((block, blockIndex) => {
    (block.citations ?? []).forEach((citation, citationIndex) => {
      if (!citation.quote) {
        return;
      }

      const chunk = resolveCitedChunk(registry, citation);

      if (!chunk || citationQuoteAppearsInChunk(citation.quote, chunk.content)) {
        return;
      }

      issues.push({
        path: `$.thread[${blockIndex}].citations[${citationIndex}].quote`,
        message: "citation quote does not appear in its registered source chunk.",
        severity: "error"
      });
    });
  });

  return issues;
}

function citationQuoteAppearsInChunk(quote: string, content: string): boolean {
  const normalizedQuote = normalizeCitationQuote(quote).replace(/(?:\.\.\.|…)$/u, "").trimEnd();
  const normalizedContent = normalizeCitationQuote(content);

  return normalizedQuote.length > 0 && normalizedContent.includes(normalizedQuote);
}

function normalizeCitationQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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
  // Every card field opts into anchor-style support: the card genre
  // (hook/metaphor/thread) is paraphrase by design, so only fact anchors are
  // held to verbatim traceability (docs/specs/2026-08-03-anchor-grounding.md).
  if (claim.fieldPath === "$.recommendedBecause") {
    return {
      minOverlap: 1,
      minimumSharedTokens: 1,
      checkProperNouns: true,
      checkDirection: true,
      checkNegation: true,
      supportMode: "anchors"
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
      requireClaimPolarityCue: false,
      supportMode: "anchors",
      exemptChoiceOptionPolarity: true
    };
  }

  if (claim.kind === "interpretation") {
    return {
      minOverlap: 1,
      minimumSharedTokens: 1,
      checkProperNouns: true,
      requireClaimPolarityCue: true,
      supportMode: "anchors"
    };
  }

  return {
    minOverlap: 1,
    minimumSharedTokens: 2,
    checkProperNouns: true,
    supportMode: "anchors"
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
      const chunk = resolveCitedChunk(registry, citation);

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
  // Clause splitting severs polarity scopes that span clauses: an option marker
  // from its text ("A. 增加容量" → "A." + "增加容量"), and a hypothesis from its
  // consequent ("如果…，但发现内存不够" — the second clause no longer starts with
  // 如果). Both are recovered here by locating each clause in the (glued)
  // original: a clause preceded by an option marker, or inside a sentence that
  // opened with a hypothesis marker, skips direction/negation comparison.
  // Entities, numbers and anchors in it are still checked.
  const glued = glueShortParentheticals(claim);
  let cursor = 0;
  let hypotheticalUntil = -1;

  for (const clause of claimClauses) {
    let clauseOptions = options;
    const at = glued.indexOf(clause, cursor);

    if (at >= 0) {
      cursor = at + clause.length;

      if (isHypotheticalClause(clause)) {
        const terminator = glued.slice(at).search(/[。．！？!?]|\.(?=\s|$)/u);
        hypotheticalUntil = terminator >= 0 ? at + terminator : glued.length;
      }

      const isOption =
        (options.exemptChoiceOptionPolarity ?? false) &&
        choiceOptionMarkerBefore.test(glued.slice(Math.max(0, at - 8), at));

      if (isOption || at < hypotheticalUntil) {
        clauseOptions = { ...options, checkDirection: false, checkNegation: false };
      }
    }

    const support = validateSingleClaimSupport(clause, evidenceClauses, clauseOptions);
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
  // Clause-local number checking assumes the closest candidate really is the
  // aligned sentence. Across scripts there is nothing to align on — a Chinese
  // clause shares at most a Latin term with its English source sentence — so the
  // selected clause is close to arbitrary and locality rejects true restatements
  // ("其中 2 个共享处理所有 token" vs "Two are shared and process every token").
  // When claim and candidate are written in different scripts, numbers fall back
  // to the whole cited evidence. Accepted cost: a cross-language claim can pair a
  // number with the wrong subject inside the same citation; same-script claims
  // keep the strict clause-local rule that blocks borrowed numbers.
  const numericEvidence =
    bestEvidence && !isCrossScriptPair(claim, bestEvidence) ? [bestEvidence] : evidence;
  const claimTokens = Array.from(new Set(tokenize(claim)));
  const evidenceTokens = new Set(tokenize(bestEvidence ?? ""));
  const sharedTokenCount = claimTokens.filter((token) => evidenceTokens.has(token)).length;
  const minimumSharedTokens = options.minimumSharedTokens ?? Math.min(2, claimTokens.length);
  const candidateWasRecalled = sharedTokenCount >= Math.max(1, minimumSharedTokens);
  const claimHasPolarityCue =
    hasNegation(claim) || collectDirections(claim).size > 0 || extractNumericTokens(claim).length > 0;
  const isChoiceOption = (options.exemptChoiceOptionPolarity ?? false) && choiceOptionPattern.test(claim);
  const ungroundedNumbers = findUngroundedNumericTokens(claim, numericEvidence);

  if (ungroundedNumbers.length) {
    return {
      supported: false,
      overlapScore,
      reason: `Claim contains numbers that do not appear in cited evidence with the same sign, unit, or percentage marker: ${ungroundedNumbers.join(", ")}.`,
      issueKind: "numeric"
    };
  }

  if (
    (options.checkDirection ?? true) &&
    !isChoiceOption &&
    !isHypotheticalClause(claim) &&
    bestEvidence &&
    candidateWasRecalled
  ) {
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

  if ((options.checkNegation ?? true) && !isChoiceOption && bestEvidence && hasScopedNegationOfClaim(claim, bestEvidence)) {
    return {
      supported: false,
      overlapScore,
      reason: "Claim is explicitly refuted by the closest cited evidence.",
      issueKind: "negation"
    };
  }

  if (
    (options.checkNegation ?? true) &&
    !isChoiceOption &&
    bestEvidence &&
    candidateWasRecalled &&
    !isHypotheticalClause(claim) &&
    (!(options.requireClaimPolarityCue ?? false) || claimHasPolarityCue) &&
    (isCrossScriptPair(claim, bestEvidence)
      ? // Across scripts the overlap-selected clause is not the aligned sentence
        // (the negative word can sit in a neighbouring clause: "…avoids that
        // redundant work"), so polarity is judged against the citation as a
        // whole — a negated claim is rejected only when nothing in the cited
        // evidence is negative at all. Weaker than the same-script check by
        // design; reversals inside otherwise-negative evidence get through.
        hasNegation(claim) && !evidence.some((text) => hasNegation(text))
      : hasNegationMismatch(claim, bestEvidence))
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

  if ((options.supportMode ?? "ordered") === "anchors") {
    // Anchor-style support (docs/specs/2026-08-03-anchor-grounding.md): numbers,
    // direction, negation and proper nouns are enforced above; here every Latin
    // technical term embedded in CJK prose must appear in the cited evidence, with
    // the same regularized word-form tolerance concepts get. Narrative wording is
    // the model's own voice and is deliberately not order-checked any more —
    // still no semantics, no synonym tables, no model.
    const unsupportedAnchors = findUnsupportedClaimAnchors(claim, evidence, options);

    if (unsupportedAnchors.length) {
      return {
        supported: false,
        overlapScore,
        reason: `Claim contains technical terms that do not appear in cited evidence: ${unsupportedAnchors.join(", ")}.`,
        issueKind: "overlap"
      };
    }

    return {
      supported: true,
      overlapScore,
      reason: "Claim anchors (numbers, polarity, entities, technical terms) are grounded in cited evidence.",
      issueKind: "supported"
    };
  }

  // Overlap chooses the closest evidence candidate; it is never sufficient for
  // acceptance. Without semantic NLU, fail closed unless every meaningful
  // claim token is present in that local candidate.
  const minOverlap = Math.max(1, options.minOverlap ?? 1);
  const orderedLexicalSupport = bestEvidence ? hasOrderedLexicalSupport(claim, bestEvidence) : false;

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

// A short single-token parenthetical — a number ("GPT-2 (2019)", "growth
// (22,580x)") or a notation fragment ("O(N)", "O(N²)") — is an appositive
// label for its host, not an independent claim; keep it attached. Worded
// parentheticals (they contain spaces) still split so factual continuations
// need their own support.
function glueShortParentheticals(value: string): string {
  return value.replace(/[(（]\s*([^\s()（）]{1,10})\s*[)）]/gu, " $1 ");
}

function splitSupportClauses(value: string): string[] {
  const glued = glueShortParentheticals(value);

  return Array.from(new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(glued))
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
  const directionPattern = /\b(?:increase[ds]?|increasing|rise[sn]?|rose|risen|rising|grow(?:s|th|ing)?|grew|higher|above|decrease[ds]?|decreasing|fall(?:s|en|ing)?|fell|drop(?:s|ped|ping)?|lower|below|reduce[ds]?|reducing|decline[ds]?|halv(?:e[sd]?|ing)|decay(?:s|ed|ing)?)\b|增加|增长|增幅|上升|提高|提升|上调|高于|超过|减少|下降|降低|减幅|下调|衰减|低于|下跌|减半/iu;
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

// The fact-bearing tokens of a clause. In CJK prose every embedded Latin term
// is technical vocabulary (KV cache, token, transformer) and must trace to the
// evidence. Latin-script prose anchors on proper nouns instead — enforced via
// options.checkProperNouns above, or here for callers that did not opt in.
function findUnsupportedClaimAnchors(
  claim: string,
  evidence: readonly string[],
  options: ClaimSupportOptions
): string[] {
  const hasCjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(claim);

  if (!hasCjk) {
    // Symbol-bearing technical tokens (C#, A/B, TCP/IP, ELU+1) are entities even
    // in lowercase prose; a bare proper-noun scan cannot tell C# from C.
    const symbolTokens =
      claim.match(/[A-Za-z][A-Za-z0-9]*(?:\+\+|#)|[A-Za-z0-9]+(?:[/+][A-Za-z0-9]+)+/g) ?? [];
    const unsupportedSymbols = Array.from(new Set(symbolTokens)).filter(
      (token) => !evidence.some((text) => normalizedConceptAppearsInText(token, text))
    );

    if (options.checkProperNouns) {
      return unsupportedSymbols;
    }

    return [...unsupportedSymbols, ...findUnsupportedProperNouns(claim, evidence)];
  }

  const anchors = Array.from(
    new Set(
      tokenize(claim).filter(
        (token) => token.length >= 2 && /[a-z]/.test(token) && !cjkLatinConnectives.has(token)
      )
    )
  );

  return anchors.filter((anchor) => !evidence.some((text) => normalizedConceptAppearsInText(anchor, text)));
}

// Latin abbreviations that act as prose connectives inside CJK sentences
// ("GQA vs MQA 的差异") — glue, not technical terms, so never anchors.
const cjkLatinConnectives = new Set(["vs", "etc", "eg", "ie", "aka"]);

const cjkScriptPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function isCrossScriptPair(claim: string, evidence: string): boolean {
  return cjkScriptPattern.test(claim) !== cjkScriptPattern.test(evidence);
}

function findUngroundedNumericTokens(claim: string, evidence: readonly string[]): string[] {
  const claimNumbers = extractNumericTokens(claim);

  if (!claimNumbers.length) {
    return [];
  }

  const evidenceNumbers = new Set(evidence.flatMap(extractNumericTokens));

  return Array.from(new Set(claimNumbers.filter((token) => !evidenceNumbers.has(token))));
}

// Letter-led identifiers that merely contain digits (GPT-2, ELU+1, KimiK3, Top-2)
// are technical tokens, not numeric claims. They are stripped before numeric
// extraction on both the claim and the evidence side; their letters remain
// covered by the proper-noun and Latin-anchor checks.
function stripTechnicalIdentifiers(value: string): string {
  return value.replace(
    /(?<![\p{L}\p{N}])(?=[A-Za-z0-9/+\-.#]*\d)[A-Za-z][A-Za-z0-9]*(?:[/+\-.#][A-Za-z0-9]+)*(?![\p{L}\p{N}])/gu,
    " "
  );
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
    "x(?![a-z0-9])|×|-?folds?",
    "个百分点|百分比|年|个月|月|日|天|小时|分钟|秒|毫秒|步|步骤|个|项|次|人|倍|元|美元|千米|公里|米|厘米|毫米|千克|公斤|克"
  ].join("|");
  const currency = "(?:[$€£¥￥]|usd|eur|gbp|jpy|cny|rmb)";
  const comparator = "(?:no\\s+(?:more|less)\\s+than|at\\s+(?:least|most)|more\\s+than|less\\s+than|up\\s+to|over|under|>=|<=|=>|=<|[<>≤≥~≈])";
  const semanticPrefix = `(?:${currency}|${comparator}|[+\\-−])`;
  const pattern = new RegExp(
    `(?:${semanticPrefix}\\s*)*(?:(?:\\d{1,3}(?:,\\d{3})+)|\\d+|\\.\\d+)(?:\\.\\d+)?(?:\\s*(?:${unit}|${currency}))?`,
    "giu"
  );
  // "a factor of 22,580" is the prefix spelling of a multiplier; rewrite it to the
  // suffix form so it lands in the same normalized token as "22,580x" and "22,580 倍".
  // Single-word English cardinals are the same numbers in word form ("Two are
  // shared" ↔ "2 个共享", user decision 2026-08-03). "one" is deliberately
  // excluded: as a pronoun/determiner ("one of the ways") it would fabricate
  // number claims out of ordinary prose. Multi-word numerals stay out of scope.
  const prepared = stripTechnicalIdentifiers(value.normalize("NFKC"))
    .replace(/\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi, (word) => String(englishCardinalValues[word.toLowerCase()]))
    .replace(/\b(?:a\s+)?factor\s+of\s+(\d[\d,]*(?:\.\d+)?)/gi, "$1×");
  const matches = prepared.match(pattern) ?? [];

  return matches.map((token) => {
    const normalized = token.toLowerCase().replace(/[\s,]+/g, "").replace(/−/g, "-");

    // Multiplier markers are cross-language spellings of the same unit, and a
    // calendar year reads identically with or without its unit word.
    return normalized
      .replace(/(?:倍|times|x|×|-?folds?)$/u, "×")
      .replace(/^((?:19|20)\d{2})(?:年|years?)$/u, "$1")
      // The generic classifier 个 adds no meaning a bare English count lacks:
      // "898 个专家" must equal the "898" in "898 experts". Specific units
      // (个百分点, 倍, %) never end in a bare 个 after the replacements above.
      .replace(/个$/u, "");
  });
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

  // 增加/提升 in Chinese prose often means "adds a component", not a quantity
  // rising. Evidence that states an addition satisfies an increase-shaped claim
  // (user decision 2026-08-03). Evidence-side only: claims saying "adds" do not
  // start requiring direction support.
  const evidenceStatesAddition = /\b(?:add(?:s|ed|ing)?|introduce[sd]?|introducing)\b|加入|新增|添加|引入/iu.test(
    evidence.normalize("NFKC").toLowerCase()
  );

  if (claimDirections.has("increase") && !evidenceDirections.has("increase") && !evidenceStatesAddition) {
    return "Claim uses an increase/above direction that does not match the closest cited evidence.";
  }

  if (claimDirections.has("decrease") && !evidenceDirections.has("decrease")) {
    return "Claim uses a decrease/below direction that does not match the closest cited evidence.";
  }

  return undefined;
}

const englishCardinalValues: Record<string, number> = {
  zero: 0,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};

function collectDirections(value: string): Set<"increase" | "decrease"> {
  const normalized = value.normalize("NFKC").toLowerCase();
  const directions = new Set<"increase" | "decrease">();
  const increasePattern = /\b(?:increase[ds]?|increasing|rise[sn]?|rose|risen|rising|grow(?:s|th|ing)?|grew|higher|above)\b|增加|增长|增幅|上升|提高|提升|上调|高于|超过/u;
  const decreasePattern = /\b(?:decrease[ds]?|decreasing|fall(?:s|en|ing)?|fell|drop(?:s|ped|ping)?|lower|below|reduce[ds]?|reducing|decline[ds]?|halv(?:e[sd]?|ing)|decay(?:s|ed|ing)?)\b|减少|下降|降低|减幅|下调|衰减|低于|下跌|减半/u;

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

  return /\b(?:no|not|never|without|cannot|can't|doesn't|didn't|isn't|aren't|wasn't|weren't|won't)\b|不(?!如|同|过|断|错)|未|并非|并不|(?<!如果|若|假如)没有|无法/u.test(normalized) ||
    avoidancePattern.test(normalized);
}

// "Storing their key and value vectors avoids that redundant work" is a negative
// statement written with a positive verb; a faithful restatement ("生成时就不用
// 重算") reads as negated and used to fail the polarity check. Both sides use the
// same list, so a claim that invents an avoidance still needs evidence for it.
const avoidancePattern =
  /\b(?:avoids?|avoided|avoiding|prevents?|prevented|preventing|eliminates?|eliminated|eliminating)\b|避免|无需|免去|省去/u;

// A hypothesis ("如果 X 无法 Y 会怎样") belongs to the quiz or scenario block, not
// to the source: its direction and negation are the question's own, so neither is
// compared with the evidence's — for the whole hypothesis sentence, not just the
// marker clause (validateClaimSupport widens the scope to the sentence end).
// Entities, numbers and technical terms in it are still checked.
function isHypotheticalClause(claim: string): boolean {
  return /^(?:如果|若|假如|倘若|万一|要是|假设|设想)|^(?:if|suppose|imagine|what\s+if)\b/iu.test(claim.trim());
}

// A multiple-choice option marker: "A. 增加容量", "B、…", "(C) …", "D：…".
// Uppercase A–E only, and the marker must be followed by whitespace or CJK text
// so "E.g." style abbreviations never read as options. The clause-start form
// covers whole-claim validation; the look-behind form covers split clauses,
// where the marker letter must itself follow a boundary ("列表A：" is a name,
// not an option).
const choiceOptionPattern = /^[(（]?\s*[A-E][.、．:：)）](?:\s|(?=[\p{Script=Han}]))/u;
const choiceOptionMarkerBefore = /(?:^|[\s。．.！!？?；;：:，,、（()）])[A-E][.、．:：)）]\s*$/u;

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

  const chinesePattern = /(?:并非|并不|(?<!如果|若|假如)没有|无法|不(?!如|同|过|断|错)|未)([\p{Script=Han}]{1,12})/gu;

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
  const matches = Array.from(claim.matchAll(/\b(?:[A-Z]{2,}[A-Z0-9]*|[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)\b/g));
  const candidates = matches
    // A lone capital letter is a math-notation fragment (the O in O(N)), not an
    // entity name; requiring evidence for it only produces noise.
    .filter((match) => match[0].length >= 2 && !isSentenceCasedCommonWord(claim, match))
    .map((match) => match[0]);

  return Array.from(
    new Set(
      candidates.filter((candidate) => {
        const normalized = normalizeForComparison(candidate);

        // Word-boundary matching, not bare containment: "RAG" must not ride on
        // the letters inside "storage". Same matcher the concept check uses.
        return (
          normalized &&
          !ignored.has(normalized) &&
          !evidence.some((text) => normalizedConceptAppearsInText(candidate, text))
        );
      })
    )
  );
}

// English capitalizes every sentence opener, so a clause-initial "Scaling" or
// "Models" is sentence case, not an entity. Only simple-cased words whose shape
// matches ordinary word morphology are demoted; bare names (Aspirin, Kimi),
// ALL-CAPS, CamelCase and hyphenated terms stay anchors wherever they appear.
function isSentenceCasedCommonWord(claim: string, match: RegExpExecArray): boolean {
  const word = match[0];

  if (!/^[A-Z][a-z]+$/.test(word)) {
    return false;
  }

  // Suffixes chosen to exclude name shapes: bare -s/-es (Mars, Postgres),
  // -er (Sutskever) and -al (Mistral) stay anchors even at sentence start.
  if (!/(?:ing|ed|tion|sion|ment|ness|ity|able|ible|ly)$/.test(word.toLowerCase())) {
    return false;
  }

  const prefix = claim.slice(0, match.index ?? 0).trimEnd();

  return prefix === "" || /[.!?:;。！？：；]["')\]]?$/.test(prefix);
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

// A concept is grounded only when its own words appear in the cited chunk. The
// matcher tolerates *rule-generated* surface variants of that same string:
// letter case, hyphen/underscore/space used interchangeably as word separators,
// and regular English plural inflection (`s` / `es` / `y`->`ies`), both ways.
//
// It deliberately does NOT tolerate: semantic similarity, synonym or
// abbreviation tables ("MoE" is not "Mixture-of-Experts" here), stemmers,
// irregular plurals, model calls, or partial/prefix matches. The concept must
// still occur as a complete, contiguous, word-boundary-aligned run of words, so
// widening the word form cannot admit a concept the source never named — the
// only strings newly accepted are ones a human reading that chunk would call
// the same term. Severity mapping is untouched: an unmatched concept still
// fails closed.
export function normalizedConceptAppearsInText(concept: string, evidence: string): boolean {
  const normalizedConcept = normalizeForExactSupport(concept);

  if (!normalizedConcept) {
    return false;
  }

  // CJK gets no form tolerance at all: Chinese has no plural inflection and no
  // hyphenation, so any relaxation there would only add false positives.
  // Concepts carrying arithmetic or currency symbols keep the literal path too,
  // because word segmentation drops those symbols ("C++" -> "c").
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(concept) ||
    /[$€£¥￥%+#−<>≤≥~≈°/]/u.test(concept)
  ) {
    return normalizeForExactSupport(evidence).includes(normalizedConcept);
  }

  const conceptWords = segmentComparableWords(concept);
  const evidenceWords = segmentComparableWords(evidence);

  if (!conceptWords.length || conceptWords.length > evidenceWords.length) {
    return false;
  }

  return evidenceWords.some((_word, index) =>
    conceptWords.every((conceptWord, offset) =>
      conceptWordMatchesEvidenceWord(conceptWord, evidenceWords[index + offset])
    )
  );
}

function conceptWordMatchesEvidenceWord(conceptWord: string, evidenceWord: string | undefined): boolean {
  if (evidenceWord === undefined) {
    return false;
  }

  if (conceptWord === evidenceWord) {
    return true;
  }

  return isRegularEnglishPlural(conceptWord, evidenceWord) || isRegularEnglishPlural(evidenceWord, conceptWord);
}

// True when `plural` is the regular English plural of `singular`. Rules only —
// no irregular table, no stemming. The three-character floor and the sibilant
// exclusion keep short words from collapsing into each other: "Los" must not
// pass as the singular of "Loss", and "Bu" must not pass for "Bus".
function isRegularEnglishPlural(singular: string, plural: string): boolean {
  if (singular.length < 3) {
    return false;
  }

  if (/[^aeiou]y$/.test(singular)) {
    return `${singular.slice(0, -1)}ies` === plural;
  }

  if (/(?:s|x|z|ch|sh)$/.test(singular)) {
    return `${singular}es` === plural;
  }

  return `${singular}s` === plural;
}

export function isConceptPolarityCompatibleWithText(concept: string, evidence: string): boolean {
  return !hasNegationMismatch(concept, evidence);
}

function segmentComparableWords(value: string): string[] {
  // Underscores are the one separator word segmentation joins rather than
  // splits ("Multi_Token" stays one token), so normalize them to spaces first.
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "word" }).segment(value.normalize("NFKC").replace(/_+/g, " "))
  )
    .filter((entry) => entry.isWordLike)
    // Word segmentation keeps a possessive attached ("Schlag’s" is one token), so
    // an entity named in the source only in possessive form looked absent. Both
    // sides are stripped the same way, straight and curly apostrophes alike.
    .map((entry) => entry.segment.toLowerCase().replace(/[’']s$|[’']$/u, ""))
    .filter(Boolean);
}

function normalizeCaptionForComparison(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// Keep short all-caps tokens ("AI", "RAG", "LLM") that carry meaning; drop other short words.
function isShortSignalToken(token: string): boolean {
  return token.length >= 2 && /^[A-Z0-9]+$/.test(token) && /[A-Z]/.test(token);
}
