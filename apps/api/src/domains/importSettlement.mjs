// @ts-check

// Terminal failure messages are matched, not just displayed. Keep them here so
// classification and redaction never drift apart.
export const sourceCandidateFailureMessages = {
  unreachable: "Source could not be fetched.",
  transcriptUnavailable: "Source has no usable transcript.",
  importFailed: "Source import failed.",
  unprocessable: "Source candidate could not be processed.",
  fallbackSource: "Candidate did not produce a qualified source; same-source fallback was used.",
  stale: "stale_candidate"
};

// One classification for a terminal import_source job drives both halves of the
// bookkeeping: which budget slot the attempt consumed, and where the candidate
// lands in the pool. Splitting them is how candidates used to rot in `queued`.
/**
 * @returns {{
 *   settlement: import("../../../../packages/core/dist/index.js").DailyAutoJobSettlementOutcome;
 *   candidateStatus: "imported" | "rejected_source" | "skipped" | "unreachable";
 *   qualityGate?: any;
 *   rejectionReasons: string[];
 * }}
 */
export function classifyTerminalImportSource({ record, sourceImport, candidateRecord }) {
  if (record.status === "succeeded") {
    const producedCards = sourceImport?.posts?.length ?? 0;
    const gateRejected = sourceImport?.qualityGate?.verdict === "reject";
    const importedDifferentSource = Boolean(
      sourceImport &&
        candidateRecord &&
        sourceImport.source.id !== candidateRecord.candidate.source.id &&
        sourceImport.source.url !== candidateRecord.candidate.source.url
    );
    // A gate-rejected job that still produced a card took the same-source
    // fallback lane: the candidate is retired, but the slot did buy a card.
    // A zero-card success is a dedupe/merge into an existing card, not a loss.
    const settlement = gateRejected && producedCards === 0 ? "gate_rejected" : "produced";

    if (gateRejected || importedDifferentSource) {
      return {
        settlement,
        candidateStatus: "rejected_source",
        qualityGate: sourceImport?.qualityGate,
        rejectionReasons:
          sourceImport?.qualityGate?.reasons ??
          (importedDifferentSource ? [sourceCandidateFailureMessages.fallbackSource] : [])
      };
    }

    return { settlement, candidateStatus: "imported", rejectionReasons: [] };
  }

  if (isTranscriptUnavailableMessage(record.lastError)) {
    return {
      settlement: "import_failed",
      candidateStatus: "skipped",
      rejectionReasons: [sourceCandidateFailureMessages.transcriptUnavailable]
    };
  }

  if (isNetworkFailureMessage(record.lastError)) {
    // Nothing was fetched, so no model was called: give the slot back.
    return {
      settlement: "import_failed_refundable",
      candidateStatus: "unreachable",
      rejectionReasons: [sourceCandidateFailureMessages.unreachable]
    };
  }

  return {
    settlement: "import_failed",
    candidateStatus: "skipped",
    rejectionReasons: [sourceCandidateFailureMessages.importFailed]
  };
}

export function applySourceCandidateOutcome(candidateRecord, outcome, now) {
  return {
    ...candidateRecord,
    status: outcome.candidateStatus,
    updatedAt: now,
    ...(outcome.candidateStatus === "imported" ? { importedAt: now } : {}),
    ...(outcome.candidateStatus === "rejected_source" ? { rejectedAt: now } : {}),
    ...(outcome.qualityGate ? { qualityGate: outcome.qualityGate } : {}),
    ...(outcome.rejectionReasons?.length
      ? {
          rejectionReasons: mergeCandidateRejectionReasons(
            candidateRecord.rejectionReasons,
            outcome.rejectionReasons
          )
        }
      : {})
  };
}

export function mergeCandidateRejectionReasons(previous, next) {
  const merged = [...(previous ?? [])];

  for (const reason of next) {
    if (!merged.includes(reason)) {
      merged.push(reason);
    }
  }

  return merged;
}

export function isTranscriptUnavailableMessage(message) {
  if (typeof message !== "string" || !message.trim()) {
    return false;
  }

  return /does not expose transcript tracks|did not contain any readable segments|transcript track is missing|no usable transcript/i.test(
    message
  );
}

export function isNetworkFailureMessage(message) {
  if (typeof message !== "string" || !message.trim()) {
    return false;
  }

  return /(?:fetch failed|could not be fetched|could not be resolved|did not resolve|dns|network|timeout|timed out|abort|aborted|econnrefused|econnreset|enotfound|etimedout|eai_again|und_err_connect_timeout|socket|request failed with \d{3}|http status \d{3})/i.test(
    message
  );
}

export function collectKnownSourceUrls(snapshot) {
  return [
    ...snapshot.posts.flatMap((post) => post.sources.map((source) => source.url)),
    ...snapshot.sourceRegistries.flatMap((record) => record.registry.sources.map((source) => source.url)),
    ...snapshot.sourceCandidates.map((record) => record.candidate.source.url)
  ];
}

export function collectKnownSourceTitles(snapshot) {
  return [
    ...snapshot.posts.map((post) => post.title),
    ...snapshot.sourceCandidates.map((record) => record.candidate.source.title)
  ];
}

export function dedupePostsById(posts) {
  const byId = new Map();

  for (const post of posts) {
    byId.set(post.id, post);
  }

  return Array.from(byId.values());
}

export function getKnowledgePosts(posts) {
  return posts.filter((post) => post.kind !== "connection_note");
}

export function sanitizeSourceCandidateRecordForResponse(record) {
  if (!record?.rejectionReasons?.length || record.qualityGate) {
    return record;
  }

  const stableReasons = new Set(Object.values(sourceCandidateFailureMessages));

  if (record.rejectionReasons.every((reason) => stableReasons.has(reason))) {
    return record;
  }

  return {
    ...record,
    rejectionReasons: [
      record.status === "unreachable"
        ? sourceCandidateFailureMessages.unreachable
        : sourceCandidateFailureMessages.unprocessable
    ]
  };
}
