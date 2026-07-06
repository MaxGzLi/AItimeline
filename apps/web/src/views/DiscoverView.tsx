import { LoaderCircle, RefreshCw } from "lucide-react";
import { formatCandidateStatus, formatRelativeTime } from "../lib/format";
import { getI18nLanguage, t } from "../lib/i18n";
import type { SourceCandidateRecord } from "../lib/types";

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
              {isRunning ? <LoaderCircle className="x-spin" size={16} /> : <RefreshCw size={16} />}
              {isRunning ? t("discover.running") : t("discover.run")}
            </button>
          </div>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="x-empty">{t("discover.empty")}</p>
      ) : (
        records.map((record) => (
          <div className="x-cand" key={record.id}>
            <span className="x-avatar small" aria-hidden="true">
              {(record.candidate.conceptIds[0] ?? t("common.source")).slice(0, 2)}
            </span>
            <div className="x-cmain">
              <p className="x-cmeta">
                {t(`discover.intake.${record.intakeKind}`)} · {formatRelativeTime(record.createdAt)} ·{" "}
                {record.candidate.conceptIds.slice(0, 3).join(getI18nLanguage() === "en" ? ", " : "、")}
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
