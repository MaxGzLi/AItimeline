import type {
  ConceptAliasRecord,
  ConceptMergeSuggestion,
  KnowledgeBoundaryView,
  KnowledgeCard,
  LinkedKnowledgeGraph
} from "@aitimeline/core";
import { AlertTriangle, Archive, BookOpen, CheckCircle2, Download, Loader2, Pause, Play, RotateCcw, Target, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { GraphReplayCanvas } from "../components/GraphReplayCanvas";
import { LinkedGraphCanvas, type LinkedGraphLayout } from "../components/LinkedGraphCanvas";
import type { WikilinkAutocompleteCandidate } from "../components/WikilinkAutocomplete";
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
import type { DeepReadArticleRecord, LearningGoalWithTree, SkillTreeView } from "../lib/types";

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

type GraphTab = "graph" | "boundary" | "skillTree";

export function GraphView({
  boundary,
  cards,
  cardCountByConcept,
  conceptAliases,
  conceptCandidates,
  conceptMergeSuggestions,
  initialTab,
  isSavingLearningGoal,
  learningGoalMessage,
  learningGoals,
  deepReadArticles,
  deepReadGeneratingGoalId,
  deepReadMessage,
  linkedGraph,
  onArchiveLearningGoal,
  onCreateLearningGoal,
  onGenerateDeepRead,
  onOpenDeepRead,
  onOpenCardId,
  onOpenConcept,
  onResolveConceptSuggestion
}: {
  boundary: KnowledgeBoundaryView;
  cards: KnowledgeCard[];
  cardCountByConcept: Record<string, number>;
  conceptAliases: ConceptAliasRecord[];
  conceptCandidates: WikilinkAutocompleteCandidate[];
  conceptMergeSuggestions: ConceptMergeSuggestion[];
  initialTab?: GraphTab;
  isSavingLearningGoal: boolean;
  learningGoalMessage: string;
  learningGoals: LearningGoalWithTree[];
  deepReadArticles: DeepReadArticleRecord[];
  deepReadGeneratingGoalId: string | null;
  deepReadMessage: string;
  linkedGraph: LinkedKnowledgeGraph;
  onArchiveLearningGoal: (id: string) => Promise<void>;
  onCreateLearningGoal: (concept: string) => Promise<void>;
  onGenerateDeepRead: (goal: LearningGoalWithTree) => Promise<void>;
  onOpenDeepRead: (articleId: string) => void;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onResolveConceptSuggestion: (suggestion: ConceptMergeSuggestion, decision: "merge" | "separate") => Promise<void>;
}) {
  const [tab, setTab] = useState<GraphTab>(initialTab ?? "graph");
  const [layout, setLayout] = useState<LinkedGraphLayout | null>(null);
  const [replayActive, setReplayActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [goalConcept, setGoalConcept] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const timeline = useMemo(
    () => buildGraphGrowthTimeline({ cards, conceptAliases, graph: linkedGraph }),
    [cards, conceptAliases, linkedGraph]
  );
  const activeGoals = useMemo(() => learningGoals.filter((goal) => goal.status === "active"), [learningGoals]);
  const selectedGoal = activeGoals.find((goal) => goal.id === selectedGoalId) ?? activeGoals[0] ?? null;
  const conceptOptions = useMemo(
    () => conceptCandidates.filter((candidate) => candidate.kind === "concept").map((candidate) => candidate.label),
    [conceptCandidates]
  );
  const [currentMs, setCurrentMs] = useState(timeline.startMs);
  const currentMsRef = useRef(timeline.startMs);
  const graphSignature = `${linkedGraph.nodes.map((node) => node.id).join("|")}::${linkedGraph.edges.length}`;
  const suggestion = conceptMergeSuggestions[0];
  const sliderValue = Math.round(timeToProgress(timeline, currentMs) * 1000);
  const replayFinished = replayActive && !playing && currentMs >= timeline.endMs - 1;

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (selectedGoalId && activeGoals.some((goal) => goal.id === selectedGoalId)) {
      return;
    }

    setSelectedGoalId(activeGoals[0]?.id ?? null);
  }, [activeGoals, selectedGoalId]);

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

  async function handleGoalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const concept = normalizeGoalInput(goalConcept);

    if (!concept) {
      return;
    }

    await onCreateLearningGoal(concept);
    setGoalConcept("");
  }

  return (
    <>
      <div className="x-tabs" role="tablist" aria-label={t("graph.viewLabel")}>
        {(
          [
            ["graph", t("graph.tab")],
            ["boundary", t("graph.boundaryTab")],
            ["skillTree", t("goals.tab")]
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
      ) : tab === "boundary" ? (
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
      ) : (
        <SkillTreeGoalPanel
          activeGoals={activeGoals}
          conceptOptions={conceptOptions}
          goalConcept={goalConcept}
          isSaving={isSavingLearningGoal}
          message={learningGoalMessage}
          deepReadArticles={deepReadArticles}
          deepReadGeneratingGoalId={deepReadGeneratingGoalId}
          deepReadMessage={deepReadMessage}
          onArchiveLearningGoal={onArchiveLearningGoal}
          onGenerateDeepRead={onGenerateDeepRead}
          onGoalConceptChange={setGoalConcept}
          onGoalSubmit={handleGoalSubmit}
          onOpenDeepRead={onOpenDeepRead}
          onOpenConcept={onOpenConcept}
          onSelectGoal={setSelectedGoalId}
          selectedGoal={selectedGoal}
        />
      )}
    </>
  );
}

