import { ArrowUp, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatRelativeTime, formatShortTime } from "../lib/format";
import { t } from "../lib/i18n";
import {
  groupAgentTasks,
  type AgentDispatchReply,
  type AgentTaskDetailResponse,
  type AgentTaskStatus,
  type AgentTaskSummary
} from "../lib/tasks";

// 状态点是一个小圆,不是字符也不是徽章。只有「有事要你看」才上强调色。
const statusTone: Record<AgentTaskStatus, string> = {
  queued: "waiting",
  running: "live",
  awaiting: "waiting",
  succeeded: "done",
  failed: "stuck",
  skipped: "done"
};

export interface TaskClientViewProps {
  contextRail: ReactNode;
  detail: AgentTaskDetailResponse | null;
  detailLoading: boolean;
  dispatchError: string | null;
  dispatchPending: boolean;
  dispatchText: string;
  failedCount: number;
  footerNav: ReactNode;
  lastReply: AgentDispatchReply | null;
  listError: string | null;
  onConfirmDiscovery: (turnId: string, choices: Record<string, string>) => void;
  onDispatchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDispatchTextChange: (value: string) => void;
  onOpenCard: (cardId: string) => void;
  onRetry: (taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  /** 发出去还没回来的那句话:先上屏,下面跟一个「在想」的指示。 */
  pendingQuestion: string | null;
  primaryNav: ReactNode;
  retryingId: string | null;
  runningCount: number;
  selectedTaskId: string | null;
  tasks: AgentTaskSummary[];
  tasksLoading: boolean;
}

/**
 * 这一轮跑了多久。Codex 把它收成一行很淡的小字放在这轮开头,不是一条通栏横线,
 * 所以这里只出数字,长什么样交给样式。算不出来就不写,不编。
 */
function describeElapsed(steps: AgentTaskDetailResponse["steps"]): string | null {
  const stamps = steps.map((step) => step.at).filter((at): at is string => Boolean(at));

  if (stamps.length < 2) return null;

  const first = Date.parse(stamps[0]);
  const last = Date.parse(stamps[stamps.length - 1]);

  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;

  const seconds = Math.round((last - first) / 1000);

  if (seconds < 60) return t("tasks.elapsedSeconds", { seconds: String(seconds) });

  const minutes = Math.floor(seconds / 60);

  return t("tasks.elapsedMinutes", { minutes: String(minutes), seconds: String(seconds % 60).padStart(2, "0") });
}

export function TaskClientView({
  contextRail,
  detail,
  detailLoading,
  dispatchError,
  dispatchPending,
  dispatchText,
  failedCount,
  footerNav,
  lastReply,
  listError,
  onConfirmDiscovery,
  onDispatchSubmit,
  onDispatchTextChange,
  onOpenCard,
  onRetry,
  onSelectTask,
  pendingQuestion,
  primaryNav,
  retryingId,
  runningCount,
  selectedTaskId,
  tasks,
  tasksLoading
}: TaskClientViewProps) {
  const groups = groupAgentTasks(tasks, new Date());
  const [confirmChoices, setConfirmChoices] = useState<Record<string, string>>({});
  const confirmTurnId = lastReply?.confirm?.turnId ?? null;
  const isConfirmReady = Boolean(
    lastReply?.confirm?.questions.every((confirmQuestion) => confirmChoices[confirmQuestion.id])
  );
  const elapsed = detail ? describeElapsed(detail.steps) : null;
  const streamRef = useRef<HTMLDivElement | null>(null);
  // 这活是你派的还是它自己排的。你派的才右对齐,它排的按它说话处理。
  const taskFromYou = detail?.task.origin === "you";

  // 换一轮对话就把上一轮的勾选清掉,免得把旧选择带进新的确认。
  useEffect(() => {
    setConfirmChoices({});
  }, [confirmTurnId]);

  // 新回话接在最下面,得自己滚下去——否则答案和「要不要去外面找」都被挡在屏幕外。
  useEffect(() => {
    const stream = streamRef.current;

    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [detail?.task.id, lastReply, pendingQuestion]);

  // 桌面壳里系统标题栏是藏掉的(hiddenInset),红绿灯浮在内容左上角:
  // 侧栏要让出顶部一条,并给窗口一条可拖拽的顶带。浏览器里没有这回事。
  const isDesktop = typeof window !== "undefined" && Boolean(window.aitimelineDesktop);

  return (
    <div className={`x-task-client${isDesktop ? " is-desktop" : ""}`}>
      {isDesktop ? <div aria-hidden className="x-task-dragstrip" /> : null}
      <aside className="x-task-side">
        <div className="x-task-brand">
          <span className="x-task-brandname">AITimeline</span>
          {runningCount > 0 ? (
            <span aria-label={t("tasks.countRunning", { count: runningCount })} className="x-task-live" />
          ) : null}
        </div>

        {/* 常去的地方钉在最上面,不跟着列表滚。 */}
        <nav aria-label={t("tasks.primaryNav")} className="x-task-quick">
          {primaryNav}
        </nav>

        <div className="x-task-list">
          {listError ? <p className="x-task-error">{listError}</p> : null}
          {!listError && tasks.length === 0 ? (
            <p className="x-task-empty">{tasksLoading ? t("tasks.loading") : t("tasks.empty")}</p>
          ) : null}
          {groups.map((group) => (
            <section className="x-task-group" key={group.key}>
              <h2 className="x-task-groupname">{t(`tasks.group.${group.key}`)}</h2>
              {group.tasks.map((task) => (
                <button
                  aria-current={task.id === selectedTaskId ? "true" : undefined}
                  className={`x-task-row${task.id === selectedTaskId ? " active" : ""}`}
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  type="button"
                >
                  <span aria-hidden="true" className={`x-task-dot ${statusTone[task.status] ?? "waiting"} ${task.status}`} />
                  <span className="x-task-rowtitle">{task.title}</span>
                  <span className="x-task-rowtime">{formatRelativeTime(task.updatedAt)}</span>
                </button>
              ))}
            </section>
          ))}
        </div>

        {/* 图书馆、设置这些是「去了就回来」的地方,收在最底下。 */}
        <nav aria-label={t("tasks.footerNav")} className="x-task-foot">
          {footerNav}
          {failedCount > 0 ? <em className="x-task-stuck">{t("tasks.countFailed", { count: failedCount })}</em> : null}
        </nav>
      </aside>

      <main className="x-task-main">
        <div className="x-task-stream" ref={streamRef}>
          {/* 屏幕上已经有回答了就别再挂一行「加载中」,那看着像出了两件事。 */}
          {!detail && !lastReply && detailLoading ? <p className="x-task-empty">{t("tasks.loading")}</p> : null}
          {!detail && !detailLoading && !lastReply ? <p className="x-task-empty">{t("tasks.pickOne")}</p> : null}

          {detail ? (
            <article className="x-task-turn">
              {/* 你派的活右对齐成一块,它自己排的活当它说的第一句话。 */}
              {taskFromYou ? (
                <p className="x-task-you">{detail.task.title}</p>
              ) : (
                <p className="x-task-lead">{detail.task.title}</p>
              )}

              <div className="x-task-agent">
                {/* 这轮跑了多久、几步,收成一行淡字放在开头。 */}
                <p className="x-task-runline">
                  <span>{elapsed ?? t(`tasks.status.${detail.task.status}`)}</span>
                  {detail.steps.length > 0 ? <span>{t("tasks.stepCount", { count: detail.steps.length })}</span> : null}
                  <span>{detail.task.kindLabel}</span>
                  <span>{formatRelativeTime(detail.task.updatedAt)}</span>
                  {detail.task.attempts > 1 ? <span>{t("tasks.attempts", { count: detail.task.attempts })}</span> : null}
                  {detail.task.retryable ? (
                    <button
                      className="x-task-retry"
                      disabled={retryingId === detail.task.id}
                      onClick={() => onRetry(detail.task.id)}
                      type="button"
                    >
                      {retryingId === detail.task.id ? (
                        <LoaderCircle className="x-task-spin" size={13} />
                      ) : (
                        <RotateCcw size={13} />
                      )}
                      <span>{t("tasks.retry")}</span>
                    </button>
                  ) : null}
                </p>

                {taskFromYou && detail.task.reason ? <p className="x-task-lead">{detail.task.reason}</p> : null}

                <ol className="x-task-steps">
                  {detail.steps.map((step, index) => (
                    <li className={`x-task-step ${step.kind}`} key={`${step.kind}-${index}`}>
                      <span className="x-task-stepline">
                        {step.text}
                        {step.at ? <em className="at">{formatShortTime(step.at)}</em> : null}
                        {step.note ? <em>{step.note}</em> : null}
                      </span>
                      {step.items?.length ? (
                        <span className="x-task-stepitems">
                          {step.items.map((item) => (
                            <span className="x-task-stepitem" key={`${item.title}-${item.url ?? ""}`}>
                              {item.url ? (
                                <a href={item.url} rel="noreferrer" target="_blank">
                                  {item.title}
                                </a>
                              ) : (
                                <span>{item.title}</span>
                              )}
                              {item.relevanceScore === null ? null : <em>{item.relevanceScore.toFixed(2)}</em>}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>

                {detail.produced.length ? (
                  <section className="x-task-produced">
                    {detail.produced.map((card) => (
                      <button className="x-task-card" key={card.id} onClick={() => onOpenCard(card.id)} type="button">
                        <span className="x-task-cardtitle">{card.title}</span>
                        {card.keyTakeaway ? <span className="x-task-cardtake">{card.keyTakeaway}</span> : null}
                        {card.quote ? <span className="x-task-cardquote">{card.quote}</span> : null}
                        {card.source ? <span className="x-task-cardsource">{card.source.title}</span> : null}
                      </button>
                    ))}
                  </section>
                ) : null}
              </div>
            </article>
          ) : null}

          {/* 你刚说的那句话和观察员的回话。答案正文不进快照,只活在这一次会话里。
              选中的正是这条任务时,详情里已经摆过你的问题,这里不再重复画一个气泡。 */}
          {lastReply ? (
            <article className="x-task-turn">
              {lastReply.taskId === detail?.task.id && detail.task.title === lastReply.question ? null : (
                <p className="x-task-you">{lastReply.question}</p>
              )}

              <div className="x-task-agent">
                <p className="x-task-answer">{lastReply.text}</p>
                {lastReply.quote ? (
                  <blockquote className="x-task-quote">
                    {lastReply.quote}
                    {lastReply.sourceTitle ? <em>{lastReply.sourceTitle}</em> : null}
                  </blockquote>
                ) : null}

                {/* 库里的答完了;要往外搜先问过用户,别静默花掉搜索额度。 */}
                {lastReply.confirm ? (
                  <div className="x-task-confirm">
                    <p className="x-task-confirmhead">{t("tasks.confirmHead")}</p>
                    {lastReply.confirm.questions.map((confirmQuestion) => (
                      <div className="x-task-confirmrow" key={confirmQuestion.id}>
                        <span className="x-task-confirmlabel">{confirmQuestion.label}</span>
                        {confirmQuestion.options.map((option) => (
                          <button
                            aria-pressed={confirmChoices[confirmQuestion.id] === option.id}
                            className={`x-task-choice${
                              confirmChoices[confirmQuestion.id] === option.id ? " active" : ""
                            }`}
                            key={option.id}
                            onClick={() =>
                              setConfirmChoices((current) => ({ ...current, [confirmQuestion.id]: option.id }))
                            }
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ))}
                    <button
                      className="x-task-confirmgo"
                      disabled={!isConfirmReady || dispatchPending}
                      onClick={() => onConfirmDiscovery(lastReply.confirm!.turnId, confirmChoices)}
                      type="button"
                    >
                      {t("tasks.confirmGo")}
                    </button>
                  </div>
                ) : null}
                {lastReply.confirmedNote ? <p className="x-task-confirmed">{lastReply.confirmedNote}</p> : null}
              </div>
            </article>
          ) : null}

          {/* 发出去还没回来:话先摆上,下面三个点在呼吸,表示观察员在翻库。 */}
          {pendingQuestion ? (
            <article className="x-task-turn">
              <p className="x-task-you">{pendingQuestion}</p>
              <div className="x-task-agent">
                <p aria-label={t("tasks.thinking")} className="x-task-thinking" role="status">
                  <span />
                  <span />
                  <span />
                </p>
              </div>
            </article>
          ) : null}
        </div>

        {/* 输入区是一张浮在底部的圆角卡,工具条在卡里面,不是卡外面一条工具栏。 */}
        <form className="x-task-composer" onSubmit={onDispatchSubmit}>
          {dispatchError ? <p className="x-task-error">{dispatchError}</p> : null}
          <div className="x-task-composerbox">
            <textarea
              aria-label={t("tasks.dispatchLabel")}
              className="x-task-composerinput"
              disabled={dispatchPending}
              onChange={(event) => onDispatchTextChange(event.target.value)}
              placeholder={t("tasks.dispatchPlaceholder")}
              rows={1}
              value={dispatchText}
            />
            <div className="x-task-tools">
              <span className="x-task-toolnote">{t("tasks.groundedNote")}</span>
              <button
                aria-label={t("tasks.dispatchSubmit")}
                className="x-task-send"
                disabled={dispatchPending || !dispatchText.trim()}
                title={t("tasks.dispatchSubmit")}
                type="submit"
              >
                {dispatchPending ? <LoaderCircle className="x-task-spin" size={15} /> : <ArrowUp size={15} />}
              </button>
            </div>
          </div>
        </form>
      </main>

      {/* 右栏是浮起的一张卡:当前在看什么、边界在哪、该复习什么。用的是现有 ContextRail。 */}
      <aside className="x-task-rail">{contextRail}</aside>
    </div>
  );
}
