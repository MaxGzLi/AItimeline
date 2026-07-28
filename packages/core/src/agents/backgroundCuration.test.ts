import { describe, expect, it } from "vitest";
import type { DailyAutoJobBudgetRecord } from "../types.js";
import {
  applyDailyAutoJobBudget,
  isMeteredAutoJobKind,
  settleDailyAutoJobBudget,
  type BackgroundCurationJobKind,
  type BackgroundCurationPlan
} from "./backgroundCuration.js";

function makePlan(kinds: BackgroundCurationJobKind[]): BackgroundCurationPlan {
  const generatedAt = "2026-07-28T00:00:00.000Z";

  return {
    generatedAt,
    jobs: kinds.map((kind, index) => ({
      id: `job-${index + 1}`,
      kind,
      topicId: `topic-${index + 1}`,
      conceptIds: [`Concept ${index + 1}`],
      priority: 100 - index,
      reason: "Budget fixture.",
      createdAt: generatedAt
    })),
    suppressions: [],
    acceptedSourceCandidateIds: [],
    cooledTopicIds: [],
    expansionPlan: {
      generatedAt,
      jobs: [],
      suppressions: [],
      cooledTopicIds: []
    }
  };
}

function makeBudget(overrides: Partial<DailyAutoJobBudgetRecord> = {}): DailyAutoJobBudgetRecord {
  return {
    date: "2026-07-28",
    used: 1,
    limit: 1,
    discarded: 0,
    produced: 0,
    gateRejected: 0,
    importFailed: 0,
    refunded: 0,
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides
  };
}

describe("daily automatic job budget", () => {
  it("admits metered jobs within the limit, rejects overflow, and keeps unmetered work", () => {
    const result = applyDailyAutoJobBudget({
      plan: makePlan(["import_source", "generate_followup", "schedule_review"]),
      limit: 1,
      now: "2026-07-28T08:00:00.000Z",
      timeZone: "UTC"
    });

    expect(result.plan.jobs.map((job) => job.id)).toEqual(["job-1", "job-3"]);
    expect(result.discardedJobIds).toEqual(["job-2"]);
    expect(result.budget).toMatchObject({ date: "2026-07-28", used: 1, discarded: 1 });
  });

  it("resets an exhausted budget exactly at the configured local midnight", () => {
    const plan = makePlan(["concept_brief"]);
    const budget = makeBudget();
    const beforeMidnight = applyDailyAutoJobBudget({
      plan,
      budget,
      limit: 1,
      now: "2026-07-28T15:59:59.999Z",
      timeZone: "Asia/Shanghai"
    });
    const atMidnight = applyDailyAutoJobBudget({
      plan,
      budget,
      limit: 1,
      now: "2026-07-28T16:00:00.000Z",
      timeZone: "Asia/Shanghai"
    });

    expect(beforeMidnight.plan.jobs).toEqual([]);
    expect(beforeMidnight.budget).toMatchObject({ date: "2026-07-28", used: 1, discarded: 1 });
    expect(atMidnight.plan.jobs.map((job) => job.id)).toEqual(["job-1"]);
    expect(atMidnight.budget).toMatchObject({
      date: "2026-07-29",
      used: 1,
      discarded: 0,
      produced: 0,
      gateRejected: 0,
      importFailed: 0,
      refunded: 0
    });
  });
});

describe("daily automatic job settlement", () => {
  it("records every terminal outcome and refunds only pre-model import failures", () => {
    const startingBudget = makeBudget({ used: 4, limit: 5 });
    const produced = settleDailyAutoJobBudget({
      budget: startingBudget,
      outcome: "produced",
      now: "2026-07-28T01:00:00.000Z",
      timeZone: "UTC"
    });
    const gateRejected = settleDailyAutoJobBudget({
      budget: produced,
      outcome: "gate_rejected",
      now: "2026-07-28T02:00:00.000Z",
      timeZone: "UTC"
    });
    const importFailed = settleDailyAutoJobBudget({
      budget: gateRejected,
      outcome: "import_failed",
      now: "2026-07-28T03:00:00.000Z",
      timeZone: "UTC"
    });
    const refunded = settleDailyAutoJobBudget({
      budget: importFailed,
      outcome: "import_failed_refundable",
      now: "2026-07-28T04:00:00.000Z",
      timeZone: "UTC"
    });

    expect(gateRejected).toMatchObject({ used: 4, produced: 1, gateRejected: 1 });
    expect(refunded).toMatchObject({
      used: 3,
      produced: 1,
      gateRejected: 1,
      importFailed: 2,
      refunded: 1
    });
  });

  it("meters only discover, import, follow-up, and concept-brief jobs", () => {
    const metered: BackgroundCurationJobKind[] = [
      "discover_sources",
      "import_source",
      "generate_followup",
      "concept_brief"
    ];
    const unmetered: BackgroundCurationJobKind[] = [
      "deep_read_article",
      "research_question",
      "research_idea",
      "schedule_review",
      "ask_clarifying_question",
      "cooldown_topic"
    ];

    expect(metered.map(isMeteredAutoJobKind)).toEqual([true, true, true, true]);
    expect(unmetered.map(isMeteredAutoJobKind)).toEqual([false, false, false, false, false, false]);
  });
});
