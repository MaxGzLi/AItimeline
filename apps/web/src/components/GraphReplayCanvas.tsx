import type { LinkedKnowledgeGraph } from "@aitimeline/core";
import { useEffect, useRef } from "react";
import { drawGraphSnapshot, getCurrentGraphTheme, type GraphSnapshotLayout } from "../lib/graphSnapshot";
import { nodeAppearanceAlpha, type GraphGrowthTimeline } from "../lib/graphTimeline";

export function GraphReplayCanvas({
  currentMs,
  graph,
  layout,
  timeline
}: {
  currentMs: number;
  graph: LinkedKnowledgeGraph;
  layout: GraphSnapshotLayout;
  timeline: GraphGrowthTimeline;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const drawRef = useRef<() => void>(() => {});

  // currentMs changes every animation frame while playing; the draw closure is
  // kept in a ref so the observers (installed once below) can call the latest
  // version without tearing down and re-installing per frame.
  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      const { width, height } = sizeRef.current;

      if (!canvas || !context || width === 0 || height === 0) {
        return;
      }

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawGraphSnapshot(context, {
        alphaForNode: (nodeId) => nodeAppearanceAlpha(timeline.nodeFirstSeen[nodeId], currentMs),
        graph,
        height,
        layout,
        theme: getCurrentGraphTheme(),
        width
      });
    };

    drawRef.current();
  }, [currentMs, graph, layout, timeline]);

  useEffect(() => {
    const wrap = wrapRef.current;

    if (!wrap) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      sizeRef.current = {
        width: entry.contentRect.width,
        height: entry.contentRect.height
      };
      drawRef.current();
    });
    const themeObserver = new MutationObserver(() => drawRef.current());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    resizeObserver.observe(wrap);
    drawRef.current();

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  return (
    <div className="x-graphcanvas x-replaycanvas" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}
