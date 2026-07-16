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
  type SourceAsset,
  type SourceImport,
  type TimelineBlockTopic,
  type TopicState,
  type UserMemory,
  type WeeklyRecapRecord
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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AgentReplyThread,
  type AgentReplyAction,
  type DiscoveryRunState
} from "./components/AgentReplyThread";
import { AskComposer } from "./components/AskComposer";
import { ConceptDigestPanel } from "./components/ConceptDigestPanel";
import { ContextRail } from "./components/ContextRail";
import { DeepReadArticleView } from "./components/DeepReadArticleView";
import { PostDetailView } from "./components/PostDetailView";
import { PostView } from "./components/PostView";
import { SupplyDroughtCard, type SupplyRefillState } from "./components/SupplyDroughtCard";
import { WeeklyRecapCard } from "./components/WeeklyRecapCard";
import { buildWikilinkAutocompleteCandidates } from "./components/WikilinkAutocomplete";
import { DiscoverView } from "./views/DiscoverView";
import { AgentView } from "./views/AgentView";
import { GraphView } from "./views/GraphView";
import { NotificationsView } from "./views/NotificationsView";
import { ReviewView, type ReviewQueueEntry } from "./views/ReviewView";
import { SettingsView } from "./views/SettingsView";
import { ApiHttpError, apiBaseUrl, apiRequest, isAbortError, isTransportError, isYouTubeChannelUrl, isYouTubeUrl, sampleSourceUrl } from "./lib/api";
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
  ApiDeepReadQueueResponse,
  ApiEvidenceResponse,
  ApiGoalsResponse,
  ApiImportResponse,
  ApiNotificationsResponse,
  ApiReviewCompleteResponse,
  ApiReviewDueResponse,
  ApiSettings,
  ApiSnapshot,
  ApiStatus,
  ApiSupplyRefillResponse,
  ApiTimelineResponse,
  ApiWeeklyRecapResponse,
  ApiWeeklyRecapSeenResponse,
  AskApiResult,
  ConceptBrief,
  DailyAutoJobBudgetRecord,
  DismissedPostSummary,
  DeepReadArticleRecord,
  EvidenceLedger,
  InteractionSignals,
  LearningFeedbackByPost,
  LearningGoalWithTree,
  MemoryAction,
  NoteApiResponse,
  ReviewDueItem,
  ApiBacklogDigestResponse,
  ReviewGrade,
  SourceCandidateRecord,
  SubscriptionBacklogView,
  SupplyStatus,
  SubscriptionRecord,
  TimelineCard
} from "./lib/types";

type ViewKey = "timeline" | "discover" | "graph" | "review" | "notifications" | "agent" | "settings" | "deepread";
type TopicFilterKey = "all" | "__other__" | string;

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
  settings: { title: "nav.settings" },
  deepread: { title: "deepread.title", sub: "deepread.subtitle" }
};

const otherTopicFilterKey = "__other__";
const maxTopicFilterPillCount = 5;

type TopicFilterOption = {
  topic: TimelineBlockTopic;
  count: number;
  firstIndex: number;
};

function getTimelineCardBlockTopic(card: RankedKnowledgeCard): TimelineBlockTopic {
  const timelineCard = card as TimelineCard;

  if (timelineCard.blockTopic) {
    return timelineCard.blockTopic;
  }

  const fallbackLabel = card.concepts[0] ?? t("common.concept");

  return {
    id: getTopicId(card),
    label: fallbackLabel,
    source: "card_topic"
  };
}

