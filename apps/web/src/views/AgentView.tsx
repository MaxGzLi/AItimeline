import type { SourceImport, SubscriptionRecord } from "@aitimeline/core";
import { ChevronDown, ChevronUp, LoaderCircle, Plus, Rss, Trash2 } from "lucide-react";
import type { FormEvent } from "react";
import { ImportRow } from "../components/ImportRow";
import { SourceCandidatePanel } from "../components/SourceCandidatePanel";
import { SourceImportPanel } from "../components/SourceImportPanel";
import { formatShortTime } from "../lib/format";
import { t } from "../lib/i18n";
import type { ApiStatus, SourceCandidateRecord, SubscriptionBacklogView } from "../lib/types";

function backlogStatusKey(status: string): string {
  if (status === "pending" || status === "queued" || status === "imported" || status === "skipped") {
    return status;
  }

  return "failed";
}

export function AgentView({
  agentTurnCount,
  apiMessage,
  apiStatus,
  autoScoutEnabled,
  backlogBusyIds,
  backlogViews,
  candidateConcept,
  candidateMessage,
  candidateUrl,
  cardCount,
  curationMessage,
  expandedBacklogIds,
  hasQueuedScoutWork,
  importError,
  isImporting,
  isRunningCuration,
  isSavingCandidate,
  isSavingSubscription,
  lastScoutAt,
  memoryMessage,
  onAutoScoutChange,
  onCandidateConceptChange,
  onCandidateUrlChange,
  onCatalogBacklog,
  onDeleteSubscription,
  onDigestBacklog,
  onImportSubmit,
  onPrioritizeBacklogEntry,
  onRunCuration,
  onSaveCandidate,
  onSourceUrlChange,
  onSubscriptionFilterChange,
  onSubscriptionSubmit,
  onSubscriptionUrlChange,
  onToggleBacklog,
  queuedJobCount,
  sourceCandidates,
  sourceImports,
  sourceUrl,
  subscriptionMessage,
  subscriptions,
  subscriptionUrl,
  deletingSubscriptionIds,
  updatingSubscriptionIds
}: {
  agentTurnCount: number;
  apiMessage: string;
  apiStatus: ApiStatus;
  autoScoutEnabled: boolean;
  backlogBusyIds: string[];
  backlogViews: Record<string, SubscriptionBacklogView>;
  candidateConcept: string;
  candidateMessage: string;
  candidateUrl: string;
  cardCount: number;
  curationMessage: string;
  expandedBacklogIds: string[];
  hasQueuedScoutWork: boolean;
  importError: string | null;
  isImporting: boolean;
  isRunningCuration: boolean;
  isSavingCandidate: boolean;
  isSavingSubscription: boolean;
  lastScoutAt: string | null;
  memoryMessage: string;
  onAutoScoutChange: (value: boolean) => void;
  onCandidateConceptChange: (value: string) => void;
  onCandidateUrlChange: (value: string) => void;
  onCatalogBacklog: (id: string) => void;
  onDeleteSubscription: (id: string) => void;
  onDigestBacklog: (id: string) => void;
  onImportSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPrioritizeBacklogEntry: (subscriptionId: string, candidateId: string) => void;
  onRunCuration: () => void;
  onSaveCandidate: (event: FormEvent<HTMLFormElement>) => void;
  onSourceUrlChange: (value: string) => void;
  onSubscriptionFilterChange: (id: string, filterMode: SubscriptionRecord["filterMode"]) => void;
  onSubscriptionSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSubscriptionUrlChange: (value: string) => void;
  onToggleBacklog: (id: string) => void;
  queuedJobCount: number;
  sourceCandidates: SourceCandidateRecord[];
  sourceImports: SourceImport[];
  sourceUrl: string;
  subscriptionMessage: string;
  subscriptions: SubscriptionRecord[];
  subscriptionUrl: string;
  deletingSubscriptionIds: string[];
  updatingSubscriptionIds: string[];
}) {
  const rejectedSourceCandidates = sourceCandidates.filter((record) => record.status === "rejected_source");
  const activeSourceCandidates = sourceCandidates.filter((record) => record.status !== "rejected_source");
  const deletingSubscriptionSet = new Set(deletingSubscriptionIds);
  const updatingSubscriptionSet = new Set(updatingSubscriptionIds);
  const backlogBusySet = new Set(backlogBusyIds);
  const expandedBacklogSet = new Set(expandedBacklogIds);

  return (
    <>
      <section className="x-mr" id="agent-source-import" aria-label={t("mr.sourceImport")}>
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          {t("mr.sourceImport")}
        </h2>
        <SourceImportPanel
          apiMessage={apiMessage}
          apiStatus={apiStatus}
          cardCount={cardCount}
          error={importError}
          isImporting={isImporting}
          latestImport={sourceImports[0]}
          onSubmit={onImportSubmit}
          onUrlChange={onSourceUrlChange}
          url={sourceUrl}
        />
      </section>

      <section className="x-mr" id="agent-subscriptions" aria-label={t("mr.subscriptions")}>
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          {t("mr.subscriptions")}
        </h2>
        <section className="x-sub-panel">
          <form className="x-import-form" onSubmit={onSubscriptionSubmit}>
            <label className="x-import-field">
              <Rss size={16} />
              <input
                aria-label={t("subscription.title")}
                onChange={(event) => onSubscriptionUrlChange(event.target.value)}
                placeholder={t("subscription.placeholder")}
                value={subscriptionUrl}
              />
            </label>
            <button className="x-pill start" disabled={isSavingSubscription} type="submit">
              {isSavingSubscription ? <LoaderCircle className="x-spin" size={16} /> : <Plus size={16} />}
              <span>{isSavingSubscription ? t("subscription.adding") : t("subscription.add")}</span>
            </button>
          </form>
          <div className="x-cand-note">{subscriptionMessage}</div>

          {subscriptions.length === 0 ? (
            <div className="x-cand-empty">{t("subscription.empty")}</div>
          ) : (
            <div className="x-sub-list">
              {subscriptions.map((subscription) => (
                <article className="x-sub-row" key={subscription.id}>
                  <div className="x-sub-main">
                    <div className="x-sub-titleline">
                      <strong>{subscription.title}</strong>
                      <span className="x-chip">{t(`subscription.kind.${subscription.kind}`)}</span>
                    </div>
                    <small>
                      {subscription.lastPolledAt
                        ? t("subscription.lastPolled", { time: formatShortTime(subscription.lastPolledAt) })
                        : t("subscription.neverPolled")}
                      {subscription.lastError ? ` · ${t("subscription.lastError", { message: subscription.lastError })}` : ""}
                    </small>
                  </div>
                  <div className="x-sub-actions">
                    {(["relevant", "all", "listOnly"] as const).map((mode) => (
                      <button
                        className={`x-chip action${subscription.filterMode === mode ? " active" : ""}`}
                        disabled={updatingSubscriptionSet.has(subscription.id)}
                        key={mode}
                        onClick={() => onSubscriptionFilterChange(subscription.id, mode)}
                        type="button"
                      >
                        {t(`subscription.filter.${mode}`)}
                      </button>
                    ))}
                    <button
                      className="x-iconbtn"
                      disabled={deletingSubscriptionSet.has(subscription.id)}
                      onClick={() => onDeleteSubscription(subscription.id)}
                      title={t("subscription.delete")}
                      type="button"
                    >
                      {deletingSubscriptionSet.has(subscription.id) ? (
                        <LoaderCircle className="x-spin" size={16} />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                  {subscription.kind === "youtube_channel" ? (
                    <div className="x-sub-backlog">
                      <div className="x-sub-backlog-head">
                        {!subscription.backlog ? (
                          <button
                            className="x-chip action"
                            disabled={backlogBusySet.has(subscription.id)}
                            onClick={() => onCatalogBacklog(subscription.id)}
                            type="button"
                          >
                            {backlogBusySet.has(subscription.id) ? <LoaderCircle className="x-spin" size={12} /> : null}
                            {backlogBusySet.has(subscription.id)
                              ? t("subscription.backlog.starting")
                              : t("subscription.backlog.start")}
                          </button>
                        ) : (
                          <>
                            <span>
                              {backlogViews[subscription.id]
                                ? t("subscription.backlog.progress", {
                                    imported: backlogViews[subscription.id].summary.imported,
                                    total: subscription.backlog.videoCount
                                  })
                                : t("subscription.backlog.size", { total: subscription.backlog.videoCount })}
                              {backlogViews[subscription.id]?.summary.skipped
                                ? ` · ${t("subscription.backlog.skippedCount", {
                                    count: backlogViews[subscription.id].summary.skipped
                                  })}`
                                : ""}
                            </span>
                            <button
                              className="x-chip action"
                              disabled={backlogBusySet.has(subscription.id)}
                              onClick={() => onDigestBacklog(subscription.id)}
                              type="button"
                            >
                              {backlogBusySet.has(subscription.id) ? <LoaderCircle className="x-spin" size={12} /> : null}
                              {t("subscription.backlog.digest")}
                            </button>
                            <button className="x-chip action" onClick={() => onToggleBacklog(subscription.id)} type="button">
                              {expandedBacklogSet.has(subscription.id) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              {t("subscription.backlog.catalog")}
                            </button>
                          </>
                        )}
                      </div>
                      {subscription.backlog && expandedBacklogSet.has(subscription.id) ? (
                        backlogViews[subscription.id] ? (
                          <div className="x-sub-backlog-list">
                            {backlogViews[subscription.id].entries.map((entry) => (
                              <div className="x-sub-backlog-item" key={entry.candidateId}>
                                <span className="title">
                                  {entry.order + 1}. {entry.title}
                                </span>
                                <span className={`x-sub-backlog-status ${backlogStatusKey(entry.status)}`}>
                                  {t(`subscription.backlog.status.${backlogStatusKey(entry.status)}`)}
                                </span>
                                {entry.status === "pending" ? (
                                  <button
                                    className="x-chip action"
                                    disabled={entry.prioritized}
                                    onClick={() => onPrioritizeBacklogEntry(subscription.id, entry.candidateId)}
                                    type="button"
                                  >
                                    {entry.prioritized
                                      ? t("subscription.backlog.prioritized")
                                      : t("subscription.backlog.prioritize")}
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="x-cand-note">{t("subscription.backlog.loading")}</div>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="x-mr" aria-label={t("mr.observer")}>
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          {t("mr.observer")}
        </h2>
        <SourceCandidatePanel
          autoScoutEnabled={autoScoutEnabled}
          candidateConcept={candidateConcept}
          candidateUrl={candidateUrl}
          curationMessage={curationMessage}
          hasQueuedScoutWork={hasQueuedScoutWork}
          isRunningCuration={isRunningCuration}
          isSaving={isSavingCandidate}
          lastScoutAt={lastScoutAt}
          message={candidateMessage}
          onAutoScoutChange={onAutoScoutChange}
          onConceptChange={onCandidateConceptChange}
          onRunCuration={onRunCuration}
          onSubmit={onSaveCandidate}
          onUrlChange={onCandidateUrlChange}
          queuedJobCount={queuedJobCount}
          records={activeSourceCandidates}
        />
        {rejectedSourceCandidates.length ? (
          <div style={{ padding: "12px 16px 0" }}>
            <h3 className="x-mrnote" style={{ margin: "0 0 8px" }}>
              {t("mr.rejectedSources")}
            </h3>
            <div style={{ display: "grid", gap: 8 }}>
              {rejectedSourceCandidates.slice(0, 5).map((record) => {
                const reasons = record.rejectionReasons ?? record.qualityGate?.reasons ?? [];

                return (
                  <article className="x-import-row" key={record.id}>
                    <strong>{record.candidate.source.title}</strong>
                    <p>{reasons.slice(0, 2).join(" · ") || t("mr.rejectedSources.noReason")}</p>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="x-mr" aria-label={t("mr.imports")}>
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          {t("mr.imports")}
        </h2>
        {sourceImports.length === 0 ? (
          <p className="x-mrnote">{t("mr.imports.empty")}</p>
        ) : (
          <div style={{ padding: "0 16px" }}>
            {sourceImports.map((sourceImport) => (
              <ImportRow item={sourceImport} key={sourceImport.id} />
            ))}
          </div>
        )}
      </section>

      <section className="x-mr" aria-label={t("mr.memory")}>
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          {t("mr.memory")}
        </h2>
        <p className="x-mrnote">{memoryMessage}</p>
        <div className="x-usage">
          <div>
            <p className="x-num">{agentTurnCount}</p>
            <p className="x-lab">{t("mr.usage.agentReplies")}</p>
          </div>
          <div>
            <p className="x-num">{queuedJobCount}</p>
            <p className="x-lab">{t("mr.usage.jobs")}</p>
          </div>
          <div>
            <p className="x-num">{activeSourceCandidates.length}</p>
            <p className="x-lab">{t("mr.usage.candidates")}</p>
          </div>
        </div>
      </section>
    </>
  );
}
