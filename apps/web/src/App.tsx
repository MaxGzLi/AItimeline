import {
  buildBacklinkIndex,
  buildCardConnections,
  buildConceptDigest,
  buildKnowledgeBoundary,
  buildKnowledgeGraph,
  buildLinkedKnowledgeGraph,
  demoCards,
  demoProfile,
  demoSignals,
  evaluateInteraction,
  rankKnowledgeCards,
  resolveConcept,
  slugConcept as slugCanonicalConcept,
  transformMockYouTubeUrl,
  type Backlink,
  type CardConnection,
  type ConceptAliasRecord,
  type ConceptDigest,
  type ConceptMergeSuggestion,
  type InteractionSignal,
  type KnowledgeCard,
  type KnowledgeChunk,
  type LearningFeedback,
  type RankedKnowledgeCard,
  type ReviewItem,
  type SourceAsset,
  type SourceImport,
  type TopicState
} from "@aitimeline/core";
import {
  ArrowLeft,
  ArrowUp,
  Bell,
  Bot,
  Brain,
  CheckCircle2,
  Compass,
  GitBranch,
  Home,
  Pause,
  PenLine,
  Play,
  Settings,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AgentReplyThread,
  type AgentReplyAction,
  type DiscoveryRunState
} from "./components/AgentReplyThread";
import { AskComposer } from "./components/AskComposer";
import { ConceptDigestPanel } from "./components/ConceptDigestPanel";
import { ContextRail } from "./components/ContextRail";
import { PostDetailView } from "./components/PostDetailView";
import { PostView } from "./components/PostView";
import { buildWikilinkAutocompleteCandidates } from "./components/WikilinkAutocomplete";
import { DiscoverView } from "./views/DiscoverView";
import { AgentView } from "./views/AgentView";
import { GraphView } from "./views/GraphView";
import { NotificationsView } from "./views/NotificationsView";
import { ReviewView } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";
import { apiBaseUrl, apiRequest, isYouTubeUrl, sampleSourceUrl } from "./lib/api";
import { buildGroundedAnswer, formatAskAnswer, getTopicId, scrollMotion, slugConcept } from "./lib/format";
import { normalizeLanguage, setI18nLanguage, t, type Language } from "./lib/i18n";
import { buildCardNeighborhoodGraph } from "./lib/localGraph";
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
  AgentConfirmApiResponse,
  AgentNotification,
  AgentTurnStatus,
  AgentTurnSummary,
  AiMessage,
  AiThreads,
  ApiCurationJobsResponse,
  ApiCurationRunResponse,
  ApiConceptBriefResponse,
  ApiDismissedPostsResponse,
  ApiEvidenceResponse,
  ApiImportResponse,
  ApiNotificationsResponse,
  ApiReviewDueResponse,
  ApiSettings,
  ApiSnapshot,
  ApiStatus,
  ApiTimelineResponse,
  AskApiResult,
  ConceptBrief,
  DailyAutoJobBudgetRecord,
  DismissedPostSummary,
  EvidenceLedger,
  InteractionSignals,
  LearningFeedbackByPost,
  MemoryAction,
  NoteApiResponse,
  ReviewDueItem,
  SourceCandidateRecord,
  TimelineCard
} from "./lib/types";

type ViewKey = "timeline" | "discover" | "graph" | "review" | "notifications" | "agent" | "settings";

const languageStorageKey = "aitl-language";
const autoScoutStorageKey = "aitl-auto-scout";

const navItems: Array<{ key: ViewKey; labelKey: string; icon: typeof Home }> = [
  { key: "timeline", labelKey: "nav.timeline", icon: Home },
  { key: "discover", labelKey: "nav.discover", icon: Compass },
  { key: "graph", labelKey: "nav.graph", icon: GitBranch },
  { key: "review", labelKey: "nav.review", icon: Brain },
  { key: "notifications", labelKey: "nav.notifications", icon: Bell },
  { key: "agent", labelKey: "nav.agent", icon: Bot },
  { key: "settings", labelKey: "nav.settings", icon: Settings }
];

const viewTitleKeys: Record<ViewKey, { title: string; sub?: string }> = {
  timeline: { title: "nav.timeline" },
  discover: { title: "nav.discover", sub: "nav.discoverSub" },
  graph: { title: "nav.graph", sub: "nav.graphSub" },
  review: { title: "nav.review", sub: "nav.reviewSub" },
  notifications: { title: "nav.notifications", sub: "nav.notificationsSub" },
  agent: { title: "nav.agent", sub: "nav.agentSub" },
  settings: { title: "nav.settings" }
};

