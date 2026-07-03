import {
  buildCardConnections,
  buildConceptDigest,
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
import {
  ArrowUp,
  Bell,
  Bot,
  Brain,
  CheckCircle2,
  Compass,
  FileText,
  GitBranch,
  Home,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  Sun,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AgentAskPanel } from "./components/AgentAskPanel";
import { ConceptDigestPanel } from "./components/ConceptDigestPanel";
import { ImportRow } from "./components/ImportRow";
import { KnowledgeCardView } from "./components/KnowledgeCardView";
import { SourceCandidatePanel } from "./components/SourceCandidatePanel";
import { SourceDetailDrawer } from "./components/SourceDetailDrawer";
import { SourceImportPanel } from "./components/SourceImportPanel";
import { apiBaseUrl, apiRequest, isYouTubeUrl, sampleSourceUrl } from "./lib/api";
import { buildGroundedAnswer, formatAskAnswer, formatDueDate, getTopicId, scrollMotion, slugConcept } from "./lib/format";
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

const navItems = [
  { label: "时间线", icon: Home, active: true },
  { label: "发现", icon: Compass },
  { label: "图谱", icon: GitBranch },
  { label: "复习", icon: Brain },
  { label: "智能体", icon: Bot },
  { label: "设置", icon: Settings }
];

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
  const [feedTab, setFeedTab] = useState<"foryou" | "latest">("foryou");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
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
  // newest-first by createdAt so users can switch between relevance and recency.
  const displayedCards = useMemo(
    () =>
      feedTab === "latest"
        ? [...rankedCards].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : rankedCards,
    [feedTab, rankedCards]
  );
  // Free-text filter over the active tab's cards so the header search narrows
  // the feed in place instead of leaving the page.
  const visibleCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const topic = activeTopic?.toLowerCase() ?? null;
    if (!q && !topic) return displayedCards;
    return displayedCards.filter((card) => {
      if (topic && !card.concepts.some((concept) => concept.toLowerCase() === topic)) {
        return false;
      }
      if (q) {
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
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [displayedCards, searchQuery, activeTopic]);
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
          setSearchOpen(false);
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
          setSearchOpen(true);
          requestAnimationFrame(() =>
            document.querySelector<HTMLInputElement>(".header-search input")?.focus()
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
    const nodes = document.querySelectorAll<HTMLElement>(".feed-list .knowledge-card");
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

  return (
    <div className="app-shell">
      <aside className="left-rail" aria-label="主导航">
        <div className="brand-mark">
          <div className="brand-icon">AI</div>
          <span>AITimeline</span>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              aria-current={item.active ? "page" : undefined}
              aria-label={item.label}
              className={`nav-item ${item.active ? "active" : ""}`}
              key={item.label}
            >
              <item.icon size={20} strokeWidth={1.9} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="agent-brief">
          <div className="section-label">当前智能体</div>
          <h2>AI 知识观察员</h2>
          <p>{curationMessage}</p>
          <button className="primary-action" disabled={isRunningCuration} onClick={handleRunCuration} type="button">
            {isRunningCuration ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
            <span>{isRunningCuration ? "运行中" : "运行观察员"}</span>
          </button>
        </section>
      </aside>

      <main className="timeline-column">
        <header className="timeline-header">
          {searchOpen ? (
            <div className="header-search">
              <Search size={18} />
              <input
                aria-label="搜索时间线"
                autoFocus
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索你的时间线"
                value={searchQuery}
              />
              {searchQuery ? (
                <button
                  aria-label="清除搜索"
                  className="header-search-clear"
                  onClick={() => setSearchQuery("")}
                  type="button"
                >
                  <XCircle size={18} />
                </button>
              ) : null}
            </div>
          ) : (
            <div>
              <p className="section-label">今天</p>
              <h1>知识时间线</h1>
            </div>
          )}
          <div className="header-actions">
            <button
              className={`icon-button${searchOpen ? " selected" : ""}`}
              onClick={() => {
                if (searchOpen) {
                  setSearchOpen(false);
                  setSearchQuery("");
                } else {
                  setSearchOpen(true);
                }
              }}
              title="搜索"
              type="button"
            >
              <Search size={19} />
            </button>
            <button
              aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              className="icon-button"
              onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
              title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
              type="button"
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <button className="icon-button" title="通知" type="button">
              <Bell size={19} />
            </button>
          </div>
        </header>

        <div className="feed-tabs" role="tablist" aria-label="信息流视图">
          <button
            aria-selected={feedTab === "foryou"}
            className={`feed-tab${feedTab === "foryou" ? " active" : ""}`}
            onClick={() => setFeedTab("foryou")}
            role="tab"
            type="button"
          >
            推荐
          </button>
          <button
            aria-selected={feedTab === "latest"}
            className={`feed-tab${feedTab === "latest" ? " active" : ""}`}
            onClick={() => setFeedTab("latest")}
            role="tab"
            type="button"
          >
            最新
          </button>
        </div>

        <div className="topic-strip" aria-label="话题">
          <button
            aria-pressed={activeTopic === null}
            className={`topic-pill${activeTopic === null ? " active" : ""}`}
            onClick={() => setActiveTopic(null)}
            type="button"
          >
            全部
          </button>
          {demoProfile.interests.map((interest) => (
            <button
              aria-pressed={activeTopic === interest}
              className={`topic-pill${activeTopic === interest ? " active" : ""}`}
              key={interest}
              onClick={() => setActiveTopic((current) => (current === interest ? null : interest))}
              type="button"
            >
              {interest}
            </button>
          ))}
        </div>

        <SourceImportPanel
          apiMessage={apiMessage}
          apiStatus={apiStatus}
          cardCount={importedCards.length}
          error={importError}
          isImporting={isImporting}
          latestImport={sourceImports[0]}
          onSubmit={handleImport}
          onUrlChange={setSourceUrl}
          url={sourceUrl}
        />

        <section className="feed-list" aria-label="知识卡片">
          {visibleCards.length === 0 && (searchQuery.trim() || activeTopic) ? (
            <p className="feed-empty">
              {searchQuery.trim()
                ? `没有匹配「${searchQuery.trim()}」的卡片。`
                : `「${activeTopic}」下还没有卡片。`}
            </p>
          ) : (
            visibleCards.map((card, index) => (
              <KnowledgeCardView
                card={card}
                connections={connectionsByCard[card.id] ?? []}
                feedback={learningFeedback[card.id]}
                isFocused={index === focusedIndex}
                key={card.id}
                onDwell={handleDwell}
                onLike={handleLike}
                onOpen={handleOpenCard}
                onOpenCardId={handleOpenCardId}
                onOpenConcept={handleOpenConcept}
                onSave={handleSave}
                onSkip={handleSkip}
                signal={interactionSignals[card.id]}
              />
            ))
          )}
          {visibleCards.length > 0 && (
            <div className="feed-end" role="status">
              <CheckCircle2 aria-hidden="true" className="feed-end-icon" size={22} />
              <p className="feed-end-title">已经看完啦</p>
              <p className="feed-end-sub">你已经刷到时间线的底部了。</p>
            </div>
          )}
        </section>
      </main>

      <aside className="right-rail" aria-label="上下文">
        <AgentAskPanel
          isAsking={isAgentAsking}
          message={agentMessage}
          onOpenCard={handleOpenCardId}
          onQuestionChange={setAgentQuestion}
          onSubmit={handleAgentAsk}
          question={agentQuestion}
          response={agentResponse}
        />

        <SourceCandidatePanel
          autoScoutEnabled={autoScoutEnabled}
          candidateConcept={candidateConcept}
          candidateUrl={candidateUrl}
          curationMessage={curationMessage}
          hasQueuedScoutWork={hasQueuedScoutWork}
          isSaving={isSavingCandidate}
          isRunningCuration={isRunningCuration}
          lastScoutAt={lastScoutAt}
          message={candidateMessage}
          onConceptChange={setCandidateConcept}
          onAutoScoutChange={setAutoScoutEnabled}
          onRunCuration={handleRunCuration}
          onSubmit={handleSaveCandidate}
          onUrlChange={setCandidateUrl}
          queuedJobCount={queuedJobCount}
          records={sourceCandidates}
        />

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">来源</p>
              <h2>导入</h2>
            </div>
            <button className="icon-button compact" title="来源导入">
              <FileText size={18} />
            </button>
          </div>

          <div className="import-list">
            {sourceImports.length > 0 ? (
              sourceImports.map((sourceImport) => <ImportRow item={sourceImport} key={sourceImport.id} />)
            ) : (
              <div className="empty-state">还没有导入</div>
            )}
          </div>
        </section>

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">图谱</p>
              <h2>沉淀的概念</h2>
            </div>
            <button className="icon-button compact" title="打开图谱">
              <GitBranch size={18} />
            </button>
          </div>

          <div className="graph-list">
            {graph.nodes.slice(0, 6).map((node) => (
              <button
                className="graph-row"
                key={node.id}
                onClick={() => handleOpenConcept(node.label)}
                title={`查看「${node.label}」的全部碎片`}
                type="button"
              >
                <span>{node.label}</span>
                <strong>{node.weight}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">记忆</p>
              <h2>用户信号</h2>
            </div>
            <button className="icon-button compact" title="记忆">
              <Brain size={18} />
            </button>
          </div>

          <div className="memory-status">{memoryMessage}</div>
        </section>

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">复习</p>
              <h2>即将到期</h2>
            </div>
            <button className="icon-button compact" title="复习队列">
              <Brain size={18} />
            </button>
          </div>

          <div className="review-list">
            {reviewQueue.slice(0, 4).map((item) => (
              <button
                className="review-row"
                key={`${item.cardId}-${item.concept}`}
                onClick={() => setSelectedCardId(item.cardId)}
                title={`打开「${item.concept}」复习`}
                type="button"
              >
                <span>{item.concept}</span>
                <time>{formatDueDate(item.dueAt)}</time>
              </button>
            ))}
          </div>
        </section>

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">用量</p>
              <h2>AI 额度</h2>
            </div>
            <button className="icon-button compact" title="用量详情">
              <MoreHorizontal size={18} />
            </button>
          </div>

          <div className="usage-meter">
            <div className="usage-fill" />
          </div>
          <div className="usage-copy">
            <span>剩余 128</span>
            <span>Pro 内测</span>
          </div>
        </section>
      </aside>

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
