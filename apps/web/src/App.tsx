import {
  buildKnowledgeGraph,
  createReviewQueue,
  demoCards,
  demoProfile,
  demoSignals,
  evaluateInteraction,
  rankKnowledgeCards,
  transformMockYouTubeUrl,
  type BackgroundSourceCandidate,
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
  Link,
  ListChecks,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Quote,
  RefreshCw,
  Route,
  Search,
  Send,
  Settings,
  Sparkles,
  Video,
  XCircle
} from "lucide-react";

const apiBaseUrl = (import.meta.env.VITE_AITIMELINE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const sampleSourceUrl = `${apiBaseUrl}/fixtures/article`;
const storageKey = "aitimeline.mvp.v3";
const syncedSignalsStorageKey = "aitimeline.synced-signals.v1";

const navItems = [
  { label: "Timeline", icon: Home, active: true },
  { label: "Explore", icon: Compass },
  { label: "Graph", icon: GitBranch },
  { label: "Review", icon: Brain },
  { label: "Agents", icon: Bot },
  { label: "Settings", icon: Settings }
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
  const [candidateConcept, setCandidateConcept] = useState(demoProfile.interests[0] ?? "AI Agent");
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
  const [apiMessage, setApiMessage] = useState("Connecting to local API");
  const [curationMessage, setCurationMessage] = useState("No worker run yet");
  const [autoScoutEnabled, setAutoScoutEnabled] = useState(true);
  const [lastScoutAt, setLastScoutAt] = useState<string | null>(null);
  const [queuedJobCount, setQueuedJobCount] = useState(0);
  const [memoryMessage, setMemoryMessage] = useState("No memory edits yet");
  const [candidateMessage, setCandidateMessage] = useState("No queued source candidates yet");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [feedTab, setFeedTab] = useState<"foryou" | "latest">("foryou");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
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
        case "?":
          event.preventDefault();
          setShortcutsOpen((open) => !open);
          break;
        case "Escape":
          setShortcutsOpen(false);
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
    nodes[focusedIndex]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedIndex]);
  useEffect(() => {
    setFocusedIndex((index) => (index >= visibleCount ? visibleCount - 1 : index));
  }, [visibleCount]);

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
          setApiMessage("Signal sync failed; local feedback is still available");
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
      setApiMessage("Refreshing local API state");
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
      setApiMessage("Connected to local API");
    } catch (error) {
      setApiStatus("offline");
      setApiMessage(error instanceof Error ? error.message : "Start npm run dev:api to use source imports");
    }
  }

  async function importSourceThroughApi(url: string): Promise<ApiImportResponse> {
    const endpoint = isYouTubeUrl(url) ? "/api/import/youtube" : "/api/import/article";
    const result = await apiRequest<ApiImportResponse>(endpoint, {
      method: "POST",
      body: {
        url,
        createdAt: new Date().toISOString(),
        recommendedBecause: "You imported this source from the Web timeline."
      }
    });

    setApiStatus("connected");
    setApiMessage("Connected to local API");

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

      setMemoryMessage(`${result.events.length} memory edits from ${action}`);
    } catch {
      setMemoryMessage("Memory API unavailable; kept local feedback");
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
      setImportError("Paste an article or YouTube URL first.");
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
        setApiMessage("API unavailable; showing mock YouTube import locally");
      } else {
        setImportError(error instanceof Error ? error.message : "Import failed.");
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
      setCandidateMessage("Add a URL and topic before queuing a candidate");
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
          reason: `Queued from the Web timeline for ${trimmedConcept}.`,
          discoveredAt: new Date().toISOString()
        }
      });

      setSourceCandidates((records) => upsertById(records, [result.record]));
      setCandidateMessage(`Queued ${result.record.candidate.source.title}`);
      setApiStatus("connected");
      setApiMessage("Connected to local API");
    } catch (error) {
      setApiStatus("offline");
      setCandidateMessage(error instanceof Error ? error.message : "Could not queue source candidate");
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
    setCurationMessage(trigger === "auto" ? "Auto scout running due jobs" : "Running due jobs");

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
      setApiMessage("Connected to local API");
      setLastScoutAt(checkedAt);
      setCurationMessage(
        result.records.length > 0
          ? `${trigger === "auto" ? "Auto scout" : "Scout"} processed ${result.records.length} jobs · ${importedCount} source imports`
          : `${trigger === "auto" ? "Auto scout" : "Scout"} checked · no due jobs`
      );
      await refreshFromApi({ silent: true });
    } catch (error) {
      setApiStatus("offline");
      setApiMessage(error instanceof Error ? error.message : "API unavailable");
      setCurationMessage("Worker could not run");
    } finally {
      curationRunInFlight.current = false;
      setIsRunningCuration(false);
    }
  }

  function handleRunCuration() {
    void runCuration("manual");
  }

  function handleAskAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedCard || !aiPrompt.trim()) {
      return;
    }

    const now = new Date().toISOString();
    const userMessage: AiMessage = {
      id: `${selectedCard.id}-user-${now}`,
      role: "user",
      content: aiPrompt.trim(),
      createdAt: now
    };
    const assistantMessage: AiMessage = {
      id: `${selectedCard.id}-assistant-${now}`,
      role: "assistant",
      content: buildGroundedAnswer(selectedCard, selectedChunks, aiPrompt.trim()),
      createdAt: now
    };

    setAiThreads((threads) => ({
      ...threads,
      [selectedCard.id]: [...(threads[selectedCard.id] ?? []), userMessage, assistantMessage]
    }));
    recordInteraction(selectedCard, { askedQuestion: true, openedThread: true, dwellTimeMs: 12000 });
    void syncMemoryForCard(selectedCard, "ask", aiPrompt.trim());
    setAiPrompt("");
  }

  function handleOpenCard(card: RankedKnowledgeCard) {
    setSelectedCardId(card.id);
    recordInteraction(card, { openedThread: true, dwellTimeMs: 9000, skippedQuickly: false });
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
      <aside className="left-rail" aria-label="Primary">
        <div className="brand-mark">
          <div className="brand-icon">AI</div>
          <span>AITimeline</span>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <button className={`nav-item ${item.active ? "active" : ""}`} key={item.label}>
              <item.icon size={20} strokeWidth={1.9} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <section className="agent-brief">
          <div className="section-label">Active Agent</div>
          <h2>AI Knowledge Scout</h2>
          <p>{curationMessage}</p>
          <button className="primary-action" disabled={isRunningCuration} onClick={handleRunCuration} type="button">
            {isRunningCuration ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
            <span>{isRunningCuration ? "Running" : "Run Scout"}</span>
          </button>
        </section>
      </aside>

      <main className="timeline-column">
        <header className="timeline-header">
          {searchOpen ? (
            <div className="header-search">
              <Search size={18} />
              <input
                aria-label="Search the timeline"
                autoFocus
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search your timeline"
                value={searchQuery}
              />
              {searchQuery ? (
                <button
                  aria-label="Clear search"
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
              <p className="section-label">Today</p>
              <h1>Knowledge Timeline</h1>
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
              title="Search"
              type="button"
            >
              <Search size={19} />
            </button>
            <button className="icon-button" title="Notifications" type="button">
              <Bell size={19} />
            </button>
          </div>
        </header>

        <div className="feed-tabs" role="tablist" aria-label="Feed view">
          <button
            aria-selected={feedTab === "foryou"}
            className={`feed-tab${feedTab === "foryou" ? " active" : ""}`}
            onClick={() => setFeedTab("foryou")}
            role="tab"
            type="button"
          >
            For you
          </button>
          <button
            aria-selected={feedTab === "latest"}
            className={`feed-tab${feedTab === "latest" ? " active" : ""}`}
            onClick={() => setFeedTab("latest")}
            role="tab"
            type="button"
          >
            Latest
          </button>
        </div>

        <div className="topic-strip" aria-label="Topics">
          <button
            aria-pressed={activeTopic === null}
            className={`topic-pill${activeTopic === null ? " active" : ""}`}
            onClick={() => setActiveTopic(null)}
            type="button"
          >
            All
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

        <section className="feed-list" aria-label="Knowledge cards">
          {visibleCards.length === 0 && (searchQuery.trim() || activeTopic) ? (
            <p className="feed-empty">
              {searchQuery.trim()
                ? `No posts match “${searchQuery.trim()}”.`
                : `No posts in “${activeTopic}”.`}
            </p>
          ) : (
            visibleCards.map((card, index) => (
              <KnowledgeCardView
                card={card}
                feedback={learningFeedback[card.id]}
                isFocused={index === focusedIndex}
                key={card.id}
                onDwell={handleDwell}
                onLike={handleLike}
                onOpen={handleOpenCard}
                onSave={handleSave}
                onSkip={handleSkip}
                signal={interactionSignals[card.id]}
              />
            ))
          )}
        </section>
      </main>

      <aside className="right-rail" aria-label="Context">
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
              <p className="section-label">Sources</p>
              <h2>Imports</h2>
            </div>
            <button className="icon-button compact" title="Source imports">
              <FileText size={18} />
            </button>
          </div>

          <div className="import-list">
            {sourceImports.length > 0 ? (
              sourceImports.map((sourceImport) => <ImportRow item={sourceImport} key={sourceImport.id} />)
            ) : (
              <div className="empty-state">No imports yet</div>
            )}
          </div>
        </section>

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">Graph</p>
              <h2>Saved Concepts</h2>
            </div>
            <button className="icon-button compact" title="Open graph">
              <GitBranch size={18} />
            </button>
          </div>

          <div className="graph-list">
            {graph.nodes.slice(0, 6).map((node) => (
              <div className="graph-row" key={node.id}>
                <span>{node.label}</span>
                <strong>{node.weight}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">Memory</p>
              <h2>User Signals</h2>
            </div>
            <button className="icon-button compact" title="Memory">
              <Brain size={18} />
            </button>
          </div>

          <div className="memory-status">{memoryMessage}</div>
        </section>

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">Review</p>
              <h2>Due Soon</h2>
            </div>
            <button className="icon-button compact" title="Review queue">
              <Brain size={18} />
            </button>
          </div>

          <div className="review-list">
            {reviewQueue.slice(0, 4).map((item) => (
              <div className="review-row" key={`${item.cardId}-${item.concept}`}>
                <span>{item.concept}</span>
                <time>{formatDueDate(item.dueAt)}</time>
              </div>
            ))}
          </div>
        </section>

        <section className="context-section">
          <div className="rail-heading">
            <div>
              <p className="section-label">Usage</p>
              <h2>AI Credits</h2>
            </div>
            <button className="icon-button compact" title="Usage details">
              <MoreHorizontal size={18} />
            </button>
          </div>

          <div className="usage-meter">
            <div className="usage-fill" />
          </div>
          <div className="usage-copy">
            <span>128 left</span>
            <span>Pro beta</span>
          </div>
        </section>
      </aside>

      {selectedCard ? (
        <SourceDetailDrawer
          asset={selectedAsset}
          card={selectedCard}
          chunks={selectedChunks}
          evidenceLedger={selectedEvidenceLedger}
          feedback={selectedFeedback}
          messages={selectedThread}
          onAsk={handleAskAi}
          onClose={() => setSelectedCardId(null)}
          onPromptChange={setAiPrompt}
          prompt={aiPrompt}
          signal={selectedSignal}
        />
      ) : null}

      {shortcutsOpen ? (
        <div
          aria-label="Keyboard shortcuts"
          aria-modal="true"
          className="shortcuts-overlay"
          onClick={() => setShortcutsOpen(false)}
          role="dialog"
        >
          <div className="shortcuts-modal" onClick={(event) => event.stopPropagation()}>
            <div className="shortcuts-head">
              <h2>Keyboard shortcuts</h2>
              <button
                aria-label="Close shortcuts"
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
                <span>Next post</span>
              </li>
              <li>
                <kbd>k</kbd>
                <span>Previous post</span>
              </li>
              <li>
                <kbd>Enter</kbd>
                <span>Open thread</span>
              </li>
              <li>
                <kbd>/</kbd>
                <span>Search</span>
              </li>
              <li>
                <kbd>?</kbd>
                <span>Toggle this menu</span>
              </li>
              <li>
                <kbd>Esc</kbd>
                <span>Close / clear</span>
              </li>
            </ul>
          </div>
        </div>
      ) : null}

      {showScrollTop && !selectedCard ? (
        <button
          aria-label="Scroll to top"
          className="scroll-top-button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          title="Back to top"
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
          <p className="section-label">Source Queue</p>
          <h2>Candidates</h2>
        </div>
        <button className="icon-button compact" title="Candidate sources">
          <Link size={18} />
        </button>
      </div>

      <form className="candidate-form" onSubmit={onSubmit}>
        <label className="candidate-input">
          <Link size={16} />
          <input
            aria-label="Candidate source URL"
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="Source URL"
            value={candidateUrl}
          />
        </label>
        <label className="candidate-input">
          <Sparkles size={16} />
          <input
            aria-label="Candidate topic"
            onChange={(event) => onConceptChange(event.target.value)}
            placeholder="Topic"
            value={candidateConcept}
          />
        </label>
        <button className="primary-action candidate-submit" disabled={isSaving} type="submit">
          {isSaving ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
          <span>{isSaving ? "Queuing" : "Queue"}</span>
        </button>
      </form>

      <div className="candidate-message">{message}</div>

      <label className="auto-scout-toggle">
        <input
          checked={autoScoutEnabled}
          onChange={(event) => onAutoScoutChange(event.target.checked)}
          type="checkbox"
        />
        <span>Auto scout</span>
        <strong>{hasQueuedScoutWork ? `${queuedJobCount} queued jobs` : "Idle"}</strong>
      </label>

      <button className="secondary-action candidate-worker" disabled={isRunningCuration} onClick={onRunCuration} type="button">
        {isRunningCuration ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
        <span>{isRunningCuration ? "Running" : "Run Scout"}</span>
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
                  {formatCandidateStatus(record.status)} · {record.candidate.conceptIds.slice(0, 2).join(", ") || "general"}
                </small>
              </div>
              <strong>{Math.round(record.candidate.relevanceScore * 100)}</strong>
            </div>
          ))
        ) : (
          <div className="empty-state">No candidates yet</div>
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
          <p className="section-label">Source Agent</p>
          <h2>URL Import</h2>
        </div>
        <div className={`source-kind ${apiStatus}`}>
          {apiStatus === "connected" ? <CheckCircle2 size={17} /> : <Video size={17} />}
          <span>{apiStatus === "connected" ? "API" : apiStatus === "checking" ? "Checking" : "Offline"}</span>
        </div>
      </div>

      <form className="source-form" onSubmit={onSubmit}>
        <label className="source-input-shell">
          <Link size={18} />
          <input
            aria-label="Source URL"
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="Paste article or YouTube URL"
            value={url}
          />
        </label>
        <button className="primary-action source-submit" disabled={isImporting} type="submit">
          {isImporting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
          <span>{isImporting ? "Importing" : "Import"}</span>
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
            {latestImport ? formatStatus(latestImport.status) : "Ready"} · {cardCount} generated posts · {apiMessage}
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
  feedback,
  isFocused,
  onDwell,
  onLike,
  onOpen,
  onSave,
  onSkip,
  signal
}: {
  card: RankedKnowledgeCard;
  feedback?: LearningFeedback;
  isFocused?: boolean;
  onDwell: (card: RankedKnowledgeCard, dwellTimeMs: number) => void;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpen: (card: RankedKnowledgeCard) => void;
  onSave: (card: RankedKnowledgeCard) => void;
  onSkip: (card: RankedKnowledgeCard) => void;
  signal?: InteractionSignal;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const visibleSince = useRef<number | null>(null);
  const reportedDwellMs = useRef(0);
  const threadPreview = getTimelineThreadPreview(card);
  const [threadExpanded, setThreadExpanded] = useState(false);
  const fullThread = card.thread ?? [];
  const visibleThread = threadExpanded ? fullThread : threadPreview;
  const canExpandThread = fullThread.length > threadPreview.length;
  const readBlock = getReadBlock(card);
  const learnPrompts = card.reviewPrompts?.slice(0, 2) ?? [];
  const exploreEdges = card.graphEdges?.slice(0, 2) ?? [];
  const primaryConcept = card.concepts[0] ?? "Knowledge";
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
            <span>{card.estimatedReadMinutes}m read</span>
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
              Agent take
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
              <span>{threadExpanded ? "Show less" : `Show this thread · ${fullThread.length} replies`}</span>
            </button>
          ) : (
            <button className="thread-count-button" onClick={() => onOpen(card)} type="button">
              <MessageCircle size={16} />
              <span>
                Open thread · {fullThread.length} replies · {card.reviewPrompts?.length ?? 0} checks ready
              </span>
            </button>
          )}
        </div>

        {learnPrompts.length > 0 || exploreEdges.length > 0 ? (
          <div className="feed-prompt-row">
            {learnPrompts[0] ? (
              <button className="feed-prompt" onClick={() => onSave(card)} type="button">
                <Brain size={16} />
                <span>Review</span>
                <strong>{learnPrompts[0].prompt}</strong>
              </button>
            ) : null}
            {exploreEdges[0] ? (
              <button className="feed-prompt" onClick={() => onOpen(card)} type="button">
                <Route size={16} />
                <span>Related</span>
                <strong>
                  {exploreEdges[0].sourceConcept} → {exploreEdges[0].targetConcept}
                </strong>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="post-social-context">
          <span>For you: {card.recommendedBecause}</span>
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
          <div className="recommendation-reasons" aria-label="Recommendation reasons">
            {card.scoreReasons.slice(0, 3).map((reason) => (
              <span key={reason}>{reason}</span>
            ))}
          </div>
        ) : null}

        <div className="concept-list">
          {card.concepts.slice(0, 3).map((concept) => (
            <span key={concept}>{concept}</span>
          ))}
          {card.concepts.length > 3 ? <span>+{card.concepts.length - 3}</span> : null}
        </div>

        <footer className="card-footer">
          <div className="social-metrics">
            <span>{Math.max(12, Math.round(card.score))} useful</span>
            <span>{card.thread?.length ?? 0} replies</span>
            <span>{card.reviewPrompts?.length ?? 0} checks</span>
          </div>
          <div className="card-actions">
            <button className={`icon-button compact ${signal?.liked ? "selected" : ""}`} onClick={() => onLike(card)} title="Like">
              <Heart size={18} />
            </button>
            <button className={`icon-button compact ${signal?.saved ? "selected" : ""}`} onClick={() => onSave(card)} title="Save">
              <Bookmark size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="Ask AI">
              <MessageCircle size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="View source">
              <Quote size={18} />
            </button>
            <button className="icon-button compact" onClick={() => onOpen(card)} title="Explain">
              <CircleHelp size={18} />
            </button>
            <button className={`icon-button compact ${signal?.skippedQuickly ? "negative" : ""}`} onClick={() => onSkip(card)} title="Skip post">
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
  evidenceLedger,
  feedback,
  messages,
  onAsk,
  onClose,
  onPromptChange,
  prompt,
  signal
}: {
  asset?: SourceAsset;
  card: RankedKnowledgeCard;
  chunks: KnowledgeChunk[];
  evidenceLedger?: EvidenceLedger | null;
  feedback?: LearningFeedback;
  messages: AiMessage[];
  onAsk: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onPromptChange: (value: string) => void;
  prompt: string;
  signal?: InteractionSignal;
}) {
  const citation = card.citations?.[0];
  const source = card.sources[0];

  return (
    <aside className="detail-drawer" aria-label="Source detail">
      <div className="drawer-header">
        <div>
          <p className="section-label">Grounded Card</p>
          <h2>{card.title}</h2>
        </div>
        <button className="icon-button compact" onClick={onClose} title="Close">
          <XCircle size={18} />
        </button>
      </div>

      <section className="drawer-section">
        <div className="drawer-section-heading">
          <Quote size={18} />
          <h3>Citation</h3>
        </div>
        <p>{source?.title ?? "Unknown source"}</p>
        {citation?.startTimeSeconds !== undefined ? (
          <a className="timestamp-link" href={buildTimestampUrl(source?.url, citation.startTimeSeconds)}>
            {formatTimestamp(citation.startTimeSeconds)}-{formatTimestamp(citation.endTimeSeconds ?? citation.startTimeSeconds)}
          </a>
        ) : (
          <span className="muted-copy">No citation available</span>
        )}
      </section>

      <EvidenceLedgerPanel ledger={evidenceLedger} />

      <section className="drawer-section">
        <div className="drawer-section-heading">
          <Sparkles size={18} />
          <h3>Agent Takeaway</h3>
        </div>
        <p>{card.keyTakeaway}</p>
      </section>

      {card.thread?.length ? (
        <section className="drawer-section">
          <div className="drawer-section-heading">
            <MessageCircle size={18} />
            <h3>Thread</h3>
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
          <h3>Source Chunks</h3>
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
            <p className="muted-copy">{asset?.content ?? "This demo card has no imported transcript yet."}</p>
          )}
        </div>
      </section>

      {card.graphEdges?.length ? (
        <section className="drawer-section">
          <div className="drawer-section-heading">
            <Route size={18} />
            <h3>Graph Edges</h3>
          </div>
          <div className="edge-list">
            {card.graphEdges.map((edge) => (
              <div className="edge-row" key={edge.id}>
                <strong>
                  {edge.sourceConcept} → {edge.targetConcept}
                </strong>
                <span>{edge.relation}</span>
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
            <h3>Review & Next Actions</h3>
          </div>
          <div className="review-prompt-list">
            {card.reviewPrompts?.map((prompt) => (
              <div className="review-prompt-row" key={prompt.id}>
                <span>{prompt.kind} · {prompt.dueInDays}d</span>
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
          <h3>Feedback Loop</h3>
        </div>
        {feedback ? (
          <div className={`feedback-panel ${feedback.inferredState}`}>
            <div className="feedback-panel-top">
              <span>{formatLearningState(feedback.inferredState)}</span>
              <strong>{formatNextAction(feedback.nextAction)}</strong>
            </div>
            <p>{feedback.reason}</p>
            <small>Signal strength {feedback.signalStrength}</small>
          </div>
        ) : (
          <p className="muted-copy">Open, like, save, ask, or skip this post to generate feedback.</p>
        )}
        {signal ? (
          <div className="signal-chip-list">
            {formatSignalChips(signal).map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="drawer-section">
        <div className="drawer-section-heading">
          <GraduationCap size={18} />
          <h3>Ask AI</h3>
        </div>
        <div className="chat-list">
          {messages.length > 0 ? (
            messages.map((message) => (
              <div className={`chat-message ${message.role}`} key={message.id}>
                <span>{message.role === "assistant" ? "AI" : "You"}</span>
                <p>{message.content}</p>
              </div>
            ))
          ) : (
            <p className="muted-copy">Ask how this connects to your memory, graph, or review queue.</p>
          )}
        </div>

        <form className="ask-form" onSubmit={onAsk}>
          <input
            aria-label="Ask AI about this card"
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Ask about this source"
            value={prompt}
          />
          <button className="icon-button" title="Send question" type="submit">
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
        <h3>Evidence Ledger</h3>
      </div>

      {ledger === undefined ? (
        <p className="muted-copy">Checking source grounding...</p>
      ) : ledger === null ? (
        <p className="muted-copy">No evidence ledger is available for this card yet.</p>
      ) : (
        <>
          <div className="evidence-summary">
            <span className="evidence-stat passed">{ledger.summary.passed} passed</span>
            <span className="evidence-stat warning">{ledger.summary.warnings} warnings</span>
            <span className="evidence-stat failed">{ledger.summary.failed} failed</span>
          </div>
          <div className="evidence-meta">
            <span>{ledger.summary.citedSources} sources</span>
            <span>{ledger.summary.citedChunks} chunks</span>
            <span>{ledger.summary.totalClaims} claims</span>
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
                    {claim.evidence[0].sourceTitle} · {Math.round(claim.evidence[0].overlapScore * 100)}% overlap
                  </small>
                ) : (
                  <small>No source chunk resolved</small>
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
      scoreReasons: [card.recommendedBecause || "Imported source is ready for exploration"]
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

function getTimelineThreadPreview(card: KnowledgeCard): NonNullable<KnowledgeCard["thread"]> {
  return (
    card.thread
      ?.filter((block) => block.kind === "example" || block.kind === "contrast" || block.kind === "extension")
      .slice(0, 1) ?? []
  );
}

function getAgentName(concept: string): string {
  if (concept === "RAG") return "RAG Field Notes";
  if (concept === "AI Agent") return "Agent Lab";
  if (concept === "Product Strategy") return "Product Loop";
  if (concept === "NotebookLM") return "Source Grounding";
  if (concept === "Recommendation") return "Ranking Desk";

  return `${concept} Scout`;
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
    title: explainBlock?.title ?? "Core idea",
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
  return concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function formatTrustState(state: TrustState): string {
  const labels: Record<TrustState, string> = {
    emerging: "Emerging",
    supported: "Supported",
    contested: "Contested"
  };
  return labels[state];
}

function formatStatus(status: TransformationStatus): string {
  const labels: Record<TransformationStatus, string> = {
    queued: "Queued",
    extracting: "Extracting",
    transforming: "Transforming",
    ready: "Ready",
    failed: "Failed"
  };

  return labels[status];
}

function formatCandidateStatus(status: SourceCandidateStatus): string {
  const labels: Record<SourceCandidateStatus, string> = {
    pending: "Pending",
    queued: "Queued",
    imported: "Imported",
    dismissed: "Dismissed"
  };

  return labels[status];
}

function formatLearningState(state: LearningFeedback["inferredState"]): string {
  const labels: Record<LearningFeedback["inferredState"], string> = {
    interested: "Interested",
    confused: "Confused",
    fatigued: "Fatigued",
    not_relevant: "Weak signal",
    needs_review: "Needs review"
  };

  return labels[state];
}

function formatSignalChips(signal: InteractionSignal): string[] {
  const chips = ["Impression"];

  if (signal.dwellTimeMs > 0) chips.push(`${Math.round(signal.dwellTimeMs / 1000)}s dwell`);
  if (signal.openedThread) chips.push("Thread opened");
  if (signal.liked) chips.push("Liked");
  if (signal.saved) chips.push("Saved");
  if (signal.askedQuestion) chips.push("Asked");
  if (signal.reviewed) chips.push("Reviewed");
  if (signal.skippedQuickly) chips.push("Skipped");

  return chips;
}

function formatDifficulty(value: NonNullable<KnowledgeCard["difficulty"]>): string {
  const labels: Record<NonNullable<KnowledgeCard["difficulty"]>, string> = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced"
  };

  return labels[value];
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
    explain: "Explain",
    example: "Example",
    contrast: "Contrast",
    extension: "Extend",
    quiz: "Quiz"
  };

  return labels[value];
}

function formatNextAction(action: NonNullable<KnowledgeCard["nextActions"]>[number]): string {
  const labels: Record<NonNullable<KnowledgeCard["nextActions"]>[number], string> = {
    continue_deeper: "Go deeper",
    expand_broader: "Go broader",
    reframe_simpler: "Simplify",
    cooldown_topic: "Cool down",
    schedule_review: "Review",
    ask_clarifying_question: "Ask user"
  };

  return labels[action];
}

function formatGroundingStatus(status: GroundingStatus): string {
  const labels: Record<GroundingStatus, string> = {
    passed: "Passed",
    warning: "Warning",
    failed: "Failed"
  };

  return labels[status];
}

function formatEvidenceFieldPath(path: string): string {
  if (path.startsWith("$.thread")) {
    return "Thread";
  }

  if (path.startsWith("$.graphEdges")) {
    return "Graph";
  }

  return path.replace(/^\$\./, "").replace(/([A-Z])/g, " $1");
}

function formatCardSource(card: KnowledgeCard): string {
  const source = card.sources[0];
  const citation = card.citations?.[0];

  if (!source) {
    return "Unknown source";
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

function buildGroundedAnswer(card: KnowledgeCard, chunks: KnowledgeChunk[], prompt: string): string {
  const citation = card.citations?.[0];
  const source = card.sources[0];
  const groundedChunk =
    chunks.find((chunk) => chunk.id === citation?.chunkId) ?? chunks.find((chunk) => chunk.sourceId === source?.id);
  const timestamp =
    citation?.startTimeSeconds !== undefined ? ` at ${formatTimestamp(citation.startTimeSeconds)}` : "";
  const conceptLine = card.concepts.length > 0 ? `Concepts: ${card.concepts.join(", ")}.` : "";

  return [
    `Based on "${source?.title ?? "this source"}"${timestamp}, the card is saying: ${card.keyTakeaway}`,
    groundedChunk ? `Grounding: ${groundedChunk.content}` : `Grounding: ${card.summary}`,
    card.nextActions?.length ? `Harness next action: ${card.nextActions.map(formatNextAction).join(", ")}.` : "",
    `${conceptLine} Your question was: "${prompt}".`
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
        : `AITimeline API request failed with ${response.status}.`;

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
