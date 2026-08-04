import { ArrowUp, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
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

  // 换一轮对话就把上一轮的勾选清掉,免得把旧选择带进新的确认。
  useEffect(() => {
    setConfirmChoices({});
  }, [confirmTurnId]);

  return (
    <div className="x-task-client">
      <aside className="x-task-side">
        <div className="x-task-brand">
          <span className="x-task-logo">AI</span>
          <span className="x-task-brandname">AITimeline</span>
          <span className="x-task-counts">
            {runningCount > 0 ? <em className="running">{t("tasks.countRunning", { count: runningCount })}</em> : null}
            {failedCount > 0 ? <em className="failed">{t("tasks.countFailed", { count: failedCount })}</em> : null}
          </span>
        </div>

        {/* 派活框照 Codex 的 composer:无边框、底色跟「一条还没发出去的消息」一样,
            左边一个加粗的 › 提示符。 */}
        <form className="x-task-dispatch" onSubmit={onDispatchSubmit}>
          <span aria-hidden="true" className="x-task-caret">
            ›
          </span>
          <textarea
            aria-label={t("tasks.dispatchLabel")}
            className="x-task-dispatch-input"
            disabled={dispatchPending}
            onChange={(event) => onDispatchTextChange(event.target.value)}
            placeholder={t("tasks.dispatchPlaceholder")}
            rows={2}
            value={dispatchText}
          />
          <button
            aria-label={t("tasks.dispatchSubmit")}
            className="x-task-dispatch-send"
            disabled={dispatchPending || !dispatchText.trim()}
            title={t("tasks.dispatchSubmit")}
            type="submit"
          >
            {dispatchPending ? <LoaderCircle className="x-task-spin" size={15} /> : <ArrowUp size={15} />}
          </button>
        </form>
        {dispatchError ? <p className="x-task-error">{dispatchError}</p> : null}

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
                  <span className="x-task-rowbody">
                    <span className="x-task-rowtitle">{task.title}</span>
                    <span className="x-task-rowmeta">
                      {task.origin === "you" ? <em className="you">{t("tasks.originYou")}</em> : null}
                      <span>{formatRelativeTime(task.updatedAt)}</span>
                      {task.producedCount > 0 ? <span>{t("tasks.produced", { count: task.producedCount })}</span> : null}
                      {task.status === "failed" ? <span className="failed">{t("tasks.failedShort")}</span> : null}
                    </span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>

        <nav className="x-task-secondary" aria-label={t("tasks.secondaryNav")}>
          {secondaryNav}
        </nav>
      </aside>

      <main className="x-task-detail">
        {/* 观察员对刚才那句话的回话。答案正文不进快照,所以只活在这一次会话里。 */}
        {lastReply ? (
          <div className="x-task-detailbody x-task-replywrap">
            <div className="x-task-reply">
              <span aria-hidden="true" className="x-task-bullet">
                •
              </span>
              <div>
                <p className="x-task-replytext">{lastReply.text}</p>
                {lastReply.quote ? (
                  <p className="x-task-replyquote">
                    {lastReply.quote}
                    {lastReply.sourceTitle ? <em>{lastReply.sourceTitle}</em> : null}
                  </p>
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
            </div>
          </div>
        ) : null}
        {!detail && detailLoading ? <p className="x-task-empty">{t("tasks.loading")}</p> : null}
        {!detail && !detailLoading && !lastReply ? <p className="x-task-empty">{t("tasks.pickOne")}</p> : null}
        {detail ? (
          <article className="x-task-detailbody">
            <header className="x-task-detailhead">
              <p className="x-task-kicker">
                <span>{detail.task.kindLabel}</span>
                <span>{formatRelativeTime(detail.task.updatedAt)}</span>
                {detail.task.attempts > 1 ? <span>{t("tasks.attempts", { count: detail.task.attempts })}</span> : null}
              </p>
              <h1>{detail.task.title}</h1>
              {detail.task.reason ? <p className="x-task-reason">{detail.task.reason}</p> : null}
              {detail.task.retryable ? (
                <button
                  className="x-task-retry"
                  disabled={retryingId === detail.task.id}
                  onClick={() => onRetry(detail.task.id)}
                  type="button"
                >
                  {retryingId === detail.task.id ? (
                    <LoaderCircle className="x-task-spin" size={14} />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                  <span>{t("tasks.retry")}</span>
                </button>
              ) : null}
            </header>

            {/* 步骤流照 Codex 的历史单元:每步一个 • 前缀,附属行走 │ / └ 的槽,
                最后一步是一整行淡横线收尾。 */}
            <ol className="x-task-steps">
              {detail.steps.map((step, index) => {
                const isLast = index === detail.steps.length - 1;
                const closes = isLast && (step.kind === "succeeded" || step.kind === "failed");

                if (closes) {
                  return (
                    <li className={`x-task-rule ${step.kind}`} key={`${step.kind}-${index}`}>
                      <span className="x-task-ruletext">
                        {step.text}
                        {step.note ? ` · ${step.note}` : ""}
                        {step.at ? ` · ${formatShortTime(step.at)}` : ""}
                      </span>
                    </li>
                  );
                }

                return (
                  <li className={`x-task-step ${step.kind}`} key={`${step.kind}-${index}`}>
                    <span aria-hidden="true" className="x-task-bullet">
                      •
                    </span>
                    <span className="x-task-steptext">
                      <span className="x-task-stepline">
                        {step.text}
                        {step.at ? <em className="at">{formatShortTime(step.at)}</em> : null}
                        {step.note ? <em>{step.note}</em> : null}
                      </span>
                      {step.items?.length ? (
                        <span className="x-task-stepitems">
                          {step.items.map((item, itemIndex) => (
                            <span className="x-task-stepitem" key={`${item.title}-${item.url ?? ""}`}>
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
                );
              })}
            </ol>

            {detail.produced.length ? (
              <section className="x-task-produced">
                <h2>{t("tasks.producedHeading", { count: detail.produced.length })}</h2>
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
          </article>
        ) : null}
      </main>
    </div>
  );
}
