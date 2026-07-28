import { describe, expect, it } from "vitest";
import {
  classifyTerminalImportSource,
  sourceCandidateFailureMessages
} from "../src/domains/importSettlement.mjs";

describe("terminal source import classification", () => {
  it("refunds an unreachable fetch before any model work and marks the candidate unreachable", () => {
    expect(
      classifyTerminalImportSource({
        record: {
          status: "failed",
          lastError: sourceCandidateFailureMessages.unreachable
        }
      })
    ).toEqual({
      settlement: "import_failed_refundable",
      candidateStatus: "unreachable",
      rejectionReasons: [sourceCandidateFailureMessages.unreachable]
    });
  });

  it("refunds a fetch target that could not be resolved", () => {
    expect(
      classifyTerminalImportSource({
        record: {
          status: "failed",
          lastError: "Fetch target could not be resolved."
        }
      })
    ).toEqual({
      settlement: "import_failed_refundable",
      candidateStatus: "unreachable",
      rejectionReasons: [sourceCandidateFailureMessages.unreachable]
    });
  });

  it("refunds a fetch target that did not resolve to an IP address", () => {
    expect(
      classifyTerminalImportSource({
        record: {
          status: "failed",
          lastError: "Fetch target did not resolve to an IP address."
        }
      })
    ).toEqual({
      settlement: "import_failed_refundable",
      candidateStatus: "unreachable",
      rejectionReasons: [sourceCandidateFailureMessages.unreachable]
    });
  });

  it("keeps the spent slot when the quality gate rejects a zero-card import", () => {
    const qualityGate = {
      verdict: "reject",
      reasons: ["Low source quality."]
    };

    expect(
      classifyTerminalImportSource({
        record: { status: "succeeded" },
        sourceImport: {
          source: {
            id: "candidate-source",
            url: "https://candidate.example/article"
          },
          posts: [],
          qualityGate
        },
        candidateRecord: {
          candidate: {
            source: {
              id: "candidate-source",
              url: "https://candidate.example/article"
            }
          }
        }
      })
    ).toEqual({
      settlement: "gate_rejected",
      candidateStatus: "rejected_source",
      qualityGate,
      rejectionReasons: qualityGate.reasons
    });
  });

  it("counts a fallback card as produced even when the candidate source failed its quality gate", () => {
    const qualityGate = {
      verdict: "reject",
      reasons: ["Candidate evidence did not meet the quality threshold."]
    };

    expect(
      classifyTerminalImportSource({
        record: { status: "succeeded" },
        sourceImport: {
          source: {
            id: "candidate-source",
            url: "https://candidate.example/article"
          },
          posts: [{ id: "same-source-fallback-card" }],
          qualityGate
        },
        candidateRecord: {
          candidate: {
            source: {
              id: "candidate-source",
              url: "https://candidate.example/article"
            }
          }
        }
      })
    ).toEqual({
      settlement: "produced",
      candidateStatus: "rejected_source",
      qualityGate,
      rejectionReasons: qualityGate.reasons
    });
  });

  it("keeps the spent slot but skips a source with no usable transcript", () => {
    expect(
      classifyTerminalImportSource({
        record: {
          status: "failed",
          lastError: sourceCandidateFailureMessages.transcriptUnavailable
        }
      })
    ).toEqual({
      settlement: "import_failed",
      candidateStatus: "skipped",
      rejectionReasons: [sourceCandidateFailureMessages.transcriptUnavailable]
    });
  });

  it("counts a same-source fallback card as produced while retiring the candidate source", () => {
    expect(
      classifyTerminalImportSource({
        record: { status: "succeeded" },
        sourceImport: {
          source: {
            id: "seed-source",
            url: "https://seed.example/article"
          },
          posts: [{ id: "fallback-card" }]
        },
        candidateRecord: {
          candidate: {
            source: {
              id: "candidate-source",
              url: "https://candidate.example/article"
            }
          }
        }
      })
    ).toEqual({
      settlement: "produced",
      candidateStatus: "rejected_source",
      qualityGate: undefined,
      rejectionReasons: [sourceCandidateFailureMessages.fallbackSource]
    });
  });
});
