import type { LinkedKnowledgeGraph, RankedKnowledgeCard, SourceImport } from "@aitimeline/core";
import { MessageCircle } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { ImportRow } from "../components/ImportRow";
import { LinkedGraphCanvas } from "../components/LinkedGraphCanvas";
import { formatDueDate } from "../lib/format";
import { t } from "../lib/i18n";
import { countRecentImports, groupImportsByTitle, summarizeLinkedGraph } from "../lib/ledger";
import type { ReviewQueueEntry } from "./ReviewView";

const RECENT_IMPORT_LIMIT = 5;
const REVIEW_PREVIEW_LIMIT = 3;

/**
 * 基地第一屏:agent 工作台账。全部数字来自现有接口的真数据 —— 导入记录来自
 * /api/timeline,复习队列来自 /api/review/due,图谱在前端由快照卡片确定性构建。
 * 对话入口目前只是占位:提交只在前端提示,不发请求(后续任务接后端)。
 */
export function BaseView({
  linkedGraph,
  onOpenCardId,
  onOpenConcept,
  onOpenGraph,
  onOpenImports,
  onOpenReview,
  reviewCardsById,
  reviewQueue,
  sourceImports
}: {
  linkedGraph: LinkedKnowledgeGraph;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onOpenGraph: () => void;
  onOpenImports: () => void;
  onOpenReview: () => void;
  reviewCardsById: Record<string, RankedKnowledgeCard>;
  reviewQueue: ReviewQueueEntry[];
  sourceImports: SourceImport[];
}) {
  const [chatDraft, setChatDraft] = useState("");
  const [chatNotice, setChatNotice] = useState<string | null>(null);
  const weeklyImportCount = useMemo(
    () => countRecentImports(sourceImports, new Date()),
    [sourceImports]
  );
  const importGroups = useMemo(() => groupImportsByTitle(sourceImports), [sourceImports]);
  const graphSummary = useMemo(() => summarizeLinkedGraph(linkedGraph), [linkedGraph]);
  // 只展示还能找到卡片正文的复习条目,和复习页的口径一致。
  const reviewPreview = reviewQueue.filter((entry) => reviewCardsById[entry.cardId]);

  function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!chatDraft.trim()) {
      return;
    }

    setChatNotice(t("base.chat.comingSoon"));
  }

  return (
    <>
      <section className="x-mr" aria-label={t("base.stats")}>
        <div className="x-usage">
          <div>
            <p className="x-num">{weeklyImportCount}</p>
            <p className="x-lab">{t("base.stat.weekImports")}</p>
          </div>
          <div>
            <p className="x-num">{graphSummary.cardCount}</p>
            <p className="x-lab">{t("base.stat.cards")}</p>
          </div>
          <div>
            <p className="x-num">{graphSummary.conceptCount}</p>
            <p className="x-lab">{t("base.stat.concepts")}</p>
          </div>
          <div>
            <p className="x-num">{reviewPreview.length}</p>
            <p className="x-lab">{t("base.stat.due")}</p>
          </div>
        </div>
        <form className="x-import-form x-base-chat" onSubmit={handleChatSubmit}>
          <label className="x-import-field">
            <MessageCircle size={16} />
            <input
              aria-label={t("base.chat.label")}
              onChange={(event) => {
                setChatDraft(event.target.value);
                setChatNotice(null);
              }}
              placeholder={t("base.chat.placeholder")}
              value={chatDraft}
            />
          </label>
          <button className="x-pill start" type="submit">
            {t("base.chat.submit")}
          </button>
        </form>
        {chatNotice ? (
          <p className="x-mrnote" role="status">
            {chatNotice}
          </p>
        ) : null}
      </section>

      <section className="x-mr" aria-label={t("base.imports.title")}>
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          {t("base.imports.title")}
        </h2>
        <p className="x-mrnote">{t("base.imports.weekCount", { count: weeklyImportCount })}</p>
        {importGroups.length === 0 ? (
          <p className="x-mrnote">{t("base.imports.empty")}</p>
        ) : (
          <div style={{ padding: "0 16px" }}>
            {importGroups.slice(0, RECENT_IMPORT_LIMIT).map((group) => (
              <ImportRow count={group.count} item={group.latest} key={group.latest.id} />
            ))}
            <p className="x-import-more">
              <button className="x-chip action" onClick={onOpenImports} type="button">
                {t("base.imports.viewAll")}
              </button>
            </p>
          </div>
        )}
      </section>

      <section className="x-mr" aria-label={t("base.graph.title")}>
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          {t("base.graph.title")}
        </h2>
        <p className="x-mrnote">
          {t("base.graph.stats", {
            cards: graphSummary.cardCount,
            concepts: graphSummary.conceptCount,
            links: graphSummary.linkCount
          })}
        </p>
        {graphSummary.cardCount === 0 ? (
          <p className="x-mrnote">{t("base.graph.empty")}</p>
        ) : (
          <>
            <div className="x-base-graph">
              <LinkedGraphCanvas graph={linkedGraph} onOpenCardId={onOpenCardId} onOpenConcept={onOpenConcept} />
            </div>
            <p className="x-import-more">
              <button className="x-chip action" onClick={onOpenGraph} type="button">
                {t("base.graph.open")}
              </button>
            </p>
          </>
        )}
      </section>

      <section className="x-mr" aria-label={t("base.review.title")}>
        <h2 className="x-mrhead">
          <span className="x-pulse" aria-hidden="true" />
          {t("base.review.title")}
        </h2>
        {reviewPreview.length === 0 ? (
          <p className="x-mrnote">{t("base.review.empty")}</p>
        ) : (
          <>
            <p className="x-mrnote">{t("base.review.dueCount", { count: reviewPreview.length })}</p>
            <div style={{ padding: "0 16px" }}>
              {reviewPreview.slice(0, REVIEW_PREVIEW_LIMIT).map((entry) => {
                const card = reviewCardsById[entry.cardId];

                return (
                  <div className="x-import-row" key={entry.cardId}>
                    <div>
                      <span>{card.title}</span>
                      <small>
                        #{entry.concept.replace(/\s+/g, "")} · {t("base.review.due", { date: formatDueDate(entry.dueAt) })}
                      </small>
                    </div>
                  </div>
                );
              })}
              <p className="x-import-more">
                <button className="x-chip action" onClick={onOpenReview} type="button">
                  {t("base.review.start")}
                </button>
              </p>
            </div>
          </>
        )}
      </section>
    </>
  );
}
