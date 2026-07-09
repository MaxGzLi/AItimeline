import {
  createConceptMentionMatcher,
  type ConceptAliasRecord,
  type KnowledgeCard
} from "@aitimeline/core";
import { AlertTriangle, ArrowLeft, BookOpen, FileText } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { formatDueDate } from "../lib/format";
import { t } from "../lib/i18n";
import type { DeepReadArticleRecord } from "../lib/types";

export function DeepReadArticleView({
  article,
  cards,
  conceptAliases,
  onOpenConcept,
  onBack
}: {
  article: DeepReadArticleRecord | null;
  cards: KnowledgeCard[];
  conceptAliases: ConceptAliasRecord[];
  onOpenConcept: (concept: string) => void;
  onBack: () => void;
}) {
  const conceptMentionMatcher = useMemo(
    () => createConceptMentionMatcher({ cards, conceptAliases }),
    [cards, conceptAliases]
  );

  if (!article) {
    return (
      <section className="x-deepread-empty">
        <button
          aria-label={t("deepread.back")}
          className="x-detail-back"
          onClick={onBack}
          title={t("deepread.back")}
          type="button"
        >
          <ArrowLeft size={21} />
        </button>
        <p className="x-empty">{t("deepread.empty")}</p>
      </section>
    );
  }

  const introLinkedConcepts = new Set<string>();
  const conclusionLinkedConcepts = new Set<string>();

  return (
    <article className="x-deepread" aria-label={t("deepread.readerLabel")}>
      <header className="x-deepread-hero">
        <button
          aria-label={t("deepread.back")}
          className="x-detail-back"
          onClick={onBack}
          title={t("deepread.back")}
          type="button"
        >
          <ArrowLeft size={21} />
        </button>
        <p className="x-label">
          <BookOpen size={14} />
          {t(article.runnerKind === "model" ? "deepread.kind.model" : "deepread.kind.fallback")}
        </p>
        <h1>{article.title}</h1>
        <p className="x-deepread-meta">
          {t("deepread.meta", {
            date: formatDueDate(article.createdAt),
            chapters: article.chapters.length,
            sources: article.sources.length
          })}
        </p>
        <p className="x-deepread-intro">
          {renderTextWithConceptMentions(
            article.introduction,
            conceptMentionMatcher,
            introLinkedConcepts,
            onOpenConcept,
            "deepread-intro"
          )}
        </p>
      </header>

      {article.budget.truncated ? (
        <section className="x-deepread-notice">
          <AlertTriangle size={16} />
          <p>{article.budget.notes.join(" ")}</p>
        </section>
      ) : null}

      {article.chapters.map((chapter, index) => {
        const chapterLinkedConcepts = new Set<string>();

        return (
          <section className={`x-deepread-chapter ${chapter.status}`} key={chapter.id}>
            <header className="x-deepread-chapter-head">
              <p className="x-label">{t("deepread.chapterIndex", { index: index + 1 })}</p>
              <h2>{chapter.title}</h2>
              <p>{chapter.question}</p>
              <div className="x-deepread-tags">
                {chapter.status === "gap" ? <span>{t("deepread.gapChapter")}</span> : null}
                {chapter.singleSource ? <span>{t("deepread.singleSource")}</span> : null}
              </div>
            </header>

            {chapter.gapStatement ? <p className="x-deepread-gap">{chapter.gapStatement}</p> : null}

            <div className="x-deepread-paragraphs">
              {chapter.paragraphs.map((paragraph) => (
                <p className={`x-deepread-p ${paragraph.kind}`} key={paragraph.id}>
                  {paragraph.kind === "synthesis" ? <span>{t("deepread.synthesis")}</span> : null}
                  {renderTextWithConceptMentions(
                    paragraph.text,
                    conceptMentionMatcher,
                    chapterLinkedConcepts,
                    onOpenConcept,
                    `deepread-${chapter.id}-${paragraph.id}`
                  )}
                </p>
              ))}
            </div>

            <section className="x-deepread-chapter-sources">
              <h3>{t("deepread.chapterSources")}</h3>
              {chapter.sources.length ? (
                <ul>
                  {chapter.sources.map((source) => (
                    <li key={source.sourceId}>
                      <strong>{source.sourceTitle}</strong>
                      <small>{t("deepread.chunkCount", { count: source.chunkIds.length })}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t("deepread.noChapterSources")}</p>
              )}
            </section>
          </section>
        );
      })}

      <footer className="x-deepread-footer">
        <section>
          <h2>{t("deepread.conclusion")}</h2>
          <p>
            {renderTextWithConceptMentions(
              article.conclusion,
              conceptMentionMatcher,
              conclusionLinkedConcepts,
              onOpenConcept,
              "deepread-conclusion"
            )}
          </p>
        </section>
        <section>
          <h2>{t("deepread.sources")}</h2>
          {article.sources.length ? (
            <ol className="x-deepread-source-list">
              {article.sources.map((source) => (
                <li key={source.sourceId}>
                  <FileText size={15} />
                  <a href={source.url} rel="noreferrer" target="_blank">
                    {source.title}
                  </a>
                  <small>{t("deepread.chunkCount", { count: source.chunkIds.length })}</small>
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("deepread.noSources")}</p>
          )}
        </section>
        <section className="x-deepread-quality">
          <h2>{t("deepread.quality")}</h2>
          <p>
            {t("deepread.density", {
              points: article.qualityReport.density.atomicPointCount,
              density: article.qualityReport.density.pointsPerThousandChars
            })}
          </p>
          {article.deletedParagraphLog.length ? (
            <p>{t("deepread.deleted", { count: article.deletedParagraphLog.length })}</p>
          ) : null}
          {article.discardedMaterials.length ? (
            <p>{t("deepread.discarded", { count: article.discardedMaterials.length })}</p>
          ) : null}
          {article.qualityReport.notes.length ? (
            <ul>
              {article.qualityReport.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </footer>
    </article>
  );
}

function renderTextWithConceptMentions(
  text: string,
  matcher: ReturnType<typeof createConceptMentionMatcher>,
  linkedConcepts: Set<string>,
  onOpenConcept: (concept: string) => void,
  keyPrefix: string
): ReactNode {
  const linkedMentions = matcher.findMentions(text).filter((mention) => {
    if (linkedConcepts.has(mention.slug)) {
      return false;
    }

    linkedConcepts.add(mention.slug);
    return true;
  });

  if (linkedMentions.length === 0) {
    return text;
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;

  linkedMentions.forEach((mention, index) => {
    if (mention.start > cursor) {
      nodes.push(text.slice(cursor, mention.start));
    }

    const open = () => onOpenConcept(mention.concept);

    nodes.push(
      <span
        className="x-wikilink concept"
        key={`${keyPrefix}-${index}-${mention.start}-${mention.slug}`}
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            open();
          }
        }}
        role="link"
        tabIndex={0}
      >
        {mention.text}
      </span>
    );

    cursor = mention.end;
  });

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}
