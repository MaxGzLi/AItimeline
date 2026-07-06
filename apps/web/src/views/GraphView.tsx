import type { KnowledgeBoundaryView, LinkedKnowledgeGraph } from "@aitimeline/core";
import { Fragment, useState } from "react";
import { LinkedGraphCanvas } from "../components/LinkedGraphCanvas";
import { t } from "../lib/i18n";

const zones: Array<{
  key: keyof Pick<KnowledgeBoundaryView, "inside" | "learning" | "frontier">;
  title: string;
  detail: string;
  color: string;
}> = [
  { key: "inside", title: "graph.zone.inside.title", detail: "graph.zone.inside.detail", color: "var(--x-blue)" },
  { key: "learning", title: "graph.zone.learning.title", detail: "graph.zone.learning.detail", color: "var(--x-repost)" },
  { key: "frontier", title: "graph.zone.frontier.title", detail: "graph.zone.frontier.detail", color: "var(--x-warn)" }
];

type GraphTab = "graph" | "boundary";

export function GraphView({
  boundary,
  cardCountByConcept,
  linkedGraph,
  onOpenCardId,
  onOpenConcept
}: {
  boundary: KnowledgeBoundaryView;
  cardCountByConcept: Record<string, number>;
  linkedGraph: LinkedKnowledgeGraph;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
}) {
  const [tab, setTab] = useState<GraphTab>("graph");

  return (
    <>
      <div className="x-tabs" role="tablist" aria-label={t("graph.viewLabel")}>
        {(
          [
            ["graph", t("graph.tab")],
            ["boundary", t("graph.boundaryTab")]
          ] as const
        ).map(([key, label]) => (
          <button
            aria-selected={tab === key}
            className={`x-tab${tab === key ? " active" : ""}`}
            key={key}
            onClick={() => setTab(key)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "graph" ? (
        linkedGraph.nodes.length === 0 ? (
          <p className="x-empty">{t("graph.empty")}</p>
        ) : (
          <LinkedGraphCanvas graph={linkedGraph} onOpenCardId={onOpenCardId} onOpenConcept={onOpenConcept} />
        )
      ) : (
        zones.map((zone) => {
          const concepts = boundary[zone.key];

          return (
            <Fragment key={zone.key}>
              <h2 className="x-zonehead">
                <span className="x-dot" style={{ background: zone.color }} />
                {t(zone.title)}
                <span className="x-zcount">
                  {t("graph.conceptCount", { count: concepts.length, detail: t(zone.detail) })}
                </span>
              </h2>
              {concepts.length === 0 ? (
                <p className="x-empty">{t("graph.emptyZone")}</p>
              ) : (
                concepts.map((concept) => (
                  <button className="x-trend" key={concept} onClick={() => onOpenConcept(concept)} type="button">
                    <p className="x-tmeta">{t("graph.cardCount", { count: cardCountByConcept[concept] ?? 0 })}</p>
                    <p className="x-tname">#{concept.replace(/\s+/g, "")}</p>
                  </button>
                ))
              )}
            </Fragment>
          );
        })
      )}
    </>
  );
}
