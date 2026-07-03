import {
  buildCardConnections,
  buildConceptDigest,
  buildKnowledgeBoundary,
  buildKnowledgeGraph,
  createReviewQueue,
  demoCards,
  demoProfile,
  demoSignals,
  evaluateInteraction,
  rankKnowledgeCards,
  transformMockYouTubeUrl,
  type CardConnection,
  type ConceptDigest,
  type InteractionSignal,
  type KnowledgeCard,
  type KnowledgeChunk,
  type LearningFeedback,
  type RankedKnowledgeCard,
  type SourceAsset,
  type SourceImport,
  type TopicState
} from "@aitimeline/core";
import { ArrowUp, Bot, Brain, CheckCircle2, Compass, GitBranch, Home, PenLine, Settings, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AgentReplyThread } from "./components/AgentReplyThread";
import { AskComposer } from "./components/AskComposer";
import { ConceptDigestPanel } from "./components/ConceptDigestPanel";
import { ContextRail } from "./components/ContextRail";
import { PostView } from "./components/PostView";
import { SourceDetailDrawer } from "./components/SourceDetailDrawer";
import { DiscoverView } from "./views/DiscoverView";
import { AgentView } from "./views/AgentView";
import { GraphView } from "./views/GraphView";
import { ReviewView } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";
import { apiBaseUrl, apiRequest, isYouTubeUrl, sampleSourceUrl } from "./lib/api";
import { buildGroundedAnswer, formatAskAnswer, getTopicId, scrollMotion, slugConcept } from "./lib/format";
import {
  createInteractionSignal,
  createSignalSignature,
  deriveTopicState,
  ensureRankedCards,
  loadStoredState,
  loadSyncedSignalSignatures,
  mergeCards,
  saveStoredState,
  saveSyncedSignalSignatures,
  shouldSyncSignal,
  upsertById,
  upsertImport
} from "./lib/state";
import type {
  AgentAskApiResponse,
  AiMessage,
  AiThreads,
  ApiCurationJobsResponse,
  ApiCurationRunResponse,
  ApiEvidenceResponse,
  ApiImportResponse,
  ApiSnapshot,
  ApiStatus,
  ApiTimelineResponse,
  AskApiResult,
  EvidenceLedger,
  InteractionSignals,
  LearningFeedbackByPost,
  MemoryAction,
  SourceCandidateRecord
} from "./lib/types";

type ViewKey = "timeline" | "discover" | "graph" | "review" | "agent" | "settings";

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Home }> = [
  { key: "timeline", label: "时间线", icon: Home },
  { key: "discover", label: "发现", icon: Compass },
  { key: "graph", label: "图谱", icon: GitBranch },
  { key: "review", label: "复习", icon: Brain },
  { key: "agent", label: "智能体", icon: Bot },
  { key: "settings", label: "设置", icon: Settings }
];

const viewTitles: Record<ViewKey, { title: string; sub?: string }> = {
  timeline: { title: "时间线" },
  discover: { title: "发现", sub: "观察员找到的候选来源" },
  graph: { title: "图谱", sub: "你的知识边界" },
  review: { title: "复习", sub: "到期的间隔复习" },
  agent: { title: "智能体", sub: "观察员机器房" },
  settings: { title: "设置" }
};

