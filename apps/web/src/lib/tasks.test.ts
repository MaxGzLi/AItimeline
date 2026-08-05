import { describe, expect, it } from "vitest";
import {
  detailForSelection,
  groupAgentTasks,
  type AgentTaskDetailResponse,
  type AgentTaskSummary
} from "./tasks";

function createTask(overrides: Partial<AgentTaskSummary> & { id: string }): AgentTaskSummary {
  return {
    origin: "agent",
    kind: "import_source",
    kindLabel: "导入来源",
    title: "导入来源:某文章",
    reason: null,
    status: "succeeded",
    attempts: 1,
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T09:05:00.000Z",
    producedCount: 0,
    failureReason: null,
    retryable: false,
    ...overrides
  };
}

const now = new Date(2026, 7, 4, 18, 0, 0);

describe("groupAgentTasks", () => {
  it("puts running and queued work on top regardless of its timestamp", () => {
    const groups = groupAgentTasks(
      [
        createTask({ id: "old-done", updatedAt: "2026-07-01T09:00:00.000Z" }),
        createTask({ id: "queued", status: "queued", updatedAt: "2026-06-01T09:00:00.000Z" }),
        createTask({ id: "running", status: "running", updatedAt: "2026-08-04T09:00:00.000Z" })
      ],
      now
    );

    expect(groups[0].key).toBe("active");
    expect(groups[0].tasks.map((task) => task.id)).toEqual(["queued", "running"]);
  });

  it("splits finished work into today and earlier by local midnight", () => {
    const groups = groupAgentTasks(
      [
        createTask({ id: "today", updatedAt: new Date(2026, 7, 4, 8, 30).toISOString() }),
        createTask({ id: "yesterday", updatedAt: new Date(2026, 7, 3, 23, 59).toISOString() })
      ],
      now
    );

    expect(groups.map((group) => group.key)).toEqual(["today", "earlier"]);
    expect(groups[0].tasks[0].id).toBe("today");
    expect(groups[1].tasks[0].id).toBe("yesterday");
  });

  it("drops empty groups so the list has no headings with nothing under them", () => {
    const groups = groupAgentTasks([createTask({ id: "only", updatedAt: new Date(2026, 7, 4, 8, 0).toISOString() })], now);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("today");
  });

  it("files a task with an unreadable timestamp under earlier instead of floating it to the top", () => {
    const groups = groupAgentTasks([createTask({ id: "broken", updatedAt: "not-a-date" })], now);

    expect(groups).toEqual([{ key: "earlier", tasks: [expect.objectContaining({ id: "broken" })] }]);
  });

  it("returns nothing when there are no tasks at all", () => {
    expect(groupAgentTasks([], now)).toEqual([]);
  });
});

describe("detailForSelection", () => {
  const detail = (id: string): AgentTaskDetailResponse => ({
    task: createTask({ id }),
    steps: [],
    produced: [],
    conceptBrief: null
  });

  it("keeps the detail when it belongs to the selected task", () => {
    const held = detail("task-1");

    expect(detailForSelection(held, "task-1")).toBe(held);
  });

  it("drops the previous task's detail the moment another row is selected", () => {
    expect(detailForSelection(detail("task-1"), "task-2")).toBeNull();
  });

  it("drops the detail when nothing is selected", () => {
    expect(detailForSelection(detail("task-1"), null)).toBeNull();
  });
});
