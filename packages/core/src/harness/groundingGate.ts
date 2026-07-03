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
}

export const defaultGroundingGateOptions: GroundingGateOptions = {
  minSourceFactOverlap: 0.08,
  minInterpretationOverlap: 0.03
};

const stopwords = new Set([
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
  "every",
  "from",
  "have",
  "into",
  "more",
  "should",
  "that",
  "their",
  "there",
  "this",
  "when",
  "where",
  "which",
  "with",
  "would"
]);

export function validateGrounding(
  post: KnowledgePost,
  registry: SourceRegistry,
  options: Partial<GroundingGateOptions> = {}
): GroundingCheck {
  const gateOptions = { ...defaultGroundingGateOptions, ...options };
  const citationIssues = validateCitationsAgainstRegistry(post.citations, registry);
  const claims = createSourceClaims(post);
  const checks = claims.map((claim) => validateClaimGrounding(claim, registry, post.citations, gateOptions));
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
      createClaim(
        post,
        `$.thread[${index}].body`,
        threadKindToClaimKind(block.kind),
        block.body
      )
    );
  }

  for (const [index, edge] of post.graphEdges.entries()) {
    claims.push(createClaim(post, `$.graphEdges[${index}].evidence`, "source_fact", edge.evidence));
  }

  return claims.filter((claim) => claim.claim.trim().length > 0);
}

function validateCitationsAgainstRegistry(citations: Citation[] | undefined, registry: SourceRegistry): HarnessValidationIssue[] {
  const issues: HarnessValidationIssue[] = [];

  if (!citations?.length) {
    return [{ path: "$.citations", message: "post must include at least one source citation.", severity: "error" }];
  }

  citations.forEach((citation, index) => {
    if (!getRegistrySource(registry, citation.sourceId)) {
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
    } else if (!getRegistryChunk(registry, citation.chunkId)) {
      issues.push({
        path: `$.citations[${index}].chunkId`,
        message: "citation chunkId is not registered in SourceRegistry.",
        severity: "error"
      });
    }
  });

  return issues;
}

function validateClaimGrounding(
  claim: SourceClaim,
  registry: SourceRegistry,
  citations: Citation[] | undefined,
  options: GroundingGateOptions
): GroundingClaimCheck {
  const evidence = resolveEvidenceSpans(registry, citations);
  const bestOverlap = evidence.reduce((best, span) => Math.max(best, calculateOverlapScore(claim.claim, span.quote)), 0);
  const evidenceChunkIds = evidence.map((span) => span.chunkId);

  if (!evidence.length) {
    return {
      claimId: claim.id,
      fieldPath: claim.fieldPath,
      kind: claim.kind,
      status: claim.kind === "source_fact" ? "failed" : "warning",
      evidenceChunkIds,
      overlapScore: 0,
      reason: "No citation chunk could be resolved for this claim."
    };
  }

  if (claim.kind === "source_fact" && bestOverlap < options.minSourceFactOverlap) {
    return {
      claimId: claim.id,
      fieldPath: claim.fieldPath,
      kind: claim.kind,
      status: "failed",
      evidenceChunkIds,
      overlapScore: bestOverlap,
      reason: "Source fact does not overlap enough with cited evidence."
    };
  }

  // Numbers are the highest-risk hallucination surface: a fabricated or altered
  // figure keeps high lexical overlap, so it needs an exact-match gate of its own.
  if (claim.kind === "source_fact") {
    const ungroundedNumbers = findUngroundedNumericTokens(claim.claim, evidence);

    if (ungroundedNumbers.length) {
      return {
        claimId: claim.id,
        fieldPath: claim.fieldPath,
        kind: claim.kind,
        status: "failed",
        evidenceChunkIds,
        overlapScore: bestOverlap,
        reason: `Source fact contains numbers that do not appear in cited evidence: ${ungroundedNumbers.join(", ")}.`
      };
    }
  }

  if (claim.kind === "interpretation" && bestOverlap < options.minInterpretationOverlap) {
    return {
      claimId: claim.id,
      fieldPath: claim.fieldPath,
      kind: claim.kind,
      status: "warning",
      evidenceChunkIds,
      overlapScore: bestOverlap,
      reason: "Interpretation is grounded by citation, but lexical overlap is weak."
    };
  }

  return {
    claimId: claim.id,
    fieldPath: claim.fieldPath,
    kind: claim.kind,
    status: "passed",
    evidenceChunkIds,
    overlapScore: bestOverlap,
    reason: "Claim is grounded by registered source evidence."
  };
}

function resolveEvidenceSpans(registry: SourceRegistry, citations: Citation[] | undefined): EvidenceSpan[] {
  if (!citations?.length) {
    return [];
  }

  return citations.flatMap((citation) => {
    if (citation.chunkId) {
      const chunk = getRegistryChunk(registry, citation.chunkId);

      return chunk
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

function findUngroundedNumericTokens(claim: string, evidence: EvidenceSpan[]): string[] {
  const claimNumbers = extractNumericTokens(claim);

  if (!claimNumbers.length) {
    return [];
  }

  const evidenceNumbers = new Set(evidence.flatMap((span) => extractNumericTokens(span.quote)));

  return Array.from(new Set(claimNumbers.filter((token) => !evidenceNumbers.has(token))));
}

function extractNumericTokens(value: string): string[] {
  const matches = value.match(/\d+(?:[.,]\d+)*%?/g) ?? [];

  return matches.map((token) => token.replace(/,/g, "").replace(/%$/, ""));
}

function calculateOverlapScore(claim: string, evidence: string): number {
  const claimTokens = tokenize(claim);
  const evidenceTokens = new Set(tokenize(evidence));

  if (!claimTokens.length || !evidenceTokens.size) {
    return 0;
  }

  const overlap = claimTokens.filter((token) => evidenceTokens.has(token)).length;

  return overlap / claimTokens.length;
}

function tokenize(value: string): string[] {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 3 || isShortSignalToken(token))
    .map((token) => token.toLowerCase())
    .filter((token) => !stopwords.has(token));
}

// Keep short all-caps tokens ("AI", "RAG", "LLM") that carry meaning; drop other short words.
function isShortSignalToken(token: string): boolean {
  return token.length >= 2 && /^[A-Z0-9]+$/.test(token) && /[A-Z]/.test(token);
}