function SkillTreeGoalPanel({
  activeGoals,
  conceptOptions,
  goalConcept,
  isSaving,
  message,
  deepReadArticles,
  deepReadGeneratingGoalId,
  deepReadMessage,
  onArchiveLearningGoal,
  onGenerateDeepRead,
  onGoalConceptChange,
  onGoalSubmit,
  onOpenDeepRead,
  onOpenConcept,
  onSelectGoal,
  selectedGoal
}: {
  activeGoals: LearningGoalWithTree[];
  conceptOptions: string[];
  goalConcept: string;
  isSaving: boolean;
  message: string;
  deepReadArticles: DeepReadArticleRecord[];
  deepReadGeneratingGoalId: string | null;
  deepReadMessage: string;
  onArchiveLearningGoal: (id: string) => Promise<void>;
  onGenerateDeepRead: (goal: LearningGoalWithTree) => Promise<void>;
  onGoalConceptChange: (value: string) => void;
  onGoalSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenDeepRead: (articleId: string) => void;
  onOpenConcept: (concept: string) => void;
  onSelectGoal: (id: string) => void;
  selectedGoal: LearningGoalWithTree | null;
}) {
  const tree = selectedGoal?.tree ?? null;

  return (
    <section className="x-skilltree" aria-label={t("goals.label")}>
      <form className="x-goal-form" onSubmit={onGoalSubmit}>
        <label>
          <span>{t("goals.inputLabel")}</span>
          <input
            autoComplete="off"
            disabled={isSaving}
            list="skill-tree-goal-concepts"
            onChange={(event) => onGoalConceptChange(event.currentTarget.value)}
            placeholder={t("goals.placeholder")}
            value={goalConcept}
          />
        </label>
        <datalist id="skill-tree-goal-concepts">
          {conceptOptions.map((concept) => (
            <option key={concept} value={concept} />
          ))}
        </datalist>
        <button className="x-cand-run" disabled={isSaving} type="submit">
          <Target size={16} />
          {isSaving ? t("goals.creating") : t("goals.create")}
        </button>
      </form>
      {message ? <p className="x-goal-message">{message}</p> : null}
      {deepReadMessage ? <p className="x-goal-message">{deepReadMessage}</p> : null}

      {activeGoals.length ? (
        <div className="x-goal-list" role="list" aria-label={t("goals.activeLabel")}>
          {activeGoals.map((goal) => {
            const article = findLatestDeepReadArticleForGoal(goal, deepReadArticles);
            const isGenerating = deepReadGeneratingGoalId === goal.id;

            return (
              <div className={`x-goal-row${selectedGoal?.id === goal.id ? " active" : ""}`} key={goal.id} role="listitem">
                <button
                  aria-pressed={selectedGoal?.id === goal.id}
                  className="x-goal-pick"
                  onClick={() => onSelectGoal(goal.id)}
                  type="button"
                >
                  <span>
                    <strong>#{goal.concept}</strong>
                    <em>{formatGoalProgress(goal)}</em>
                  </span>
                </button>
                <button
                  aria-label={article ? t("deepread.open") : t("deepread.generate")}
                  className="x-iconbtn"
                  disabled={isGenerating}
                  onClick={() => {
                    if (article) {
                      onOpenDeepRead(article.id);
                      return;
                    }

                    void onGenerateDeepRead(goal);
                  }}
                  title={article ? t("deepread.open") : t("deepread.generate")}
                  type="button"
                >
                  {isGenerating ? <Loader2 className="x-spin" size={15} /> : <BookOpen size={15} />}
                </button>
                <button
                  aria-label={t("goals.archive")}
                  className="x-iconbtn"
                  onClick={() => {
                    void onArchiveLearningGoal(goal.id);
                  }}
                  title={t("goals.archive")}
                  type="button"
                >
                  <Archive size={15} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="x-empty">{t("goals.empty")}</p>
      )}

      {tree ? (
        <SkillTreeViewPanel onOpenConcept={onOpenConcept} tree={tree} />
      ) : selectedGoal ? (
        <p className="x-empty">{t("goals.treeUnavailable")}</p>
      ) : null}
    </section>
  );
}

function SkillTreeViewPanel({
  onOpenConcept,
  tree
}: {
  onOpenConcept: (concept: string) => void;
  tree: SkillTreeView;
}) {
  type SkillNode = SkillTreeView["nodes"][number];
  const nodeById = new Map(tree.nodes.map((node) => [node.id, node]));
  const goalNode =
    tree.nodes.find((node) => node.dependentIds.length === 0) ??
    tree.nodes.find((node) => node.concept === tree.goalConcept) ??
    null;
  const rendered = new Set<string>();

  const renderRow = (node: SkillNode, isGoal: boolean, isRepeat: boolean) => (
    <button
      className={`x-tree-row ${node.status} ${node.importance}${isGoal ? " goal" : ""}${isRepeat ? " repeat" : ""}`}
      key={node.id}
      onClick={() => onOpenConcept(node.concept)}
      type="button"
    >
      <span className="x-tree-name">{node.concept}</span>
      <span className="x-tree-tags">
        <em>{isGoal ? t("goals.goalTag") : t(node.importance === "required" ? "goals.required" : "goals.optional")}</em>
        {node.mastered ? (
          <em className="x-tree-state mastered">
            <CheckCircle2 size={13} />
            {t("goals.status.mastered")}
          </em>
        ) : node.gap ? (
          <em className="x-tree-state gap">
            <AlertTriangle size={13} />
            {t("goals.status.gap")}
          </em>
        ) : null}
      </span>
    </button>
  );

  const renderBranch = (node: SkillNode, isGoal: boolean) => {
    rendered.add(node.id);
    const prerequisites = node.prerequisiteIds
      .map((id) => nodeById.get(id))
      .filter((child): child is SkillNode => !!child)
      .sort((left, right) =>
        left.importance === right.importance
          ? left.concept.localeCompare(right.concept)
          : left.importance === "required"
            ? -1
            : 1
      );

    return (
      <div className="x-tree-branch" key={node.id}>
        {renderRow(node, isGoal, false)}
        {prerequisites.length ? (
          <div className="x-tree-children">
            {prerequisites.map((child) =>
              rendered.has(child.id) ? renderRow(child, false, true) : renderBranch(child, false)
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="x-skill-tree" aria-label={t("goals.treeLabel", { concept: tree.goalConcept })}>
      <header className="x-skill-summary">
        <span>{t("goals.progress", { mastered: tree.progress.mastered, total: tree.progress.total })}</span>
        <span>{t("goals.gaps", { count: tree.gapConcepts.length })}</span>
      </header>
      {goalNode ? renderBranch(goalNode, true) : <p className="x-empty">{t("goals.treeUnavailable")}</p>}
    </section>
  );
}

function formatGoalProgress(goal: LearningGoalWithTree): string {
  const progress = goal.tree?.progress;

  return progress ? t("goals.progress", { mastered: progress.mastered, total: progress.total }) : t("goals.pending");
}

function findLatestDeepReadArticleForGoal(
  goal: LearningGoalWithTree,
  articles: DeepReadArticleRecord[]
): DeepReadArticleRecord | undefined {
  const goalKey = goal.tree?.goalId ?? normalizeGoalInput(goal.concept).toLowerCase();

  return articles
    .filter((article) => article.goalId === goal.id || article.topicKey === goalKey || article.topic === goal.concept)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function normalizeGoalInput(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\[\[(.+)\]\]$/);

  return (match?.[1] ?? trimmed).trim();
}