export function App() {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored =
      typeof window !== "undefined" ? normalizeLanguage(window.localStorage.getItem(languageStorageKey)) : undefined;
    const initialLanguage = stored ?? "zh";
    setI18nLanguage(initialLanguage);
    return initialLanguage;
  });
  const [sourceUrl, setSourceUrl] = useState(sampleSourceUrl);
  const [candidateUrl, setCandidateUrl] = useState(`${apiBaseUrl}/fixtures/article-background`);
  const [candidateConcept, setCandidateConcept] = useState(demoProfile.interests[0] ?? "AI Agent");
  const [sourceImports, setSourceImports] = useState<SourceImport[]>([]);
  const [importedCards, setImportedCards] = useState<KnowledgeCard[]>([]);
  // Newly synced cards stay buffered until the user inserts them into the feed.
  const [pendingCards, setPendingCards] = useState<KnowledgeCard[]>([]);
  // Server due-review data is the single review source for the feed and rail.
  const [reviewDueItems, setReviewDueItems] = useState<ReviewDueItem[]>([]);
  const [sourceAssets, setSourceAssets] = useState<SourceAsset[]>([]);
  const [sourceChunks, setSourceChunks] = useState<KnowledgeChunk[]>([]);
  const [sourceCandidates, setSourceCandidates] = useState<SourceCandidateRecord[]>([]);
  const [conceptAliases, setConceptAliases] = useState<ConceptAliasRecord[]>([]);
  const [conceptMergeSuggestions, setConceptMergeSuggestions] = useState<ConceptMergeSuggestion[]>([]);
  const [conceptBriefs, setConceptBriefs] = useState<ConceptBrief[]>([]);
  const [conceptBriefQueuedByKey, setConceptBriefQueuedByKey] = useState<Record<string, boolean>>({});
  const [dismissedPosts, setDismissedPosts] = useState<DismissedPostSummary[]>([]);
  const [agentTurns, setAgentTurns] = useState<AgentTurnSummary[]>([]);
  const [notifications, setNotifications] = useState<AgentNotification[]>([]);
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null);
  const [dismissToast, setDismissToast] = useState<{ postId: string; title: string } | null>(null);
  const [aiThreads, setAiThreads] = useState<AiThreads>({});
  const [agentQuestion, setAgentQuestion] = useState("");
  const [composerMode, setComposerMode] = useState<"question" | "idea">("question");
  const [pendingThreadId, setPendingThreadId] = useState<string | null>(null);
  const [agentResponse, setAgentResponse] = useState<AgentAskApiResponse | null>(null);
  const [discoveryRun, setDiscoveryRun] = useState<DiscoveryRunState>({ status: "idle" });
  const [agentMessage, setAgentMessage] = useState("");
  const [isAgentAsking, setIsAgentAsking] = useState(false);
  const [interactionSignals, setInteractionSignals] = useState<InteractionSignals>({});
  const [learningFeedback, setLearningFeedback] = useState<LearningFeedbackByPost>({});
  const [evidenceLedgers, setEvidenceLedgers] = useState<Record<string, EvidenceLedger | null>>({});
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [apiMessage, setApiMessage] = useState(() => t("api.connecting"));
  const [curationMessage, setCurationMessage] = useState(() => t("curation.default"));
  // Remembered across reloads: background production burns model credits, so a
  // pause must survive until the user explicitly resumes.
  const [autoScoutEnabled, setAutoScoutEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(autoScoutStorageKey) !== "0";
    } catch {
      return true;
    }
  });
  const [lastScoutAt, setLastScoutAt] = useState<string | null>(null);
  const [queuedJobCount, setQueuedJobCount] = useState(0);
  const [autoJobBudget, setAutoJobBudget] = useState<DailyAutoJobBudgetRecord | null>(null);
  const [agentTurnCount, setAgentTurnCount] = useState(0);
  const [memoryMessage, setMemoryMessage] = useState(() => t("memory.default"));
  const [candidateMessage, setCandidateMessage] = useState(() => t("candidate.message.default"));
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
  const settingsReady = useRef(false);
  const lastSyncedLanguage = useRef<Language | null>(null);
  // Buffered refreshes compare against the current list through a ref.
  const importedCardsRef = useRef<KnowledgeCard[]>([]);
  // Peak queue depth for the active production batch.
  const productionPeakRef = useRef(0);
  // Mirror of interactionSignals so stable callbacks (e.g. handleDwell) can read
  // the latest signals without stale closures and without impure state updaters.
  const interactionSignalsRef = useRef<InteractionSignals>({});
  const composerInputRef = useRef<HTMLInputElement | null>(null);
  const detailReturnScrollY = useRef(0);
  // Best-effort impression reporting, capped to one event per card per session.
  const impressionReportedIds = useRef<Set<string>>(new Set());
  const impressionQueue = useRef<Map<string, KnowledgeCard>>(new Map());
  // Locally hidden cards remain hidden while async buffered refreshes finish.
  const locallyRemovedIdsRef = useRef<Set<string>>(new Set());
  const [locallyRemovedIds, setLocallyRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const dismissToastTimer = useRef<number | null>(null);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setI18nLanguage(nextLanguage);
    setLanguageState(nextLanguage);
  }, []);

  useEffect(() => {
    setI18nLanguage(language);
    try {
      window.localStorage.setItem(languageStorageKey, language);
    } catch {
      // ignore unavailable storage
    }
  }, [language]);

  useEffect(() => {
    try {
      window.localStorage.setItem(autoScoutStorageKey, autoScoutEnabled ? "1" : "0");
    } catch {
      // ignore unavailable storage
    }
  }, [autoScoutEnabled]);

  useEffect(() => {
    let cancelled = false;

    void apiRequest<ApiSettings>("/api/settings")
      .then((settings) => {
        if (cancelled) {
          return;
        }

        const nextLanguage = normalizeLanguage(settings.contentLanguage) ?? "zh";
        lastSyncedLanguage.current = nextLanguage;
        setLanguage(nextLanguage);
      })
      .catch(() => {
        // Keep the local preference when the API is unavailable.
      })
      .finally(() => {
        if (!cancelled) {
          settingsReady.current = true;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setLanguage]);

  useEffect(() => {
    if (!settingsReady.current || apiStatus !== "connected" || lastSyncedLanguage.current === language) {
      return;
    }

    const nextLanguage = language;

    void apiRequest<ApiSettings>("/api/settings", {
      method: "POST",
      body: { contentLanguage: nextLanguage }
    })
      .then((settings) => {
        const syncedLanguage = normalizeLanguage(settings.contentLanguage) ?? nextLanguage;
        lastSyncedLanguage.current = syncedLanguage;

        if (syncedLanguage !== nextLanguage) {
          setLanguage(syncedLanguage);
        }
      })
      .catch(() => {
        // The local preference remains active and will retry after reconnection.
      });
  }, [apiStatus, language, setLanguage]);

  useEffect(() => {
    interactionSignalsRef.current = interactionSignals;
  }, [interactionSignals]);

  useEffect(() => {
    return () => {
      if (dismissToastTimer.current !== null) {
        window.clearTimeout(dismissToastTimer.current);
      }
    };
  }, []);

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
  const rankedCards = useMemo(() => {
    const cards = rankedImportedCards.length > 0 ? rankedImportedCards : demoRankedCards;
    // Locally removed or reviewed cards leave the feed immediately.
    return locallyRemovedIds.size === 0 ? cards : cards.filter((card) => !locallyRemovedIds.has(card.id));
  }, [demoRankedCards, locallyRemovedIds, rankedImportedCards]);
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
  const wikilinkCandidates = useMemo(() => buildWikilinkAutocompleteCandidates(allCards), [allCards]);
  const connectionsByCard = useMemo(() => {
    const byCard: Record<string, CardConnection[]> = {};

    for (const card of allCards) {
      byCard[card.id] = buildCardConnections(card, allCards, { conceptAliases });
    }

    return byCard;
  }, [allCards, conceptAliases]);
  const conceptDigest = useMemo<ConceptDigest | null>(
    () => (conceptView ? buildConceptDigest(conceptView, allCards, { conceptAliases }) : null),
    [conceptView, allCards, conceptAliases]
  );
  const selectedConceptBrief = useMemo(
    () => {
      const concept = conceptDigest?.concept ?? conceptView;

      if (!concept) {
        return null;
      }

      return findConceptBrief(conceptBriefs, concept) ?? null;
    },
    [conceptBriefs, conceptDigest?.concept, conceptView]
  );
  const selectedConceptBriefQueued =
    conceptView !== null
      ? conceptBriefQueuedByKey[slugConcept(conceptDigest?.concept ?? conceptView)] ?? false
      : false;
  const cardsById = useMemo(() => {
    const byId: Record<string, RankedKnowledgeCard> = {};

    for (const card of allCards) {
      byId[card.id] = card;
    }

    return byId;
  }, [allCards]);
  // Review cards can be in the pending buffer, so merge them into the lookup.
  const reviewCardsById = useMemo(() => {
    if (pendingCards.length === 0) {
      return cardsById;
    }

    const byId = { ...cardsById };

    for (const card of ensureRankedCards(pendingCards)) {
      if (!byId[card.id]) {
        byId[card.id] = card;
      }
    }

    return byId;
  }, [cardsById, pendingCards]);
  const cardCountByConcept = useMemo(() => {
    const byConcept: Record<string, number> = {};

    for (const card of allCards) {
      if (card.kind === "connection_note") {
        continue;
      }

      for (const concept of card.concepts) {
        const canonical = resolveConcept(concept, conceptAliases);
        byConcept[canonical] = (byConcept[canonical] ?? 0) + 1;
      }
    }

    return byConcept;
  }, [allCards, conceptAliases]);
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
      if (selectedCardId) {
        switch (event.key) {
          case "Escape":
            event.preventDefault();
            if (shortcutsOpen) {
              setShortcutsOpen(false);
            } else {
              handleCloseDetail();
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
          default:
            break;
        }
        return;
      }
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
  }, [visibleCount, focusedIndex, visibleCards, selectedCardId, shortcutsOpen]);

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
  const graph = useMemo(
    () => buildKnowledgeGraph(allCards, allSignals, { conceptAliases }),
    [allCards, allSignals, conceptAliases]
  );
  const linkedGraph = useMemo(
    () => buildLinkedKnowledgeGraph({ cards: allCards, signals: allSignals, conceptAliases }),
    [allCards, allSignals, conceptAliases]
  );
  // Wikilink backlinks, keyed by concept slug and card id (see buildBacklinkIndex).
  const backlinkIndex = useMemo(() => buildBacklinkIndex(allCards, { conceptAliases }), [allCards, conceptAliases]);
  // One-hop patch of the linked graph around the open post, for the rail.
  const selectedLocalGraph = useMemo(
    () => (selectedCardId ? buildCardNeighborhoodGraph(linkedGraph, selectedCardId) : null),
    [linkedGraph, selectedCardId]
  );
  // The due-review queue comes directly from the server schedule.
  const reviewQueue = useMemo<ReviewItem[]>(
    () =>
      reviewDueItems.map((item) => ({
        cardId: item.postId,
        concept: resolveConcept(reviewCardsById[item.postId]?.concepts[0] ?? item.postId, conceptAliases),
        dueAt: item.dueAt,
        intervalDays: item.intervalDays,
        strength: 0
      })),
    [conceptAliases, reviewDueItems, reviewCardsById]
  );
  const boundary = useMemo(
    () => buildKnowledgeBoundary({ cards: allCards, signals: allSignals, conceptAliases }),
    [allCards, allSignals, conceptAliases]
  );
  const selectedThread = selectedCard ? aiThreads[selectedCard.id] ?? [] : [];
  const selectedFeedback = selectedCard ? learningFeedback[selectedCard.id] : undefined;
  const selectedSignal = selectedCard ? interactionSignals[selectedCard.id] : undefined;
  const selectedEvidenceLedger = selectedCard ? evidenceLedgers[selectedCard.id] : undefined;
  // Backlinks that point at the open card's id or any of its concepts, minus
  // links authored on the card itself.
  const selectedBacklinks = useMemo<Backlink[]>(() => {
    if (!selectedCard) {
      return [];
    }

    const seen = new Set<string>();
    const results: Backlink[] = [];
    const collect = (key: string) => {
      for (const backlink of backlinkIndex.get(key) ?? []) {
        if (backlink.fromPostId === selectedCard.id) {
          continue;
        }
        const signature = `${backlink.fromPostId}::${backlink.snippet}`;
        if (seen.has(signature)) {
          continue;
        }
        seen.add(signature);
        results.push(backlink);
      }
    };

    collect(selectedCard.id);
    for (const concept of selectedCard.concepts) {
      collect(slugCanonicalConcept(resolveConcept(concept, conceptAliases)));
    }

    return results;
  }, [backlinkIndex, conceptAliases, selectedCard]);
  const conceptBacklinks = useMemo<Backlink[]>(
    () => (conceptView ? backlinkIndex.get(slugCanonicalConcept(resolveConcept(conceptView, conceptAliases))) ?? [] : []),
    [backlinkIndex, conceptAliases, conceptView]
  );
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
          setApiMessage(t("api.signalSyncFailed"));
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
    if (!conceptDigest || conceptDigest.cardCount === 0 || apiStatus !== "connected") {
      return;
    }

    let isStale = false;
    const concept = conceptDigest.concept;
    const conceptKey = slugConcept(concept);

    void apiRequest<ApiConceptBriefResponse>(`/api/concepts/${encodeURIComponent(concept)}/brief`, {
      method: "POST",
      body: { now: new Date().toISOString() }
    })
      .then((result) => {
        if (isStale) {
          return;
        }

        setConceptBriefs((briefs) => upsertConceptBriefs(briefs, [result.brief]));
        setConceptBriefQueuedByKey((queued) => ({
          ...queued,
          [conceptKey]: result.queued
        }));
      })
      .catch(() => {
        if (isStale) {
          return;
        }

        setConceptBriefQueuedByKey((queued) => ({
          ...queued,
          [conceptKey]: false
        }));
      });

    return () => {
      isStale = true;
    };
    // Depend on the concept identity and card count, not the digest object:
    // the digest re-memos on every timeline poll and would re-POST /brief each time.
  }, [apiStatus, conceptDigest?.concept, conceptDigest?.cardCount]);

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

  // Keep visible tabs aligned with server-side timeline removals.
  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    const refreshIfVisible = () => {
      if (document.hidden) {
        return;
      }

      void refreshFromApi({ silent: true, mode: "buffer" });
    };
    const interval = window.setInterval(refreshIfVisible, 60000);

    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [hasHydrated]);

  const handleDwell = useCallback((card: KnowledgeCard, dwellTimeMs: number) => {
    recordInteraction(card, { dwellTimeMs, skippedQuickly: false });
  }, []);

  // PostView queues impressions after a visible dwell; the throttled sender flushes them.
  const handleImpression = useCallback((card: KnowledgeCard) => {
    if (impressionReportedIds.current.has(card.id) || impressionQueue.current.has(card.id)) {
      return;
    }

    impressionQueue.current.set(card.id, card);
  }, []);

  // Impression signals use a lightweight endpoint path without refreshing the feed.
  const flushImpressions = useCallback(() => {
    if (impressionQueue.current.size === 0) {
      return;
    }

    const pending = Array.from(impressionQueue.current.values());
    impressionQueue.current.clear();

    for (const card of pending) {
      // Impression analytics are best-effort and capped to one send per card.
      impressionReportedIds.current.add(card.id);
      void apiRequest<unknown>("/api/signals", {
        method: "POST",
        keepalive: true,
        body: {
          generatedAt: new Date().toISOString(),
          signal: createInteractionSignal(card),
          sourceCandidates: []
        }
      }).catch(() => {
        // Drop failed analytics sends without affecting reading.
      });
    }
  }, []);

  // Flush impressions periodically and when the page is hidden.
  useEffect(() => {
    const interval = window.setInterval(flushImpressions, 5000);
    const handleVisibilityChange = () => {
      if (document.hidden) {
        flushImpressions();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushImpressions();
    };
  }, [flushImpressions]);

  useEffect(() => {
    importedCardsRef.current = importedCards;
  }, [importedCards]);

  async function refreshFromApi(options: { silent?: boolean; mode?: "replace" | "buffer" } = {}) {
    const requestId = ++refreshSequence.current;

    if (!options.silent) {
      setApiStatus("checking");
      setApiMessage(t("api.refreshing"));
    }

    const now = new Date().toISOString();

    try {
      const [timeline, snapshot, queuedJobs, reviewDue, dismissed, notificationsResult] = await Promise.all([
        apiRequest<ApiTimelineResponse>(
          `/api/timeline?userId=local-user&now=${encodeURIComponent(now)}`
        ),
        apiRequest<ApiSnapshot>("/api/snapshot"),
        apiRequest<ApiCurationJobsResponse>("/api/curation/jobs?status=queued"),
        apiRequest<ApiReviewDueResponse>(`/api/review/due?now=${encodeURIComponent(now)}`),
        apiRequest<ApiDismissedPostsResponse>(`/api/dismissed?now=${encodeURIComponent(now)}`),
        apiRequest<ApiNotificationsResponse>("/api/notifications")
      ]);

      // A newer refresh started while this one was in flight; drop the stale result.
      if (requestId !== refreshSequence.current) {
        return;
      }

      const registryAssets = snapshot.sourceRegistries.flatMap((record) => record.registry.assets);
      const registryChunks = snapshot.sourceRegistries.flatMap((record) => record.registry.chunks);

      // Buffered refreshes update known cards in place and hold new cards for insertion.
      const displayed = importedCardsRef.current;

      if (options.mode === "buffer" && displayed.length > 0) {
        const serverById = new Map(timeline.posts.map((post) => [post.id, post]));
        const displayedIds = new Set(displayed.map((card) => card.id));

        setImportedCards(
          displayed.flatMap((card) => {
            const fresh = serverById.get(card.id);
            return fresh ? [fresh] : [];
          })
        );
        setPendingCards(
          timeline.posts.filter(
            (post) => !displayedIds.has(post.id) && !locallyRemovedIdsRef.current.has(post.id)
          )
        );
      } else {
        setImportedCards(timeline.posts);
        setPendingCards([]);
      }

      setSourceImports(timeline.sourceImports);
      setSourceAssets(upsertById([], registryAssets));
      setSourceChunks(upsertById([], registryChunks));
      setSourceCandidates(snapshot.sourceCandidates);
      setConceptAliases(snapshot.conceptAliases ?? []);
      setConceptMergeSuggestions(snapshot.conceptMergeSuggestions ?? []);
      setConceptBriefs(snapshot.conceptBriefs ?? []);
      setDismissedPosts(dismissed.records);
      setAgentTurns(snapshot.agentTurns);
      setNotifications(notificationsResult.records);
      setReviewDueItems(reviewDue.due);
      setAutoJobBudget(snapshot.autoJobBudget?.find((record) => record.date === now.slice(0, 10)) ?? null);
      setQueuedJobCount(queuedJobs.jobs.length);
      productionPeakRef.current =
        queuedJobs.jobs.length === 0 ? 0 : Math.max(productionPeakRef.current, queuedJobs.jobs.length);
      setAgentTurnCount(snapshot.agentTurns.length);
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
    } catch (error) {
      if (requestId !== refreshSequence.current) {
        return;
      }

      setApiStatus("offline");
      setApiMessage(error instanceof Error ? error.message : t("api.offlineImport"));
    }
  }

  async function importSourceThroughApi(url: string): Promise<ApiImportResponse> {
    const endpoint = isYouTubeUrl(url) ? "/api/import/youtube" : "/api/import/article";
    const result = await apiRequest<ApiImportResponse>(endpoint, {
      method: "POST",
      body: {
        url,
        createdAt: new Date().toISOString(),
        recommendedBecause: t("import.webReason")
      }
    });

    setApiStatus("connected");
    setApiMessage(t("api.connected"));

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

    await refreshFromApi({ silent: true, mode: "buffer" });
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

      const actionLabel = t(`memory.action.${action}`);
      setMemoryMessage(t("memory.changed", { action: actionLabel, count: result.events.length }));
    } catch {
      setMemoryMessage(t("memory.apiUnavailable"));
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
      setImportError(t("import.error.emptyUrl"));
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      const result = await importSourceThroughApi(trimmedUrl);

      applyImportResult(result);
      await refreshFromApi({ silent: true });

      if (result.posts?.[0]) {
        showDetail(result.posts[0].id);
        recordInteraction(result.posts[0], { openedThread: true, dwellTimeMs: 9000 });
      }
    } catch (error) {
      if (isYouTubeUrl(trimmedUrl)) {
        const result = transformMockYouTubeUrl(trimmedUrl, new Date().toISOString(), language);

        applyImportResult({
          importRecord: result.importRecord,
          assets: [result.asset],
          chunks: result.chunks,
          posts: result.cards
        });
        if (result.cards[0]) {
          showDetail(result.cards[0].id);
        }
        setApiStatus("offline");
        setApiMessage(t("import.localFallback"));
      } else {
        setImportError(error instanceof Error ? error.message : t("import.error.failed"));
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
      setCandidateMessage(t("candidate.missing"));
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
          reason: t("candidate.reason.web", { concept: trimmedConcept }),
          discoveredAt: new Date().toISOString()
        }
      });

      setSourceCandidates((records) => upsertById(records, [result.record]));
      setCandidateMessage(t("candidate.added", { title: result.record.candidate.source.title }));
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
    } catch (error) {
      setApiStatus("offline");
      setCandidateMessage(error instanceof Error ? error.message : t("candidate.unable"));
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
    setCurationMessage(trigger === "auto" ? t("curation.autoRunning") : t("curation.manualRunning"));

    try {
      const result = await apiRequest<ApiCurationRunResponse>("/api/curation/run", {
        method: "POST",
        body: {
          now: new Date().toISOString(),
          limit: trigger === "auto" ? 4 : 8,
          kinds: [
            "import_source",
            "discover_sources",
            "research_question",
            "research_idea",
            "generate_followup",
            "concept_brief",
            "schedule_review",
            "cooldown_topic"
          ]
        }
      });
      const importedCount = result.records.filter((record) => record.result?.sourceImport).length;
      const checkedAt = new Date().toISOString();

      setApiStatus("connected");
      setApiMessage(t("api.connected"));
      setLastScoutAt(checkedAt);
      const scoutLabel = trigger === "auto" ? t("curation.autoLabel") : t("curation.manualLabel");
      setCurationMessage(
        result.records.length > 0
          ? t("curation.imported", { label: scoutLabel, records: result.records.length, imports: importedCount })
          : t("curation.checkedEmpty", { label: scoutLabel })
      );
      await refreshFromApi({ silent: true, mode: "buffer" });
    } catch (error) {
      setApiStatus("offline");
      setApiMessage(error instanceof Error ? error.message : t("api.unavailable"));
      setCurationMessage(t("curation.failed"));
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

  function handleAskThreadBlock(text: string) {
    setAiPrompt(text.replace(/^\[(?:超出来源|beyond source)\]\s*/i, ""));
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(".x-detail-ask input")?.focus()
    );
  }

  function showDetail(cardId: string) {
    if (!selectedCardId) {
      detailReturnScrollY.current = window.scrollY;
    }

    setActiveView("timeline");
    setSelectedCardId(cardId);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }

  function handleOpenCard(card: RankedKnowledgeCard) {
    showDetail(card.id);
    setFocusedIndex(-1);
    recordInteraction(card, { openedThread: true, dwellTimeMs: 9000, skippedQuickly: false });
  }

  function handleOpenCardId(cardId: string) {
    const target = rankedCards.find((card) => card.id === cardId);

    if (target) {
      handleOpenCard(target);
    } else {
      showDetail(cardId);
    }
  }

  function handleCloseDetail() {
    const returnY = detailReturnScrollY.current;

    setSelectedCardId(null);
    requestAnimationFrame(() => window.scrollTo({ top: returnY, behavior: "auto" }));
  }

  function handleOpenConcept(concept: string) {
    setConceptView(concept);
  }

  async function resolveConceptSuggestion(suggestion: ConceptMergeSuggestion, decision: "merge" | "separate") {
    const result = await apiRequest<{
      suggestion: ConceptMergeSuggestion;
      conceptAliases?: ConceptAliasRecord[];
    }>(`/api/concept-merge-suggestions/${encodeURIComponent(suggestion.id)}/resolve`, {
      method: "POST",
      body: {
        decision,
        canonical: suggestion.left
      }
    });

    setConceptMergeSuggestions((suggestions) =>
      suggestions.map((item) => (item.id === suggestion.id ? result.suggestion : item))
    );

    if (result.conceptAliases) {
      setConceptAliases(result.conceptAliases);
    }

    await refreshFromApi({ silent: true, mode: "buffer" });
  }

  async function unmergeConceptAlias(canonical: string, alias: string) {
    const result = await apiRequest<{ conceptAliases: ConceptAliasRecord[] }>("/api/concept-aliases/unmerge", {
      method: "POST",
      body: { canonical, alias }
    });

    setConceptAliases(result.conceptAliases);
    await refreshFromApi({ silent: true, mode: "buffer" });
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

  // Hide locally right away so in-flight refreshes cannot reinsert the card.
  function markLocallyRemoved(postId: string) {
    locallyRemovedIdsRef.current.add(postId);
    setLocallyRemovedIds(new Set(locallyRemovedIdsRef.current));
  }

  function unmarkLocallyRemoved(postId: string) {
    locallyRemovedIdsRef.current.delete(postId);
    setLocallyRemovedIds(new Set(locallyRemovedIdsRef.current));
  }

  function showDismissToast(card: RankedKnowledgeCard) {
    if (dismissToastTimer.current !== null) {
      window.clearTimeout(dismissToastTimer.current);
    }

    setDismissToast({ postId: card.id, title: card.title });
    dismissToastTimer.current = window.setTimeout(() => {
      setDismissToast((current) => (current?.postId === card.id ? null : current));
      dismissToastTimer.current = null;
    }, 8000);
  }

  async function refreshDismissedPosts() {
    const now = new Date().toISOString();
    const dismissed = await apiRequest<ApiDismissedPostsResponse>(`/api/dismissed?now=${encodeURIComponent(now)}`);

    setDismissedPosts(dismissed.records);
  }

  async function restoreDismissedPost(postId: string) {
    if (dismissToastTimer.current !== null) {
      window.clearTimeout(dismissToastTimer.current);
      dismissToastTimer.current = null;
    }

    setDismissToast((current) => (current?.postId === postId ? null : current));
    unmarkLocallyRemoved(postId);

    try {
      await apiRequest(`/api/posts/${encodeURIComponent(postId)}/dismiss`, { method: "DELETE" });
      setDismissedPosts((records) => records.filter((record) => record.postId !== postId));
      await refreshFromApi({ silent: true });
    } catch {
      await refreshDismissedPosts().catch(() => {
        // Keep the local restore if the API is unavailable.
      });
    }
  }

  async function hardDismissPost(postId: string) {
    try {
      await apiRequest(`/api/posts/${encodeURIComponent(postId)}/dismiss`, {
        method: "POST",
        body: { mode: "hard" }
      });
      await refreshDismissedPosts();
      markLocallyRemoved(postId);
    } catch {
      await refreshDismissedPosts().catch(() => {
        // Leave the current list unchanged on repeated API failure.
      });
    }
  }

  function handleSkip(card: RankedKnowledgeCard) {
    // Keep the same-topic downrank signal.
    recordInteraction(card, { skippedQuickly: true, dwellTimeMs: 800, openedThread: false });
    // Persist dismissal; refreshed timelines filter dismissed posts.
    markLocallyRemoved(card.id);
    showDismissToast(card);
    void apiRequest<{ record?: DismissedPostSummary }>(`/api/posts/${encodeURIComponent(card.id)}/dismiss`, {
      method: "POST"
    })
      .then(() => refreshDismissedPosts())
      .catch(() => {
        // Best-effort persistence does not block local removal.
      });
  }

  // Completing a review advances the server interval and hides the card until due.
  async function completeReview(card: KnowledgeCard) {
    try {
      await apiRequest(`/api/review/${encodeURIComponent(card.id)}/complete`, {
        method: "POST",
        body: { reviewedAt: new Date().toISOString() }
      });
    } catch {
      // Best effort; the next refresh reconciles with the server.
    }

    await refreshFromApi({ silent: true, mode: "buffer" });
  }

  function handleReviewComplete(card: RankedKnowledgeCard) {
    // Remove immediately, then advance the server review interval quietly.
    markLocallyRemoved(card.id);
    void completeReview(card);
  }

  function handleShowPendingCards() {
    setImportedCards((cards) => {
      const pendingIds = new Set(pendingCards.map((card) => card.id));
      return [...pendingCards, ...cards.filter((card) => !pendingIds.has(card.id))];
    });
    setPendingCards([]);
    window.scrollTo({ top: 0, behavior: scrollMotion() });
  }

  // Post a public comment on a card: the API appends the user comment plus the
  // observer's grounded reply to the card's thread, and we replace the card so
  // the inline thread updates in place.
  async function handleReply(card: RankedKnowledgeCard, text: string) {
    const result = await apiRequest<{ post: KnowledgeCard }>(
      `/api/posts/${encodeURIComponent(card.id)}/replies`,
      {
        method: "POST",
        body: { text }
      }
    );

    setImportedCards((cards) =>
      cards.some((existing) => existing.id === result.post.id)
        ? cards.map((existing) => (existing.id === result.post.id ? result.post : existing))
        : cards
    );
    recordInteraction(card, { askedQuestion: true, openedThread: true, dwellTimeMs: 12000 });
    void refreshFromApi({ silent: true, mode: "buffer" });
  }

  async function handleDiscoverSources(action: AgentReplyAction) {
    if (discoveryRun.status === "searching") {
      return;
    }

    setDiscoveryRun({ status: "searching" });

    try {
      const result = await apiRequest<{ configured: boolean; candidates: Array<{ id: string }> }>(
        "/api/discovery/run",
        { method: "POST", body: { queries: action.queries ?? [], concepts: action.concepts } }
      );

      if (!result.configured) {
        setDiscoveryRun({ status: "unconfigured" });
        return;
      }

      if (result.candidates.length === 0) {
        setDiscoveryRun({ status: "empty", count: pendingDiscoverCount });
        return;
      }

      setDiscoveryRun({ status: "found", count: result.candidates.length });
      void refreshFromApi({ silent: true, mode: "buffer" });
    } catch (error) {
      setDiscoveryRun({
        status: "error",
        message: error instanceof Error ? error.message : t("agent.discovery.error")
      });
    }
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
      if (composerMode === "idea") {
        const result = await apiRequest<NoteApiResponse>("/api/notes", {
          method: "POST",
          body: { text: question, kind: "idea" }
        });

        setAgentResponse(result);
        setImportedCards((cards) => upsertById(cards, [result.post]));
      } else {
        const result = await apiRequest<AgentAskApiResponse>("/api/agent/ask", {
          method: "POST",
          body: { question, threadId: pendingThreadId ?? undefined }
        });

        setAgentResponse(result);
      }

      setDiscoveryRun({ status: "idle" });
      setPendingThreadId(null);
      void refreshFromApi({ silent: true });
    } catch (error) {
      setAgentMessage(
        error instanceof Error ? error.message : t("ask.error")
      );
    } finally {
      setIsAgentAsking(false);
    }
  }

  function handleIdeaProbe(action: AgentReplyAction) {
    const threadId = agentResponse?.turnRecord.threadId;

    if (!threadId) {
      return;
    }

    setComposerMode("question");
    setPendingThreadId(threadId);
    setAgentMessage(t("agent.idea.probeHint", { question: action.question ?? action.label }));
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

  async function handleResearchIdea(action: AgentReplyAction) {
    if (!agentResponse?.turnRecord?.id || agentResponse.turnRecord.status === "researching") {
      return;
    }

    const question = action.question ?? action.queries?.[0];

    if (!question) {
      return;
    }

    setDiscoveryRun({ status: "searching" });

    try {
      const result = await apiRequest<AgentConfirmApiResponse>("/api/agent/research-idea", {
        method: "POST",
        body: {
          turnId: agentResponse.turnRecord.id,
          question,
          concepts: action.concepts
        }
      });

      setAgentResponse((current) =>
        current
          ? {
              ...current,
              turnRecord: result.turnRecord
            }
          : current
      );
      setQueuedJobCount((count) => Math.max(count, result.records.length));
      void runCuration("auto");
      void refreshFromApi({ silent: true, mode: "buffer" });
    } catch (error) {
      setDiscoveryRun({
        status: "error",
        message: error instanceof Error ? error.message : t("agent.discovery.error")
      });
    }
  }

  async function handleConfirmDiscovery(action: AgentReplyAction, choices: Record<string, string>) {
    if (!agentResponse?.turnRecord?.id || agentResponse.turnRecord.status === "researching") {
      return;
    }

    try {
      const result = await apiRequest<AgentConfirmApiResponse>("/api/agent/confirm", {
        method: "POST",
        body: {
          turnId: agentResponse.turnRecord.id,
          choices
        }
      });

      setAgentResponse((current) =>
        current
          ? {
              ...current,
              turnRecord: result.turnRecord
            }
          : current
      );
      setQueuedJobCount((count) => Math.max(count, result.records.length));
      void runCuration("auto");
      void refreshFromApi({ silent: true, mode: "buffer" });
    } catch (error) {
      setDiscoveryRun({
        status: "error",
        message: error instanceof Error ? error.message : t("agent.discovery.error")
      });
    }
  }

  async function handleSelectNotification(notification: AgentNotification) {
    setSelectedNotificationId(notification.id);

    if (notification.readAt) {
      return;
    }

    setNotifications((records) =>
      records.map((record) =>
        record.id === notification.id ? { ...record, readAt: new Date().toISOString() } : record
      )
    );

    try {
      await apiRequest(`/api/notifications/${encodeURIComponent(notification.id)}/read`, {
        method: "POST"
      });
      void refreshFromApi({ silent: true, mode: "buffer" });
    } catch {
      setNotifications((records) =>
        records.map((record) =>
          record.id === notification.id ? { ...record, readAt: notification.readAt } : record
        )
      );
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

  const activeTitleKeys = viewTitleKeys[activeView];
  const activeTitle = {
    title: t(activeTitleKeys.title),
    sub: activeTitleKeys.sub ? t(activeTitleKeys.sub) : undefined
  };
  const pendingDiscoverCount = sourceCandidates.filter(
    (record) => record.status === "pending" || record.status === "queued"
  ).length;
  const unreadNotificationCount = notifications.filter((notification) => !notification.readAt).length;
  const activeDismissedPostIds = new Set(
    dismissedPosts.filter((record) => record.isActive).map((record) => record.postId)
  );
  const agentTurnStatusRank = {
    pending_confirmation: 0,
    researching: 1,
    answered: 2,
    closed: 2
  } as const;
  const rankAgentTurnStatus = (status: AgentTurnStatus | undefined) =>
    status ? agentTurnStatusRank[status] : -1;
  const polledAgentTurnStatus = agentResponse?.turnRecord
    ? agentTurns.find((turn) => turn.id === agentResponse.turnRecord.id)?.status
    : undefined;
  const localAgentTurnStatus = agentResponse?.turnRecord?.status;
  const currentAgentTurnStatus =
    rankAgentTurnStatus(polledAgentTurnStatus) >= rankAgentTurnStatus(localAgentTurnStatus)
      ? polledAgentTurnStatus
      : localAgentTurnStatus;

  return (
    <div className="x-frame">
      <nav className="x-navrail" aria-label={t("nav.main")}>
        <button
          className="x-logo"
          onClick={() => {
            setActiveView("timeline");
            setSelectedCardId(null);
          }}
          title="AITimeline"
          type="button"
        >
          AI
        </button>
        {navItems.map((item) => {
          const label = t(item.labelKey);
          const showDot =
            (item.key === "discover" && pendingDiscoverCount > 0) ||
            (item.key === "review" && reviewQueue.length > 0) ||
            (item.key === "notifications" && unreadNotificationCount > 0);

          return (
            <button
              aria-current={activeView === item.key ? "page" : undefined}
              aria-label={label}
              className={`x-navbtn${activeView === item.key ? " active" : ""}`}
              key={item.key}
              onClick={() => {
                setActiveView(item.key);
                if (item.key !== "timeline") {
                  setSelectedCardId(null);
                }
              }}
              title={label}
              type="button"
            >
              <span className="x-navicon">
                <item.icon size={26} strokeWidth={activeView === item.key ? 2.4 : 1.9} />
                {showDot ? <span className="x-navdot" /> : null}
              </span>
              <span className="x-navlabel">{label}</span>
            </button>
          );
        })}
        <button
          aria-label={t("nav.composeTitle")}
          className="x-compose"
          onClick={() => {
            setActiveView("timeline");
            setSelectedCardId(null);
            requestAnimationFrame(() => composerInputRef.current?.focus());
          }}
          title={t("nav.composeTitle")}
          type="button"
        >
          <PenLine size={22} />
          <span className="x-navlabel">{t("nav.compose")}</span>
        </button>
      </nav>

      <main className="x-main">
        <header className="x-colhead">
          {selectedCard ? (
            <div className="x-detail-head">
              <button aria-label={t("post.back")} className="x-detail-back" onClick={handleCloseDetail} type="button">
                <ArrowLeft size={21} />
              </button>
              <div>
                <h1>{t("post.detailTitle")}</h1>
                <p className="x-colsub">{selectedCard.title}</p>
              </div>
            </div>
          ) : activeView === "timeline" ? null : (
            <div className="x-coltitle">
              <div>
                <h1>{activeTitle.title}</h1>
                {activeTitle.sub ? <p className="x-colsub">{activeTitle.sub}</p> : null}
              </div>
            </div>
          )}
          {activeView === "timeline" && !selectedCard ? (
            <div className="x-tabs" role="tablist" aria-label={t("feed.views")}>
              {(
                [
                  ["foryou", t("feed.tab.foryou")],
                  ["latest", t("feed.tab.latest")],
                  ["saved", t("feed.tab.saved")]
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
          <button
            className={`x-scout-toggle${autoScoutEnabled ? "" : " paused"}`}
            onClick={() => setAutoScoutEnabled((value) => !value)}
            title={t("scout.toggleTitle")}
            type="button"
          >
            {autoScoutEnabled ? <Pause size={14} /> : <Play size={14} />}
            <span>{autoScoutEnabled ? t("scout.on") : t("scout.off")}</span>
            {queuedJobCount > 0 ? <em>{t("scout.queued", { count: queuedJobCount })}</em> : null}
            <em>{t("scout.budget", { used: autoJobBudget?.used ?? 0, limit: autoJobBudget?.limit ?? 20 })}</em>
          </button>
        </header>

        {activeView === "timeline" && selectedCard ? (
          <PostDetailView
            asset={selectedAsset}
            backlinks={selectedBacklinks}
            card={selectedCard}
            cards={allCards}
            chunks={selectedChunks}
            connections={connectionsByCard[selectedCard.id] ?? []}
            evidenceLedger={selectedEvidenceLedger}
            feedback={selectedFeedback}
            graph={linkedGraph}
            messages={selectedThread}
            onAsk={handleAskAi}
            onAskThreadBlock={handleAskThreadBlock}
            onLike={handleLike}
            onOpenCardId={handleOpenCardId}
            onOpenConcept={handleOpenConcept}
            onPromptChange={setAiPrompt}
            onReply={handleReply}
            onSave={handleSave}
            prompt={aiPrompt}
            quoteText={quoteByCard[selectedCard.id]}
            signal={selectedSignal}
            wikilinkCandidates={wikilinkCandidates}
          />
        ) : null}

        {activeView === "timeline" && !selectedCard ? (
          <>
            <AskComposer
              isAsking={isAgentAsking}
              mode={composerMode}
              onModeChange={(mode) => {
                setComposerMode(mode);
                if (mode === "idea") {
                  setPendingThreadId(null);
                }
              }}
              onQuestionChange={setAgentQuestion}
              onSubmit={handleAgentAsk}
              question={agentQuestion}
              ref={composerInputRef}
              wikilinkCandidates={wikilinkCandidates}
            />

            {agentMessage ? <p className="x-empty">{agentMessage}</p> : null}
            {agentResponse && agentAskedQuestion ? (
              <AgentReplyThread
                discovery={discoveryRun}
                onConfirm={handleConfirmDiscovery}
                onDiscover={handleDiscoverSources}
                onDismiss={() => {
                  setAgentResponse(null);
                  setAgentAskedQuestion("");
                  setPendingThreadId(null);
                  setDiscoveryRun({ status: "idle" });
                }}
                onOpenCardId={handleOpenCardId}
                onOpenDiscover={() => setActiveView("discover")}
                onProbe={handleIdeaProbe}
                onResearchIdea={handleResearchIdea}
                question={agentAskedQuestion}
                response={agentResponse}
                turnStatus={currentAgentTurnStatus}
              />
            ) : null}

            {pendingCards.length > 0 ? (
              <button className="x-newpill" onClick={handleShowPendingCards} type="button">
                {t("feed.newCards", { count: pendingCards.length })}
              </button>
            ) : queuedJobCount > 0 ? (
              <div className="x-prodchip" role="status">
                {autoScoutEnabled
                  ? t("feed.production", {
                      done: Math.max(0, productionPeakRef.current - queuedJobCount),
                      total: Math.max(productionPeakRef.current, queuedJobCount)
                    })
                  : t("feed.productionPaused", { count: queuedJobCount })}
              </div>
            ) : null}

            <section className="x-feedlist" aria-label={t("feed.label")}>
              {visibleCards.length === 0 ? (
                <p className="x-empty">
                  {searchQuery.trim()
                    ? t("feed.noMatch", { query: searchQuery.trim() })
                    : feedTab === "saved"
                      ? t("feed.savedEmpty")
                      : t("feed.empty")}
                </p>
              ) : (
                visibleCards.map((card, index) => (
                  <PostView
                    card={card}
                    cards={allCards}
                    connections={connectionsByCard[card.id] ?? []}
                    dismissedPostIds={activeDismissedPostIds}
                    graph={linkedGraph}
                    isFocused={index === focusedIndex}
                    key={card.id}
                    onDwell={handleDwell}
                    onImpression={handleImpression}
                    onLike={handleLike}
                    onOpen={handleOpenCard}
                    onOpenCardId={handleOpenCardId}
                    onOpenConcept={handleOpenConcept}
                    onReply={handleReply}
                    onRestorePost={restoreDismissedPost}
                    onReviewComplete={handleReviewComplete}
                    onSave={handleSave}
                    onSkip={handleSkip}
                    quoteText={quoteByCard[card.id]}
                    reviewDueAt={(card as TimelineCard).reviewDueAt}
                    signal={interactionSignals[card.id]}
                    wikilinkCandidates={wikilinkCandidates}
                  />
                ))
              )}
              {visibleCards.length > 0 ? (
                <p className="x-empty" role="status">
                  <CheckCircle2 aria-hidden="true" size={16} style={{ verticalAlign: "-3px", marginRight: 6 }} />
                  {t("feed.end")}
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
            records={sourceCandidates.filter((record) => record.status !== "rejected_source")}
          />
        ) : null}

        {activeView === "graph" ? (
          <GraphView
            boundary={boundary}
            cards={allCards}
            cardCountByConcept={cardCountByConcept}
            conceptAliases={conceptAliases}
            conceptMergeSuggestions={conceptMergeSuggestions.filter((suggestion) => suggestion.status === "pending")}
            linkedGraph={linkedGraph}
            onOpenCardId={handleOpenCardId}
            onOpenConcept={handleOpenConcept}
            onResolveConceptSuggestion={resolveConceptSuggestion}
          />
        ) : null}

        {activeView === "review" ? (
          <ReviewView
            cardsById={reviewCardsById}
            onReviewed={handleReviewComplete}
            queue={reviewQueue}
          />
        ) : null}

        {activeView === "notifications" ? (
          <NotificationsView
            notifications={notifications}
            onOpenCardId={(cardId) => {
              handleOpenCardId(cardId);
              setActiveView("timeline");
            }}
            onSelect={(notification) => {
              void handleSelectNotification(notification);
            }}
            selectedId={selectedNotificationId}
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
            agentTurnCount={agentTurnCount}
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
            dismissedPosts={dismissedPosts}
            language={language}
            onHardDismiss={(postId) => {
              void hardDismissPost(postId);
            }}
            onLanguageChange={setLanguage}
            onRestoreDismissed={(postId) => {
              void restoreDismissedPost(postId);
            }}
            onShowShortcuts={() => setShortcutsOpen(true)}
            onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
            theme={theme}
          />
        ) : null}
      </main>

      {activeView === "timeline" ? (
        <ContextRail
          boundary={boundary}
          detailCard={selectedCard}
          detailGraph={selectedLocalGraph}
          graph={graph}
          onOpenCardId={handleOpenCardId}
          onOpenConcept={handleOpenConcept}
          onOpenGraph={() => setActiveView("graph")}
          onOpenReview={() => setActiveView("review")}
          onSearchChange={setSearchQuery}
          reviewQueue={reviewQueue}
          searchQuery={searchQuery}
        />
      ) : null}

      {conceptDigest && conceptDigest.cardCount > 0 ? (
        <ConceptDigestPanel
          conceptAliases={conceptAliases}
          backlinks={conceptBacklinks}
          brief={selectedConceptBrief}
          briefQueued={selectedConceptBriefQueued}
          digest={conceptDigest}
          onClose={() => setConceptView(null)}
          onUnmergeAlias={unmergeConceptAlias}
          onOpenCardId={handleOpenCardFromConcept}
        />
      ) : null}

      {shortcutsOpen ? (
        <div
          aria-label={t("shortcuts.title")}
          aria-modal="true"
          className="x-overlay"
          onClick={() => setShortcutsOpen(false)}
          role="dialog"
        >
          <div className="x-modal" onClick={(event) => event.stopPropagation()}>
            <div className="x-shortcuts-head">
              <h2>{t("shortcuts.title")}</h2>
              <button
                aria-label={t("shortcuts.close")}
                className="x-iconbtn"
                onClick={() => setShortcutsOpen(false)}
                type="button"
              >
                <XCircle size={18} />
              </button>
            </div>
            <ul className="x-shortcuts-list">
              <li>
                <kbd>j</kbd>
                <span>{t("shortcuts.next")}</span>
              </li>
              <li>
                <kbd>k</kbd>
                <span>{t("shortcuts.previous")}</span>
              </li>
              <li>
                <kbd>g</kbd>
                <span>{t("shortcuts.top")}</span>
              </li>
              <li>
                <kbd>Enter</kbd>
                <span>{t("shortcuts.detail")}</span>
              </li>
              <li>
                <kbd>l</kbd>
                <span>{t("shortcuts.like")}</span>
              </li>
              <li>
                <kbd>s</kbd>
                <span>{t("shortcuts.save")}</span>
              </li>
              <li>
                <kbd>/</kbd>
                <span>{t("shortcuts.search")}</span>
              </li>
              <li>
                <kbd>t</kbd>
                <span>{t("shortcuts.theme")}</span>
              </li>
              <li>
                <kbd>?</kbd>
                <span>{t("shortcuts.menu")}</span>
              </li>
              <li>
                <kbd>Esc</kbd>
                <span>{t("shortcuts.clear")}</span>
              </li>
            </ul>
          </div>
        </div>
      ) : null}

      {showScrollTop && !selectedCard ? (
        <button
          aria-label={t("shortcuts.top")}
          className="x-scrolltop"
          onClick={() => window.scrollTo({ top: 0, behavior: scrollMotion() })}
          title={t("shortcuts.top")}
          type="button"
        >
          <ArrowUp size={20} />
        </button>
      ) : null}

      {dismissToast ? (
        <div className="x-dismiss-toast" role="status">
          <span>{t("dismiss.toast")}</span>
          <button onClick={() => void restoreDismissedPost(dismissToast.postId)} type="button">
            {t("dismiss.undo")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function findConceptBrief(briefs: ConceptBrief[], concept: string): ConceptBrief | undefined {
  const key = slugConcept(concept);

  return briefs
    .filter((brief) => slugConcept(brief.concept) === key)
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];
}

function upsertConceptBriefs(briefs: ConceptBrief[], nextBriefs: ConceptBrief[]): ConceptBrief[] {
  const byConcept = new Map(briefs.map((brief) => [slugConcept(brief.concept), brief]));

  for (const brief of nextBriefs) {
    byConcept.set(slugConcept(brief.concept), brief);
  }

  return Array.from(byConcept.values());
}
