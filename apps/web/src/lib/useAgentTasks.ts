import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, isAbortLikeError } from "./api";
import { t } from "./i18n";
import type { AgentTaskDetailResponse, AgentTaskListResponse, AgentTaskSummary } from "./tasks";

const pollIntervalMs = 5000;

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

interface DispatchResponse {
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
    actions?: Array<{ kind?: string; questions?: AgentConfirmQuestion[] }>;
  };
}

/**
 * 派活后观察员说了什么。两条路的回话长得不一样:调喜好那条回一句确认,提问那条
 * 回一段有出处的答案。答案正文并没有存进快照(agentTurns 只存问题和状态),所以
 * 这里接住这一次的回话拿去显示,刷新后就只剩任务记录——这是本期的已知限制。
 */
function extractDispatchReply(result: DispatchResponse, asked: string): AgentDispatchReply | null {
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

  return null;
}

/**
 * 任务客户端的数据面。列表轮询只在这一屏开着时跑,离开就停——后台任务几秒才动
 * 一次,没必要在别的视图里空转。
 */
export function useAgentTasks(enabled: boolean) {
  const [tasks, setTasks] = useState<AgentTaskSummary[]>([]);
  const [runningCount, setRunningCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentTaskDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dispatchText, setDispatchText] = useState("");
  const [dispatchPending, setDispatchPending] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<AgentDispatchReply | null>(null);
  // 轮询回来的列表不能覆盖用户刚点开的那条详情,所以选中项存一份 ref 给回调用。
  const selectedRef = useRef<string | null>(null);

  selectedRef.current = selectedTaskId;

  const refreshTasks = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await apiRequest<AgentTaskListResponse>("/api/agent/tasks?limit=120", { signal });

      setTasks(result.tasks);
      setRunningCount(result.running);
      setFailedCount(result.failed);
      setListError(null);

      return result.tasks;
    } catch (error) {
      if (!isAbortLikeError(error)) {
        setListError(t("tasks.listFailed"));
      }

      return null;
    }
  }, []);

  const loadDetail = useCallback(async (taskId: string, signal?: AbortSignal) => {
    setDetailLoading(true);

    try {
      const result = await apiRequest<AgentTaskDetailResponse>(`/api/agent/tasks/${encodeURIComponent(taskId)}`, {
        signal
      });

      // 详情请求慢于用户点下一条时,晚到的响应不能盖掉现在选中的那条。
      if (selectedRef.current === taskId) {
        setDetail(result);
      }
    } catch (error) {
      if (!isAbortLikeError(error) && selectedRef.current === taskId) {
        setDetail(null);
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let timer = 0;

    setTasksLoading(true);

    const tick = async () => {
      const loaded = await refreshTasks(controller.signal);

      setTasksLoading(false);

      // 第一次拉到列表就打开最新那条,免得右边空着。
      if (loaded?.length && !selectedRef.current) {
        setSelectedTaskId(loaded[0].id);
      }

      if (!controller.signal.aborted) {
        timer = window.setTimeout(tick, pollIntervalMs);
      }
    };

    void tick();

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, refreshTasks]);

  useEffect(() => {
    if (!enabled || !selectedTaskId) return;

    const controller = new AbortController();

    void loadDetail(selectedTaskId, controller.signal);

    return () => controller.abort();
  }, [enabled, loadDetail, selectedTaskId]);

  const dispatchTask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();

      if (!trimmed) return;

      setDispatchPending(true);
      setDispatchError(null);

      try {
        const result = await apiRequest<DispatchResponse>("/api/agent/tasks", {
          method: "POST",
          body: { text: trimmed },
          // 派活要写记忆、排任务,现在一次要重写整份快照,比普通请求慢得多。
          timeoutMs: 60000
        });

        setDispatchText("");
        setLastReply(extractDispatchReply(result, trimmed));

        const refreshed = await refreshTasks();

        if (result.taskId && refreshed?.some((task) => task.id === result.taskId)) {
          setSelectedTaskId(result.taskId);
        }
      } catch {
        setDispatchError(t("tasks.dispatchFailed"));
      } finally {
        setDispatchPending(false);
      }
    },
    [refreshTasks]
  );

  const retryTask = useCallback(
    async (taskId: string) => {
      setRetryingId(taskId);

      try {
        const result = await apiRequest<{ retried: boolean; taskId?: string }>(
          `/api/agent/tasks/${encodeURIComponent(taskId)}/retry`,
          { method: "POST", body: {} }
        );
        const refreshed = await refreshTasks();

        if (result.retried && result.taskId && refreshed?.some((task) => task.id === result.taskId)) {
          setSelectedTaskId(result.taskId);
        }
      } catch {
        setDispatchError(t("tasks.retryFailed"));
      } finally {
        setRetryingId(null);
      }
    },
    [refreshTasks]
  );

  // 用户点了「去找来源」才真的动网络。确认之后排的是一个研究任务,会出现在列表里。
  const confirmDiscovery = useCallback(
    async (turnId: string, choices: Record<string, string>) => {
      setDispatchPending(true);

      try {
        await apiRequest("/api/agent/confirm", {
          method: "POST",
          body: { turnId, choices },
          timeoutMs: 60000
        });

        setLastReply((reply) => (reply ? { ...reply, confirm: null, confirmedNote: t("tasks.confirmQueued") } : reply));
        await refreshTasks();
      } catch {
        setDispatchError(t("tasks.confirmFailed"));
      } finally {
        setDispatchPending(false);
      }
    },
    [refreshTasks]
  );

  // 换看别的任务就把上一次的回话收起来,免得它一直挂在不相干的任务上面。
  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId((current) => {
      if (current !== taskId) {
        setLastReply((reply) => (reply?.taskId === taskId ? reply : null));
      }

      return taskId;
    });
  }, []);

  return {
    confirmDiscovery,
    detail,
    detailLoading,
    dispatchError,
    dispatchPending,
    dispatchTask,
    dispatchText,
    failedCount,
    lastReply,
    listError,
    retryTask,
    retryingId,
    runningCount,
    selectTask,
    selectedTaskId,
    setDispatchText,
    tasks,
    tasksLoading
  };
}
