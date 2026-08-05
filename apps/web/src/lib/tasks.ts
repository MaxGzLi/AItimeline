// 任务客户端的数据形状,对着 apps/api/src/domains/agentTasks.mjs 的响应。

export type AgentTaskStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export interface AgentTaskSummary {
  id: string;
  origin: "you" | "agent";
  kind: string;
  kindLabel: string;
  title: string;
  reason: string | null;
  status: AgentTaskStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  producedCount: number;
  failureReason: string | null;
  retryable: boolean;
}

export interface AgentTaskStepItem {
  title: string;
  url: string | null;
  relevanceScore: number | null;
}

export interface AgentTaskStep {
  kind: "queued" | "claimed" | "discovered" | "imported" | "succeeded" | "failed";
  at: string | null;
  text: string;
  note: string | null;
  items?: AgentTaskStepItem[];
}

export interface AgentTaskCard {
  id: string;
  title: string;
  keyTakeaway: string | null;
  concepts: string[];
  quote: string | null;
  source: { title: string; url: string; author: string | null } | null;
}

export interface AgentTaskListResponse {
  tasks: AgentTaskSummary[];
  total: number;
  running: number;
  failed: number;
}

export interface AgentTaskDetailResponse {
  task: AgentTaskSummary;
  steps: AgentTaskStep[];
  produced: AgentTaskCard[];
  conceptBrief: unknown;
}

export type AgentTaskGroupKey = "active" | "today" | "earlier";

export interface AgentTaskGroup {
  key: AgentTaskGroupKey;
  tasks: AgentTaskSummary[];
}

/**
 * 分组:在跑的置顶,其余按今天/更早分。
 *
 * 队列里躺着几百条历史任务,平铺是一堵墙;Codex 那种客户端也是把在跑的顶上去、
 * 剩下的按时间归堆。空的组不返回,界面上就不会出现只有标题的空段。
 */
export function groupAgentTasks(tasks: AgentTaskSummary[], now: Date): AgentTaskGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: Record<AgentTaskGroupKey, AgentTaskSummary[]> = { active: [], today: [], earlier: [] };

  for (const task of tasks) {
    if (task.status === "running" || task.status === "queued") {
      groups.active.push(task);
      continue;
    }

    const updatedAt = Date.parse(task.updatedAt);

    // 时间读不出来时归到「更早」,不要让一条坏数据顶在最上面。
    groups[Number.isNaN(updatedAt) || updatedAt < startOfToday ? "earlier" : "today"].push(task);
  }

  return (["active", "today", "earlier"] as const)
    .filter((key) => groups[key].length > 0)
    .map((key) => ({ key, tasks: groups[key] }));
}
