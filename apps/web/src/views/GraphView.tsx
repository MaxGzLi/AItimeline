import type { KnowledgeBoundaryView } from "@aitimeline/core";
import { Fragment } from "react";

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

// Knowledge boundary rendered as three trend sections; a concept row opens
// its digest (all cards that mention it).
export function GraphView({
  boundary,
  cardCountByConcept,
  onOpenConcept
}: {
  boundary: KnowledgeBoundaryView;
  cardCountByConcept: Record<string, number>;
  onOpenConcept: (concept: string) => void;
}) {
  return (
    <>
      {zones.map((zone) => {
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
      })}
    </>
  );
}
