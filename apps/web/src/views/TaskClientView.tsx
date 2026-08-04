import { ArrowUp, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatRelativeTime, formatShortTime } from "../lib/format";
import { t } from "../lib/i18n";
import { groupAgentTasks, type AgentTaskDetailResponse, type AgentTaskStatus, type AgentTaskSummary } from "../lib/tasks";
import type { AgentDispatchReply } from "../lib/useAgentTasks";

// 状态点用一个字符表明,不用彩色徽章——设计语法要扁平,不要模板脸。
const statusGlyphs: Record<AgentTaskStatus, string> = {
  queued: "○",
  running: "◐",
  succeeded: "●",
  failed: "×",
  skipped: "–"
};

export interface TaskClientViewProps {
  detail: AgentTaskDetailResponse | null;
  detailLoading: boolean;
  dispatchError: string | null;
  dispatchPending: boolean;
  dispatchText: string;
  failedCount: number;
  lastReply: AgentDispatchReply | null;
  listError: string | null;
  onConfirmDiscovery: (turnId: string, choices: Record<string, string>) => void;
  onDispatchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDispatchTextChange: (value: string) => void;
  onOpenCard: (cardId: string) => void;
  onRetry: (taskId: string) => void;
  onSelectTask: (taskId: string) => void;
  retryingId: string | null;
  runningCount: number;
  secondaryNav: React.ReactNode;
  selectedTaskId: string | null;
  tasks: AgentTaskSummary[];
  tasksLoading: boolean;
}

/**
 * 一轮跑了多久。Codex 每一轮结尾是一条通栏横线加「用了 X」,那个数字要有出处,
 * 所以只在头尾两步都带时间戳时才算,算不出来就不写。
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
  detail,
  detailLoading,
  dispatchError,
  dispatchPending,
  dispatchText,
  failedCount,
  lastReply,
  listError,
  onConfirmDiscovery,
  onDispatchSubmit,
  onDispatchTextChange,
  onOpenCard,
  onRetry,
  onSelectTask,
  retryingId,
  runningCount,
  secondaryNav,
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

  // 换一轮对话就把上一轮的勾选清掉,免得把旧选择带进新的确认。
  useEffect(() => {
    setConfirmChoices({});
  }, [confirmTurnId]);

  // 新回话接在最下面,得自己滚下去——否则答案和「要不要去外面找」都被挡在屏幕外。
  useEffect(() => {
    const stream = streamRef.current;

    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [detail?.task.id, lastReply]);

  return (
    <div className="x-task-client">
      <aside className="x-task-side">
        <div className="x-task-brand">
          <span className="x-task-brandname">AITimeline</span>
          <span className="x-task-counts">
            {runningCount > 0 ? <em className="running">{t("tasks.countRunning", { count: runningCount })}</em> : null}
            {failedCount > 0 ? <em className="failed">{t("tasks.countFailed", { count: failedCount })}</em> : null}
          </span>
        </div>

        <div className="x-task-list">
          {listError ? <p className="x-task-error">{listError}</p> : null}
          {!listError && tasks.length === 0 ? (
            <p className="x-task-empty">{tasksLoading ? t("tasks.loading") : t("tasks.empty")}</p>
          ) : null}
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="x-task-groupname">{t(`tasks.group.${group.key}`)}</h2>
              {group.tasks.map((task) => (
                <button
                  aria-current={task.id === selectedTaskId ? "true" : undefined}
                  className={`x-task-row${task.id === selectedTaskId ? " active" : ""}`}
                  key={task.id}
                  onClick={() => onSelectTask(task.id)}
                  type="button"
                >
                  <span className={`x-task-dot ${task.status}`}>{statusGlyphs[task.status] ?? "○"}</span>
                  <span className="x-task-rowtitle">{task.title}</span>
                  <span className="x-task-rowtime">{formatRelativeTime(task.updatedAt)}</span>
                </button>
              ))}
            </section>
          ))}
        </div>

        {/* 旧视图退成不起眼的一行小字。它们不是这一屏的主角,不该占八个格子。 */}
        <nav className="x-task-secondary" aria-label={t("tasks.secondaryNav")}>
          {secondaryNav}
        </nav>
      </aside>

      <main className="x-task-main">
        <div className="x-task-stream" ref={streamRef}>
          {!detail && detailLoading ? <p className="x-task-empty">{t("tasks.loading")}</p> : null}
          {!detail && !detailLoading && !lastReply ? <p className="x-task-empty">{t("tasks.pickOne")}</p> : null}

          {detail ? (
            <article className="x-task-turn">
              {/* 一轮的开头是「你说的话」:派的这个活本身。 */}
              <p className="x-task-said">{detail.task.title}</p>

              <p className="x-task-meta">
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

              {/* 派活理由是「它为什么在做这件事」,照 Codex 的思考行:暗色斜体,不抢戏。 */}
              {detail.task.reason ? <p className="x-task-think">{detail.task.reason}</p> : null}

              <ol className="x-task-cells">
                {detail.steps.map((step, index) => (
                  <li className={`x-task-cell ${step.kind}`} key={`${step.kind}-${index}`}>
                    <span aria-hidden="true" className="x-task-bullet">
                      •
                    </span>
                    <span className="x-task-celltext">
                      <span className="x-task-cellline">
                        {step.text}
                        {step.at ? <em className="at">{formatShortTime(step.at)}</em> : null}
                        {step.note ? <em>{step.note}</em> : null}
                      </span>
                      {step.items?.length ? (
                        <span className="x-task-cellitems">
                          {step.items.map((item, itemIndex) => (
                            <span className="x-task-cellitem" key={`${item.title}-${item.url ?? ""}`}>
                              <span aria-hidden="true" className="x-task-gutter">
                                {itemIndex === step.items!.length - 1 ? "└" : "│"}
                              </span>
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
                    </span>
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

              {/* 一轮的收尾:一条通栏横线,左边写这轮用了多久。 */}
              <p className="x-task-rule">
                <span className="x-task-ruletext">
                  {elapsed ?? t(`tasks.status.${detail.task.status}`)}
                </span>
              </p>
            </article>
          ) : null}

          {/* 你刚说的那句话和观察员的回话。答案正文不进快照,只活在这一次会话里。 */}
          {lastReply ? (
            <article className="x-task-turn">
              <p className="x-task-said">{lastReply.question}</p>
              <div className="x-task-cell">
                <span aria-hidden="true" className="x-task-bullet">
                  •
                </span>
                <span className="x-task-celltext">
                  <span className="x-task-answer">{lastReply.text}</span>
                  {lastReply.quote ? (
                    <span className="x-task-quote">
                      {lastReply.quote}
                      {lastReply.sourceTitle ? <em>{lastReply.sourceTitle}</em> : null}
                    </span>
                  ) : null}
                </span>
              </div>

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
            </article>
          ) : null}
        </div>

        {/* Codex 的 composer:贴在主列底部、没有边框,左边一个加粗的 › 提示符。 */}
        <form className="x-task-composer" onSubmit={onDispatchSubmit}>
          {dispatchError ? <p className="x-task-error">{dispatchError}</p> : null}
          <div className="x-task-composerrow">
            <span aria-hidden="true" className="x-task-caret">
              ›
            </span>
            <textarea
              aria-label={t("tasks.dispatchLabel")}
              className="x-task-composerinput"
              disabled={dispatchPending}
              onChange={(event) => onDispatchTextChange(event.target.value)}
              placeholder={t("tasks.dispatchPlaceholder")}
              rows={1}
              value={dispatchText}
            />
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
        </form>
      </main>
    </div>
  );
}
