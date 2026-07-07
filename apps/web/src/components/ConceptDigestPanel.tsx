import type { Backlink, ConceptAliasRecord, ConceptBrief, ConceptDigest } from "@aitimeline/core";
import { Layers, Link2, XCircle } from "lucide-react";
import { formatConceptRole, formatDueDate } from "../lib/format";
import { t } from "../lib/i18n";

export function ConceptDigestPanel({
  backlinks,
  conceptAliases,
  brief,
  briefQueued,
  digest,
  onClose,
  onOpenCardId,
  onUnmergeAlias
}: {
  backlinks: Backlink[];
  conceptAliases: ConceptAliasRecord[];
  brief?: ConceptBrief | null;
  briefQueued?: boolean;
  digest: ConceptDigest;
  onClose: () => void;
  onOpenCardId: (cardId: string) => void;
  onUnmergeAlias: (canonical: string, alias: string) => Promise<void>;
}) {
  const aliasRecord = conceptAliases.find((record) => record.canonical === digest.concept);

  return (
    <div
      aria-label={t("concept.aria", { concept: digest.concept })}
      aria-modal="true"
      className="x-overlay"
      onClick={onClose}
      role="dialog"
    >
      <div className="x-modal" onClick={(event) => event.stopPropagation()}>
        <div className="x-concept-head">
          <div>
            <p className="x-label x-concept-eyebrow">
              <Layers size={14} aria-hidden="true" /> {t("common.concept")}
            </p>
            <h2>{digest.concept}</h2>
            <p className="x-concept-sub">{t("concept.subtitle", { count: digest.cardCount })}</p>
          </div>
          <button aria-label={t("concept.close")} className="x-iconbtn" onClick={onClose} type="button">
            <XCircle size={18} />
          </button>
        </div>

        {digest.firstSeenAt && digest.firstCardId && digest.firstCardTitle ? (
          <div className="x-concept-origin">
            <p>{t("concept.origin", { date: formatDueDate(digest.firstSeenAt), title: digest.firstCardTitle })}</p>
            <button onClick={() => onOpenCardId(digest.firstCardId ?? "")} type="button">
              {t("concept.openFirstCard")}
            </button>
            {digest.firstSourceOrigin ? (
              <p className="x-muted-copy">
                {t("concept.originQuestion", { date: formatDueDate(digest.firstSourceOrigin.createdAt) })}
              </p>
            ) : null}
          </div>
        ) : null}

        {aliasRecord?.aliases.length ? (
          <div className="x-concept-aliases">
            <p className="x-label">{t("concept.aliases")}</p>
            <div className="x-alias-list">
              {aliasRecord.aliases.map((alias) => (
                <span className="x-alias" key={alias}>
                  {alias}
                  <button onClick={() => void onUnmergeAlias(aliasRecord.canonical, alias)} type="button">
                    {t("concept.unmerge")}
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {brief?.sentences.length ? (
          <section className="x-concept-brief">
            <div className="x-concept-brief-head">
              <p className="x-label">{t("concept.brief")}</p>
              {briefQueued ? <span>{t("concept.briefQueued")}</span> : null}
            </div>
            <div className="x-concept-brief-body">
              {brief.sentences.map((sentence) => {
                const sourceEntry = digest.entries.find((entry) => entry.cardId === sentence.cardId);

                return (
                  <p key={sentence.id}>
                    {sentence.text}
                    <button onClick={() => onOpenCardId(sentence.cardId)} type="button">
                      {sourceEntry?.title ?? sentence.cardId}
                    </button>
                  </p>
                );
              })}
            </div>
          </section>
        ) : null}

        <ol className="x-concept-list">
          {digest.entries.map((entry) => (
            <li key={entry.cardId}>
              <button className="x-concept-entry" onClick={() => onOpenCardId(entry.cardId)} type="button">
                <span className={`x-concept-role x-concept-role-${entry.role}`}>{formatConceptRole(entry.role)}</span>
                <span className="x-concept-body">
                  <strong>{entry.title}</strong>
                  <span className="x-concept-take">{entry.keyTakeaway}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>

        {backlinks.length > 0 ? (
          <div className="x-concept-backlinks">
            <p className="x-label x-concept-eyebrow">
              <Link2 size={14} aria-hidden="true" /> {t("concept.backlinks")}
            </p>
            <div className="x-backlinks">
              {backlinks.map((backlink) => (
                <button
                  className="x-backlink"
                  key={`${backlink.fromPostId}-${backlink.snippet}`}
                  onClick={() => onOpenCardId(backlink.fromPostId)}
                  title={t("detail.openTitle", { title: backlink.fromTitle })}
                  type="button"
                >
                  <span className="x-backlink-from">{backlink.fromTitle}</span>
                  <span className="x-backlink-snip">{backlink.snippet}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
