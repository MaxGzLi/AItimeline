import { BadgeCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatBoundaryZone } from "../lib/format";
import { t } from "../lib/i18n";
import type { AgentAskApiResponse, AgentBoundaryZone } from "../lib/types";

const zoneClassNames: Record<AgentBoundaryZone, string> = {
  inside: "inside",
  learning: "learning",
  frontier: "",
  dark: "dark-zone"
};

export type AgentReplyAction = AgentAskApiResponse["turn"]["actions"][number];

export type DiscoveryRunState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "found"; count: number }
  | { status: "empty"; count: number }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

// The composer's question + the observer's grounded reply, rendered as an
// inline thread at the top of the timeline (no jump back to a side panel).
export function AgentReplyThread({
  discovery,
  onDiscover,
  onConfirm,
  onDismiss,
  onOpenCardId,
  onOpenDiscover,
  question,
  response,
  turnStatus
}: {
  discovery: DiscoveryRunState;
  onDiscover: (action: AgentReplyAction) => void;
  onConfirm: (action: AgentReplyAction, choices: Record<string, string>) => void;
  onDismiss: () => void;
  onOpenCardId: (cardId: string) => void;
  onOpenDiscover: () => void;
  question: string;
  response: AgentAskApiResponse;
  turnStatus?: string;
}) {
  const { turn } = response;
  const citation = turn.answer?.citations[0];
  const [choices, setChoices] = useState<Record<string, string>>({});
  const confirmAction = useMemo(
    () => turn.actions.find((action) => action.kind === "confirm_discovery"),
    [turn.actions]
  );
  const confirmQuestions = confirmAction?.questions ?? [];
  const isConfirmReady =
    confirmQuestions.length > 0 && confirmQuestions.every((confirmQuestion) => choices[confirmQuestion.id]);
  const effectiveTurnStatus = turnStatus ?? response.turnRecord?.status;

  useEffect(() => {
    setChoices({});
  }, [response.turnRecord?.id]);

  return (
    <div aria-label={t("agent.threadLabel")} role="region">
      <article className="x-post borderless">
        <span className="x-avatar" aria-hidden="true">
          {t("common.you")}
        </span>
        <div className="x-post-main">
          <div className="x-head">
            <span className="x-name">{t("common.you")}</span>
            <span className="x-meta">@you</span>
            <span className="x-meta">·</span>
            <span className="x-meta">{t("format.relative.justNow")}</span>
          </div>
          <p className="x-body">{question}</p>
        </div>
      </article>

      <article className="x-post">
        <span className="x-avatar agent" aria-hidden="true">
          AI
        </span>
        <div className="x-post-main">
          <div className="x-head">
            <span className="x-name">{t("agent.name")}</span>
            <BadgeCheck aria-label={t("post.hasSource")} className="x-verified" size={17} />
            <span className="x-meta">@ai-agent</span>
            <span className="x-meta">·</span>
            <span className="x-meta">{t("agent.replyToYou")}</span>
          </div>

          <p className={`x-zone ${zoneClassNames[turn.zone]}`.trim()}>
            {t("agent.boundaryPrefix", { zone: formatBoundaryZone(turn.zone) })}
          </p>

          <p className="x-body">{turn.answer?.answer ?? turn.notes.join("\n") ?? t("agent.askFallback")}</p>

          {turn.nearestPosts?.length ? (
            <div className="x-nearest" role="list">
              {turn.nearestPosts.map((nearestPost) => (
                <button
                  className="x-hint"
                  key={nearestPost.postId}
                  onClick={() => onOpenCardId(nearestPost.postId)}
                  type="button"
                >
                  {t("agent.nearestPost", { title: nearestPost.title })}
                </button>
              ))}
            </div>
          ) : null}

          {citation ? (
            <div className="x-quote" role="note">
              <span className="x-qhead">
                <span className="x-name">{t("agent.citationLabel")}</span>
                <span className="x-meta">· {citation.sourceTitle}</span>
              </span>
              <p className="x-qtext">“{citation.quote}”</p>
            </div>
          ) : null}

          <div className="x-composer-foot">
            {turn.answerCardId ? (
              <button className="x-hint" onClick={() => onOpenCardId(turn.answerCardId as string)} type="button">
                {t("agent.openRelatedCard")}
              </button>
            ) : null}
            {turn.actions.map((action) =>
              action.kind === "confirm_discovery" ? (
                <div className="x-confirm" key={`${action.kind}-${action.label}`}>
                  {action.questions?.map((confirmQuestion) => (
                    <div className="x-confirm-row" key={confirmQuestion.id}>
                      <span className="x-meta">{confirmQuestion.label}</span>
                      <div className="x-confirm-options">
                        {confirmQuestion.options.map((option) => {
                          const selected = choices[confirmQuestion.id] === option.id;

                          return (
                            <button
                              aria-pressed={selected}
                              className={`x-chip action${selected ? " active" : ""}`}
                              key={option.id}
                              onClick={() =>
                                setChoices((current) => ({
                                  ...current,
                                  [confirmQuestion.id]: option.id
                                }))
                              }
                              type="button"
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <button
                    className="x-chip action"
                    disabled={!isConfirmReady || effectiveTurnStatus !== "pending_confirmation"}
                    onClick={() => onConfirm(action, choices)}
                    type="button"
                  >
                    {effectiveTurnStatus === "researching" ? t("agent.research.working") : t("agent.confirm.submit")}
                  </button>
                </div>
              ) : action.kind === "discover_sources" ? (
                <button
                  className="x-chip action"
                  disabled={discovery.status === "searching"}
                  key={`${action.kind}-${action.label}`}
                  onClick={() => onDiscover(action)}
                  type="button"
                >
                  {discovery.status === "searching" ? t("agent.discovery.searching") : action.label}
                </button>
              ) : (
                <span className="x-chip" key={`${action.kind}-${action.label}`}>
                  {action.label}
                </span>
              )
            )}
            <button aria-label={t("agent.dismiss")} className="x-act" onClick={onDismiss} style={{ marginLeft: "auto" }} type="button">
              <XCircle size={16} />
              {t("agent.dismiss")}
            </button>
          </div>

          {effectiveTurnStatus === "researching" ? (
            <p className="x-discover-note" role="status">
              {t("agent.research.status.searching")}
            </p>
          ) : null}
          {effectiveTurnStatus === "answered" && confirmAction ? (
            <p className="x-discover-note" role="status">
              {t("agent.research.status.answered")}
            </p>
          ) : null}
          {effectiveTurnStatus === "closed" && confirmAction ? (
            <p className="x-discover-note" role="status">
              {t("agent.research.status.closed")}
            </p>
          ) : null}

          {discovery.status === "found" ? (
            <button className="x-hint" onClick={onOpenDiscover} type="button">
              {t("agent.discovery.found", { count: discovery.count })}
            </button>
          ) : null}
          {discovery.status === "empty" ? (
            <button className="x-hint" onClick={onOpenDiscover} type="button">
              {t("agent.discovery.empty", { count: discovery.count })}
            </button>
          ) : null}
          {discovery.status === "unconfigured" ? (
            <p className="x-discover-note">{t("agent.discovery.unconfigured")}</p>
          ) : null}
          {discovery.status === "error" ? <p className="x-discover-note">{discovery.message}</p> : null}
        </div>
      </article>
    </div>
  );
}
