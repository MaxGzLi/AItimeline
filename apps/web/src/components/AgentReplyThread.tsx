import { BadgeCheck, XCircle } from "lucide-react";
import { formatBoundaryZone } from "../lib/format";
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
    <div aria-label="智能体回复" role="region">
      <article className="x-post borderless">
        <span className="x-avatar" aria-hidden="true">
          你
        </span>
        <div className="x-post-main">
          <div className="x-head">
            <span className="x-name">你</span>
            <span className="x-meta">@you</span>
            <span className="x-meta">·</span>
            <span className="x-meta">刚刚</span>
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
            <span className="x-name">知识观察员</span>
            <BadgeCheck aria-label="有出处" className="x-verified" size={17} />
            <span className="x-meta">@ai-agent</span>
            <span className="x-meta">·</span>
            <span className="x-meta">回复 @you</span>
          </div>

          <p className={`x-zone ${zoneClassNames[turn.zone]}`.trim()}>这个问题{formatBoundaryZone(turn.zone)}</p>

          <p className="x-body">{turn.answer?.answer ?? turn.notes.join("\n") ?? "我还答不了这个问题。"}</p>

          {citation ? (
            <div className="x-quote" role="note">
              <span className="x-qhead">
                <span className="x-name">来源</span>
                <span className="x-meta">· {citation.sourceTitle}</span>
              </span>
              <p className="x-qtext">“{citation.quote}”</p>
            </div>
          ) : null}

          <div className="x-composer-foot">
            {turn.answerCardId ? (
              <button className="x-hint" onClick={() => onOpenCardId(turn.answerCardId as string)} type="button">
                打开相关知识卡
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
                  {discovery.status === "searching" ? "正在找来源…" : action.label}
                </button>
              ) : (
                <span className="x-chip" key={`${action.kind}-${action.label}`}>
                  {action.label}
                </span>
              )
            )}
            <button aria-label="收起回复" className="x-act" onClick={onDismiss} style={{ marginLeft: "auto" }} type="button">
              <XCircle size={16} />
              收起
            </button>
          </div>

          {discovery.status === "found" ? (
            <button className="x-hint" onClick={onOpenDiscover} type="button">
              找到 {discovery.count} 个候选来源 · 去「发现」整理
            </button>
          ) : null}
          {discovery.status === "empty" ? <p className="x-discover-note">没有找到新的来源,换个问法试试。</p> : null}
          {discovery.status === "unconfigured" ? (
            <p className="x-discover-note">
              还没配置搜索服务(.env 里的 AITIMELINE_SEARCH_API_KEY),先手动导入一个来源。
              <button className="x-hint" onClick={onOpenImport} type="button">
                去导入
              </button>
            </p>
          ) : null}
          {discovery.status === "error" ? <p className="x-discover-note">{discovery.message}</p> : null}
        </div>
      </article>
    </div>
  );
}
