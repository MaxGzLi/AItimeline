// 任务客户端的数据形状,对着 apps/api/src/domains/agentTasks.mjs 的响应。

import { t } from "./i18n";

export type AgentTaskStatus = "queued" | "running" | "awaiting" | "succeeded" | "failed" | "skipped";

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

export interface AgentConfirmQuestion {
  id: string;
  label: string;
  options: Array<{ id: string; label: string }>;
}

export interface AgentDispatchReply {
  taskId: string | null;
  /** 你刚才那句话。对话流里要先摆出它,再摆观察员的回话。 */
  question: string;
  text: string;
  quote: string | null;
  sourceTitle: string | null;
  /** 库里答不全、要往外搜时才有:先问过用户才动网络。 */
  confirm: { turnId: string; questions: AgentConfirmQuestion[] } | null;
  confirmedNote: string | null;
}

export interface DispatchResponse {
  route?: "preference" | "question";
  taskId?: string | null;
  reply?: string;
  turnRecord?: { id?: string } | null;
  turn?: {
    question?: string;
    answer?: {
      answer?: string;
      citations?: Array<{ quote?: string; sourceTitle?: string }>;
    } | null;
    /** 没有正式答案时的口头交代(「库内暂无足够依据」这类),也是回话的一部分。 */
    notes?: string[];
    actions?: Array<{ kind?: string; questions?: AgentConfirmQuestion[] }>;
  };
}

/**
 * 派活后观察员说了什么。两条路的回话长得不一样:调喜好那条回一句确认,提问那条
 * 回一段有出处的答案。答案正文并没有存进快照(agentTurns 只存问题和状态),所以
 * 这里接住这一次的回话拿去显示,刷新后就只剩任务记录——这是本期的已知限制。
 */
export function extractDispatchReply(result: DispatchResponse, asked: string): AgentDispatchReply | null {
  const answer = result.turn?.answer;
  const question = result.turn?.question?.trim() || asked;
  const confirmAction = result.turn?.actions?.find((action) => action.kind === "confirm_discovery");
  const turnId = result.turnRecord?.id;
  const confirm =
    confirmAction?.questions?.length && turnId ? { turnId, questions: confirmAction.questions } : null;

  if (answer?.answer) {
    const citation = answer.citations?.find((entry) => entry.quote);

    return {
      taskId: result.taskId ?? null,
      question,
      text: answer.answer,
      quote: citation?.quote ?? null,
      sourceTitle: citation?.sourceTitle ?? null,
      confirm,
      confirmedNote: null
    };
  }

  if (result.reply) {
    return {
      taskId: result.taskId ?? null,
      question,
      text: result.reply,
      quote: null,
      sourceTitle: null,
      confirm,
      confirmedNote: null
    };
  }

  // 第三种形状:没有正式答案,只有口头交代(notes)和/或「要不要出网查」的确认。
  // 原来这里直接返回 null,用户发了话却看不到任何回音——连确认按钮一起被扔掉了。
  const notes = (result.turn?.notes ?? []).filter(Boolean);

  if (notes.length || confirm) {
    return {
      taskId: result.taskId ?? null,
      question,
      text: notes.length ? notes.join("\n") : t("tasks.replyNeedsConfirm"),
      quote: null,
      sourceTitle: null,
      confirm,
      confirmedNote: null
    };
  }

  return null;
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
    if (task.status === "running" || task.status === "queued" || task.status === "awaiting") {
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

/**
 * 换一条任务时,该不该把手上这份详情留在屏幕上。
 *
 * 高亮是点下去就动的,详情还要等一趟请求回来。中间这段如果把上一条的内容
 * 留着,看到的就是「高亮在新行、正文是旧的」,会让人以为读的是选中的这条。
 */
export function detailForSelection(
  current: AgentTaskDetailResponse | null,
  selectedTaskId: string | null
): AgentTaskDetailResponse | null {
  return current && current.task.id === selectedTaskId ? current : null;
}
