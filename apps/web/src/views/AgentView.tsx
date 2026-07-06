import type { SourceImport } from "@aitimeline/core";
import type { FormEvent } from "react";
import { ImportRow } from "../components/ImportRow";
import { SourceCandidatePanel } from "../components/SourceCandidatePanel";
import { SourceImportPanel } from "../components/SourceImportPanel";
import { t } from "../lib/i18n";
import type { ApiStatus, SourceCandidateRecord } from "../lib/types";

export function AgentView({
  agentTurnCount,
  apiMessage,
  apiStatus,
  autoScoutEnabled,
  candidateConcept,
  candidateMessage,
  candidateUrl,
  cardCount,
  curationMessage,
  hasQueuedScoutWork,
  importError,
  isImporting,
  isRunningCuration,
  isSavingCandidate,
  lastScoutAt,
  memoryMessage,
  onAutoScoutChange,
  onCandidateConceptChange,
  onCandidateUrlChange,
  onImportSubmit,
  onRunCuration,
  onSaveCandidate,
  onSourceUrlChange,
  queuedJobCount,
  sourceCandidates,
  sourceImports,
  sourceUrl
}: {
  agentTurnCount: number;
  apiMessage: string;
  apiStatus: ApiStatus;
  autoScoutEnabled: boolean;
  candidateConcept: string;
  candidateMessage: string;
  candidateUrl: string;
  cardCount: number;
  curationMessage: string;
  hasQueuedScoutWork: boolean;
  importError: string | null;
  isImporting: boolean;
  isRunningCuration: boolean;
  isSavingCandidate: boolean;
  lastScoutAt: string | null;
  memoryMessage: string;
  onAutoScoutChange: (value: boolean) => void;
  onCandidateConceptChange: (value: string) => void;
  onCandidateUrlChange: (value: string) => void;
  onImportSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRunCuration: () => void;
  onSaveCandidate: (event: FormEvent<HTMLFormElement>) => void;
  onSourceUrlChange: (value: string) => void;
  queuedJobCount: number;
  sourceCandidates: SourceCandidateRecord[];
  sourceImports: SourceImport[];
  sourceUrl: string;
}) {
  return (
    <>
      <section className="x-mr" aria-label={t("mr.sourceImport")}>
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
          records={sourceCandidates}
        />
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
            <p className="x-num">{sourceCandidates.length}</p>
            <p className="x-lab">{t("mr.usage.candidates")}</p>
          </div>
        </div>
      </section>
    </>
  );
}
