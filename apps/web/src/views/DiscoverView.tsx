import { LoaderCircle, RefreshCw } from "lucide-react";
import { formatCandidateStatus, formatRelativeTime } from "../lib/format";
import type { SourceCandidateRecord } from "../lib/types";

const intakeLabels: Record<SourceCandidateRecord["intakeKind"], string> = {
  user_paste: "你贴的链接",
  browser_share: "浏览器分享",
  agent_discovery: "观察员发现",
  manual: "手动加入"
};

// Discovery feed: candidate sources the observer wants to turn into cards.
export function DiscoverView({
  isRunning,
  message,
  onRunCuration,
  records
}: {
  isRunning: boolean;
  message: string;
  onRunCuration: () => void;
  records: SourceCandidateRecord[];
}) {
  return (
    <>
      <div className="x-composer">
        <span className="x-avatar agent" aria-hidden="true">
          AI
        </span>
        <div className="x-composer-main">
          <p className="x-body" style={{ paddingTop: 8 }}>
            {message}
          </p>
          <div className="x-composer-foot">
            <button className="x-pill start" disabled={isRunning} onClick={onRunCuration} type="button">
              {isRunning ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
              {isRunning ? "整理中" : "立即整理"}
            </button>
          </div>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="x-empty">还没有候选来源。观察员发现新来源后会先在这里排队。</p>
      ) : (
        records.map((record) => (
          <div className="x-cand" key={record.id}>
            <span className="x-avatar small" aria-hidden="true">
              {(record.candidate.conceptIds[0] ?? "源").slice(0, 2)}
            </span>
            <div className="x-cmain">
              <p className="x-cmeta">
                {intakeLabels[record.intakeKind]} · {formatRelativeTime(record.createdAt)} ·{" "}
                {record.candidate.conceptIds.slice(0, 3).join("、")}
              </p>
              <p className="x-ctitle">{record.candidate.source.title}</p>
              <p className="x-cwhy">{record.candidate.reason}</p>
            </div>
            <span className={`x-chip${record.status === "imported" ? " ok" : ""}`}>
              {formatCandidateStatus(record.status)}
            </span>
          </div>
        ))
      )}
    </>
  );
}
