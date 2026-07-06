import type {
  ConceptAliasRecord,
  ConceptMergeSuggestion,
  KnowledgeBoundaryView,
  KnowledgeCard,
  LinkedKnowledgeGraph
} from "@aitimeline/core";
import { Download, Pause, Play, RotateCcw, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { GraphReplayCanvas } from "../components/GraphReplayCanvas";
import { LinkedGraphCanvas, type LinkedGraphLayout } from "../components/LinkedGraphCanvas";
import { formatDueDate } from "../lib/format";
import { getCurrentGraphTheme, renderGraphSnapshotDataUrl } from "../lib/graphSnapshot";
import {
  buildGraphGrowthTimeline,
  nodeAppearanceAlpha,
  progressToTime,
  timeToProgress
} from "../lib/graphTimeline";
import { t } from "../lib/i18n";
import { downloadDataUrl, renderElementToPng } from "../lib/shareImage";

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
  cards,
  cardCountByConcept,
  conceptAliases,
  conceptMergeSuggestions,
  linkedGraph,
  onOpenCardId,
  onOpenConcept,
  onResolveConceptSuggestion
}: {
  boundary: KnowledgeBoundaryView;
  cards: KnowledgeCard[];
  cardCountByConcept: Record<string, number>;
  conceptAliases: ConceptAliasRecord[];
  conceptMergeSuggestions: ConceptMergeSuggestion[];
  linkedGraph: LinkedKnowledgeGraph;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onResolveConceptSuggestion: (suggestion: ConceptMergeSuggestion, decision: "merge" | "separate") => Promise<void>;
}) {
  const [tab, setTab] = useState<GraphTab>("graph");
  const [layout, setLayout] = useState<LinkedGraphLayout | null>(null);
  const [replayActive, setReplayActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const timeline = useMemo(
    () => buildGraphGrowthTimeline({ cards, conceptAliases, graph: linkedGraph }),
    [cards, conceptAliases, linkedGraph]
  );
  const [currentMs, setCurrentMs] = useState(timeline.startMs);
  const currentMsRef = useRef(timeline.startMs);
  const graphSignature = `${linkedGraph.nodes.map((node) => node.id).join("|")}::${linkedGraph.edges.length}`;
  const suggestion = conceptMergeSuggestions[0];
  const sliderValue = Math.round(timeToProgress(timeline, currentMs) * 1000);
  const replayFinished = replayActive && !playing && currentMs >= timeline.endMs - 1;

  useEffect(() => {
    currentMsRef.current = currentMs;
  }, [currentMs]);

  const timelineStartRef = useRef(timeline.startMs);
  timelineStartRef.current = timeline.startMs;

  // Reset only when the graph content changes: timeline.startMs derives from
  // Date.now(), so every background sync produces a new value. Depending on it
  // would clear layout here while LinkedGraphCanvas only re-reports layout on a
  // graphSignature change, leaving the replay button disabled forever.
  useEffect(() => {
    setCurrentMs(timelineStartRef.current);
    currentMsRef.current = timelineStartRef.current;
    setReplayActive(false);
    setPlaying(false);
    setLayout(null);
    setExportNotice("");
  }, [graphSignature]);

  useEffect(() => {
    if (!replayActive || !playing) {
      return;
    }

    const startTime = currentMsRef.current;
    const startFrame = performance.now();
    const remaining = Math.max(timeline.endMs - startTime, 1);
    const fullSpan = Math.max(timeline.endMs - timeline.startMs, 1);
    const duration = Math.max(600, 9000 * (remaining / fullSpan));
    let frame = 0;

    const tick = () => {
      const elapsed = performance.now() - startFrame;
      const nextTime = startTime + remaining * Math.min(1, elapsed / duration);

      currentMsRef.current = nextTime;
      setCurrentMs(nextTime);

      if (nextTime >= timeline.endMs) {
        setPlaying(false);
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, replayActive, timeline.endMs, timeline.startMs]);

  function startReplay() {
    setTab("graph");
    setReplayActive(true);
    currentMsRef.current = timeline.startMs;
    setCurrentMs(timeline.startMs);
    setPlaying(true);
    setExportNotice("");
  }

  function togglePlaying() {
    if (!replayActive) {
      startReplay();
      return;
    }

    setPlaying((value) => !value);
  }

  function handleSliderChange(value: string) {
    setPlaying(false);
    setReplayActive(true);
    const nextTime = progressToTime(timeline, Number(value) / 1000);
    currentMsRef.current = nextTime;
    setCurrentMs(nextTime);
  }

  async function handleExportComparison() {
    if (!layout) {
      setExportNotice(t("graph.replay.waitingForLayout"));
      return;
    }

    setExporting(true);
    setExportNotice("");

    try {
      const theme = getCurrentGraphTheme();
      const startImageUrl = renderGraphSnapshotDataUrl({
        alphaForNode: (nodeId) => nodeAppearanceAlpha(timeline.nodeFirstSeen[nodeId], timeline.startMs),
        graph: linkedGraph,
        height: 560,
        label: t("graph.replay.startFrame"),
        layout,
        theme,
        width: 650
      });
      const endImageUrl = renderGraphSnapshotDataUrl({
        alphaForNode: (nodeId) => nodeAppearanceAlpha(timeline.nodeFirstSeen[nodeId], timeline.endMs),
        graph: linkedGraph,
        height: 560,
        label: t("graph.replay.endFrame"),
        layout,
        theme,
        width: 650
      });
      const pngUrl = await renderElementToPng(
        {
          claim: t("share.claim"),
          compareLabel: t("graph.replay.compareLabel"),
          endImageUrl,
          endLabel: formatDueDate(new Date(timeline.endMs).toISOString()),
          kind: "graph-comparison",
          startImageUrl,
          startLabel: formatDueDate(new Date(timeline.startMs).toISOString()),
          summary: t("graph.replay.summary", {
            concepts: timeline.newConceptCount,
            connections: timeline.newConnectionCount
          })
        },
        { height: 760, pixelRatio: 2, width: 1400 }
      );

      downloadDataUrl(pngUrl, "aitimeline-graph-growth.png");
      setExportNotice(t("graph.replay.exportDone"));
    } catch {
      setExportNotice(t("graph.replay.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

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

      {suggestion ? (
        <section className="x-merge-banner" aria-label={t("graph.merge.aria")}>
          <div>
            <p className="x-label">{t("graph.merge.label")}</p>
            <p className="x-merge-title">{t("graph.merge.title", { left: suggestion.left, right: suggestion.right })}</p>
            {suggestion.leftExcerpt || suggestion.rightExcerpt ? (
              <p className="x-merge-copy">
                {[suggestion.leftExcerpt, suggestion.rightExcerpt].filter(Boolean).join(" / ")}
              </p>
            ) : null}
          </div>
          <div className="x-merge-actions">
            <button onClick={() => void onResolveConceptSuggestion(suggestion, "merge")} type="button">
              {t("graph.merge.accept")}
            </button>
            <button onClick={() => void onResolveConceptSuggestion(suggestion, "separate")} type="button">
              {t("graph.merge.reject")}
            </button>
          </div>
        </section>
      ) : null}

      {tab === "graph" ? (
        linkedGraph.nodes.length === 0 ? (
          <p className="x-empty">{t("graph.empty")}</p>
        ) : (
          <>
            <section className="x-graph-actions" aria-label={t("graph.replay.controls")}>
              <button className="x-cand-run" disabled={!layout} onClick={startReplay} type="button">
                <Play size={16} /> {t("graph.replay.open")}
              </button>
              {replayActive ? (
                <>
                  <button className="x-cand-run" onClick={togglePlaying} type="button">
                    {playing ? <Pause size={16} /> : <Play size={16} />}
                    {playing ? t("graph.replay.pause") : t("graph.replay.play")}
                  </button>
                  <button className="x-cand-run" onClick={startReplay} type="button">
                    <RotateCcw size={16} /> {t("graph.replay.restart")}
                  </button>
                  <button className="x-cand-run" disabled={exporting} onClick={() => void handleExportComparison()} type="button">
                    <Download size={16} /> {exporting ? t("graph.replay.exporting") : t("graph.replay.export")}
                  </button>
                  <button
                    className="x-cand-run"
                    onClick={() => {
                      setPlaying(false);
                      setReplayActive(false);
                    }}
                    type="button"
                  >
                    <X size={16} /> {t("graph.replay.exit")}
                  </button>
                </>
              ) : null}
            </section>

            {replayActive && layout ? (
              <>
                <GraphReplayCanvas currentMs={currentMs} graph={linkedGraph} layout={layout} timeline={timeline} />
                <section className="x-replay-controls">
                  <div className="x-replay-scale">
                    <span>{formatDueDate(new Date(timeline.startMs).toISOString())}</span>
                    <strong>{formatDueDate(new Date(currentMs).toISOString())}</strong>
                    <span>{formatDueDate(new Date(timeline.endMs).toISOString())}</span>
                  </div>
                  <input
                    aria-label={t("graph.replay.scrub")}
                    max={1000}
                    min={0}
                    onChange={(event) => handleSliderChange(event.currentTarget.value)}
                    type="range"
                    value={sliderValue}
                  />
                  {replayFinished ? (
                    <p className="x-replay-summary">
                      {t("graph.replay.summary", {
                        concepts: timeline.newConceptCount,
                        connections: timeline.newConnectionCount
                      })}
                    </p>
                  ) : null}
                  {exportNotice ? <p className="x-replay-note">{exportNotice}</p> : null}
                </section>
              </>
            ) : (
              <LinkedGraphCanvas
                graph={linkedGraph}
                onLayoutSettled={setLayout}
                onOpenCardId={onOpenCardId}
                onOpenConcept={onOpenConcept}
              />
            )}
          </>
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
