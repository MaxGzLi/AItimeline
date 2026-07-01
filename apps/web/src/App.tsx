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
  type BackgroundSourceCandidate,
  type CardConnection,
  type ConceptDigest,
  type InteractionSignal,
  type KnowledgeCard,
  type KnowledgeChunk,
  type LearningFeedback,
  type RankedKnowledgeCard,
  type SourceAsset,
  type SourceImport,
  type SourceRegistry,
  type TopicState,
  type TransformationStatus,
  type TrustState
} from "@aitimeline/core";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  Bell,
  Bookmark,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock,
  Compass,
  FileText,
  GraduationCap,
  GitBranch,
  Heart,
  Home,
  Layers,
  Link,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Quote,
  RefreshCw,
  Route,
  Search,
  Send,
  Settings,
  Sparkles,
  Sun,
  Video,
  XCircle
} from "lucide-react";

const apiBaseUrl = (import.meta.env.VITE_AITIMELINE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const sampleSourceUrl = `${apiBaseUrl}/fixtures/article`;
const storageKey = "aitimeline.mvp.v3";
const syncedSignalsStorageKey = "aitimeline.synced-signals.v1";

// JS smooth-scroll ignores prefers-reduced-motion (unlike CSS, which we honor
// everywhere). Fall back to an instant jump when the user asked for reduced motion.
function scrollMotion(): ScrollBehavior {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

const navItems = [
  { label: "时间线", icon: Home, active: true },
  { label: "发现", icon: Compass },
  { label: "图谱", icon: GitBranch },
  { label: "复习", icon: Brain },
  { label: "智能体", icon: Bot },
  { label: "设置", icon: Settings }
];

type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type AiThreads = Record<string, AiMessage[]>;
type InteractionSignals = Record<string, InteractionSignal>;
type LearningFeedbackByPost = Record<string, LearningFeedback>;
type ApiStatus = "checking" | "connected" | "offline";
type SourceCandidateStatus = "pending" | "queued" | "imported" | "dismissed";
type GroundingStatus = "passed" | "warning" | "failed";

type EvidenceLedger = {
  postId: string;
  valid: boolean;
  generatedAt: string;
  summary: {
    totalClaims: number;
    passed: number;
    warnings: number;
    failed: number;
    citedSources: number;
    citedChunks: number;
  };
  claims: Array<{
    id: string;
    fieldPath: string;
    kind: string;
    claim: string;
    status: GroundingStatus;
    overlapScore: number;
    reason: string;
    evidence: Array<{
      sourceId: string;
      sourceTitle: string;
      chunkId: string;
      quote: string;
      startTimeSeconds?: number;
      endTimeSeconds?: number;
      overlapScore: number;
    }>;
  }>;
};

type PersistedMvpState = {
  sourceImports: SourceImport[];
  importedCards: KnowledgeCard[];
  sourceAssets: SourceAsset[];
  sourceChunks: KnowledgeChunk[];
  aiThreads: AiThreads;
  interactionSignals: InteractionSignals;
  learningFeedback: LearningFeedbackByPost;
};

type ApiImportResponse = {
  importRecord: SourceImport;
  assets?: SourceAsset[];
  chunks?: KnowledgeChunk[];
  posts?: KnowledgeCard[];
};

type ApiSnapshot = {
  sourceImports: SourceImport[];
  sourceRegistries: Array<{
    id: string;
    sourceId: string;
    registry: SourceRegistry;
    createdAt: string;
  }>;
  posts: KnowledgeCard[];
  sourceCandidates: SourceCandidateRecord[];
};

type ApiTimelineResponse = {
  posts: RankedKnowledgeCard[];
  sourceImports: SourceImport[];
  topicStates?: TopicState[];
  recommendationSummary?: {
    total: number;
    byIntent: Record<string, number>;
    topReasons: string[];
  };
};

type ApiEvidenceResponse = {
  ledger: EvidenceLedger;
};

type ApiCurationRunResponse = {
  records: Array<{
    id: string;
    status: string;
    result?: {
      sourceImport?: ApiImportResponse;
    };
  }>;
};

type ApiCurationJobsResponse = {
  jobs: Array<{
    id: string;
    status: string;
  }>;
};

type MemoryAction = "like" | "save" | "ask";

type SourceCandidateRecord = {
  id: string;
  candidate: BackgroundSourceCandidate;
  status: SourceCandidateStatus;
  intakeKind: "user_paste" | "browser_share" | "agent_discovery" | "manual";
  createdAt: string;
  updatedAt: string;
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

  function recordInteraction(card: KnowledgeCard, patch: Partial<InteractionSignal>) {
    setInteractionSignals((signals) => {
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

      setLearningFeedback((feedbackByPost) => ({
        ...feedbackByPost,
        [card.id]: feedback
      }));

      return {
        ...signals,
        [card.id]: nextSignal
      };
    });
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

function SourceCandidatePanel({
  autoScoutEnabled,
  candidateConcept,
  candidateUrl,
  curationMessage,
  hasQueuedScoutWork,
  isSaving,
  isRunningCuration,
  lastScoutAt,
  message,
  onAutoScoutChange,
  onConceptChange,
  onRunCuration,
  onSubmit,
  onUrlChange,
  queuedJobCount,
  records
}: {
  autoScoutEnabled: boolean;
  candidateConcept: string;
  candidateUrl: string;
  curationMessage: string;
  hasQueuedScoutWork: boolean;
  isSaving: boolean;
  isRunningCuration: boolean;
  lastScoutAt: string | null;
  message: string;
  onAutoScoutChange: (value: boolean) => void;
  onConceptChange: (value: string) => void;
  onRunCuration: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUrlChange: (value: string) => void;
  queuedJobCount: number;
  records: SourceCandidateRecord[];
}) {
  return (
    <section className="context-section candidate-section">
      <div className="rail-heading">
        <div>
          <p className="section-label">来源队列</p>
          <h2>候选源</h2>
        </div>
        <button className="icon-button compact" title="候选来源">
          <Link size={18} />
        </button>
      </div>

      <form className="candidate-form" onSubmit={onSubmit}>
        <label className="candidate-input">
          <Link size={16} />
          <input
            aria-label="候选来源 URL"
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="来源 URL"
            value={candidateUrl}
          />
        </label>
        <label className="candidate-input">
          <Sparkles size={16} />
          <input
            aria-label="候选话题"
            onChange={(event) => onConceptChange(event.target.value)}
            placeholder="话题"
            value={candidateConcept}
          />
        </label>
        <button className="primary-action candidate-submit" disabled={isSaving} type="submit">
          {isSaving ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
          <span>{isSaving ? "排队中" : "加入队列"}</span>
        </button>
      </form>

      <div className="candidate-message">{message}</div>

      <label className="auto-scout-toggle">
        <input
          checked={autoScoutEnabled}
          onChange={(event) => onAutoScoutChange(event.target.checked)}
          type="checkbox"
        />
        <span>自动观察员</span>
        <strong>{hasQueuedScoutWork ? `${queuedJobCount} 个排队任务` : "空闲"}</strong>
      </label>

      <button className="secondary-action candidate-worker" disabled={isRunningCuration} onClick={onRunCuration} type="button">
        {isRunningCuration ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
        <span>{isRunningCuration ? "运行中" : "运行观察员"}</span>
      </button>
      <div className="candidate-message">
        {curationMessage}
        {lastScoutAt ? ` · ${formatShortTime(lastScoutAt)}` : ""}
      </div>

      <div className="candidate-list">
        {records.length > 0 ? (
          records.slice(0, 4).map((record) => (
            <div className={`candidate-row ${record.status}`} key={record.id}>
              <div>
                <span>{record.candidate.source.title}</span>
                <small>
                  {formatCandidateStatus(record.status)} · {record.candidate.conceptIds.slice(0, 2).join("、") || "通用"}
                </small>
              </div>
              <strong>{Math.round(record.candidate.relevanceScore * 100)}</strong>
            </div>
          ))
        ) : (
          <div className="empty-state">还没有候选源</div>
        )}
      </div>
    </section>
  );
}

function SourceImportPanel({
  apiMessage,
  apiStatus,
  cardCount,
  error,
  isImporting,
  latestImport,
  onSubmit,
  onUrlChange,
  url
}: {
  apiMessage: string;
  apiStatus: ApiStatus;
  cardCount: number;
  error: string | null;
  isImporting: boolean;
  latestImport?: SourceImport;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUrlChange: (value: string) => void;
  url: string;
}) {
  return (
    <section className="source-import">
      <div className="source-import-heading">
        <div>
          <p className="section-label">来源智能体</p>
          <h2>URL 导入</h2>
        </div>
        <div className={`source-kind ${apiStatus}`}>
          {apiStatus === "connected" ? <CheckCircle2 size={17} /> : <Video size={17} />}
          <span>{apiStatus === "connected" ? "已连接" : apiStatus === "checking" ? "连接中" : "离线"}</span>
        </div>
      </div>

      <form className="source-form" onSubmit={onSubmit}>
        <label className="source-input-shell">
          <Link size={18} />
          <input
            aria-label="来源 URL"
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="粘贴文章或 YouTube 链接"
            value={url}
          />
        </label>
        <button className="primary-action source-submit" disabled={isImporting} type="submit">
          {isImporting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
          <span>{isImporting ? "导入中" : "导入"}</span>
        </button>
      </form>

      <div className="import-feedback">
        {error ? (
          <span className="import-error">
            <XCircle size={16} />
            {error}
          </span>
        ) : (
          <span>
            {latestImport ? formatStatus(latestImport.status) : "就绪"} · 生成了 {cardCount} 张卡 · {apiMessage}
          </span>
        )}
      </div>
    </section>
  );
}

function ImportRow({ item }: { item: SourceImport }) {
  return (
    <div className="import-row">
      <div>
        <span>{item.source.title}</span>
        <small>{formatStatus(item.status)}</small>
      </div>
      <StatusIcon status={item.status} />
    </div>
  );
}

function StatusIcon({ status }: { status: TransformationStatus }) {
  if (status === "ready") {
    return <CheckCircle2 className="status-ready" size={18} />;
  }

  if (status === "failed") {
    return <XCircle className="status-failed" size={18} />;
  }

  if (status === "queued") {
    return <Clock className="status-working" size={18} />;
  }

  return <LoaderCircle className="status-working spin" size={18} />;
}

function KnowledgeCardView({
  card,
  connections,
  feedback,
  isFocused,
  onDwell,
  onLike,
  onOpen,
  onOpenCardId,
  onOpenConcept,
  onSave,
  onSkip,
  signal
}: {
  card: RankedKnowledgeCard;
  connections: CardConnection[];
  feedback?: LearningFeedback;
  isFocused?: boolean;
  onDwell: (card: RankedKnowledgeCard, dwellTimeMs: number) => void;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpen: (card: RankedKnowledgeCard) => void;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onSave: (card: RankedKnowledgeCard) => void;
  onSkip: (card: RankedKnowledgeCard) => void;
  signal?: InteractionSignal;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const visibleSince = useRef<number | null>(null);
  const reportedDwellMs = useRef(0);
  const threadPreview = getTimelineThreadPreview(card);
  const [threadExpanded, setThreadExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const fullThread = card.thread ?? [];
  const visibleThread = threadExpanded ? fullThread : threadPreview;
  const canExpandThread = fullThread.length > threadPreview.length;
  const readBlock = getReadBlock(card);
  const learnPrompts = card.reviewPrompts?.slice(0, 2) ?? [];
  const topConnection = connections[0];
  const primaryConcept = card.concepts[0] ?? "知识";
  const source = card.sources[0];

  useEffect(() => {
    const node = cardRef.current;

    if (!node || !("IntersectionObserver" in window)) {
      return;
    }

    const flushDwell = () => {
      if (visibleSince.current === null) {
        return;
      }

      const dwellTimeMs = Math.round(performance.now() - visibleSince.current);
      visibleSince.current = null;

      if (dwellTimeMs >= 1200 && dwellTimeMs > reportedDwellMs.current + 800) {
        reportedDwellMs.current = dwellTimeMs;
        onDwell(card, dwellTimeMs);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= 0.6) {
          visibleSince.current ??= performance.now();
          return;
        }

        flushDwell();
      },
      { threshold: [0, 0.6, 1] }
    );
    const interval = window.setInterval(() => {
      if (visibleSince.current === null) {
        return;
      }

      const dwellTimeMs = Math.round(performance.now() - visibleSince.current);

      if (dwellTimeMs >= 9000 && dwellTimeMs > reportedDwellMs.current + 3500) {
        reportedDwellMs.current = dwellTimeMs;
        onDwell(card, dwellTimeMs);
      }
    }, 3000);

    observer.observe(node);

    return () => {
      window.clearInterval(interval);
      flushDwell();
      observer.disconnect();
    };
  }, [card, onDwell]);

  if (dismissed) {
    return (
      <article className="knowledge-card dismissed" ref={cardRef}>
        <div className="card-dismissed">
          <p>不感兴趣 —— 以后会少推这类卡片。</p>
          <button className="card-dismissed-undo" onClick={() => setDismissed(false)} type="button">
            撤销
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className={`knowledge-card${isFocused ? " focused" : ""}`} ref={cardRef}>
      <div className="post-avatar" aria-hidden="true">
        {getAgentInitials(primaryConcept)}
      </div>

      <div className="post-main">
        <div className="social-post-header">
          <div className="post-author-line">
            <strong>{getAgentName(primaryConcept)}</strong>
            <span>@{slugConcept(primaryConcept)}</span>
            <span title={formatFullTimestamp(card.createdAt)}>{formatRelativeTime(card.createdAt)}</span>
            <span>阅读 {card.estimatedReadMinutes} 分钟</span>
          </div>
          <div className="post-header-badges">
            <span className={`trust-badge ${card.trustState}`}>{formatTrustState(card.trustState)}</span>
            {card.difficulty ? <span>{formatDifficulty(card.difficulty)}</span> : null}
          </div>
        </div>

        <button className="post-open-button" onClick={() => onOpen(card)} type="button">
          <h2>{card.title}</h2>
          {card.hook ? <p className="post-hook">{card.hook}</p> : null}
          <p className="summary">{card.shortBody ?? card.summary}</p>
        </button>

        {card.thesis || readBlock.body ? (
          <button className="post-claim-card" onClick={() => onOpen(card)} type="button">
            <span>
              <Sparkles size={15} />
              智能体观点
            </span>
            <p>{card.thesis ?? readBlock.body}</p>
          </button>
        ) : null}

        <div className={`social-thread-preview${threadExpanded ? " expanded" : ""}`}>
          {visibleThread.map((block) => (
            <button className="social-thread-reply" key={block.id} onClick={() => onOpen(card)} type="button">
              <div className="reply-avatar">{formatThreadKind(block.kind).slice(0, 2)}</div>
              <div>
                <span>{formatThreadKind(block.kind)}</span>
                <strong>{block.title}</strong>
                <p>{block.body}</p>
              </div>
            </button>
          ))}
          {canExpandThread ? (
            <button
              aria-expanded={threadExpanded}
              className="thread-count-button"
              onClick={() => setThreadExpanded((value) => !value)}
              type="button"
            >
              <ChevronDown className={`thread-chevron${threadExpanded ? " open" : ""}`} size={16} />
              <span>{threadExpanded ? "收起" : `展开这条 · ${fullThread.length} 条回应`}</span>
            </button>
          ) : (
            <button className="thread-count-button" onClick={() => onOpen(card)} type="button">
              <MessageCircle size={16} />
              <span>
                展开卡片 · {fullThread.length} 条回应 · {card.reviewPrompts?.length ?? 0} 个小测
              </span>
            </button>
          )}
        </div>

        {learnPrompts.length > 0 || topConnection ? (
          <div className="feed-prompt-row">
            {learnPrompts[0] ? (
              <button className="feed-prompt" onClick={() => onSave(card)} type="button">
                <Brain size={16} />
                <span>复习</span>
                <strong>{learnPrompts[0].prompt}</strong>
              </button>
            ) : null}
            {topConnection ? (
              <button
                className="feed-prompt"
                onClick={() => onOpenCardId(topConnection.cardId)}
                title={`${formatConnectionKind(topConnection.kind)} · 通过「${topConnection.concept}」`}
                type="button"
              >
                <Route size={16} />
                <span>{formatConnectionKind(topConnection.kind)}</span>
                <strong>{topConnection.title}</strong>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="post-social-context">
          <span>为你推荐:{card.recommendedBecause}</span>
          <span>{formatCardSource(card)}</span>
          {source?.author ? <span>{source.author}</span> : null}
        </div>

        {feedback ? (
          <div className={`feedback-strip ${feedback.inferredState}`}>
            <span>{formatLearningState(feedback.inferredState)}</span>
            <strong>{formatNextAction(feedback.nextAction)}</strong>
          </div>
        ) : null}

        {card.scoreReasons.length > 0 ? (
          <div className="recommendation-reasons" aria-label="推荐理由">
            {card.scoreReasons.slice(0, 3).map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
        ) : null}

        <div className="concept-list">
          {card.concepts.slice(0, 3).map((concept) => (
            <button
              className="concept-chip"
              key={concept}
              onClick={() => onOpenConcept(concept)}
              title={`查看「${concept}」的全部碎片`}
              type="button"
            >
              {concept}
            </button>
          ))}
          {card.concepts.length > 3 ? <span>+{card.concepts.length - 3}</span> : null}
        </div>

        <footer className="card-footer">
          <div className="social-metrics">
            <span>{Math.max(12, Math.round(card.score))} 有用</span>
            <span>{card.thread?.length ?? 0} 条回应</span>
            <span>{card.reviewPrompts?.length ?? 0} 个小测</span>
          </div>
          <div className="card-actions">
            <button className={`icon-button compact ${signal?.liked ? "selected" : ""}`} onClick={() => onLike(card)} title="点赞">
              <Heart size={18} />
            </button>
            <button className={`icon-button compact ${signal?.saved ? "selected" : ""}`} onClick={() => onSave(card)} title="收藏">
              <Bookmark size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="问 AI">
              <MessageCircle size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="查看来源">
              <Quote size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="讲解">
              <CircleHelp size={18} />
            </button>
            <button
              className={`icon-button compact ${signal?.skippedQuickly ? "negative" : ""}`}
              onClick={() => {
                onSkip(card);
                setDismissed(true);
              }}
              title="不感兴趣"
            >
              <XCircle size={18} />
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}

function SourceDetailDrawer({
  asset,
  card,
  chunks,
  connections,
  evidenceLedger,
  feedback,
  messages,
  onAsk,
  onClose,
  onOpenCardId,
  onPromptChange,
  prompt,
  signal
}: {
  asset?: SourceAsset;
  card: RankedKnowledgeCard;
  chunks: KnowledgeChunk[];
  connections: CardConnection[];
  evidenceLedger?: EvidenceLedger | null;
  feedback?: LearningFeedback;
  messages: AiMessage[];
  onAsk: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onOpenCardId: (cardId: string) => void;
  onPromptChange: (value: string) => void;
  prompt: string;
  signal?: InteractionSignal;
}) {
  const citation = card.citations?.[0];
  const source = card.sources[0];
  const drawerRef = useRef<HTMLElement>(null);

  // Modal focus management: move focus into the dialog on open and return it to
  // the element that opened it on close, so keyboard/screen-reader users are taken
  // to the new content and back to their place in the feed.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    drawerRef.current?.focus();
    return () => {
      if (opener && document.contains(opener)) {
        opener.focus();
      }
    };
  }, []);

  return (
    <aside
      aria-label="来源详情"
      aria-modal="true"
      className="detail-drawer"
      ref={drawerRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="drawer-header">
        <div>
          <p className="section-label">有据可查的卡片</p>
          <h2>{card.title}</h2>
        </div>
        <button className="icon-button compact" onClick={onClose} title="关闭">
          <XCircle size={18} />
        </button>
      </div>

      <section className="drawer-section">
        <div className="drawer-section-heading">
          <Quote size={18} />
          <h3>引用出处</h3>
        </div>
        <p>{source?.title ?? "未知来源"}</p>
        {citation?.startTimeSeconds !== undefined ? (
          <a className="timestamp-link" href={buildTimestampUrl(source?.url, citation.startTimeSeconds)}>
            {formatTimestamp(citation.startTimeSeconds)}-{formatTimestamp(citation.endTimeSeconds ?? citation.startTimeSeconds)}
          </a>
        ) : (
          <span className="muted-copy">暂无引用</span>
        )}
      </section>

      <EvidenceLedgerPanel ledger={evidenceLedger} />

      <section className="drawer-section">
        <div className="drawer-section-heading">
          <Sparkles size={18} />
          <h3>智能体要点</h3>
        </div>
        <p>{card.keyTakeaway}</p>
      </section>

      {card.thread?.length ? (
        <section className="drawer-section">
          <div className="drawer-section-heading">
            <MessageCircle size={18} />
            <h3>延展</h3>
          </div>
          <div className="thread-block-list">
            {card.thread.map((block) => (
              <div className="thread-block" key={block.id}>
                <span>{formatThreadKind(block.kind)}</span>
                <h4>{block.title}</h4>
                <p>{block.body}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="drawer-section">
        <div className="drawer-section-heading">
          <FileText size={18} />
          <h3>来源片段</h3>
        </div>
        <div className="chunk-list">
          {chunks.length > 0 ? (
            chunks.map((chunk) => (
              <div className="chunk-row" key={chunk.id}>
                <span>{formatTimestamp(chunk.startTimeSeconds ?? 0)}</span>
                <p>{chunk.content}</p>
              </div>
            ))
          ) : (
            <p className="muted-copy">{asset?.content ?? "这张示例卡片还没有导入转录文本。"}</p>
          )}
        </div>
      </section>

      {card.graphEdges?.length ? (
        <section className="drawer-section">
          <div className="drawer-section-heading">
            <Route size={18} />
            <h3>图谱关系</h3>
          </div>
          <div className="edge-list">
            {card.graphEdges.map((edge) => (
              <div className="edge-row" key={edge.id}>
                <strong>
                  {edge.sourceConcept} → {edge.targetConcept}
                </strong>
                <span>{formatEdgeRelation(edge.relation)}</span>
                <p>{edge.evidence}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {card.reviewPrompts?.length || card.nextActions?.length ? (
        <section className="drawer-section">
          <div className="drawer-section-heading">
            <ListChecks size={18} />
            <h3>复习与下一步</h3>
          </div>
          <div className="review-prompt-list">
            {card.reviewPrompts?.map((prompt) => (
              <div className="review-prompt-row" key={prompt.id}>
                <span>{formatReviewPromptKind(prompt.kind)} · {prompt.dueInDays} 天后</span>
                <p>{prompt.prompt}</p>
                <small>{prompt.answerHint}</small>
              </div>
            ))}
          </div>
          {card.nextActions?.length ? (
            <div className="next-action-list">
              {card.nextActions.map((action) => (
                <span key={action}>{formatNextAction(action)}</span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="drawer-section">
        <div className="drawer-section-heading">
          <Brain size={18} />
          <h3>反馈闭环</h3>
        </div>
        {feedback ? (
          <div className={`feedback-panel ${feedback.inferredState}`}>
            <div className="feedback-panel-top">
              <span>{formatLearningState(feedback.inferredState)}</span>
              <strong>{formatNextAction(feedback.nextAction)}</strong>
            </div>
            <p>{feedback.reason}</p>
            <small>信号强度 {feedback.signalStrength}</small>
          </div>
        ) : (
          <p className="muted-copy">展开、点赞、收藏、追问或划走这张卡,都会生成反馈。</p>
        )}
        {signal ? (
          <div className="signal-chip-list">
            {formatSignalChips(signal).map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        ) : null}
      </section>

      {connections.length > 0 ? (
        <section className="drawer-section">
          <div className="drawer-section-heading">
            <GitBranch size={18} />
            <h3>关联</h3>
          </div>
          <p className="muted-copy">这张碎片和你收集过的卡片怎么连起来。</p>
          <div className="connection-list">
            {connections.map((connection) => (
              <button
                className="connection-row"
                key={`${connection.kind}-${connection.cardId}`}
                onClick={() => onOpenCardId(connection.cardId)}
                title={`打开「${connection.title}」`}
                type="button"
              >
                <span className={`connection-kind ${connection.kind}`}>{formatConnectionKind(connection.kind)}</span>
                <strong>{connection.title}</strong>
                <small>通过「{connection.concept}」</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="drawer-section">
        <div className="drawer-section-heading">
          <GraduationCap size={18} />
          <h3>问 AI</h3>
        </div>
        <div className="chat-list">
          {messages.length > 0 ? (
            messages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                <span>{message.role === "assistant" ? "AI" : "你"}</span>
                <p>{message.content}</p>
              </div>
            ))
          ) : (
            <p className="muted-copy">问问它和你的记忆、图谱或复习队列怎么连起来。</p>
          )}
        </div>

        <form className="ask-form" onSubmit={onAsk}>
          <input
            aria-label="就这张卡片问 AI"
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="就这个来源提问"
            value={prompt}
          />
          <button className="icon-button" title="发送问题" type="submit">
            <Send size={18} />
          </button>
        </form>
      </section>
    </aside>
  );
}

function EvidenceLedgerPanel({ ledger }: { ledger?: EvidenceLedger | null }) {
  return (
    <section className="drawer-section evidence-ledger-section">
      <div className="drawer-section-heading">
        <CheckCircle2 size={18} />
        <h3>证据账本</h3>
      </div>

      {ledger === undefined ? (
        <p className="muted-copy">正在核对来源依据……</p>
      ) : ledger === null ? (
        <p className="muted-copy">这张卡片暂时还没有证据账本。</p>
      ) : (
        <>
          <div className="evidence-summary">
            <span className="evidence-stat passed">{ledger.summary.passed} 通过</span>
            <span className="evidence-stat warning">{ledger.summary.warnings} 警告</span>
            <span className="evidence-stat failed">{ledger.summary.failed} 失败</span>
          </div>
          <div className="evidence-meta">
            <span>{ledger.summary.citedSources} 个来源</span>
            <span>{ledger.summary.citedChunks} 个片段</span>
            <span>{ledger.summary.totalClaims} 条主张</span>
          </div>
          <div className="evidence-claim-list">
            {ledger.claims.slice(0, 5).map((claim) => (
              <div className={`evidence-claim ${claim.status}`} key={claim.id}>
                <div className="evidence-claim-top">
                  <span>{formatEvidenceFieldPath(claim.fieldPath)}</span>
                  <strong>{formatGroundingStatus(claim.status)}</strong>
                </div>
                <p>{claim.claim}</p>
                {claim.evidence[0] ? (
                  <small>
                    {claim.evidence[0].sourceTitle} · 重叠 {Math.round(claim.evidence[0].overlapScore * 100)}%
                  </small>
                ) : (
                  <small>没有匹配到来源片段</small>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function mergeCards(newCards: KnowledgeCard[], currentCards: KnowledgeCard[]): KnowledgeCard[] {
  const newCardIds = new Set(newCards.map((card) => card.id));
  return [...newCards, ...currentCards.filter((card) => !newCardIds.has(card.id))];
}

function ensureRankedCards(cards: KnowledgeCard[]): RankedKnowledgeCard[] {
  return cards.map((card) => {
    if (isRankedKnowledgeCard(card)) {
      return card;
    }

    return {
      ...card,
      score: 0,
      scoreReasons: [card.recommendedBecause || "导入的来源已经可以开始探索"]
    };
  });
}

function isRankedKnowledgeCard(card: KnowledgeCard): card is RankedKnowledgeCard {
  const maybeRanked = card as Partial<RankedKnowledgeCard>;

  return typeof maybeRanked.score === "number" && Array.isArray(maybeRanked.scoreReasons);
}

function upsertById<T extends { id: string }>(currentItems: T[], newItems: T[]): T[] {
  const newItemIds = new Set(newItems.map((item) => item.id));
  return [...newItems, ...currentItems.filter((item) => !newItemIds.has(item.id))];
}

function upsertImport(imports: SourceImport[], nextImport: SourceImport): SourceImport[] {
  return [nextImport, ...imports.filter((item) => item.id !== nextImport.id)];
}

// Count + noun with correct singular/plural (reply→replies is irregular, so no naive "+s").
function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getTimelineThreadPreview(card: KnowledgeCard): NonNullable<KnowledgeCard["thread"]> {
  return (
    card.thread
      ?.filter((block) => block.kind === "example" || block.kind === "contrast" || block.kind === "extension")
      .slice(0, 1) ?? []
  );
}

function getAgentName(concept: string): string {
  if (concept === "RAG") return "RAG 实战笔记";
  if (concept === "智能体") return "智能体实验室";
  if (concept === "产品策略") return "产品闭环";
  if (concept === "知识图谱") return "图谱工作台";
  if (concept === "评估") return "评估台";

  return `${concept} 观察员`;
}

function getAgentInitials(concept: string): string {
  return concept
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function getReadBlock(card: KnowledgeCard): { title: string; body: string } {
  const explainBlock = card.thread?.find((block) => block.kind === "explain");

  return {
    title: explainBlock?.title ?? "核心观点",
    body: explainBlock?.body ?? card.thesis ?? card.shortBody ?? card.summary
  };
}

function createInteractionSignal(card: KnowledgeCard): InteractionSignal {
  return {
    postId: card.id,
    topicId: getTopicId(card),
    conceptIds: card.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: new Date().toISOString()
  };
}

function deriveTopicState(signal: InteractionSignal): TopicState {
  const positiveSignals = [signal.openedThread, signal.liked, signal.saved, signal.askedQuestion, signal.reviewed].filter(
    Boolean
  ).length;

  return {
    topicId: signal.topicId,
    interestScore: Math.min(1, positiveSignals / 4),
    fatigueScore: signal.skippedQuickly ? 0.85 : 0.15,
    comprehensionScore: signal.askedQuestion ? 0.35 : signal.reviewed || signal.saved ? 0.78 : 0.55
  };
}

function getTopicId(card: KnowledgeCard): string {
  return slugConcept(card.concepts[0] ?? "general");
}

function slugConcept(concept: string): string {
  // Keep Unicode letters/digits so non-ASCII concepts (e.g. Chinese) slug to a distinct key.
  return concept.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/(^-|-$)/g, "");
}

function formatTrustState(state: TrustState): string {
  const labels: Record<TrustState, string> = {
    emerging: "萌芽",
    supported: "已支撑",
    contested: "有争议"
  };
  return labels[state];
}

function formatStatus(status: TransformationStatus): string {
  const labels: Record<TransformationStatus, string> = {
    queued: "排队中",
    extracting: "抽取中",
    transforming: "转化中",
    ready: "就绪",
    failed: "失败"
  };

  return labels[status];
}

function formatCandidateStatus(status: SourceCandidateStatus): string {
  const labels: Record<SourceCandidateStatus, string> = {
    pending: "待处理",
    queued: "已排队",
    imported: "已导入",
    dismissed: "已忽略"
  };

  return labels[status];
}

function formatLearningState(state: LearningFeedback["inferredState"]): string {
  const labels: Record<LearningFeedback["inferredState"], string> = {
    interested: "感兴趣",
    confused: "有困惑",
    fatigued: "疲劳",
    not_relevant: "信号弱",
    needs_review: "待复习"
  };

  return labels[state];
}

function formatSignalChips(signal: InteractionSignal): string[] {
  const chips = ["曝光"];

  if (signal.dwellTimeMs > 0) chips.push(`停留 ${Math.round(signal.dwellTimeMs / 1000)} 秒`);
  if (signal.openedThread) chips.push("展开了卡");
  if (signal.liked) chips.push("点赞");
  if (signal.saved) chips.push("收藏");
  if (signal.askedQuestion) chips.push("追问");
  if (signal.reviewed) chips.push("已复习");
  if (signal.skippedQuickly) chips.push("划走");

  return chips;
}

function formatDifficulty(value: NonNullable<KnowledgeCard["difficulty"]>): string {
  const labels: Record<NonNullable<KnowledgeCard["difficulty"]>, string> = {
    beginner: "入门",
    intermediate: "进阶",
    advanced: "高级"
  };

  return labels[value];
}

function formatConnectionKind(kind: CardConnection["kind"]): string {
  const labels: Record<CardConnection["kind"], string> = {
    builds_on: "承接自",
    leads_to: "延伸到",
    contrast: "对比",
    related: "相关"
  };

  return labels[kind];
}

type ConceptDigestRole = ConceptDigest["entries"][number]["role"];

function formatConceptRole(role: ConceptDigestRole): string {
  const labels: Record<ConceptDigestRole, string> = {
    foundation: "基础",
    builds: "递进",
    applies: "应用",
    contrast: "对比"
  };

  return labels[role];
}

function ConceptDigestPanel({
  digest,
  onClose,
  onOpenCardId
}: {
  digest: ConceptDigest;
  onClose: () => void;
  onOpenCardId: (cardId: string) => void;
}) {
  return (
    <div
      aria-label={`关于「${digest.concept}」的全部碎片`}
      aria-modal="true"
      className="concept-overlay"
      onClick={onClose}
      role="dialog"
    >
      <div className="concept-modal" onClick={(event) => event.stopPropagation()}>
        <div className="concept-head">
          <div>
            <p className="section-label concept-eyebrow">
              <Layers size={14} aria-hidden="true" /> 概念
            </p>
            <h2>{digest.concept}</h2>
            <p className="concept-sub">{digest.cardCount} 张碎片,连成一整篇</p>
          </div>
          <button aria-label="关闭概念视图" className="icon-button compact" onClick={onClose} type="button">
            <XCircle size={18} />
          </button>
        </div>

        <ol className="concept-entry-list">
          {digest.entries.map((entry) => (
            <li key={entry.cardId}>
              <button className="concept-entry" onClick={() => onOpenCardId(entry.cardId)} type="button">
                <span className={`concept-role concept-role-${entry.role}`}>{formatConceptRole(entry.role)}</span>
                <span className="concept-entry-body">
                  <strong>{entry.title}</strong>
                  <span className="concept-entry-takeaway">{entry.keyTakeaway}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function formatConfidence(value: NonNullable<KnowledgeCard["confidence"]>): string {
  const labels: Record<NonNullable<KnowledgeCard["confidence"]>, string> = {
    low: "Low confidence",
    medium: "Medium confidence",
    high: "High confidence"
  };

  return labels[value];
}

function formatThreadKind(value: NonNullable<KnowledgeCard["thread"]>[number]["kind"]): string {
  const labels: Record<NonNullable<KnowledgeCard["thread"]>[number]["kind"], string> = {
    explain: "讲解",
    example: "例子",
    contrast: "对比",
    extension: "延伸",
    quiz: "小测"
  };

  return labels[value];
}

function formatNextAction(action: NonNullable<KnowledgeCard["nextActions"]>[number]): string {
  const labels: Record<NonNullable<KnowledgeCard["nextActions"]>[number], string> = {
    continue_deeper: "深入",
    expand_broader: "拓宽",
    reframe_simpler: "简化",
    cooldown_topic: "降温",
    schedule_review: "复习",
    ask_clarifying_question: "追问澄清"
  };

  return labels[action];
}

function formatGroundingStatus(status: GroundingStatus): string {
  const labels: Record<GroundingStatus, string> = {
    passed: "通过",
    warning: "警告",
    failed: "失败"
  };

  return labels[status];
}

function formatEdgeRelation(relation: NonNullable<KnowledgeCard["graphEdges"]>[number]["relation"]): string {
  const labels: Record<NonNullable<KnowledgeCard["graphEdges"]>[number]["relation"], string> = {
    requires: "需要",
    extends: "延伸",
    contrasts: "对比",
    applies: "应用",
    evaluates: "评估",
    summarizes: "总结"
  };

  return labels[relation];
}

function formatReviewPromptKind(kind: NonNullable<KnowledgeCard["reviewPrompts"]>[number]["kind"]): string {
  const labels: Record<NonNullable<KnowledgeCard["reviewPrompts"]>[number]["kind"], string> = {
    recall: "回忆",
    compare: "比较",
    apply: "应用",
    explain: "解释"
  };

  return labels[kind];
}

function formatEvidenceFieldPath(path: string): string {
  if (path.startsWith("$.thread")) {
    return "延展";
  }

  if (path.startsWith("$.graphEdges")) {
    return "图谱";
  }

  return path.replace(/^\$\./, "").replace(/([A-Z])/g, " $1");
}

function formatCardSource(card: KnowledgeCard): string {
  const source = card.sources[0];
  const citation = card.citations?.[0];

  if (!source) {
    return "未知来源";
  }

  if (source.type === "youtube" && citation?.startTimeSeconds !== undefined) {
    return `${source.title} · ${formatTimestamp(citation.startTimeSeconds)}`;
  }

  return source.title;
}

function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatShortTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

// 类微博的相对时间:"刚刚" / "5分钟" / "3小时" / "2天",更早的显示日期。
function formatRelativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return "";
  }

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes}分钟`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}小时`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}天`;
  }

  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" })
  }).format(date);
}

// 鼠标悬停在时间上时显示的完整时间戳(相对时间会丢失精度)。
function formatFullTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "full", timeStyle: "short" }).format(date);
}

function buildTimestampUrl(url: string | undefined, seconds: number): string {
  if (!url) {
    return "#";
  }

  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.set("t", `${Math.floor(seconds)}s`);
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

type AskCitation = {
  sourceId: string;
  sourceTitle: string;
  chunkId: string;
  quote: string;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
};

type AskApiResult = {
  answer: string;
  citations: AskCitation[];
  grounded: boolean;
  runnerKind: string;
};

function formatAskAnswer(result: AskApiResult): string {
  if (!result.citations?.length) {
    return result.answer;
  }

  const sources = Array.from(
    new Map(
      result.citations.map((citation) => [
        citation.chunkId,
        `· ${citation.sourceTitle}${
          citation.startTimeSeconds !== undefined ? ` (${formatTimestamp(citation.startTimeSeconds)})` : ""
        }`
      ])
    ).values()
  ).join("\n");

  return `${result.answer}\n\n来源:\n${sources}`;
}

function buildGroundedAnswer(card: KnowledgeCard, chunks: KnowledgeChunk[], prompt: string): string {
  const citation = card.citations?.[0];
  const source = card.sources[0];
  const groundedChunk =
    chunks.find((chunk) => chunk.id === citation?.chunkId) ?? chunks.find((chunk) => chunk.sourceId === source?.id);
  const timestamp =
    citation?.startTimeSeconds !== undefined ? `(${formatTimestamp(citation.startTimeSeconds)})` : "";
  const conceptLine = card.concepts.length > 0 ? `涉及概念:${card.concepts.join("、")}。` : "";

  return [
    `根据《${source?.title ?? "这个来源"}》${timestamp},这张卡片想说的是:${card.keyTakeaway}`,
    groundedChunk ? `依据:${groundedChunk.content}` : `依据:${card.summary}`,
    card.nextActions?.length ? `下一步建议:${card.nextActions.map(formatNextAction).join("、")}。` : "",
    `${conceptLine}你的问题是:「${prompt}」。`
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function apiRequest<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = (await response.json()) as unknown;

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `AITimeline API 请求失败,状态码 ${response.status}。`;

    throw new Error(message);
  }

  return payload as T;
}

function isYouTubeUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.hostname.includes("youtube.com") || parsedUrl.hostname.includes("youtu.be");
  } catch {
    return false;
  }
}

function shouldSyncSignal(signal: InteractionSignal): boolean {
  return (
    signal.impression &&
    (signal.dwellTimeMs > 0 ||
      signal.openedThread ||
      signal.liked ||
      signal.saved ||
      signal.askedQuestion ||
      signal.reviewed ||
      signal.skippedQuickly)
  );
}

function createSignalSignature(signal: InteractionSignal): string {
  return [
    signal.postId,
    signal.topicId,
    Math.round(signal.dwellTimeMs / 1000),
    signal.openedThread,
    signal.liked,
    signal.saved,
    signal.askedQuestion,
    signal.reviewed,
    signal.skippedQuickly
  ].join(":");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadStoredState(): PersistedMvpState | null {
  try {
    const rawState = window.localStorage.getItem(storageKey);
    return rawState ? (JSON.parse(rawState) as PersistedMvpState) : null;
  } catch {
    return null;
  }
}

function saveStoredState(state: PersistedMvpState): void {
  window.localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadSyncedSignalSignatures(): Record<string, string> {
  try {
    const rawState = window.localStorage.getItem(syncedSignalsStorageKey);
    const parsed = rawState ? (JSON.parse(rawState) as unknown) : {};

    return isStringRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveSyncedSignalSignatures(signatures: Record<string, string>): void {
  window.localStorage.setItem(syncedSignalsStorageKey, JSON.stringify(signatures));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
