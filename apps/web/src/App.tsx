import {
  buildKnowledgeGraph,
  createReviewQueue,
  demoCards,
  demoProfile,
  demoSignals,
  evaluateInteraction,
  rankKnowledgeCards,
  transformMockYouTubeUrl,
  type InteractionSignal,
  type KnowledgeCard,
  type KnowledgeChunk,
  type LearningFeedback,
  type RankedKnowledgeCard,
  type SourceAsset,
  type SourceImport,
  type TopicState,
  type TransformationStatus,
  type TrustState
} from "@aitimeline/core";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bell,
  Bookmark,
  Bot,
  Brain,
  CheckCircle2,
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

const sampleYouTubeUrl = "https://www.youtube.com/watch?v=aitimeline-demo";
const storageKey = "aitimeline.mvp.v3";

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

type PersistedMvpState = {
  sourceImports: SourceImport[];
  importedCards: KnowledgeCard[];
  sourceAssets: SourceAsset[];
  sourceChunks: KnowledgeChunk[];
  aiThreads: AiThreads;
  interactionSignals: InteractionSignals;
  learningFeedback: LearningFeedbackByPost;
};

export function App() {
  const [sourceUrl, setSourceUrl] = useState(sampleYouTubeUrl);
  const [sourceImports, setSourceImports] = useState<SourceImport[]>([]);
  const [importedCards, setImportedCards] = useState<KnowledgeCard[]>([]);
  const [sourceAssets, setSourceAssets] = useState<SourceAsset[]>([]);
  const [sourceChunks, setSourceChunks] = useState<KnowledgeChunk[]>([]);
  const [aiThreads, setAiThreads] = useState<AiThreads>({});
  const [interactionSignals, setInteractionSignals] = useState<InteractionSignals>({});
  const [learningFeedback, setLearningFeedback] = useState<LearningFeedbackByPost>({});
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);

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

  const allCards = useMemo(() => [...importedCards, ...demoCards], [importedCards]);
  const allSignals = useMemo(
    () => [...demoSignals, ...importedSignals, ...interactionUserSignals],
    [importedSignals, interactionUserSignals]
  );
  const rankedCards = useMemo(() => rankKnowledgeCards(allCards, demoProfile), [allCards]);
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

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedUrl = sourceUrl.trim();

    if (!trimmedUrl) {
      setImportError("Paste a YouTube URL first.");
      return;
    }

    setIsImporting(true);
    setImportError(null);

    try {
      const result = transformMockYouTubeUrl(trimmedUrl, new Date().toISOString());
      const pendingImport = { ...result.importRecord, status: "queued" as const };

      setSourceImports((imports) => upsertImport(imports, pendingImport));
      await wait(320);
      setSourceImports((imports) => updateImportStatus(imports, pendingImport.id, "extracting"));
      await wait(420);
      setSourceImports((imports) => updateImportStatus(imports, pendingImport.id, "transforming"));
      await wait(520);

      setImportedCards((cards) => mergeCards(result.cards, cards));
      setSourceAssets((assets) => upsertById(assets, [result.asset]));
      setSourceChunks((chunks) => upsertById(chunks, result.chunks));
      setSourceImports((imports) => updateImportStatus(imports, pendingImport.id, "ready"));
      setSelectedCardId(result.cards[0]?.id ?? null);
      if (result.cards[0]) {
        recordInteraction(result.cards[0], { openedThread: true, dwellTimeMs: 9000 });
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
    }
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
    setAiPrompt("");
  }

  function handleOpenCard(card: RankedKnowledgeCard) {
    setSelectedCardId(card.id);
    recordInteraction(card, { openedThread: true, dwellTimeMs: 9000, skippedQuickly: false });
  }

  function handleLike(card: RankedKnowledgeCard) {
    recordInteraction(card, { liked: true, skippedQuickly: false });
  }

  function handleSave(card: RankedKnowledgeCard) {
    recordInteraction(card, { saved: true, skippedQuickly: false });
  }

  function handleSkip(card: RankedKnowledgeCard) {
    recordInteraction(card, { skippedQuickly: true, dwellTimeMs: 800, openedThread: false });
  }

  function recordInteraction(card: KnowledgeCard, patch: Partial<InteractionSignal>) {
    setInteractionSignals((signals) => {
      const currentSignal = signals[card.id] ?? createInteractionSignal(card);
      const nextSignal = {
        ...currentSignal,
        ...patch,
        impression: true,
        conceptIds: card.concepts,
        topicId: getTopicId(card)
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
          <p>AI Agent, RAG, Product Strategy</p>
          <button className="primary-action">
            <RefreshCw size={18} />
            <span>Run Scout</span>
          </button>
        </section>
      </aside>

      <main className="timeline-column">
        <header className="timeline-header">
          <div>
            <p className="section-label">Today</p>
            <h1>Knowledge Timeline</h1>
          </div>
          <div className="header-actions">
            <button className="icon-button" title="Search">
              <Search size={19} />
            </button>
            <button className="icon-button" title="Notifications">
              <Bell size={19} />
            </button>
          </div>
        </header>

        <div className="topic-strip" aria-label="Topics">
          {demoProfile.interests.map((interest) => (
            <button className="topic-pill" key={interest}>
              {interest}
            </button>
          ))}
        </div>

        <SourceImportPanel
          cardCount={importedCards.length}
          error={importError}
          isImporting={isImporting}
          latestImport={sourceImports[0]}
          onSubmit={handleImport}
          onUrlChange={setSourceUrl}
          url={sourceUrl}
        />

        <section className="feed-list" aria-label="Knowledge cards">
          {rankedCards.map((card) => (
            <KnowledgeCardView
              card={card}
              feedback={learningFeedback[card.id]}
              key={card.id}
              onLike={handleLike}
              onOpen={handleOpenCard}
              onSave={handleSave}
              onSkip={handleSkip}
              signal={interactionSignals[card.id]}
            />
          ))}
        </section>
      </main>

      <aside className="right-rail" aria-label="Context">
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
          feedback={selectedFeedback}
          messages={selectedThread}
          onAsk={handleAskAi}
          onClose={() => setSelectedCardId(null)}
          onPromptChange={setAiPrompt}
          prompt={aiPrompt}
          signal={selectedSignal}
        />
      ) : null}
    </div>
  );
}

