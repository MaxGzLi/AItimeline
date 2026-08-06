import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import {
  detailForSelection,
  extractDispatchReply,
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
        createTask({ id: "running", status: "running", updatedAt: "2026-08-04T09:00:00.000Z" }),
        createTask({ id: "awaiting", status: "awaiting", updatedAt: "2026-05-01T09:00:00.000Z" })
      ],
      now
    );

    expect(groups[0].key).toBe("active");
    expect(groups[0].tasks.map((task) => task.id)).toEqual(["queued", "running", "awaiting"]);
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

describe("extractDispatchReply", () => {
  it("returns the grounded answer with its first quoted citation", () => {
    const reply = extractDispatchReply(
      {
        taskId: "agent-turn-1",
        turn: {
          question: "KV 缓存是干什么用的",
          answer: {
            answer: "根据来源,KV 缓存……",
            citations: [{ quote: "cached key/value states", sourceTitle: "某来源" }]
          }
        }
      },
      "KV 缓存是干什么用的"
    );

    expect(reply).toMatchObject({
      taskId: "agent-turn-1",
      text: "根据来源,KV 缓存……",
      quote: "cached key/value states",
      sourceTitle: "某来源"
    });
  });

  it("returns the preference confirmation line", () => {
    const reply = extractDispatchReply({ route: "preference", reply: "记住了。" }, "以后少推视频");

    expect(reply).toMatchObject({ text: "记住了。", quote: null });
  });

  // 第三种形状曾被整个丢掉:用户发了话却看不到任何回音,确认按钮也一起没了。
  it("keeps the notes and confirm action when there is no formal answer", () => {
    const reply = extractDispatchReply(
      {
        taskId: "agent-turn-2",
        turnRecord: { id: "agent-turn-2" },
        turn: {
          question: "门控网络是怎么选专家的",
          answer: null,
          notes: ["这个问题在你的知识库之外。"],
          actions: [
            {
              kind: "confirm_discovery",
              questions: [{ id: "angle", label: "你想要哪种?", options: [{ id: "define", label: "定义与原理" }] }]
            }
          ]
        }
      },
      "门控网络是怎么选专家的"
    );

    expect(reply?.text).toBe("这个问题在你的知识库之外。");
    expect(reply?.confirm?.turnId).toBe("agent-turn-2");
    expect(reply?.confirm?.questions).toHaveLength(1);
  });

  it("falls back to a stock line when there are no notes but a confirm is pending", () => {
    const reply = extractDispatchReply(
      {
        turnRecord: { id: "agent-turn-3" },
        turn: {
          actions: [
            {
              kind: "confirm_discovery",
              questions: [{ id: "angle", label: "你想要哪种?", options: [{ id: "define", label: "定义与原理" }] }]
            }
          ]
        }
      },
      "问了一句"
    );

    expect(reply?.text).toBe(t("tasks.replyNeedsConfirm"));
    expect(reply?.confirm?.turnId).toBe("agent-turn-3");
  });

  it("still returns null when the response carries nothing to show", () => {
    expect(extractDispatchReply({}, "问了一句")).toBeNull();
  });
});
