import { getRegistryChunk, getRegistrySource, resolveCitedChunk } from "../source/sourceRegistry.js";
import type {
  GroundingCheckStatus,
  HarnessValidationIssue,
  KnowledgePost,
  SourceClaimKind,
  SourceRegistry
} from "../types.js";
import { createSourceClaims, validateGrounding } from "./groundingGate.js";

export interface EvidenceLedgerSpan {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  quote: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
  overlapScore: number;
}

export interface EvidenceLedgerClaim {
  id: string;
  fieldPath: string;
  kind: SourceClaimKind;
  claim: string;
  status: GroundingCheckStatus;
  overlapScore: number;
  reason: string;
  evidence: EvidenceLedgerSpan[];
}

export interface EvidenceLedgerSummary {
  totalClaims: number;
  passed: number;
  warnings: number;
  failed: number;
  citedSources: number;
  citedChunks: number;
}

export interface EvidenceLedger {
  postId: string;
  valid: boolean;
  generatedAt: string;
  summary: EvidenceLedgerSummary;
  claims: EvidenceLedgerClaim[];
  issues: HarnessValidationIssue[];
}

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

export function createEvidenceLedger(
  post: KnowledgePost,
  registry: SourceRegistry,
  generatedAt: string | Date = new Date()
): EvidenceLedger {
  const grounding = validateGrounding(post, registry);
  const claims = createSourceClaims(post);
  const checkByClaimId = new Map(grounding.checks.map((check) => [check.claimId, check]));
  const ledgerClaims = claims.map((claim) => {
    const check = checkByClaimId.get(claim.id);
    const evidence = createEvidenceSpansForClaim(claim.claim, post, registry);

    return {
      id: claim.id,
      fieldPath: claim.fieldPath,
      kind: claim.kind,
      claim: claim.claim,
      status: check?.status ?? "failed",
      overlapScore: roundScore(check?.overlapScore ?? 0),
      reason: check?.reason ?? "No grounding check was produced for this claim.",
      evidence
    };
  });

  return {
    postId: post.id,
    valid: grounding.valid,
    generatedAt: normalizeDate(generatedAt).toISOString(),
    summary: summarizeLedger(ledgerClaims),
    claims: ledgerClaims,
    issues: grounding.issues
  };
}

function createEvidenceSpansForClaim(
  claimText: string,
  post: KnowledgePost,
  registry: SourceRegistry
): EvidenceLedgerSpan[] {
  const spans = (post.citations ?? [])
    .flatMap((citation) => {
      if (citation.chunkId) {
        const chunk = resolveCitedChunk(registry, citation);
        const source = chunk ? getRegistrySource(registry, chunk.sourceId) : undefined;

        return chunk && source
          ? [
              {
                sourceId: source.id,
                sourceTitle: source.title,
                chunkId: chunk.id,
                quote: trimQuote(chunk.content),
                startTimeSeconds: chunk.startTimeSeconds,
                endTimeSeconds: chunk.endTimeSeconds,
                overlapScore: roundScore(calculateOverlapScore(claimText, chunk.content))
              }
            ]
          : [];
      }

      return registry.chunks
        .filter((chunk) => chunk.sourceId === citation.sourceId)
        .flatMap((chunk) => {
          const source = getRegistrySource(registry, chunk.sourceId);

          return source
            ? [
                {
                  sourceId: source.id,
                  sourceTitle: source.title,
                  chunkId: chunk.id,
                  quote: trimQuote(chunk.content),
                  startTimeSeconds: chunk.startTimeSeconds,
                  endTimeSeconds: chunk.endTimeSeconds,
                  overlapScore: roundScore(calculateOverlapScore(claimText, chunk.content))
                }
              ]
            : [];
        });
    })
    .sort((left, right) => right.overlapScore - left.overlapScore);

  return dedupeEvidenceSpans(spans).slice(0, 3);
}

function summarizeLedger(claims: EvidenceLedgerClaim[]): EvidenceLedgerSummary {
  const citedSources = new Set<string>();
  const citedChunks = new Set<string>();

  for (const claim of claims) {
    for (const span of claim.evidence) {
      citedSources.add(span.sourceId);
      citedChunks.add(span.chunkId);
    }
  }

  return {
    totalClaims: claims.length,
    passed: claims.filter((claim) => claim.status === "passed").length,
    warnings: claims.filter((claim) => claim.status === "warning").length,
    failed: claims.filter((claim) => claim.status === "failed").length,
    citedSources: citedSources.size,
    citedChunks: citedChunks.size
  };
}

function dedupeEvidenceSpans(spans: EvidenceLedgerSpan[]): EvidenceLedgerSpan[] {
  const byChunkId = new Map<string, EvidenceLedgerSpan>();

  for (const span of spans) {
    const existing = byChunkId.get(span.chunkId);

    if (!existing || span.overlapScore > existing.overlapScore) {
      byChunkId.set(span.chunkId, span);
    }
  }

  return Array.from(byChunkId.values());
}

function calculateOverlapScore(claim: string, evidence: string): number {
  const claimTokens = tokenize(claim);
  const evidenceTokens = new Set(tokenize(evidence));

  if (!claimTokens.length || !evidenceTokens.size) {
    return 0;
  }

  return claimTokens.filter((token) => evidenceTokens.has(token)).length / claimTokens.length;
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

function trimQuote(value: string): string {
  return value.length > 320 ? `${value.slice(0, 317)}...` : value;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