function buildTopicFilterOptions(cards: RankedKnowledgeCard[]): {
  topics: TopicFilterOption[];
  otherTopicIds: Set<string>;
  hasOther: boolean;
} {
  const byTopicId = new Map<string, TopicFilterOption>();

  cards.forEach((card, index) => {
    const topic = getTimelineCardBlockTopic(card);
    const existing = byTopicId.get(topic.id);

    if (existing) {
      existing.count += 1;
      return;
    }

    byTopicId.set(topic.id, {
      topic,
      count: 1,
      firstIndex: index
    });
  });

  const sortedTopics = Array.from(byTopicId.values()).sort(
    (left, right) =>
      Number(right.topic.source === "learning_goal") - Number(left.topic.source === "learning_goal") ||
      left.firstIndex - right.firstIndex ||
      left.topic.label.localeCompare(right.topic.label)
  );
  const topicSlotsWithoutOther = maxTopicFilterPillCount - 1;
  const topicSlotsWithOther = maxTopicFilterPillCount - 2;
  const visibleTopicCount =
    sortedTopics.length > topicSlotsWithoutOther ? topicSlotsWithOther : topicSlotsWithoutOther;
  const topics = sortedTopics.slice(0, Math.max(0, visibleTopicCount));
  const otherTopicIds = new Set(sortedTopics.slice(topics.length).map((option) => option.topic.id));

  return {
    topics,
    otherTopicIds,
    hasOther: otherTopicIds.size > 0
  };
}

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
  const [subscriptionUrl, setSubscriptionUrl] = useState("");
  const [sourceImports, setSourceImports] = useState<SourceImport[]>([]);
  const [importedCards, setImportedCards] = useState<KnowledgeCard[]>([]);
  // Full knowledge library (snapshot.posts): resting or dismissed cards leave the
  // feed but must stay visible to the graph, backlinks, review and notifications.
  const [libraryPosts, setLibraryPosts] = useState<KnowledgeCard[]>([]);
  // Newly synced cards stay buffered until the user inserts them into the feed.
  const [pendingCards, setPendingCards] = useState<KnowledgeCard[]>([]);
  // Server due-review data is the single review source for the feed and rail.
  const [reviewDueItems, setReviewDueItems] = useState<ReviewDueItem[]>([]);
  const [weeklyRecap, setWeeklyRecap] = useState<WeeklyRecapRecord | null>(null);
  const [sourceAssets, setSourceAssets] = useState<SourceAsset[]>([]);
  const [sourceChunks, setSourceChunks] = useState<KnowledgeChunk[]>([]);
  const [sourceCandidates, setSourceCandidates] = useState<SourceCandidateRecord[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [supplyStatus, setSupplyStatus] = useState<SupplyStatus | null>(null);
  const [supplyRefillState, setSupplyRefillState] = useState<SupplyRefillState>({ status: "idle" });
  const [userMemory, setUserMemory] = useState<UserMemory | null>(null);
  const [conceptAliases, setConceptAliases] = useState<ConceptAliasRecord[]>([]);
  const [conceptMergeSuggestions, setConceptMergeSuggestions] = useState<ConceptMergeSuggestion[]>([]);
  const [conceptBriefs, setConceptBriefs] = useState<ConceptBrief[]>([]);
  const [conceptBriefQueuedByKey, setConceptBriefQueuedByKey] = useState<Record<string, boolean>>({});
  const [dismissedPosts, setDismissedPosts] = useState<DismissedPostSummary[]>([]);
  const [agentTurns, setAgentTurns] = useState<AgentTurnSummary[]>([]);
  const [notifications, setNotifications] = useState<AgentNotification[]>([]);
  const [learningGoals, setLearningGoals] = useState<LearningGoalWithTree[]>([]);
  const [deepReadArticles, setDeepReadArticles] = useState<DeepReadArticleRecord[]>([]);
  const [selectedDeepReadArticleId, setSelectedDeepReadArticleId] = useState<string | null>(null);
  const [deepReadGeneratingGoalId, setDeepReadGeneratingGoalId] = useState<string | null>(null);
  const [deepReadMessage, setDeepReadMessage] = useState("");
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
  // Bumped when an in-flight signal send settles or a retry backoff expires, so
  // the sync effect re-scans for newer signal versions.
  const [signalSyncTick, setSignalSyncTick] = useState(0);
  const [learningFeedback, setLearningFeedback] = useState<LearningFeedbackByPost>({});
  const [evidenceLedgers, setEvidenceLedgers] = useState<Record<string, EvidenceLedger | null>>({});
  // Posts whose evidence fetch failed (distinct from "loaded, no evidence"):
  // cleared on reconnect or manual retry so a transient failure is not cached
  // for the whole session.
  const [evidenceErrors, setEvidenceErrors] = useState<ReadonlySet<string>>(() => new Set());
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
  const [subscriptionMessage, setSubscriptionMessage] = useState(() => t("subscription.message.default"));
  const [subscriptionMessageIsError, setSubscriptionMessageIsError] = useState(false);
  const [learningGoalMessage, setLearningGoalMessage] = useState(() => t("goals.message.default"));
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [conceptView, setConceptView] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("timeline");
  const [graphRequestedTab, setGraphRequestedTab] = useState<"graph" | "boundary" | "skillTree">("graph");
  const [feedTab, setFeedTab] = useState<"foryou" | "latest" | "saved">("foryou");
  const [topicFilter, setTopicFilter] = useState<TopicFilterKey>("all");
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
  // Ask-AI drafts are keyed by card so switching cards never carries a draft
  // (or submits it) to the wrong post.
  const [aiPromptByCard, setAiPromptByCard] = useState<Record<string, string>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingCandidate, setIsSavingCandidate] = useState(false);
  const [isSavingSubscription, setIsSavingSubscription] = useState(false);
  const [isSavingLearningGoal, setIsSavingLearningGoal] = useState(false);
  const [updatingSubscriptionIds, setUpdatingSubscriptionIds] = useState<string[]>([]);
  const [deletingSubscriptionIds, setDeletingSubscriptionIds] = useState<string[]>([]);
  const [backlogViews, setBacklogViews] = useState<Record<string, SubscriptionBacklogView>>({});
  const [expandedBacklogIds, setExpandedBacklogIds] = useState<string[]>([]);
  const [backlogBusyIds, setBacklogBusyIds] = useState<string[]>([]);
  const [isRunningCuration, setIsRunningCuration] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const syncedSignalSignatures = useRef<Record<string, string>>(loadSyncedSignalSignatures());
  const pendingSignalSignatures = useRef<Record<string, string>>({});
  const signalRetryTimers = useRef<Record<string, number>>({});
  const signalRetryDelays = useRef<Record<string, number>>({});
  const refreshAbortRef = useRef<AbortController | null>(null);
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
  const weeklyRecapSeenIds = useRef<Set<string>>(new Set());
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

  useEffect(() => {
    if (!weeklyRecap || apiStatus !== "connected" || weeklyRecapSeenIds.current.has(weeklyRecap.id)) {
      return;
    }

    weeklyRecapSeenIds.current.add(weeklyRecap.id);
    void apiRequest<ApiWeeklyRecapSeenResponse>("/api/recap/weekly/seen", {
      method: "POST",
      body: { id: weeklyRecap.id }
    }).catch(() => {
      weeklyRecapSeenIds.current.delete(weeklyRecap.id);
    });
  }, [apiStatus, weeklyRecap]);

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
  // Explicit fixture switch (build env or ?demo): the only way demo content renders.
  const demoModeEnabled = useMemo(
    () =>
      import.meta.env.VITE_AITIMELINE_DEMO === "1" ||
      new URLSearchParams(window.location.search).has("demo"),
    []
  );
  const demoCardIdSet = useMemo(() => new Set(demoCards.map((card) => card.id)), []);
  const demoRankedCards = useMemo(() => rankKnowledgeCards(demoCards, demoProfile), []);
  const rankedCards = useMemo(() => {
    // Demo cards only render behind an explicit fixture switch; a connected but
    // empty library shows the real empty state instead of fake knowledge.
    const cards = rankedImportedCards.length > 0
      ? rankedImportedCards
      : demoModeEnabled
        ? demoRankedCards
        : [];
    // Locally removed or reviewed cards leave the feed immediately.
    return locallyRemovedIds.size === 0 ? cards : cards.filter((card) => !locallyRemovedIds.has(card.id));
  }, [demoModeEnabled, demoRankedCards, locallyRemovedIds, rankedImportedCards]);
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
  const topicFilterOptions = useMemo(() => buildTopicFilterOptions(displayedCards), [displayedCards]);
  const topicFilteredCards = useMemo(() => {
    if (topicFilter === "all") {
      return displayedCards;
    }

    if (topicFilter === otherTopicFilterKey) {
      return displayedCards.filter((card) => topicFilterOptions.otherTopicIds.has(getTimelineCardBlockTopic(card).id));
    }

    return displayedCards.filter((card) => getTimelineCardBlockTopic(card).id === topicFilter);
  }, [displayedCards, topicFilter, topicFilterOptions]);
  // Free-text filter over the active tab's cards so the rail search narrows
  // the feed in place instead of leaving the page.
  const visibleCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return topicFilteredCards;
    return topicFilteredCards.filter((card) => {
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
  }, [searchQuery, topicFilteredCards]);
  useEffect(() => {
    if (topicFilter === "all") {
      return;
    }

    if (topicFilter === otherTopicFilterKey && topicFilterOptions.hasOther) {
      return;
    }

    if (topicFilterOptions.topics.some((option) => option.topic.id === topicFilter)) {
      return;
    }

    setTopicFilter("all");
  }, [topicFilter, topicFilterOptions]);
  // Library view: every post the server knows about, regardless of feed
  // lifecycle. The feed (rankedCards) is a ranked, lifecycle-filtered subset;
  // graph, backlinks, skill tree, review and notification lookups must not
  // shrink when a card rests or is dismissed from the feed.
  const allCards = useMemo(() => {
    if (libraryPosts.length === 0 && importedCards.length === 0 && pendingCards.length === 0) {
      return demoModeEnabled ? demoRankedCards : [];
    }

    const byId = new Map<string, KnowledgeCard>();

    for (const post of libraryPosts) {
      byId.set(post.id, post);
    }
    // Timeline/pending versions of the same post win: they carry the freshest
    // server state for cards currently in the feed.
    for (const card of importedCards) {
      byId.set(card.id, card);
    }
    for (const card of pendingCards) {
      byId.set(card.id, card);
    }

    return ensureRankedCards(Array.from(byId.values()));
  }, [demoModeEnabled, demoRankedCards, importedCards, libraryPosts, pendingCards]);
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
    () => [...(demoModeEnabled ? demoSignals : []), ...importedSignals, ...interactionUserSignals],
    [demoModeEnabled, importedSignals, interactionUserSignals]
  );
  const selectedCard = useMemo(() => {
    if (!selectedCardId) {
      return null;
    }

    // Prefer the feed version (it carries the active ranking context), but fall
    // back to the library so detail opens for cards that left the feed.
    return rankedCards.find((card) => card.id === selectedCardId) ?? cardsById[selectedCardId] ?? null;
  }, [cardsById, rankedCards, selectedCardId]);
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
  const reviewQueue = useMemo<ReviewQueueEntry[]>(
    () =>
      reviewDueItems.map((item) => ({
        cardId: item.postId,
        concept: resolveConcept(reviewCardsById[item.postId]?.concepts[0] ?? item.postId, conceptAliases),
        dueAt: item.dueAt,
        intervalDays: item.intervalDays,
        strength: 0,
        prompt: item.reviewPrompt ?? null
      })),
    [conceptAliases, reviewDueItems, reviewCardsById]
  );
  const boundary = useMemo(
    () => buildKnowledgeBoundary({ cards: allCards, signals: allSignals, conceptAliases, memory: userMemory ?? undefined }),
    [allCards, allSignals, conceptAliases, userMemory]
  );
  const selectedThread = selectedCard ? aiThreads[selectedCard.id] ?? [] : [];
  const selectedFeedback = selectedCard ? learningFeedback[selectedCard.id] : undefined;
  const selectedSignal = selectedCard ? interactionSignals[selectedCard.id] : undefined;
  const selectedEvidenceLedger = selectedCard ? evidenceLedgers[selectedCard.id] : undefined;
  const selectedEvidenceFailed = selectedCard ? evidenceErrors.has(selectedCard.id) : false;
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

      // One in-flight send per post: a newer version waits until the current
      // send settles, so acks can never land out of order.
      if (signal.postId in pendingSignalSignatures.current) {
        continue;
      }

      // A failed send sits out its backoff before the next attempt.
      if (signal.postId in signalRetryTimers.current) {
        continue;
      }

      pendingSignalSignatures.current[signal.postId] = signature;
      void syncInteractionSignal(signal)
        .then(() => {
          syncedSignalSignatures.current[signal.postId] = signature;
          saveSyncedSignalSignatures(syncedSignalSignatures.current);
          delete signalRetryDelays.current[signal.postId];
        })
        .catch((error: unknown) => {
          setApiMessage(t("api.signalSyncFailed"));

          if (error instanceof ApiHttpError && error.status < 500) {
            // The server rejected this payload outright; retrying the same
            // signature forever would poison the queue. Drop it.
            syncedSignalSignatures.current[signal.postId] = signature;
            saveSyncedSignalSignatures(syncedSignalSignatures.current);
            return;
          }

          const delay = Math.min(signalRetryDelays.current[signal.postId] ?? 5000, 60000);
          signalRetryDelays.current[signal.postId] = Math.min(delay * 2, 60000);
          signalRetryTimers.current[signal.postId] = window.setTimeout(() => {
            delete signalRetryTimers.current[signal.postId];
            setSignalSyncTick((tick) => tick + 1);
          }, delay);
        })
        .finally(() => {
          if (pendingSignalSignatures.current[signal.postId] === signature) {
            delete pendingSignalSignatures.current[signal.postId];
          }

          // Re-scan for a newer version that accumulated while in flight.
          setSignalSyncTick((tick) => tick + 1);
        });
    }
  }, [apiStatus, hasHydrated, interactionSignals, signalSyncTick]);

  useEffect(() => {
    if (!selectedCard || apiStatus !== "connected" || selectedCard.id in evidenceLedgers) {
      return;
    }

    // A failed fetch waits for reconnect or an explicit retry; without this
    // guard a persistent failure would refetch in a hot loop.
    if (evidenceErrors.has(selectedCard.id)) {
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

        // Do not cache the failure as "no evidence": remember it as an error
        // so the panel can offer a retry.
        setEvidenceErrors((errors) => {
          const next = new Set(errors);
          next.add(postId);
          return next;
        });
      });

    return () => {
      isStale = true;
    };
  }, [apiStatus, evidenceErrors, evidenceLedgers, selectedCard]);

  // Reconnecting invalidates cached evidence failures so they load fresh.
  useEffect(() => {
    if (apiStatus === "connected") {
      setEvidenceErrors((errors) => (errors.size === 0 ? errors : new Set()));
    }
  }, [apiStatus]);

  // A reviewed card is tombstoned out of the feed for the session; when the
  // server says it is due again, lift the tombstone so it can resurface.
  useEffect(() => {
    for (const item of reviewDueItems) {
      if (locallyRemovedIdsRef.current.has(item.postId)) {
        unmarkLocallyRemoved(item.postId);
      }
    }
  }, [reviewDueItems]);

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
      // Demo fixtures never reach the API: their ids do not exist in the
      // server snapshot and would pollute topic/curation state.
      if (demoCardIdSet.has(card.id)) continue;
      // Impression analytics are best-effort and capped to one send per card.
      // Impressions must stay pure-exposure (dwellTimeMs 0) so the server keeps
      // treating them as exposure-only; dwell reaches the server via the
      // onDwell -> signal sync path instead.
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

    // Abort the previous poll batch instead of letting hung requests pile up.
    refreshAbortRef.current?.abort();
    const abortController = new AbortController();
    refreshAbortRef.current = abortController;

    const now = new Date().toISOString();
    const signal = abortController.signal;

    try {
      const [timeline, snapshot, queuedJobs, reviewDue, dismissed, notificationsResult, weeklyRecapResult, goalsResult] = await Promise.all([
        apiRequest<ApiTimelineResponse>(
          `/api/timeline?userId=local-user&now=${encodeURIComponent(now)}`,
          { signal }
        ),
        apiRequest<ApiSnapshot>("/api/snapshot", { signal }),
        apiRequest<ApiCurationJobsResponse>("/api/curation/jobs?status=queued", { signal }),
        apiRequest<ApiReviewDueResponse>(`/api/review/due?now=${encodeURIComponent(now)}`, { signal }),
        apiRequest<ApiDismissedPostsResponse>(`/api/dismissed?now=${encodeURIComponent(now)}`, { signal }),
        apiRequest<ApiNotificationsResponse>("/api/notifications", { signal }),
        apiRequest<ApiWeeklyRecapResponse>(`/api/recap/weekly?now=${encodeURIComponent(now)}`, { signal }),
        apiRequest<ApiGoalsResponse>(`/api/goals?userId=local-user&now=${encodeURIComponent(now)}`, { signal })
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

      setLibraryPosts(snapshot.posts);
      setSourceImports(timeline.sourceImports);
      setSupplyStatus(timeline.supplyStatus ?? null);
      if (!timeline.supplyStatus?.drought) {
        setSupplyRefillState({ status: "idle" });
      }
      setSourceAssets(upsertById([], registryAssets));
      setSourceChunks(upsertById([], registryChunks));
      setSourceCandidates(snapshot.sourceCandidates);
      setSubscriptions(snapshot.subscriptions ?? []);
      setUserMemory(snapshot.userMemories?.find((record) => record.userId === "local-user")?.memory ?? null);
      setConceptAliases(snapshot.conceptAliases ?? []);
      setConceptMergeSuggestions(snapshot.conceptMergeSuggestions ?? []);
      setConceptBriefs(snapshot.conceptBriefs ?? []);
      setDeepReadArticles(snapshot.deepReadArticles ?? []);
      setDismissedPosts(dismissed.records);
      setAgentTurns(snapshot.agentTurns);
      setNotifications(notificationsResult.records);
      setLearningGoals(goalsResult.records);
      setReviewDueItems(reviewDue.due);
      setWeeklyRecap(weeklyRecapResult.recap && !weeklyRecapResult.recap.dismissedAt ? weeklyRecapResult.recap : null);
      setAutoJobBudget(
        goalsResult.gapProduction?.budget ?? snapshot.autoJobBudget?.find((record) => record.date === now.slice(0, 10)) ?? null
      );
      setQueuedJobCount(queuedJobs.jobs.length);
      productionPeakRef.current =
        queuedJobs.jobs.length === 0 ? 0 : Math.max(productionPeakRef.current, queuedJobs.jobs.length);
      setAgentTurnCount(snapshot.agentTurns.length);
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
    } catch (error) {
      // A superseded poll aborts its own batch; that is not a failure.
      if (requestId !== refreshSequence.current || isAbortError(error)) {
        return;
      }

      setApiStatus("offline");
      // Localize the raw transport error ("Failed to fetch") for the status line.
      setApiMessage(
        isTransportError(error)
          ? t("api.transportError")
          : error instanceof Error
            ? error.message
            : t("api.offlineImport")
      );
    }
  }

  // Business-action failures only flip the global status when the transport
  // itself failed; a 4xx/5xx response proves the server is reachable.
  function markOfflineIfTransport(error: unknown) {
    if (isTransportError(error)) {
      setApiStatus("offline");
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
    if (demoCardIdSet.has(signal.postId)) return;
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

    // A channel link cannot become a single video card; hand it to the
    // subscription flow instead of letting the import endpoint reject it.
    if (isYouTubeChannelUrl(trimmedUrl)) {
      setImportError(t("import.error.channelUrl"));
      setSubscriptionUrl(trimmedUrl);
      setSourceUrl("");
      openAgentSection("subscriptions");
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
      // No mock fallback on the production path: a failed import must say so
      // instead of fabricating an ungrounded card from canned transcript text.
      setImportError(error instanceof Error ? error.message : t("import.error.failed"));
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
      markOfflineIfTransport(error);
      setCandidateMessage(error instanceof Error ? error.message : t("candidate.unable"));
    } finally {
      setIsSavingCandidate(false);
    }
  }

  // Failures were easy to miss as plain note text; track the tone so the
  // subscription panel can render errors in the same red style as imports.
  function showSubscriptionMessage(text: string, isError = false) {
    setSubscriptionMessage(text);
    setSubscriptionMessageIsError(isError);
  }

  async function handleAddSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedUrl = subscriptionUrl.trim();

    if (!trimmedUrl) {
      showSubscriptionMessage(t("subscription.emptyUrl"), true);
      return;
    }

    // Validate the URL shape locally before hitting the API.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      showSubscriptionMessage(t("subscription.invalidUrl"), true);
      return;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      showSubscriptionMessage(t("subscription.invalidUrl"), true);
      return;
    }

    setIsSavingSubscription(true);

    try {
      const result = await apiRequest<{ record: SubscriptionRecord }>("/api/subscriptions", {
        method: "POST",
        body: {
          url: trimmedUrl,
          filterMode: "relevant"
        }
      });

      setSubscriptions((records) => upsertById(records, [result.record]));
      setSubscriptionUrl("");
      showSubscriptionMessage(t("subscription.added", { title: result.record.title }));
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
      // Freshly added feeds should not wait for other queued work to wake
      // the auto scout; poll them right away.
      void runCuration("auto");
    } catch (error) {
      markOfflineIfTransport(error);
      showSubscriptionMessage(error instanceof Error ? error.message : t("subscription.error"), true);
    } finally {
      setIsSavingSubscription(false);
    }
  }

  async function handleSubscriptionFilterChange(id: string, filterMode: SubscriptionRecord["filterMode"]) {
    setUpdatingSubscriptionIds((ids) => Array.from(new Set([...ids, id])));

    try {
      const result = await apiRequest<{ record: SubscriptionRecord }>(`/api/subscriptions/${encodeURIComponent(id)}`, {
        method: "POST",
        body: { filterMode }
      });

      setSubscriptions((records) => upsertById(records, [result.record]));
      showSubscriptionMessage(t("subscription.saved"));
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
    } catch (error) {
      markOfflineIfTransport(error);
      showSubscriptionMessage(error instanceof Error ? error.message : t("subscription.error"), true);
    } finally {
      setUpdatingSubscriptionIds((ids) => ids.filter((value) => value !== id));
    }
  }

  async function handleDeleteSubscription(id: string) {
    setDeletingSubscriptionIds((ids) => Array.from(new Set([...ids, id])));

    try {
      await apiRequest(`/api/subscriptions/${encodeURIComponent(id)}`, {
        method: "DELETE"
      });

      setSubscriptions((records) => records.filter((record) => record.id !== id));
      showSubscriptionMessage(t("subscription.saved"));
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
    } catch (error) {
      markOfflineIfTransport(error);
      showSubscriptionMessage(error instanceof Error ? error.message : t("subscription.error"), true);
    } finally {
      setDeletingSubscriptionIds((ids) => ids.filter((value) => value !== id));
    }
  }

  async function refreshBacklogView(id: string) {
    const view = await apiRequest<SubscriptionBacklogView>(`/api/subscriptions/${encodeURIComponent(id)}/backlog`);

    setBacklogViews((views) => ({ ...views, [id]: view }));
  }

  function markBacklogBusy(id: string, busy: boolean) {
    setBacklogBusyIds((ids) => (busy ? Array.from(new Set([...ids, id])) : ids.filter((value) => value !== id)));
  }

  async function handleCatalogBacklog(id: string) {
    markBacklogBusy(id, true);

    try {
      const result = await apiRequest<{ record: SubscriptionRecord; created: number; videoCount: number; truncated: boolean }>(
        `/api/subscriptions/${encodeURIComponent(id)}/backlog`,
        { method: "POST", body: {} }
      );

      setSubscriptions((records) => upsertById(records, [result.record]));
      showSubscriptionMessage(
        t("subscription.backlog.cataloged", { count: result.videoCount }) +
          (result.truncated ? ` ${t("subscription.backlog.truncated")}` : "")
      );
      setExpandedBacklogIds((ids) => Array.from(new Set([...ids, id])));
      await refreshBacklogView(id);
    } catch (error) {
      markOfflineIfTransport(error);
      showSubscriptionMessage(error instanceof Error ? error.message : t("subscription.backlog.error"), true);
    } finally {
      markBacklogBusy(id, false);
    }
  }

  async function handleDigestBacklog(id: string) {
    markBacklogBusy(id, true);

    try {
      const result = await apiRequest<ApiBacklogDigestResponse>(
        `/api/subscriptions/${encodeURIComponent(id)}/backlog/digest`,
        { method: "POST", body: {} }
      );

      showSubscriptionMessage(
        result.queued > 0
          ? t("subscription.backlog.digested", { count: result.queued })
          : t("subscription.backlog.exhausted")
      );
      await refreshBacklogView(id);
    } catch (error) {
      markOfflineIfTransport(error);
      showSubscriptionMessage(error instanceof Error ? error.message : t("subscription.backlog.error"), true);
    } finally {
      markBacklogBusy(id, false);
    }
  }

  function handleToggleBacklog(id: string) {
    const isExpanded = expandedBacklogIds.includes(id);

    setExpandedBacklogIds((ids) => (isExpanded ? ids.filter((value) => value !== id) : [...ids, id]));

    if (!isExpanded && !backlogViews[id]) {
      refreshBacklogView(id).catch((error) => {
        markOfflineIfTransport(error);
        showSubscriptionMessage(error instanceof Error ? error.message : t("subscription.backlog.error"), true);
      });
    }
  }

  async function handlePrioritizeBacklogEntry(subscriptionId: string, candidateId: string) {
    try {
      await apiRequest("/api/source-candidates/prioritize", {
        method: "POST",
        body: { id: candidateId }
      });
      await refreshBacklogView(subscriptionId);
    } catch (error) {
      markOfflineIfTransport(error);
      showSubscriptionMessage(error instanceof Error ? error.message : t("subscription.backlog.error"), true);
    }
  }

  async function handleCreateLearningGoal(concept: string) {
    const trimmedConcept = concept.trim();

    if (!trimmedConcept) {
      setLearningGoalMessage(t("goals.error.empty"));
      return;
    }

    setIsSavingLearningGoal(true);

    try {
      const result = await apiRequest<ApiGoalsResponse & { record: LearningGoalWithTree }>("/api/goals", {
        method: "POST",
        body: {
          concept: trimmedConcept,
          userId: "local-user"
        }
      });

      setLearningGoals(result.records);
      if (result.gapProduction?.budget) {
        setAutoJobBudget(result.gapProduction.budget);
      }
      setLearningGoalMessage(t("goals.message.created", { concept: result.record.concept }));
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
    } catch (error) {
      markOfflineIfTransport(error);
      setLearningGoalMessage(error instanceof Error ? error.message : t("goals.error.create"));
    } finally {
      setIsSavingLearningGoal(false);
    }
  }

  async function handleArchiveLearningGoal(id: string) {
    try {
      const result = await apiRequest<ApiGoalsResponse>(`/api/goals/${encodeURIComponent(id)}`, {
        method: "POST",
        body: { status: "archived" }
      });

      setLearningGoals(result.records);
      setLearningGoalMessage(t("goals.message.archived"));
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
    } catch (error) {
      markOfflineIfTransport(error);
      setLearningGoalMessage(error instanceof Error ? error.message : t("goals.error.archive"));
    }
  }

  async function handleGenerateDeepRead(goal: LearningGoalWithTree) {
    if (deepReadGeneratingGoalId || curationRunInFlight.current) {
      return;
    }

    const now = new Date().toISOString();
    setDeepReadGeneratingGoalId(goal.id);
    setDeepReadMessage(t("deepread.generating"));
    setIsRunningCuration(true);
    curationRunInFlight.current = true;

    try {
      await apiRequest<ApiDeepReadQueueResponse>("/api/deepread", {
        method: "POST",
        body: {
          goalId: goal.id,
          topic: goal.concept,
          userId: "local-user",
          now
        }
      });
      const result = await apiRequest<ApiCurationRunResponse>("/api/curation/run", {
        method: "POST",
        body: {
          now,
          limit: 1,
          kinds: ["deep_read_article"]
        }
      });
      const article = result.records.flatMap((record) => record.result?.deepReadArticle ?? [])[0];

      if (article) {
        setDeepReadArticles((records) => upsertById(records, [article]));
        setSelectedDeepReadArticleId(article.id);
        setActiveView("deepread");
        setDeepReadMessage(t("deepread.ready"));
      } else {
        setDeepReadMessage(t("deepread.queued"));
      }

      setApiStatus("connected");
      setApiMessage(t("api.connected"));
      await refreshFromApi({ silent: true, mode: "buffer" });
    } catch (error) {
      // A rejected request (e.g. the daily frequency cap) is not a lost API.
      setDeepReadMessage(error instanceof Error ? error.message : t("deepread.failed"));
    } finally {
      curationRunInFlight.current = false;
      setIsRunningCuration(false);
      setDeepReadGeneratingGoalId(null);
    }
  }

  function handleOpenDeepRead(articleId: string) {
    setSelectedDeepReadArticleId(articleId);
    setSelectedCardId(null);
    setActiveView("deepread");
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
            "deep_read_article",
            "schedule_review",
            "cooldown_topic"
          ]
        }
      });
      const importedCount = result.records.filter((record) => record.result?.sourceImport).length;
      const checkedAt = new Date().toISOString();

      if (result.supplyRefill && (result.supplyRefill.queued > 0 || result.supplyRefill.skipped > 0)) {
        setSupplyRefillState({ status: "done", result: result.supplyRefill });
      }
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
      markOfflineIfTransport(error);
      // Surface the actual failure reason instead of a bare "cannot run".
      setCurationMessage(
        error instanceof Error && error.message
          ? t("curation.failedWithReason", { reason: error.message })
          : t("curation.failed")
      );
    } finally {
      curationRunInFlight.current = false;
      setIsRunningCuration(false);
    }
  }

  function handleRunCuration() {
    void runCuration("manual");
  }

  function openAgentSection(section: "import" | "subscriptions") {
    setActiveView("agent");
    setSelectedCardId(null);
    const elementId = section === "subscriptions" ? "agent-subscriptions" : "agent-source-import";

    requestAnimationFrame(() => {
      document.getElementById(elementId)?.scrollIntoView({ block: "start", behavior: scrollMotion() });
    });
  }

  async function handleSupplyRefill() {
    if (supplyRefillState.status === "running") {
      return;
    }

    setSupplyRefillState({ status: "running" });

    try {
      const result = await apiRequest<ApiSupplyRefillResponse>("/api/supply/refill", {
        method: "POST",
        body: { now: new Date().toISOString() }
      });

      setSupplyRefillState({ status: "done", result });
      setApiStatus("connected");
      setApiMessage(t("api.connected"));
      await refreshFromApi({ silent: true, mode: "buffer" });
    } catch (error) {
      markOfflineIfTransport(error);
      setSupplyRefillState({
        status: "error",
        message: error instanceof Error ? error.message : t("api.unavailable")
      });
    }
  }

  async function handleAskAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const draft = selectedCard ? aiPromptByCard[selectedCard.id] ?? "" : "";

    if (!selectedCard || !draft.trim()) {
      return;
    }

    const card = selectedCard;
    const chunks = selectedChunks;
    const question = draft.trim();
    const askedAt = new Date().toISOString();
    const userMessage: AiMessage = {
      id: `${card.id}-user-${askedAt}`,
      role: "user",
      content: question,
      createdAt: askedAt
    };
    // Reserve the answer slot right under its question so two in-flight
    // questions on the same card can never interleave their answers.
    const assistantId = `${card.id}-assistant-${askedAt}`;
    const placeholderMessage: AiMessage = {
      id: assistantId,
      role: "assistant",
      content: t("agent.answerPending"),
      createdAt: askedAt
    };

    setAiThreads((threads) => ({
      ...threads,
      [card.id]: [...(threads[card.id] ?? []), userMessage, placeholderMessage]
    }));
    setAiPromptByCard((drafts) => ({ ...drafts, [card.id]: "" }));
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

    setAiThreads((threads) => ({
      ...threads,
      [card.id]: (threads[card.id] ?? []).map((message) =>
        message.id === assistantId
          ? { ...message, content: answerContent, createdAt: answeredAt }
          : message
      )
    }));
  }

  function handleAskThreadBlock(text: string) {
    if (selectedCardId) {
      const cardId = selectedCardId;
      setAiPromptByCard((drafts) => ({
        ...drafts,
        [cardId]: text.replace(/^\[(?:超出来源|beyond source)\]\s*/i, "")
      }));
    }
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

  function handlePromptChange(value: string) {
    if (!selectedCardId) {
      return;
    }

    const cardId = selectedCardId;
    setAiPromptByCard((drafts) => ({ ...drafts, [cardId]: value }));
  }

  function handleRetryEvidence() {
    if (!selectedCardId) {
      return;
    }

    const cardId = selectedCardId;
    setEvidenceErrors((errors) => {
      if (!errors.has(cardId)) {
        return errors;
      }

      const next = new Set(errors);
      next.delete(cardId);
      return next;
    });
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

  function dismissWeeklyRecap(recap: WeeklyRecapRecord) {
    setWeeklyRecap((current) => (current?.id === recap.id ? null : current));
    void apiRequest<ApiWeeklyRecapSeenResponse>("/api/recap/weekly/seen", {
      method: "POST",
      body: { dismissed: true, id: recap.id }
    }).catch(() => {
      setWeeklyRecap((current) => current ?? recap);
    });
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
  // Throws on failure so the review view can offer a retry instead of faking success.
  async function completeReview(
    card: KnowledgeCard,
    grade: ReviewGrade,
    reviewEventId: string
  ): Promise<ApiReviewCompleteResponse> {
    const result = await apiRequest<ApiReviewCompleteResponse>(
      `/api/review/${encodeURIComponent(card.id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: new Date().toISOString(), grade, reviewEventId }
      }
    );

    markLocallyRemoved(card.id);
    void refreshFromApi({ silent: true, mode: "buffer" });
    return result;
  }

  function handleReviewComplete(card: RankedKnowledgeCard) {
    // Timeline review chip has no grade UI yet; treat it as remembered.
    void completeReview(card, "remembered", `${card.id}-${Date.now()}`).catch(() => {
      // Best effort here; the review view is the graded, retryable path.
    });
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
  const selectedDeepReadArticle =
    deepReadArticles.find((article) => article.id === selectedDeepReadArticleId) ?? deepReadArticles[0] ?? null;
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
            evidenceError={selectedEvidenceFailed}
            evidenceLedger={selectedEvidenceLedger}
            feedback={selectedFeedback}
            graph={linkedGraph}
            // Remount per card so drafts and in-flight answer UI never leak
            // from one card into another.
            key={selectedCard.id}
            messages={selectedThread}
            onAsk={handleAskAi}
            onAskThreadBlock={handleAskThreadBlock}
            onLike={handleLike}
            onOpenCardId={handleOpenCardId}
            onOpenConcept={handleOpenConcept}
            onPromptChange={handlePromptChange}
            onReply={handleReply}
            onRetryEvidence={handleRetryEvidence}
            onSave={handleSave}
            prompt={aiPromptByCard[selectedCard.id] ?? ""}
            quoteText={quoteByCard[selectedCard.id]}
            signal={selectedSignal}
            wikilinkCandidates={wikilinkCandidates}
          />
        ) : null}

        {activeView === "timeline" && !selectedCard ? (
          <>
            <div className="x-topic-tabs" role="tablist" aria-label={t("feed.topicFilters")}>
              <button
                aria-selected={topicFilter === "all"}
                className={`x-tab${topicFilter === "all" ? " active" : ""}`}
                onClick={() => setTopicFilter("all")}
                role="tab"
                type="button"
              >
                {t("feed.topic.all")}
              </button>
              {topicFilterOptions.topics.map((option) => (
                <button
                  aria-selected={topicFilter === option.topic.id}
                  className={`x-tab${topicFilter === option.topic.id ? " active" : ""}`}
                  key={option.topic.id}
                  onClick={() => setTopicFilter(option.topic.id)}
                  role="tab"
                  title={option.topic.label}
                  type="button"
                >
                  <span>{option.topic.label}</span>
                  <em>{option.count}</em>
                </button>
              ))}
              {topicFilterOptions.hasOther ? (
                <button
                  aria-selected={topicFilter === otherTopicFilterKey}
                  className={`x-tab${topicFilter === otherTopicFilterKey ? " active" : ""}`}
                  onClick={() => setTopicFilter(otherTopicFilterKey)}
                  role="tab"
                  type="button"
                >
                  {t("feed.topic.other")}
                </button>
              ) : null}
            </div>

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

            {supplyStatus?.drought ? (
              <SupplyDroughtCard
                onImportLink={() => openAgentSection("import")}
                onOpenReview={() => setActiveView("review")}
                onRefillCandidates={() => {
                  void handleSupplyRefill();
                }}
                onSubscriptions={() => openAgentSection("subscriptions")}
                refillState={supplyRefillState}
                status={supplyStatus}
              />
            ) : null}

            {weeklyRecap ? <WeeklyRecapCard onDismiss={dismissWeeklyRecap} recap={weeklyRecap} theme={theme} /> : null}

            <section className="x-feedlist" aria-label={t("feed.label")}>
              {visibleCards.length === 0 ? (
                <p className="x-empty">
                  {searchQuery.trim()
                    ? t("feed.noMatch", { query: searchQuery.trim() })
                    : feedTab === "saved"
                      ? t("feed.savedEmpty")
                      : apiStatus === "offline"
                        ? t("feed.offline")
                        : t("feed.empty")}
                </p>
              ) : (
                visibleCards.map((card, index) => {
                  const timelineCard = card as TimelineCard;
                  const previousCard = visibleCards[index - 1] as TimelineCard | undefined;
                  const showDivider =
                    feedTab === "foryou" &&
                    !!timelineCard.timelineBlockId &&
                    timelineCard.timelineBlockId !== previousCard?.timelineBlockId;
                  const dividerLabel =
                    timelineCard.timelineDivider?.topicLabel ?? getTimelineCardBlockTopic(timelineCard).label;

                  return (
                    <Fragment key={card.id}>
                      {showDivider ? (
                        <div className="x-block-divider">
                          <span>{t("feed.topicDivider", { topic: dividerLabel })}</span>
                        </div>
                      ) : null}
                      <PostView
                        card={card}
                        cards={allCards}
                        connections={connectionsByCard[card.id] ?? []}
                        dismissedPostIds={activeDismissedPostIds}
                        graph={linkedGraph}
                        isFocused={index === focusedIndex}
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
                        reviewDueAt={timelineCard.reviewDueAt}
                        signal={interactionSignals[card.id]}
                        wikilinkCandidates={wikilinkCandidates}
                      />
                    </Fragment>
                  );
                })
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
            conceptCandidates={wikilinkCandidates}
            conceptMergeSuggestions={conceptMergeSuggestions.filter((suggestion) => suggestion.status === "pending")}
            initialTab={graphRequestedTab}
            isSavingLearningGoal={isSavingLearningGoal}
            learningGoalMessage={learningGoalMessage}
            learningGoals={learningGoals}
            deepReadArticles={deepReadArticles}
            deepReadGeneratingGoalId={deepReadGeneratingGoalId}
            deepReadMessage={deepReadMessage}
            linkedGraph={linkedGraph}
            onArchiveLearningGoal={handleArchiveLearningGoal}
            onCreateLearningGoal={handleCreateLearningGoal}
            onGenerateDeepRead={handleGenerateDeepRead}
            onOpenDeepRead={handleOpenDeepRead}
            onOpenCardId={handleOpenCardId}
            onOpenConcept={handleOpenConcept}
            onResolveConceptSuggestion={resolveConceptSuggestion}
          />
        ) : null}

        {activeView === "deepread" ? (
          <DeepReadArticleView
            article={selectedDeepReadArticle}
            cards={allCards}
            conceptAliases={conceptAliases}
            onOpenConcept={handleOpenConcept}
            onBack={() => {
              setActiveView("graph");
              setGraphRequestedTab("skillTree");
            }}
          />
        ) : null}

        {activeView === "review" ? (
          <ReviewView
            cardsById={reviewCardsById}
            onReviewed={completeReview}
            queue={reviewQueue}
          />
        ) : null}

        {activeView === "notifications" ? (
          <NotificationsView
            notifications={notifications}
            onGoTimeline={() => setActiveView("timeline")}
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
            isSavingSubscription={isSavingSubscription}
            lastScoutAt={lastScoutAt}
            memoryMessage={memoryMessage}
            onAutoScoutChange={setAutoScoutEnabled}
            onCandidateConceptChange={setCandidateConcept}
            onCandidateUrlChange={setCandidateUrl}
            backlogBusyIds={backlogBusyIds}
            backlogViews={backlogViews}
            expandedBacklogIds={expandedBacklogIds}
            onCatalogBacklog={(id) => {
              void handleCatalogBacklog(id);
            }}
            onDeleteSubscription={(id) => {
              void handleDeleteSubscription(id);
            }}
            onDigestBacklog={(id) => {
              void handleDigestBacklog(id);
            }}
            onPrioritizeBacklogEntry={(subscriptionId, candidateId) => {
              void handlePrioritizeBacklogEntry(subscriptionId, candidateId);
            }}
            onToggleBacklog={handleToggleBacklog}
            onImportSubmit={handleImport}
            onRunCuration={handleRunCuration}
            onSaveCandidate={handleSaveCandidate}
            onSourceUrlChange={setSourceUrl}
            onSubscriptionFilterChange={(id, filterMode) => {
              void handleSubscriptionFilterChange(id, filterMode);
            }}
            onSubscriptionSubmit={handleAddSubscription}
            onSubscriptionUrlChange={setSubscriptionUrl}
            agentTurnCount={agentTurnCount}
            deletingSubscriptionIds={deletingSubscriptionIds}
            queuedJobCount={queuedJobCount}
            sourceCandidates={sourceCandidates}
            sourceImports={sourceImports}
            sourceUrl={sourceUrl}
            subscriptionMessage={subscriptionMessage}
            subscriptionMessageIsError={subscriptionMessageIsError}
            subscriptions={subscriptions}
            subscriptionUrl={subscriptionUrl}
            updatingSubscriptionIds={updatingSubscriptionIds}
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
          learningGoals={learningGoals}
          onOpenCardId={handleOpenCardId}
          onOpenConcept={handleOpenConcept}
          onOpenGraph={() => {
            setGraphRequestedTab("graph");
            setActiveView("graph");
          }}
          onOpenSkillTree={() => {
            setGraphRequestedTab("skillTree");
            setActiveView("graph");
          }}
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
