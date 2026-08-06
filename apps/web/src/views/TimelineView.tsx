import type {
  Backlink,
  CardConnection,
  InteractionSignal,
  KnowledgeBoundaryView,
  KnowledgeCard,
  KnowledgeChunk,
  KnowledgeGraph,
  LearningFeedback,
  LinkedKnowledgeGraph,
  RankedKnowledgeCard,
  ReviewItem,
  SourceAsset,
  TimelineBlockTopic,
  WeeklyRecapRecord
} from "@aitimeline/core";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Fragment, type FormEvent, type ReactNode, type Ref } from "react";
import {
  AgentReplyThread,
  type AgentReplyAction,
  type DiscoveryRunState
} from "../components/AgentReplyThread";
import { AskComposer } from "../components/AskComposer";
import { ContextRail } from "../components/ContextRail";
import { PostDetailView } from "../components/PostDetailView";
import { PostView } from "../components/PostView";
import { SupplyDroughtCard, type SupplyRefillState } from "../components/SupplyDroughtCard";
import { WeeklyRecapCard } from "../components/WeeklyRecapCard";
import type { WikilinkAutocompleteCandidate } from "../components/WikilinkAutocomplete";
import { getTopicId } from "../lib/format";
import { t } from "../lib/i18n";
import type {
  AgentAskApiResponse,
  AiMessage,
  ApiStatus,
  EvidenceLedger,
  InteractionSignals,
  LearningGoalWithTree,
  SupplyStatus,
  TimelineCard
} from "../lib/types";

export type FeedTab = "foryou" | "latest" | "saved";
export type TopicFilterKey = "all" | "__other__" | string;

export const otherTopicFilterKey = "__other__";
const maxTopicFilterPillCount = 5;

export type TopicFilterOption = {
  topic: TimelineBlockTopic;
  count: number;
  firstIndex: number;
};

export type TopicFilterOptions = {
  topics: TopicFilterOption[];
  otherTopicIds: Set<string>;
  hasOther: boolean;
};

