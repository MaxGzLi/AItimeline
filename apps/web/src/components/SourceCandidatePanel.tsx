import { Link, LoaderCircle, RefreshCw, Send, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import { formatCandidateStatus, formatShortTime } from "../lib/format";
import { t } from "../lib/i18n";
import type { SourceCandidateRecord } from "../lib/types";

export function SourceCandidatePanel({
  autoScoutEnabled,
  candidateConcept,
  candidateUrl,
  curationMessage,
  hasQueuedScoutWork,
  isSaving,
  isRunningCuration,
  lastScoutAt,
  message,
  onAutoScoutChange,
  onConceptChange,
  onRunCuration,
  onSubmit,
  onUrlChange,
  queuedJobCount,
  records
}: {
  autoScoutEnabled: boolean;
  candidateConcept: string;
  candidateUrl: string;
  curationMessage: string;
  hasQueuedScoutWork: boolean;
  isSaving: boolean;
  isRunningCuration: boolean;
  lastScoutAt: string | null;
  message: string;
  onAutoScoutChange: (value: boolean) => void;
  onConceptChange: (value: string) => void;
  onRunCuration: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUrlChange: (value: string) => void;
  queuedJobCount: number;
  records: SourceCandidateRecord[];
}) {
  return (
    <section className="x-cand-panel">
      <div className="x-cand-head">
        <div>
          <p className="x-label">{t("candidate.label")}</p>
          <h2>{t("candidate.queue")}</h2>
        </div>
        <button className="x-iconbtn" title={t("candidate.sourceTitle")}>
          <Link size={18} />
        </button>
      </div>

      <form className="x-cand-form" onSubmit={onSubmit}>
        <label className="x-cand-field">
          <Link size={16} />
          <input
            aria-label={t("candidate.url")}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder={t("candidate.urlPlaceholder")}
            value={candidateUrl}
          />
        </label>
        <label className="x-cand-field">
          <Sparkles size={16} />
          <input
            aria-label={t("candidate.topic")}
            onChange={(event) => onConceptChange(event.target.value)}
            placeholder={t("candidate.topicPlaceholder")}
            value={candidateConcept}
          />
        </label>
        <button className="x-pill start" disabled={isSaving} type="submit">
          {isSaving ? <LoaderCircle className="x-spin" size={16} /> : <Send size={16} />}
          <span>{isSaving ? t("candidate.queueing") : t("candidate.save")}</span>
        </button>
      </form>

      <div className="x-cand-note">{message}</div>

      <label className="x-cand-toggle">
        <input
          checked={autoScoutEnabled}
          onChange={(event) => onAutoScoutChange(event.target.checked)}
          type="checkbox"
        />
        <span>{t("candidate.autoScout")}</span>
        <strong>{hasQueuedScoutWork ? t("candidate.queuedJobs", { count: queuedJobCount }) : t("candidate.idle")}</strong>
      </label>

      <button className="x-cand-run" disabled={isRunningCuration} onClick={onRunCuration} type="button">
        {isRunningCuration ? <LoaderCircle className="x-spin" size={16} /> : <RefreshCw size={16} />}
        <span>{isRunningCuration ? t("candidate.running") : t("candidate.run")}</span>
      </button>
      <div className="x-cand-note">
        {curationMessage}
        {lastScoutAt ? ` · ${formatShortTime(lastScoutAt)}` : ""}
      </div>

      <div className="x-cand-list">
        {records.length > 0 ? (
          records.slice(0, 4).map((record) => (
            <div className={`x-cand-row ${record.status}`} key={record.id}>
              <div>
                <span>{record.candidate.source.title}</span>
                <small>
                  {formatCandidateStatus(record.status)} · {record.candidate.conceptIds.slice(0, 2).join(", ") || t("common.concept")}
                </small>
              </div>
              <strong>{Math.round(record.candidate.relevanceScore * 100)}</strong>
            </div>
          ))
        ) : (
          <div className="x-cand-empty">{t("candidate.empty")}</div>
        )}
      </div>
    </section>
  );
}