function SourceImportPanel({
  cardCount,
  error,
  isImporting,
  latestImport,
  onSubmit,
  onUrlChange,
  url
}: {
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
          <h2>YouTube Import</h2>
        </div>
        <div className="source-kind">
          <Video size={17} />
          <span>Mocked</span>
        </div>
      </div>

      <form className="source-form" onSubmit={onSubmit}>
        <label className="source-input-shell">
          <Link size={18} />
          <input
            aria-label="YouTube URL"
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="Paste YouTube URL"
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
            {latestImport ? formatStatus(latestImport.status) : "Ready"} · {cardCount} generated posts
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
  onLike,
  onOpen,
  onSave,
  onSkip,
  signal
}: {
  card: RankedKnowledgeCard;
  feedback?: LearningFeedback;
  onLike: (card: RankedKnowledgeCard) => void;
  onOpen: (card: RankedKnowledgeCard) => void;
  onSave: (card: RankedKnowledgeCard) => void;
  onSkip: (card: RankedKnowledgeCard) => void;
  signal?: InteractionSignal;
}) {
  const threadPreview = getTimelineThreadPreview(card);
  const readBlock = getReadBlock(card);
  const learnPrompts = card.reviewPrompts?.slice(0, 2) ?? [];
  const exploreEdges = card.graphEdges?.slice(0, 2) ?? [];
  const primaryConcept = card.concepts[0] ?? "Knowledge";
  const source = card.sources[0];

  return (
    <article className="knowledge-card">
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

        <div className="social-thread-preview">
          {threadPreview.map((block) => (
            <button className="social-thread-reply" key={block.id} onClick={() => onOpen(card)} type="button">
              <div className="reply-avatar">{formatThreadKind(block.kind).slice(0, 2)}</div>
              <div>
                <span>{formatThreadKind(block.kind)}</span>
                <strong>{block.title}</strong>
                <p>{block.body}</p>
              </div>
            </button>
          ))}
          <button className="thread-count-button" onClick={() => onOpen(card)} type="button">
            <MessageCircle size={16} />
            <span>
              Open thread · {card.thread?.length ?? 0} replies · {card.reviewPrompts?.length ?? 0} checks ready
            </span>
          </button>
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

function mergeCards(newCards: KnowledgeCard[], currentCards: KnowledgeCard[]): KnowledgeCard[] {
  const newCardIds = new Set(newCards.map((card) => card.id));
  return [...newCards, ...currentCards.filter((card) => !newCardIds.has(card.id))];
}

function upsertById<T extends { id: string }>(currentItems: T[], newItems: T[]): T[] {
  const newItemIds = new Set(newItems.map((item) => item.id));
  return [...newItems, ...currentItems.filter((item) => !newItemIds.has(item.id))];
}

function upsertImport(imports: SourceImport[], nextImport: SourceImport): SourceImport[] {
  return [nextImport, ...imports.filter((item) => item.id !== nextImport.id)];
}

function updateImportStatus(
  imports: SourceImport[],
  importId: string,
  status: TransformationStatus
): SourceImport[] {
  return imports.map((item) => (item.id === importId ? { ...item, status } : item));
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