export function getTimelineCardBlockTopic(card: RankedKnowledgeCard): TimelineBlockTopic {
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

export function buildTopicFilterOptions(cards: RankedKnowledgeCard[]): TopicFilterOptions {
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

export interface TimelineViewProps {
  // Layout and timeline header
  headerActions: ReactNode;
  /** 嵌进任务客户端中栏时不渲染自带右栏——客户端有自己的右栏,别出两根。 */
  hideRail?: boolean;
  scoutLedger: ReactNode;
  selectedCard: RankedKnowledgeCard | null;
  feedTab: FeedTab;
  onCloseDetail: () => void;
  onFeedTabChange: (tab: FeedTab) => void;

  // Selected-card detail
  selectedAsset?: SourceAsset;
  selectedBacklinks: Backlink[];
  allCards: KnowledgeCard[];
  selectedChunks: KnowledgeChunk[];
  connectionsByCard: Record<string, CardConnection[]>;
  selectedEvidenceFailed: boolean;
  selectedEvidenceLedger?: EvidenceLedger | null;
  selectedFeedback?: LearningFeedback;
  linkedGraph: LinkedKnowledgeGraph;
  selectedThread: AiMessage[];
  onAskAi: (event: FormEvent<HTMLFormElement>) => void;
  onAskThreadBlock: (text: string) => void;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpenCardId: (cardId: string) => void;
  onOpenConcept: (concept: string) => void;
  onPromptChange: (value: string) => void;
  onReply: (card: RankedKnowledgeCard, text: string) => Promise<void>;
  onRetryEvidence: () => void;
  onSave: (card: RankedKnowledgeCard) => void;
  selectedPrompt: string;
  selectedQuoteText?: string;
  selectedSignal?: InteractionSignal;
  wikilinkCandidates: WikilinkAutocompleteCandidate[];

  // Feed filters and composer
  topicFilter: TopicFilterKey;
  topicFilterOptions: TopicFilterOptions;
  onTopicFilterChange: (filter: TopicFilterKey) => void;
  composerInputRef: Ref<HTMLInputElement>;
  isAgentAsking: boolean;
  composerMode: "question" | "idea";
  onComposerModeChange: (mode: "question" | "idea") => void;
  onAgentQuestionChange: (question: string) => void;
  onAgentAsk: (event: FormEvent<HTMLFormElement>) => void;
  agentQuestion: string;

  // Inline agent reply
  agentMessage: string;
  agentResponse: AgentAskApiResponse | null;
  agentAskedQuestion: string;
  discoveryRun: DiscoveryRunState;
  onConfirmDiscovery: (action: AgentReplyAction, choices: Record<string, string>) => void;
  onDiscoverSources: (action: AgentReplyAction) => void;
  onDismissAgentReply: () => void;
  onOpenDiscover: () => void;
  onIdeaProbe: (action: AgentReplyAction) => void;
  onResearchIdea: (action: AgentReplyAction) => void;
  currentAgentTurnStatus?: string;

  // Supply, recap, and feed cards
  pendingCards: KnowledgeCard[];
  onShowPendingCards: () => void;
  queuedJobCount: number;
  autoScoutEnabled: boolean;
  productionPeak: number;
  supplyStatus: SupplyStatus | null;
  supplyRefillState: SupplyRefillState;
  onOpenImport: () => void;
  onOpenReview: () => void;
  onRefillCandidates: () => void;
  onOpenSubscriptions: () => void;
  weeklyRecap: WeeklyRecapRecord | null;
  onDismissWeeklyRecap: (recap: WeeklyRecapRecord) => void;
  theme: "light" | "dark";
  visibleCards: RankedKnowledgeCard[];
  searchQuery: string;
  apiStatus: ApiStatus;
  activeDismissedPostIds: ReadonlySet<string>;
  focusedIndex: number;
  onDwell: (card: KnowledgeCard, dwellTimeMs: number) => void;
  onImpression: (card: KnowledgeCard) => void;
  onOpenCard: (card: RankedKnowledgeCard) => void;
  onRestorePost: (postId: string) => Promise<void>;
  onReviewComplete: (card: RankedKnowledgeCard) => void;
  onSkip: (card: RankedKnowledgeCard) => void;
  quoteByCard: Record<string, string | undefined>;
  interactionSignals: InteractionSignals;

  // Context rail
  boundary: KnowledgeBoundaryView;
  selectedLocalGraph: LinkedKnowledgeGraph | null;
  graph: KnowledgeGraph;
  learningGoals: LearningGoalWithTree[];
  onOpenGraph: () => void;
  onOpenSkillTree: () => void;
  onSearchChange: (query: string) => void;
  reviewQueue: ReviewItem[];
}

export function TimelineView({
  headerActions,
  hideRail,
  scoutLedger,
  selectedCard,
  feedTab,
  onCloseDetail,
  onFeedTabChange,
  selectedAsset,
  selectedBacklinks,
  allCards,
  selectedChunks,
  connectionsByCard,
  selectedEvidenceFailed,
  selectedEvidenceLedger,
  selectedFeedback,
  linkedGraph,
  selectedThread,
  onAskAi,
  onAskThreadBlock,
  onLike,
  onOpenCardId,
  onOpenConcept,
  onPromptChange,
  onReply,
  onRetryEvidence,
  onSave,
  selectedPrompt,
  selectedQuoteText,
  selectedSignal,
  wikilinkCandidates,
  topicFilter,
  topicFilterOptions,
  onTopicFilterChange,
  composerInputRef,
  isAgentAsking,
  composerMode,
  onComposerModeChange,
  onAgentQuestionChange,
  onAgentAsk,
  agentQuestion,
  agentMessage,
  agentResponse,
  agentAskedQuestion,
  discoveryRun,
  onConfirmDiscovery,
  onDiscoverSources,
  onDismissAgentReply,
  onOpenDiscover,
  onIdeaProbe,
  onResearchIdea,
  currentAgentTurnStatus,
  pendingCards,
  onShowPendingCards,
  queuedJobCount,
  autoScoutEnabled,
  productionPeak,
  supplyStatus,
  supplyRefillState,
  onOpenImport,
  onOpenReview,
  onRefillCandidates,
  onOpenSubscriptions,
  weeklyRecap,
  onDismissWeeklyRecap,
  theme,
  visibleCards,
  searchQuery,
  apiStatus,
  activeDismissedPostIds,
  focusedIndex,
  onDwell,
  onImpression,
  onOpenCard,
  onRestorePost,
  onReviewComplete,
  onSkip,
  quoteByCard,
  interactionSignals,
  boundary,
  selectedLocalGraph,
  graph,
  learningGoals,
  onOpenGraph,
  onOpenSkillTree,
  onSearchChange,
  reviewQueue
}: TimelineViewProps) {
  return (
    <>
      <main className="x-main">
        <header className="x-colhead">
          {selectedCard ? (
            <div className="x-detail-head">
              <button aria-label={t("post.back")} className="x-detail-back" onClick={onCloseDetail} type="button">
                <ArrowLeft size={21} />
              </button>
              <div>
                <h1>{t("post.detailTitle")}</h1>
                <p className="x-colsub">{selectedCard.title}</p>
              </div>
            </div>
          ) : null}
          {!selectedCard ? (
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
                  onClick={() => onFeedTabChange(tabKey)}
                  role="tab"
                  type="button"
                >
                  {tabLabel}
                </button>
              ))}
            </div>
          ) : null}
          {headerActions}
        </header>

        {scoutLedger}

        {selectedCard ? (
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
            onAsk={onAskAi}
            onAskThreadBlock={onAskThreadBlock}
            onLike={onLike}
            onOpenCardId={onOpenCardId}
            onOpenConcept={onOpenConcept}
            onPromptChange={onPromptChange}
            onReply={onReply}
            onRetryEvidence={onRetryEvidence}
            onSave={onSave}
            prompt={selectedPrompt}
            quoteText={selectedQuoteText}
            signal={selectedSignal}
            wikilinkCandidates={wikilinkCandidates}
          />
        ) : (
          <>
            <div className="x-topic-tabs" role="tablist" aria-label={t("feed.topicFilters")}>
              <button
                aria-selected={topicFilter === "all"}
                className={`x-tab${topicFilter === "all" ? " active" : ""}`}
                onClick={() => onTopicFilterChange("all")}
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
                  onClick={() => onTopicFilterChange(option.topic.id)}
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
                  onClick={() => onTopicFilterChange(otherTopicFilterKey)}
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
              onModeChange={onComposerModeChange}
              onQuestionChange={onAgentQuestionChange}
              onSubmit={onAgentAsk}
              question={agentQuestion}
              ref={composerInputRef}
              wikilinkCandidates={wikilinkCandidates}
            />

            {agentMessage ? <p className="x-empty">{agentMessage}</p> : null}
            {agentResponse && agentAskedQuestion ? (
              <AgentReplyThread
                discovery={discoveryRun}
                onConfirm={onConfirmDiscovery}
                onDiscover={onDiscoverSources}
                onDismiss={onDismissAgentReply}
                onOpenCardId={onOpenCardId}
                onOpenDiscover={onOpenDiscover}
                onProbe={onIdeaProbe}
                onResearchIdea={onResearchIdea}
                question={agentAskedQuestion}
                response={agentResponse}
                turnStatus={currentAgentTurnStatus}
              />
            ) : null}

            {pendingCards.length > 0 ? (
              <button className="x-newpill" onClick={onShowPendingCards} type="button">
                {t("feed.newCards", { count: pendingCards.length })}
              </button>
            ) : queuedJobCount > 0 ? (
              <div className="x-prodchip" role="status">
                {autoScoutEnabled
                  ? t("feed.production", {
                      done: Math.max(0, productionPeak - queuedJobCount),
                      total: Math.max(productionPeak, queuedJobCount)
                    })
                  : t("feed.productionPaused", { count: queuedJobCount })}
              </div>
            ) : null}

            {supplyStatus?.drought ? (
              <SupplyDroughtCard
                onImportLink={onOpenImport}
                onOpenReview={onOpenReview}
                onRefillCandidates={onRefillCandidates}
                onSubscriptions={onOpenSubscriptions}
                refillState={supplyRefillState}
                status={supplyStatus}
              />
            ) : null}

            {weeklyRecap ? (
              <WeeklyRecapCard onDismiss={onDismissWeeklyRecap} recap={weeklyRecap} theme={theme} />
            ) : null}

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
                        onDwell={onDwell}
                        onImpression={onImpression}
                        onLike={onLike}
                        onOpen={onOpenCard}
                        onOpenCardId={onOpenCardId}
                        onOpenConcept={onOpenConcept}
                        onReply={onReply}
                        onRestorePost={onRestorePost}
                        onReviewComplete={onReviewComplete}
                        onSave={onSave}
                        onSkip={onSkip}
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
        )}
      </main>

      {hideRail ? null : (
        <ContextRail
          boundary={boundary}
          detailCard={selectedCard}
          detailGraph={selectedLocalGraph}
          graph={graph}
          learningGoals={learningGoals}
          onOpenCardId={onOpenCardId}
          onOpenConcept={onOpenConcept}
          onOpenGraph={onOpenGraph}
          onOpenSkillTree={onOpenSkillTree}
          onOpenReview={onOpenReview}
          onSearchChange={onSearchChange}
          reviewQueue={reviewQueue}
          searchQuery={searchQuery}
        />
      )}
    </>
  );
}
