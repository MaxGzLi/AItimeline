import { Link, LoaderCircle, RefreshCw, Send, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import { formatCandidateStatus, formatShortTime } from "../lib/format";
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
    <section className="context-section candidate-section">
      <div className="rail-heading">
        <div>
          <p className="section-label">来源队列</p>
          <h2>候选源</h2>
        </div>
        <button className="icon-button compact" title="候选来源">
          <Link size={18} />
        </button>
      </div>

      <form className="candidate-form" onSubmit={onSubmit}>
        <label className="candidate-input">
          <Link size={16} />
          <input
            aria-label="候选来源 URL"
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="来源 URL"
            value={candidateUrl}
          />
        </label>
        <label className="candidate-input">
          <Sparkles size={16} />
          <input
            aria-label="候选话题"
            onChange={(event) => onConceptChange(event.target.value)}
            placeholder="话题"
            value={candidateConcept}
          />
        </label>
        <button className="primary-action candidate-submit" disabled={isSaving} type="submit">
          {isSaving ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
          <span>{isSaving ? "排队中" : "加入队列"}</span>
        </button>
      </form>

      <div className="candidate-message">{message}</div>

      <label className="auto-scout-toggle">
        <input
          checked={autoScoutEnabled}
          onChange={(event) => onAutoScoutChange(event.target.checked)}
          type="checkbox"
        />
        <span>自动观察员</span>
        <strong>{hasQueuedScoutWork ? `${queuedJobCount} 个排队任务` : "空闲"}</strong>
      </label>

      <button className="secondary-action candidate-worker" disabled={isRunningCuration} onClick={onRunCuration} type="button">
        {isRunningCuration ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
        <span>{isRunningCuration ? "运行中" : "运行观察员"}</span>
      </button>
      <div className="candidate-message">
        {curationMessage}
        {lastScoutAt ? ` · ${formatShortTime(lastScoutAt)}` : ""}
      </div>

      <div className="candidate-list">
        {records.length > 0 ? (
          records.slice(0, 4).map((record) => (
            <div className={`candidate-row ${record.status}`} key={record.id}>
              <div>
                <span>{record.candidate.source.title}</span>
                <small>
                  {formatCandidateStatus(record.status)} · {record.candidate.conceptIds.slice(0, 2).join("、") || "通用"}
                </small>
              </div>
              <strong>{Math.round(record.candidate.relevanceScore * 100)}</strong>
            </div>
          ))
        ) : (
          <div className="empty-state">还没有候选源</div>
        )}
      </div>
    </section>
  );
}
