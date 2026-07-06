import { BadgeCheck, XCircle } from "lucide-react";
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
  | { status: "empty" }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

// The composer's question + the observer's grounded reply, rendered as an
// inline thread at the top of the timeline (no jump back to a side panel).
export function AgentReplyThread({
  discovery,
  onDiscover,
  onDismiss,
  onOpenCardId,
  onOpenDiscover,
  onOpenImport,
  question,
  response
}: {
  discovery: DiscoveryRunState;
  onDiscover: (action: AgentReplyAction) => void;
  onDismiss: () => void;
  onOpenCardId: (cardId: string) => void;
  onOpenDiscover: () => void;
  onOpenImport: () => void;
  question: string;
  response: AgentAskApiResponse;
}) {
  const { turn } = response;
  const citation = turn.answer?.citations[0];

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
              action.kind === "discover_sources" ? (
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

          {discovery.status === "found" ? (
            <button className="x-hint" onClick={onOpenDiscover} type="button">
              {t("agent.discovery.found", { count: discovery.count })}
            </button>
          ) : null}
          {discovery.status === "empty" ? <p className="x-discover-note">{t("agent.discovery.empty")}</p> : null}
          {discovery.status === "unconfigured" ? (
            <p className="x-discover-note">
              {t("agent.discovery.unconfigured")}
              <button className="x-hint" onClick={onOpenImport} type="button">
                {t("agent.goImport")}
              </button>
            </p>
          ) : null}
          {discovery.status === "error" ? <p className="x-discover-note">{discovery.message}</p> : null}
        </div>
      </article>
    </div>
  );
}
