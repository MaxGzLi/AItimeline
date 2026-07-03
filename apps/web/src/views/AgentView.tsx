import type { SourceImport } from "@aitimeline/core";
import type { FormEvent } from "react";
import { ImportRow } from "../components/ImportRow";
import { SourceCandidatePanel } from "../components/SourceCandidatePanel";
import { SourceImportPanel } from "../components/SourceImportPanel";
import type { ApiStatus, SourceCandidateRecord } from "../lib/types";

// The observer's machine room: everything operational (imports, candidate
// queue, memory, usage) lives here instead of cluttering the timeline.
export function AgentView({
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
      <section className="x-mr" aria-label="来源导入">
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          来源导入
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

      <section className="x-mr" aria-label="观察员与候选源">
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          观察员
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

      <section className="x-mr" aria-label="导入记录">
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          导入记录
        </h2>
        {sourceImports.length === 0 ? (
          <p className="x-mrnote">还没有导入过来源。</p>
        ) : (
          <div style={{ padding: "0 16px" }}>
            {sourceImports.map((sourceImport) => (
              <ImportRow item={sourceImport} key={sourceImport.id} />
            ))}
          </div>
        )}
      </section>

      <section className="x-mr" aria-label="记忆与用量">
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          记忆与用量
        </h2>
        <p className="x-mrnote">{memoryMessage}</p>
        <div className="x-usage">
          <div>
            <p className="x-num">128</p>
            <p className="x-lab">剩余 AI 额度</p>
          </div>
          <div>
            <p className="x-num">{queuedJobCount}</p>
            <p className="x-lab">排队任务</p>
          </div>
          <div>
            <p className="x-num">{sourceCandidates.length}</p>
            <p className="x-lab">候选来源</p>
          </div>
        </div>
      </section>
    </>
  );
}
