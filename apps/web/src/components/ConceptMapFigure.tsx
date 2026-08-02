import type { KnowledgeCard } from "@aitimeline/core";
import { estimateTextWidth, layoutConceptMap } from "@aitimeline/core";
import { useMemo } from "react";
import { getCardConcepts, getCardGraphEdges } from "../lib/api";
import { formatEdgeRelation } from "../lib/format";
import { t } from "../lib/i18n";

/**
 * Lead visual for cards with no source image: the card's own concept graph,
 * drawn as flat SVG so it follows the theme tokens. Geometry (including every
 * font size) comes from the core layout, which is what guarantees the labels
 * do not collide; this component only paints it.
 */
export function ConceptMapFigure({ card }: { card: KnowledgeCard }) {
  const layout = useMemo(() => {
    const concepts = getCardConcepts(card);

    return layoutConceptMap({
      postId: card.id,
      primaryConcept: concepts[0],
      concepts,
      graphEdges: getCardGraphEdges(card)
    });
  }, [card]);

  if (layout.degenerate) {
    return null;
  }

  const [center, ...peers] = layout.nodes;

  return (
    <figure
      aria-label={t("post.conceptMap", { concept: center.concept, count: peers.length })}
      className="x-diagram"
      role="img"
    >
      <svg preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${layout.width} ${layout.height}`}>
        {layout.edges.map((edge) => (
          <line className="x-dgedge" key={`${edge.from}-${edge.to}`} x1={edge.x1} x2={edge.x2} y1={edge.y1} y2={edge.y2} />
        ))}

        {layout.edges.map((edge) => {
          if (!edge.relation) {
            return null;
          }

          const caption = formatEdgeRelation(edge.relation);
          const captionWidth = estimateTextWidth(caption, edge.fontSize);

          // The caption sits on top of its own edge, so it needs a plate to sit
          // on; when the layout left no room we keep the bare line instead.
          if (captionWidth > edge.labelMaxWidth) {
            return null;
          }

          return (
            <g key={`relation-${edge.from}-${edge.to}`}>
              <rect
                className="x-dgplate"
                height={edge.labelHeight}
                width={captionWidth + 6}
                x={edge.labelX - captionWidth / 2 - 3}
                y={edge.labelY - edge.labelHeight / 2}
              />
              <text
                className="x-dgrel"
                dominantBaseline="central"
                fontSize={edge.fontSize}
                textAnchor="middle"
                x={edge.labelX}
                y={edge.labelY}
              >
                {caption}
              </text>
            </g>
          );
        })}

        {peers.map((node) => (
          <g key={`node-${node.concept}`}>
            <circle className="x-dgdot" cx={node.x} cy={node.y} r={node.radius} />
            <text
              className="x-dgnode"
              dominantBaseline="central"
              fontSize={node.fontSize}
              textAnchor="middle"
              x={node.labelX}
              y={node.labelY}
            >
              {node.label}
            </text>
          </g>
        ))}

        <rect
          className="x-dgchip"
          height={center.labelHeight}
          rx={center.labelHeight / 2}
          width={center.labelWidth}
          x={center.labelX - center.labelWidth / 2}
          y={center.labelY - center.labelHeight / 2}
        />
        <text
          className="x-dgcenter"
          dominantBaseline="central"
          fontSize={center.fontSize}
          textAnchor="middle"
          x={center.labelX}
          y={center.labelY}
        >
          {center.label}
        </text>
      </svg>
    </figure>
  );
}
