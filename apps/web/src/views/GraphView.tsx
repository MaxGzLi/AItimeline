import type { KnowledgeBoundaryView, LinkedKnowledgeGraph } from "@aitimeline/core";
import { Fragment, useState } from "react";
import { LinkedGraphCanvas } from "../components/LinkedGraphCanvas";

const zones: Array<{
  key: keyof Pick<KnowledgeBoundaryView, "inside" | "learning" | "frontier">;
  title: string;
  detail: string;
  color: string;
}> = [
  { key: "inside", title: "已掌握", detail: "复习过、互动多的概念", color: "var(--x-blue)" },
  { key: "learning", title: "学习区", detail: "正在建立理解的概念", color: "var(--x-repost)" },
  { key: "frontier", title: "前沿区", detail: "刚接触、还需要更多来源的概念", color: "var(--x-warn)" }
];

type GraphTab = "graph" | "boundary";

// The graph view has two tabs: a live force-directed canvas of concepts, cards,
// notes and their [[wikilinks]] (default), and the boundary list of the three
// knowledge zones.
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
      <div className="x-tabs" role="tablist" aria-label="图谱视图">
        {(
          [
            ["graph", "图谱"],
            ["boundary", "边界"]
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
          <p className="x-empty">图谱还是空的,去时间线点赞、收藏或发一条带 [[链接]] 的笔记,概念就会连起来。</p>
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
                {zone.title}
                <span className="x-zcount">
                  {concepts.length} 个概念 · {zone.detail}
                </span>
              </h2>
              {concepts.length === 0 ? (
                <p className="x-empty">这一区还没有概念。</p>
              ) : (
                concepts.map((concept) => (
                  <button className="x-trend" key={concept} onClick={() => onOpenConcept(concept)} type="button">
                    <p className="x-tmeta">{cardCountByConcept[concept] ?? 0} 张知识卡</p>
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