export function App() {
  const [sourceUrl, setSourceUrl] = useState(sampleSourceUrl);
  const [candidateUrl, setCandidateUrl] = useState(`${apiBaseUrl}/fixtures/article-background`);
  const [candidateConcept, setCandidateConcept] = useState(demoProfile.interests[0] ?? "智能体");
  const [sourceImports, setSourceImports] = useState<SourceImport[]>([]);
  const [importedCards, setImportedCards] = useState<KnowledgeCard[]>([]);
  const [sourceAssets, setSourceAssets] = useState<SourceAsset[]>([]);
  const [sourceChunks, setSourceChunks] = useState<KnowledgeChunk[]>([]);
  const [sourceCandidates, setSourceCandidates] = useState<SourceCandidateRecord[]>([]);
  const [aiThreads, setAiThreads] = useState<AiThreads>({});
  const [agentQuestion, setAgentQuestion] = useState("");
  const [agentResponse, setAgentResponse] = useState<AgentAskApiResponse | null>(null);
  const [agentMessage, setAgentMessage] = useState("");
  const [isAgentAsking, setIsAgentAsking] = useState(false);
  const [interactionSignals, setInteractionSignals] = useState<InteractionSignals>({});
  const [learningFeedback, setLearningFeedback] = useState<LearningFeedbackByPost>({});
  const [evidenceLedgers, setEvidenceLedgers] = useState<Record<string, EvidenceLedger | null>>({});
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [apiMessage, setApiMessage] = useState("正在连接本地 API");
  const [curationMessage, setCurationMessage] = useState("还没运行过观察员");
  const [autoScoutEnabled, setAutoScoutEnabled] = useState(true);
  const [lastScoutAt, setLastScoutAt] = useState<string | null>(null);
  const [queuedJobCount, setQueuedJobCount] = useState(0);
  const [memoryMessage, setMemoryMessage] = useState("还没有记忆改动");
  const [candidateMessage, setCandidateMessage] = useState("还没有排队的候选源");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [conceptView, setConceptView] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("timeline");
  const [feedTab, setFeedTab] = useState<"foryou" | "latest" | "saved">("foryou");
  const [agentAskedQuestion, setAgentAskedQuestion] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document !== "undefined") {
      const current = document.documentElement.getAttribute("data-theme");
      if (current === "light" || current === "dark") return current;
    }
    return "light";
  });
  const [aiPrompt, setAiPrompt] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingCandidate, setIsSavingCandidate] = useState(false);
  const [isRunningCuration, setIsRunningCuration] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const syncedSignalSignatures = useRef<Record<string, string>>(loadSyncedSignalSignatures());
  const pendingSignalSignatures = useRef<Record<string, string>>({});
  const curationRunInFlight = useRef(false);
  const refreshSequence = useRef(0);
  // Mirror of interactionSignals so stable callbacks (e.g. handleDwell) can read
  // the latest signals without stale closures and without impure state updaters.
  const interactionSignalsRef = useRef<InteractionSignals>({});
  const composerInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    interactionSignalsRef.current = interactionSignals;
  }, [interactionSignals]);

  const importedSignals = useMemo(
    () =>
      importedCards.map((card) => ({
        id: `import-signal-${card.id}`,
        cardId: card.id,
        type: "save" as const,
        createdAt: card.createdAt
      })),
    [importedCards]
  );
  const interactionUserSignals = useMemo(
    () =>
      Object.values(interactionSignals).flatMap((signal) => {
        const createdAt = signal.createdAt;
        const signals = [];

        if (signal.liked) {
          signals.push({
            id: `interaction-like-${signal.postId}`,
            cardId: signal.postId,
            type: "like" as const,
            createdAt
          });
        }

        if (signal.saved) {
          signals.push({
            id: `interaction-save-${signal.postId}`,
            cardId: signal.postId,
            type: "save" as const,
            createdAt
          });
        }

        if (signal.askedQuestion) {
          signals.push({
            id: `interaction-ask-${signal.postId}`,
            cardId: signal.postId,
            type: "ask" as const,
            createdAt
          });
        }

        return signals;
      }),
    [interactionSignals]
  );

  const rankedImportedCards = useMemo(() => ensureRankedCards(importedCards), [importedCards]);
  const demoRankedCards = useMemo(() => rankKnowledgeCards(demoCards, demoProfile), []);
  const rankedCards = useMemo(
    () => (rankedImportedCards.length > 0 ? rankedImportedCards : demoRankedCards),
    [demoRankedCards, rankedImportedCards]
  );
  // "For you" keeps the personalized ranking; "Latest" re-sorts the same cards
  // newest-first by createdAt; "Saved" narrows to bookmarked cards.
  const displayedCards = useMemo(() => {
    if (feedTab === "latest") {
      return [...rankedCards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    if (feedTab === "saved") {
      return rankedCards.filter((card) => interactionSignals[card.id]?.saved);
    }

    return rankedCards;
  }, [feedTab, interactionSignals, rankedCards]);
  // Free-text filter over the active tab's cards so the rail search narrows
  // the feed in place instead of leaving the page.
  const visibleCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return displayedCards;
    return displayedCards.filter((card) => {
      const haystack = [
        card.title,
        card.summary,
        card.keyTakeaway,
        card.hook,
        card.thesis,
        card.shortBody,
        ...card.concepts
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [displayedCards, searchQuery]);
  const allCards = useMemo(() => rankedCards, [rankedCards]);
  const connectionsByCard = useMemo(() => {
    const byCard: Record<string, CardConnection[]> = {};

    for (const card of allCards) {
      byCard[card.id] = buildCardConnections(card, allCards);
    }

    return byCard;
  }, [allCards]);
  const conceptDigest = useMemo<ConceptDigest | null>(
    () => (conceptView ? buildConceptDigest(conceptView, allCards) : null),
    [conceptView, allCards]
  );
  const cardsById = useMemo(() => {
    const byId: Record<string, RankedKnowledgeCard> = {};

    for (const card of allCards) {
      byId[card.id] = card;
    }

    return byId;
  }, [allCards]);
  const cardCountByConcept = useMemo(() => {
    const byConcept: Record<string, number> = {};

    for (const card of allCards) {
      for (const concept of card.concepts) {
        byConcept[concept] = (byConcept[concept] ?? 0) + 1;
      }
    }

    return byConcept;
  }, [allCards]);
  // The X-style quote box under each post: the cited chunk's original text.
  const quoteByCard = useMemo(() => {
    const byCard: Record<string, string | undefined> = {};

    for (const card of allCards) {
      const chunkId = card.citations?.[0]?.chunkId;
      const chunk = chunkId
        ? sourceChunks.find((candidate) => candidate.id === chunkId)
        : sourceChunks.find((candidate) => candidate.sourceId === card.sources[0]?.id);
      byCard[card.id] = chunk?.content;
    }

    return byCard;
  }, [allCards, sourceChunks]);

  // Keyboard navigation (X-style): j/k move a focus highlight between cards,
  // Enter opens the focused card, "/" jumps to search, Escape clears.
  const visibleCount = visibleCards.length;
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) {
        if (event.key === "Escape") {
          target.blur();
          setSearchQuery("");
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case "j":
          event.preventDefault();
          setFocusedIndex((index) => Math.min(visibleCount - 1, index + 1));
          break;
        case "k":
          event.preventDefault();
          setFocusedIndex((index) => (index <= 0 ? index : index - 1));
          break;
        case "g":
          event.preventDefault();
          window.scrollTo({ top: 0, behavior: scrollMotion() });
          setFocusedIndex(-1);
          break;
        case "/":
          event.preventDefault();
          setActiveView("timeline");
          requestAnimationFrame(() =>
            document.querySelector<HTMLInputElement>(".x-search input")?.focus()
          );
          break;
        case "Enter":
          if (focusedIndex >= 0 && visibleCards[focusedIndex]) {
            handleOpenCard(visibleCards[focusedIndex]);
          }
          break;
        case "l":
          if (focusedIndex >= 0 && visibleCards[focusedIndex]) {
            event.preventDefault();
            handleLike(visibleCards[focusedIndex]);
          }
          break;
        case "s":
          if (focusedIndex >= 0 && visibleCards[focusedIndex]) {
            event.preventDefault();
            handleSave(visibleCards[focusedIndex]);
          }
          break;
        case "t":
          event.preventDefault();
          setTheme((value) => (value === "dark" ? "light" : "dark"));
          break;
        case "?":
          event.preventDefault();
          setShortcutsOpen((open) => !open);
          break;
        case "Escape":
          setShortcutsOpen(false);
          setSelectedCardId(null);
          setConceptView(null);
          setFocusedIndex(-1);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visibleCount, focusedIndex, visibleCards]);

  // Keep the focused card scrolled into view; clamp when the filtered list shrinks.
  useEffect(() => {
    if (focusedIndex < 0) return;
    const nodes = document.querySelectorAll<HTMLElement>(".x-feedlist > .x-post");
    nodes[focusedIndex]?.scrollIntoView({ block: "center", behavior: scrollMotion() });
  }, [focusedIndex]);
  useEffect(() => {
    setFocusedIndex((index) => (index >= visibleCount ? visibleCount - 1 : index));
  }, [visibleCount]);

  // Apply the chosen theme to <html> and remember it. The inline head script
  // sets the initial attribute before paint; this keeps it in sync on toggle.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("aitl-theme", theme);
    } catch {
      // ignore unavailable storage
    }
  }, [theme]);

  // Reveal the scroll-to-top button once the feed is scrolled past ~one screen.
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const allSignals = useMemo(
    () => [...demoSignals, ...importedSignals, ...interactionUserSignals],
    [importedSignals, interactionUserSignals]
  );
  const selectedCard = useMemo(
    () => (selectedCardId ? rankedCards.find((card) => card.id === selectedCardId) ?? null : null),
    [rankedCards, selectedCardId]
  );
  const selectedSourceId = selectedCard?.sources[0]?.id;
  const selectedChunks = useMemo(
    () => sourceChunks.filter((chunk) => chunk.sourceId === selectedSourceId),
    [selectedSourceId, sourceChunks]
  );
  const selectedAsset = useMemo(
    () => sourceAssets.find((asset) => asset.sourceId === selectedSourceId),
    [selectedSourceId, sourceAssets]
  );
  const graph = useMemo(() => buildKnowledgeGraph(allCards, allSignals), [allCards, allSignals]);
  const reviewQueue = useMemo(
    () => createReviewQueue(allCards, allSignals, new Date("2026-06-08T08:00:00.000Z")),
    [allCards, allSignals]
  );
  const boundary = useMemo(
    () => buildKnowledgeBoundary({ cards: allCards, signals: allSignals }),
    [allCards, allSignals]
  );
  const selectedThread = selectedCard ? aiThreads[selectedCard.id] ?? [] : [];
  const selectedFeedback = selectedCard ? learningFeedback[selectedCard.id] : undefined;
  const selectedSignal = selectedCard ? interactionSignals[selectedCard.id] : undefined;
  const selectedEvidenceLedger = selectedCard ? evidenceLedgers[selectedCard.id] : undefined;
  const hasQueuedScoutWork = useMemo(
    () => queuedJobCount > 0 || sourceCandidates.some((record) => record.status === "queued"),
    [queuedJobCount, sourceCandidates]
  );

  useEffect(() => {
    const storedState = loadStoredState();

    if (storedState) {
      setSourceImports(storedState.sourceImports);
      setImportedCards(storedState.importedCards);
      setSourceAssets(storedState.sourceAssets);
      setSourceChunks(storedState.sourceChunks);
      setAiThreads(storedState.aiThreads);
      setInteractionSignals(storedState.interactionSignals ?? {});
      setLearningFeedback(storedState.learningFeedback ?? {});
    }

    setHasHydrated(true);
  }, []);

  useEffect(() => {
    void refreshFromApi({ silent: true });
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    saveStoredState({
      sourceImports,
      importedCards,
      sourceAssets,
      sourceChunks,
      aiThreads,
      interactionSignals,
      learningFeedback
    });
  }, [
    aiThreads,
    hasHydrated,
    importedCards,
    interactionSignals,
    learningFeedback,
    sourceAssets,
    sourceChunks,
    sourceImports
  ]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    setInteractionSignals((signals) => {
      let changed = false;
      const nextSignals = { ...signals };

      for (const card of rankedCards) {
        if (!nextSignals[card.id]) {
          nextSignals[card.id] = createInteractionSignal(card);
          changed = true;
        }
      }

      return changed ? nextSignals : signals;
    });
  }, [hasHydrated, rankedCards]);

  useEffect(() => {
    if (!hasHydrated || apiStatus !== "connected") {
      return;
    }

    for (const signal of Object.values(interactionSignals)) {
      if (!shouldSyncSignal(signal)) {
        continue;
      }

      const signature = createSignalSignature(signal);

      if (syncedSignalSignatures.current[signal.postId] === signature) {
        continue;
      }

      if (pendingSignalSignatures.current[signal.postId] === signature) {
        continue;
      }

      pendingSignalSignatures.current[signal.postId] = signature;
      void syncInteractionSignal(signal)
        .then(() => {
          syncedSignalSignatures.current[signal.postId] = signature;
          saveSyncedSignalSignatures(syncedSignalSignatures.current);
        })
        .catch(() => {
          setApiMessage("信号同步失败,本地反馈仍然可用");
        })
        .finally(() => {
          if (pendingSignalSignatures.current[signal.postId] === signature) {
            delete pendingSignalSignatures.current[signal.postId];
          }
        });
    }
  }, [apiStatus, hasHydrated, interactionSignals]);

  useEffect(() => {
    if (!selectedCard || apiStatus !== "connected" || selectedCard.id in evidenceLedgers) {
      return;
    }

    let isStale = false;
    const postId = selectedCard.id;

    void apiRequest<ApiEvidenceResponse>(`/api/evidence/${encodeURIComponent(postId)}`)
      .then((result) => {
        if (isStale) {
          return;
        }

        setEvidenceLedgers((ledgers) => ({
          ...ledgers,
          [postId]: result.ledger
        }));
      })
      .catch(() => {
        if (isStale) {
          return;
        }

        setEvidenceLedgers((ledgers) => ({
          ...ledgers,
          [postId]: null
        }));
      });

    return () => {
      isStale = true;
    };
  }, [apiStatus, evidenceLedgers, selectedCard]);

  useEffect(() => {
    if (!hasHydrated || !autoScoutEnabled || apiStatus !== "connected") {
      return;
    }

    const runIfUseful = () => {
      if (document.hidden || curationRunInFlight.current || !hasQueuedScoutWork) {
        return;
      }

      void runCuration("auto");
    };
    const startupTimer = window.setTimeout(runIfUseful, 2500);
    const interval = window.setInterval(runIfUseful, 45000);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        runIfUseful();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [apiStatus, autoScoutEnabled, hasHydrated, hasQueuedScoutWork]);

  const handleDwell = useCallback((card: KnowledgeCard, dwellTimeMs: number) => {
    recordInteraction(card, { dwellTimeMs, skippedQuickly: false });
  }, []);

  async function refreshFromApi(options: { silent?: boolean } = {}) {
    const requestId = ++refreshSequence.current;

    if (!options.silent) {
      setApiStatus("checking");
      setApiMessage("正在刷新本地 API 状态");
    }

    try {
      const [timeline, snapshot, queuedJobs] = await Promise.all([
        apiRequest<ApiTimelineResponse>(
          `/api/timeline?userId=local-user&now=${encodeURIComponent(new Date().toISOString())}`
        ),
        apiRequest<ApiSnapshot>("/api/snapshot"),
        apiRequest<ApiCurationJobsResponse>("/api/curation/jobs?status=queued")
      ]);

      // A newer refresh started while this one was in flight; drop the stale result.
      if (requestId !== refreshSequence.current) {
        return;
      }

      const registryAssets = snapshot.sourceRegistries.flatMap((record) => record.registry.assets);
      const registryChunks = snapshot.sourceRegistries.flatMap((record) => record.registry.chunks);

      setImportedCards(timeline.posts);
      setSourceImports(timeline.sourceImports);
      setSourceAssets(upsertById([], registryAssets));
      setSourceChunks(upsertById([], registryChunks));
      setSourceCandidates(snapshot.sourceCandidates);
      setQueuedJobCount(queuedJobs.jobs.length);
      setApiStatus("connected");
      setApiMessage("已连接本地 API");
    } catch (error) {
      if (requestId !== refreshSequence.current) {
        return;
      }

      setApiStatus("offline");
      setApiMessage(error instanceof Error ? error.message : "运行 npm run dev:api 才能使用来源导入");
    }
  }

  async function importSourceThroughApi(url: string): Promise<ApiImportResponse> {
    const endpoint = isYouTubeUrl(url) ? "/api/import/youtube" : "/api/import/article";
    const result = await apiRequest<ApiImportResponse>(endpoint, {
      method: "POST",
      body: {
        url,
        createdAt: new Date().toISOString(),
        recommendedBecause: "你从 Web 时间线导入了这个来源。"
      }
    });

    setApiStatus("connected");
    setApiMessage("已连接本地 API");

    return result;
  }

  async function syncInteractionSignal(signal: InteractionSignal): Promise<void> {
    const result = await apiRequest<{
      feedback?: LearningFeedback;
      topicState?: TopicState;
      plan?: { acceptedSourceCandidateIds?: string[] };
    }>("/api/signals", {
      method: "POST",
      body: {
        generatedAt: new Date().toISOString(),
        signal,
        topicState: deriveTopicState(signal),
        sourceCandidates: []
      }
    });

    if (result.feedback) {
      setLearningFeedback((feedbackByPost) => ({
        ...feedbackByPost,
        [signal.postId]: result.feedback as LearningFeedback
      }));
    }

    await refreshFromApi({ silent: true });
  }

  async function syncMemoryForCard(card: KnowledgeCard, action: MemoryAction, question?: string): Promise<void> {
    const sourceType = card.sources[0]?.type;
    const primaryConcept = card.concepts[0];
    const edits = [
      {
        kind: "add",
        field: "interaction.recentCardIds",
        value: card.id,
        reason: `User ${action} interaction on timeline.`
      }
    ];

    if (action === "like" && primaryConcept) {
      edits.push({
        kind: "add",
        field: "profile.interests",
        value: primaryConcept,
        reason: "Liked cards should raise interest memory."
      });
    }

    if (action === "save") {
      for (const concept of card.concepts.slice(0, 4)) {
        edits.push({
          kind: "add",
          field: "knowledge.savedConcepts",
          value: concept,
          reason: "Saved cards become reviewable knowledge concepts."
        });
      }
    }

    if (action === "ask" && question) {
      edits.push({
        kind: "add",
        field: "interaction.recentQuestions",
        value: question,
        reason: "Questions reveal confusing or high-pull knowledge gaps."
      });
    }

    if (sourceType) {
      edits.push({
        kind: "add",
        field: "agent.preferredSourceTypes",
        value: sourceType,
        reason: "Interacted sources tune future source selection."
      });
    }

    try {
      const result = await apiRequest<{ events: unknown[] }>("/api/memory", {
        method: "POST",
        body: {
          userId: "local-user",
          edits
        }
      });

      const actionLabel = { like: "点赞", save: "收藏", ask: "追问" }[action];
      setMemoryMessage(`${actionLabel}产生了 ${result.events.length} 条记忆改动`);
    } catch {
      setMemoryMessage("记忆 API 不可用,已保留本地反馈");
    }
  }

  function applyImportResult(result: ApiImportResponse) {
    const posts = result.posts ?? [];
    const assets = result.assets ?? [];
    const chunks = result.chunks ?? [];

    setSourceImports((imports) => upsertImport(imports, result.importRecord));
    setImportedCards((cards) => mergeCards(posts, cards));
    setSourceAssets((assetsState) => upsertById(assetsState, assets));
    setSourceChunks((chunksState) => upsertById(chunksState, chunks));
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedUrl = sourceUrl.trim();

    if (!trimmedUrl) {
      setImportError("请先粘贴一个文章或 YouTube 链接。");
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      const result = await importSourceThroughApi(trimmedUrl);

      applyImportResult(result);
      await refreshFromApi({ silent: true });

      if (result.posts?.[0]) {
        setSelectedCardId(result.posts[0].id);
        recordInteraction(result.posts[0], { openedThread: true, dwellTimeMs: 9000 });
      }
    } catch (error) {
      if (isYouTubeUrl(trimmedUrl)) {
        const result = transformMockYouTubeUrl(trimmedUrl, new Date().toISOString());

        applyImportResult({
          importRecord: result.importRecord,
          assets: [result.asset],
          chunks: result.chunks,
          posts: result.cards
        });
        setSelectedCardId(result.cards[0]?.id ?? null);
        setApiStatus("offline");
        setApiMessage("API 不可用,改用本地模拟的 YouTube 导入");
      } else {
        setImportError(error instanceof Error ? error.message : "导入失败。");
      }
    } finally {
      setIsImporting(false);
    }
  }

  async function handleSaveCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedUrl = candidateUrl.trim();
    const trimmedConcept = candidateConcept.trim();

    if (!trimmedUrl || !trimmedConcept) {
      setCandidateMessage("加入队列前请先填好 URL 和话题");
      return;
    }

    setIsSavingCandidate(true);

    try {
      const result = await apiRequest<{ record: SourceCandidateRecord }>("/api/source-candidates", {
        method: "POST",
        body: {
          url: trimmedUrl,
          intakeKind: "user_paste",
          topicId: slugConcept(trimmedConcept),
          conceptIds: [trimmedConcept],
          relevanceScore: 0.74,
          noveltyScore: 0.66,
          qualityScore: 0.72,
          reason: `从 Web 时间线为「${trimmedConcept}」加入队列。`,
          discoveredAt: new Date().toISOString()
        }
      });

      setSourceCandidates((records) => upsertById(records, [result.record]));
      setCandidateMessage(`已加入队列:${result.record.candidate.source.title}`);
      setApiStatus("connected");
      setApiMessage("已连接本地 API");
    } catch (error) {
      setApiStatus("offline");
      setCandidateMessage(error instanceof Error ? error.message : "无法把候选源加入队列");
    } finally {
      setIsSavingCandidate(false);
    }
  }

  async function runCuration(trigger: "manual" | "auto" = "manual") {
    if (curationRunInFlight.current) {
      return;
    }

    curationRunInFlight.current = true;
    setIsRunningCuration(true);
    setCurationMessage(trigger === "auto" ? "自动观察员正在处理到期任务" : "正在处理到期任务");

    try {
      const result = await apiRequest<ApiCurationRunResponse>("/api/curation/run", {
        method: "POST",
        body: {
          now: new Date().toISOString(),
          limit: trigger === "auto" ? 4 : 8,
          kinds: ["import_source", "discover_sources", "generate_followup", "schedule_review", "cooldown_topic"]
        }
      });
      const importedCount = result.records.filter((record) => record.result?.sourceImport).length;
      const checkedAt = new Date().toISOString();

      setApiStatus("connected");
      setApiMessage("已连接本地 API");
      setLastScoutAt(checkedAt);
      const scoutLabel = trigger === "auto" ? "自动观察员" : "观察员";
      setCurationMessage(
        result.records.length > 0
          ? `${scoutLabel}处理了 ${result.records.length} 个任务 · 导入 ${importedCount} 个来源`
          : `${scoutLabel}已检查 · 没有到期任务`
      );
      await refreshFromApi({ silent: true });
    } catch (error) {
      setApiStatus("offline");
      setApiMessage(error instanceof Error ? error.message : "API 不可用");
      setCurationMessage("观察员无法运行");
    } finally {
      curationRunInFlight.current = false;
      setIsRunningCuration(false);
    }
  }

  function handleRunCuration() {
    void runCuration("manual");
  }

  async function handleAskAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedCard || !aiPrompt.trim()) {
      return;
    }

    const card = selectedCard;
    const chunks = selectedChunks;
    const question = aiPrompt.trim();
    const askedAt = new Date().toISOString();
    const userMessage: AiMessage = {
      id: `${card.id}-user-${askedAt}`,
      role: "user",
      content: question,
      createdAt: askedAt
    };

    setAiThreads((threads) => ({
      ...threads,
      [card.id]: [...(threads[card.id] ?? []), userMessage]
    }));
    setAiPrompt("");
    recordInteraction(card, { askedQuestion: true, openedThread: true, dwellTimeMs: 12000 });
    void syncMemoryForCard(card, "ask", question);

    let answerContent: string;

    try {
      const result = await apiRequest<AskApiResult>("/api/ask", {
        method: "POST",
        body: { postId: card.id, question }
      });
      answerContent = formatAskAnswer(result);
    } catch {
      // API unavailable or model not configured: keep the offline grounded answer.
      answerContent = buildGroundedAnswer(card, chunks, question);
    }

    const answeredAt = new Date().toISOString();
    const assistantMessage: AiMessage = {
      id: `${card.id}-assistant-${answeredAt}`,
      role: "assistant",
      content: answerContent,
      createdAt: answeredAt
    };

    setAiThreads((threads) => ({
      ...threads,
      [card.id]: [...(threads[card.id] ?? []), assistantMessage]
    }));
  }

  function handleOpenCard(card: RankedKnowledgeCard) {
    setSelectedCardId(card.id);
    recordInteraction(card, { openedThread: true, dwellTimeMs: 9000, skippedQuickly: false });
  }

  function handleOpenCardId(cardId: string) {
    const target = rankedCards.find((card) => card.id === cardId);

    if (target) {
      handleOpenCard(target);
    } else {
      setSelectedCardId(cardId);
    }
  }

  function handleOpenConcept(concept: string) {
    setConceptView(concept);
  }

  function handleOpenCardFromConcept(cardId: string) {
    setConceptView(null);
    handleOpenCardId(cardId);
  }

  function handleLike(card: RankedKnowledgeCard) {
    recordInteraction(card, { liked: true, skippedQuickly: false });
    void syncMemoryForCard(card, "like");
  }

  function handleSave(card: RankedKnowledgeCard) {
    recordInteraction(card, { saved: true, skippedQuickly: false });
    void syncMemoryForCard(card, "save");
  }

  function handleSkip(card: RankedKnowledgeCard) {
    recordInteraction(card, { skippedQuickly: true, dwellTimeMs: 800, openedThread: false });
  }

  async function handleAgentAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = agentQuestion.trim();

    if (!question || isAgentAsking) {
      return;
    }

    setIsAgentAsking(true);
    setAgentMessage("");
    setAgentAskedQuestion(question);
    setAgentQuestion("");

    try {
      const result = await apiRequest<AgentAskApiResponse>("/api/agent/ask", {
        method: "POST",
        body: { question }
      });

      setAgentResponse(result);
      void refreshFromApi({ silent: true });
    } catch (error) {
      setAgentMessage(
        error instanceof Error ? error.message : "Agent 请求失败，请先运行 npm run dev:api。"
      );
    } finally {
      setIsAgentAsking(false);
    }
  }

  function recordInteraction(card: KnowledgeCard, patch: Partial<InteractionSignal>) {
    const signals = interactionSignalsRef.current;
    const currentSignal = signals[card.id] ?? createInteractionSignal(card);
    const dwellTimeMs = Math.max(currentSignal.dwellTimeMs, patch.dwellTimeMs ?? 0);
    const nextSignal = {
      ...currentSignal,
      ...patch,
      impression: true,
      conceptIds: card.concepts,
      topicId: getTopicId(card),
      dwellTimeMs,
      createdAt: new Date().toISOString()
    };
    const feedback = evaluateInteraction(nextSignal, deriveTopicState(nextSignal));

    interactionSignalsRef.current = {
      ...signals,
      [card.id]: nextSignal
    };
    setInteractionSignals(interactionSignalsRef.current);
    setLearningFeedback((feedbackByPost) => ({
      ...feedbackByPost,
      [card.id]: feedback
    }));
  }

  const activeTitle = viewTitles[activeView];
  const pendingDiscoverCount = sourceCandidates.filter(
    (record) => record.status === "pending" || record.status === "queued"
  ).length;

  return (
    <div className="x-frame">
      <nav className="x-navrail" aria-label="主导航">
        <button className="x-logo" onClick={() => setActiveView("timeline")} title="AITimeline" type="button">
          AI
        </button>
        {navItems.map((item) => {
          const showDot =
            (item.key === "discover" && pendingDiscoverCount > 0) ||
            (item.key === "review" && reviewQueue.length > 0);

          return (
            <button
              aria-current={activeView === item.key ? "page" : undefined}
              aria-label={item.label}
              className={`x-navbtn${activeView === item.key ? " active" : ""}`}
              key={item.key}
              onClick={() => setActiveView(item.key)}
              title={item.label}
              type="button"
            >
              <item.icon size={24} strokeWidth={activeView === item.key ? 2.4 : 1.9} />
              {showDot ? <span className="x-navdot" /> : null}
            </button>
          );
        })}
        <button
          aria-label="发布想法"
          className="x-compose"
          onClick={() => {
            setActiveView("timeline");
            requestAnimationFrame(() => composerInputRef.current?.focus());
          }}
          title="发布想法"
          type="button"
        >
          <PenLine size={22} />
        </button>
      </nav>

      <main className="x-main">
        <header className="x-colhead">
          <div className="x-coltitle">
            <div>
              <h1>{activeTitle.title}</h1>
              {activeTitle.sub ? <p className="x-colsub">{activeTitle.sub}</p> : null}
            </div>
          </div>
          {activeView === "timeline" ? (
            <div className="x-tabs" role="tablist" aria-label="信息流视图">
              {(
                [
                  ["foryou", "推荐"],
                  ["latest", "最新"],
                  ["saved", "已收藏"]
                ] as const
              ).map(([tabKey, tabLabel]) => (
                <button
                  aria-selected={feedTab === tabKey}
                  className={`x-tab${feedTab === tabKey ? " active" : ""}`}
                  key={tabKey}
                  onClick={() => setFeedTab(tabKey)}
                  role="tab"
                  type="button"
                >
                  {tabLabel}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        {activeView === "timeline" ? (
          <>
            <AskComposer
              isAsking={isAgentAsking}
              onQuestionChange={setAgentQuestion}
              onSubmit={handleAgentAsk}
              question={agentQuestion}
              ref={composerInputRef}
            />

            {agentMessage ? <p className="x-empty">{agentMessage}</p> : null}
            {agentResponse && agentAskedQuestion ? (
              <AgentReplyThread
                onDismiss={() => {
                  setAgentResponse(null);
                  setAgentAskedQuestion("");
                }}
                onOpenCardId={handleOpenCardId}
                question={agentAskedQuestion}
                response={agentResponse}
              />
            ) : null}

            <section className="x-feedlist" aria-label="知识卡片">
              {visibleCards.length === 0 ? (
                <p className="x-empty">
                  {searchQuery.trim()
                    ? `没有匹配「${searchQuery.trim()}」的卡片。`
                    : feedTab === "saved"
                      ? "还没有收藏的卡片，点书签图标收藏。"
                      : "时间线是空的，去「智能体」导入一个来源吧。"}
                </p>
              ) : (
                visibleCards.map((card, index) => (
                  <PostView
                    card={card}
                    connections={connectionsByCard[card.id] ?? []}
                    isFocused={index === focusedIndex}
                    key={card.id}
                    onDwell={handleDwell}
                    onLike={handleLike}
                    onOpen={handleOpenCard}
                    onOpenCardId={handleOpenCardId}
                    onOpenConcept={handleOpenConcept}
                    onSave={handleSave}
                    onSkip={handleSkip}
                    quoteText={quoteByCard[card.id]}
                    signal={interactionSignals[card.id]}
                  />
                ))
              )}
              {visibleCards.length > 0 ? (
                <p className="x-empty" role="status">
                  <CheckCircle2 aria-hidden="true" size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
                  已经看完啦，你刷到时间线的底部了。
                </p>
              ) : null}
            </section>
          </>
        ) : null}

        {activeView === "discover" ? (
          <DiscoverView
            isRunning={isRunningCuration}
            message={curationMessage}
            onRunCuration={handleRunCuration}
            records={sourceCandidates}
          />
        ) : null}

        {activeView === "graph" ? (
          <GraphView boundary={boundary} cardCountByConcept={cardCountByConcept} onOpenConcept={handleOpenConcept} />
        ) : null}

        {activeView === "review" ? (
          <ReviewView
            cardsById={cardsById}
            onReviewed={(card) => recordInteraction(card, { reviewed: true, skippedQuickly: false })}
            queue={reviewQueue}
          />
        ) : null}

        {activeView === "agent" ? (
          <AgentView
            apiMessage={apiMessage}
            apiStatus={apiStatus}
            autoScoutEnabled={autoScoutEnabled}
            candidateConcept={candidateConcept}
            candidateMessage={candidateMessage}
            candidateUrl={candidateUrl}
            cardCount={importedCards.length}
            curationMessage={curationMessage}
            hasQueuedScoutWork={hasQueuedScoutWork}
            importError={importError}
            isImporting={isImporting}
            isRunningCuration={isRunningCuration}
            isSavingCandidate={isSavingCandidate}
            lastScoutAt={lastScoutAt}
            memoryMessage={memoryMessage}
            onAutoScoutChange={setAutoScoutEnabled}
            onCandidateConceptChange={setCandidateConcept}
            onCandidateUrlChange={setCandidateUrl}
            onImportSubmit={handleImport}
            onRunCuration={handleRunCuration}
            onSaveCandidate={handleSaveCandidate}
            onSourceUrlChange={setSourceUrl}
            queuedJobCount={queuedJobCount}
            sourceCandidates={sourceCandidates}
            sourceImports={sourceImports}
            sourceUrl={sourceUrl}
          />
        ) : null}

        {activeView === "settings" ? (
          <SettingsView
            apiMessage={apiMessage}
            apiStatus={apiStatus}
            onShowShortcuts={() => setShortcutsOpen(true)}
            onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            theme={theme}
          />
        ) : null}
      </main>

      {activeView === "timeline" ? (
        <ContextRail
          boundary={boundary}
          graph={graph}
          onOpenConcept={handleOpenConcept}
          onOpenGraph={() => setActiveView("graph")}
          onOpenReview={() => setActiveView("review")}
          onSearchChange={setSearchQuery}
          reviewQueue={reviewQueue}
          searchQuery={searchQuery}
        />
      ) : null}

      {selectedCard ? (
        <SourceDetailDrawer
          asset={selectedAsset}
          card={selectedCard}
          chunks={selectedChunks}
          connections={connectionsByCard[selectedCard.id] ?? []}
          evidenceLedger={selectedEvidenceLedger}
          feedback={selectedFeedback}
          messages={selectedThread}
          onAsk={handleAskAi}
          onClose={() => setSelectedCardId(null)}
          onOpenCardId={handleOpenCardId}
          onPromptChange={setAiPrompt}
          prompt={aiPrompt}
          signal={selectedSignal}
        />
      ) : null}

      {conceptDigest && conceptDigest.cardCount > 0 ? (
        <ConceptDigestPanel
          digest={conceptDigest}
          onClose={() => setConceptView(null)}
          onOpenCardId={handleOpenCardFromConcept}
        />
      ) : null}

      {shortcutsOpen ? (
        <div
          aria-label="键盘快捷键"
          aria-modal="true"
          className="shortcuts-overlay"
          onClick={() => setShortcutsOpen(false)}
          role="dialog"
        >
          <div className="shortcuts-modal" onClick={(event) => event.stopPropagation()}>
            <div className="shortcuts-head">
              <h2>键盘快捷键</h2>
              <button
                aria-label="关闭快捷键"
                className="icon-button compact"
                onClick={() => setShortcutsOpen(false)}
                type="button"
              >
                <XCircle size={18} />
              </button>
            </div>
            <ul className="shortcuts-list">
              <li>
                <kbd>j</kbd>
                <span>下一张卡</span>
              </li>
              <li>
                <kbd>k</kbd>
                <span>上一张卡</span>
              </li>
              <li>
                <kbd>g</kbd>
                <span>回到顶部</span>
              </li>
              <li>
                <kbd>Enter</kbd>
                <span>展开卡片</span>
              </li>
              <li>
                <kbd>l</kbd>
                <span>点赞</span>
              </li>
              <li>
                <kbd>s</kbd>
                <span>收藏</span>
              </li>
              <li>
                <kbd>/</kbd>
                <span>搜索</span>
              </li>
              <li>
                <kbd>t</kbd>
                <span>切换主题</span>
              </li>
              <li>
                <kbd>?</kbd>
                <span>开关此菜单</span>
              </li>
              <li>
                <kbd>Esc</kbd>
                <span>关闭 / 清除</span>
              </li>
            </ul>
          </div>
        </div>
      ) : null}

      {showScrollTop && !selectedCard ? (
        <button
          aria-label="回到顶部"
          className="scroll-top-button"
          onClick={() => window.scrollTo({ top: 0, behavior: scrollMotion() })}
          title="回到顶部"
          type="button"
        >
          <ArrowUp size={20} />
        </button>
      ) : null}
    </div>
  );
}
