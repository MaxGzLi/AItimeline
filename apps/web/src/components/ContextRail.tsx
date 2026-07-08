import type {
  KnowledgeBoundaryView,
  KnowledgeBoundaryZone,
  KnowledgeCard,
  KnowledgeGraph,
  LinkedKnowledgeGraph,
  ReviewItem
} from "@aitimeline/core";
import { classifyConceptZone } from "@aitimeline/core";
import { Search } from "lucide-react";
import { formatDueDate } from "../lib/format";
import { t } from "../lib/i18n";
import type { LearningGoalWithTree } from "../lib/types";
import { LinkedGraphCanvas } from "./LinkedGraphCanvas";

const zoneBadges: Record<KnowledgeBoundaryZone, { label: string; className: string }> = {
  inside: { label: "graph.zone.inside.title", className: "inside" },
  learning: { label: "graph.zone.learning.title", className: "learning" },
  frontier: { label: "graph.zone.frontier.title", className: "frontier" },
  dark: { label: "boundary.dark", className: "dark" }
};

export function ContextRail({
  boundary,
  detailCard,
  detailGraph,
  graph,
  learningGoals,
  onOpenCardId,
  onOpenConcept,
  onOpenGraph,
  onOpenSkillTree,
  onOpenReview,
  onSearchChange,
  reviewQueue,
  searchQuery
}: {
  boundary: KnowledgeBoundaryView;
  detailCard?: KnowledgeCard | null;
  detailGraph?: LinkedKnowledgeGraph | null;
  graph: KnowledgeGraph;
  learningGoals: LearningGoalWithTree[];
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onOpenGraph: () => void;
  onOpenSkillTree: () => void;
  onOpenReview: () => void;
  onSearchChange: (value: string) => void;
  reviewQueue: ReviewItem[];
  searchQuery: string;
}) {
  const zoneTotal = Math.max(1, boundary.inside.length + boundary.learning.length + boundary.frontier.length);
  const hasDetailGraph =
    !!detailGraph && detailGraph.nodes.length > 1 && detailGraph.edges.length > 0;
  const activeGoal = learningGoals.find((goal) => goal.status === "active");
  const activeGoalProgress = activeGoal?.tree?.progress;

  return (
    <aside className="x-rail" aria-label={t("rail.state")}>
      <div className="x-search">
        <Search size={17} />
        <input
          aria-label={t("rail.search")}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("rail.searchPlaceholder")}
          value={searchQuery}
        />
      </div>

      {detailCard ? (
        <>
          <section className="x-module" aria-label={t("rail.position")}>
            <h2 className="x-module-head">{t("rail.position")}</h2>
            {detailCard.concepts.length === 0 ? (
              <p className="x-mrnote">{t("rail.detailEmpty")}</p>
            ) : (
              detailCard.concepts.map((concept) => {
                const badge = zoneBadges[classifyConceptZone(boundary, concept)];

                return (
                  <button className="x-mrow" key={concept} onClick={() => onOpenConcept(concept)} type="button">
                    <span className="x-mmain">
                      <p className="x-mname">#{concept.replace(/\s+/g, "")}</p>
                    </span>
                    <span className={`x-zonechip ${badge.className}`}>{t(badge.label)}</span>
                  </button>
                );
              })
            )}
          </section>

          {hasDetailGraph ? (
            <section className="x-module" aria-label={t("rail.localGraph")}>
              <h2 className="x-module-head">{t("rail.graphInLibrary")}</h2>
              <div className="x-localgraph">
                <LinkedGraphCanvas graph={detailGraph} onOpenCardId={onOpenCardId} onOpenConcept={onOpenConcept} />
              </div>
              <button className="x-mmore" onClick={onOpenGraph} type="button">
                {t("rail.openFullGraph")}
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      <section className="x-module" aria-label={t("rail.review")}>
        <h2 className="x-module-head">{t("rail.review")}</h2>
        {reviewQueue.length === 0 ? <p className="x-mrnote">{t("rail.reviewEmpty")}</p> : null}
        {reviewQueue.slice(0, 3).map((item) => (
          <button
            className="x-mrow"
            key={`${item.cardId}-${item.concept}`}
            onClick={onOpenReview}
            type="button"
          >
            <span className="x-mmain">
              <p className="x-mmeta">{t("rail.dueLine", { date: formatDueDate(item.dueAt), days: item.intervalDays })}</p>
              <p className="x-mname">{item.concept}</p>
            </span>
          </button>
        ))}
        {reviewQueue.length > 0 ? (
          <button className="x-mmore" onClick={onOpenReview} type="button">
            {t("rail.startReview", { count: reviewQueue.length })}
          </button>
        ) : null}
      </section>

      {detailCard ? null : (
        <>
          <section className="x-module" aria-label={t("rail.boundary")}>
            <h2 className="x-module-head">{t("rail.boundary")}</h2>
            <div className="x-bar" aria-hidden="true">
              <span style={{ background: "var(--x-blue)", width: `${(boundary.inside.length / zoneTotal) * 100}%` }} />
              <span style={{ background: "var(--x-repost)", width: `${(boundary.learning.length / zoneTotal) * 100}%` }} />
              <span style={{ background: "var(--x-warn)", width: `${(boundary.frontier.length / zoneTotal) * 100}%` }} />
            </div>
            <button className="x-mrow" onClick={onOpenGraph} type="button">
              <span className="x-mmain">
                <p className="x-mname">{t("graph.zone.inside.title")}</p>
                <p className="x-msub">{t("rail.inside.sub")}</p>
              </span>
              <span className="x-mnum">{boundary.inside.length}</span>
            </button>
            <button className="x-mrow" onClick={onOpenGraph} type="button">
              <span className="x-mmain">
                <p className="x-mname">{t("graph.zone.learning.title")}</p>
                <p className="x-msub">{t("rail.learning.sub")}</p>
              </span>
              <span className="x-mnum">{boundary.learning.length}</span>
            </button>
            <button className="x-mrow" onClick={onOpenGraph} type="button">
              <span className="x-mmain">
                <p className="x-mname">{t("graph.zone.frontier.title")}</p>
                <p className="x-msub">{t("rail.frontier.sub")}</p>
              </span>
              <span className="x-mnum">{boundary.frontier.length}</span>
            </button>
            {activeGoal ? (
              <button className="x-mrow" onClick={onOpenSkillTree} type="button">
                <span className="x-mmain">
                  <p className="x-mname">{t("rail.learningGoal", { concept: activeGoal.concept })}</p>
                  <p className="x-msub">
                    {activeGoalProgress
                      ? t("goals.progress", { mastered: activeGoalProgress.mastered, total: activeGoalProgress.total })
                      : t("goals.pending")}
                  </p>
                </span>
                <span className="x-mnum">{activeGoalProgress?.percent ?? 0}%</span>
              </button>
            ) : null}
          </section>

          <section className="x-module" aria-label={t("rail.concepts")}>
            <h2 className="x-module-head">{t("rail.concepts")}</h2>
            {graph.nodes.slice(0, 5).map((node) => (
              <button className="x-mrow" key={node.id} onClick={() => onOpenConcept(node.label)} type="button">
                <span className="x-mmain">
                  <p className="x-mmeta">{t("rail.conceptLabel")}</p>
                  <p className="x-mname">#{node.label.replace(/\s+/g, "")}</p>
                </span>
                <span className="x-mnum">{node.weight}</span>
              </button>
            ))}
            <button className="x-mmore" onClick={onOpenGraph} type="button">
              {t("rail.openGraph")}
            </button>
          </section>
        </>
      )}

      <p className="x-raillinks">
        <span>AITimeline</span>
        <span>·</span>
        <span>{t("rail.allGrounded")}</span>
        <span>·</span>
        <span>{t("common.localFirst")}</span>
      </p>
    </aside>
  );
}
