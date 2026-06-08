import {
  buildKnowledgeGraph,
  createReviewQueue,
  demoCards,
  demoProfile,
  demoSignals,
  rankKnowledgeCards,
  transformMockYouTubeUrl,
  type KnowledgeCard,
  type KnowledgeChunk,
  type RankedKnowledgeCard,
  type SourceAsset,
  type SourceImport,
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
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Quote,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Video,
  XCircle
} from "lucide-react";

const sampleYouTubeUrl = "https://www.youtube.com/watch?v=aitimeline-demo";
const storageKey = "aitimeline.mvp.v1";

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

type PersistedMvpState = {
  sourceImports: SourceImport[];
  importedCards: KnowledgeCard[];
  sourceAssets: SourceAsset[];
  sourceChunks: KnowledgeChunk[];
  aiThreads: AiThreads;
};

export function App() {
  const [sourceUrl, setSourceUrl] = useState(sampleYouTubeUrl);
  const [sourceImports, setSourceImports] = useState<SourceImport[]>([]);
  const [importedCards, setImportedCards] = useState<KnowledgeCard[]>([]);
  const [sourceAssets, setSourceAssets] = useState<SourceAsset[]>([]);
  const [sourceChunks, setSourceChunks] = useState<KnowledgeChunk[]>([]);
  const [aiThreads, setAiThreads] = useState<AiThreads>({});
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

  const allCards = useMemo(() => [...importedCards, ...demoCards], [importedCards]);
  const allSignals = useMemo(() => [...demoSignals, ...importedSignals], [importedSignals]);
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

  useEffect(() => {
    const storedState = loadStoredState();

    if (storedState) {
      setSourceImports(storedState.sourceImports);
      setImportedCards(storedState.importedCards);
      setSourceAssets(storedState.sourceAssets);
      setSourceChunks(storedState.sourceChunks);
      setAiThreads(storedState.aiThreads);
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
      aiThreads
    });
  }, [aiThreads, hasHydrated, importedCards, sourceAssets, sourceChunks, sourceImports]);

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
    setAiPrompt("");
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
            <KnowledgeCardView card={card} key={card.id} onSelect={setSelectedCardId} />
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
          messages={selectedThread}
          onAsk={handleAskAi}
          onClose={() => setSelectedCardId(null)}
          onPromptChange={setAiPrompt}
          prompt={aiPrompt}
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
            {latestImport ? formatStatus(latestImport.status) : "Ready"} · {cardCount} generated cards
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
  onSelect
}: {
  card: RankedKnowledgeCard;
  onSelect: (cardId: string) => void;
}) {
  return (
    <article className="knowledge-card">
      <div className="card-topline">
        <span className={`trust-badge ${card.trustState}`}>{formatTrustState(card.trustState)}</span>
        <span>{card.estimatedReadMinutes} min</span>
      </div>

      <h2>{card.title}</h2>
      <p className="summary">{card.summary}</p>

      <div className="takeaway">
        <Sparkles size={18} />
        <span>{card.keyTakeaway}</span>
      </div>

      <div className="concept-list">
        {card.concepts.map((concept) => (
          <span key={concept}>{concept}</span>
        ))}
      </div>

      <footer className="card-footer">
        <div className="source-line">
          <span>{formatCardSource(card)}</span>
          <span>Score {Math.round(card.score)}</span>
        </div>
        <div className="card-actions">
          <button className="icon-button compact" title="Like">
            <Heart size={18} />
          </button>
          <button className="icon-button compact" title="Save">
            <Bookmark size={18} />
          </button>
          <button className="icon-button compact" onClick={() => onSelect(card.id)} title="Ask AI">
            <MessageCircle size={18} />
          </button>
          <button className="icon-button compact" onClick={() => onSelect(card.id)} title="View source">
            <Quote size={18} />
          </button>
          <button className="icon-button compact" onClick={() => onSelect(card.id)} title="Explain">
            <CircleHelp size={18} />
          </button>
        </div>
      </footer>
    </article>
  );
}

function SourceDetailDrawer({
  asset,
  card,
  chunks,
  messages,
  onAsk,
  onClose,
  onPromptChange,
  prompt
}: {
  asset?: SourceAsset;
  card: RankedKnowledgeCard;
  chunks: KnowledgeChunk[];
  messages: AiMessage[];
  onAsk: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onPromptChange: (value: string) => void;
  prompt: string;
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
    `${conceptLine} Your question was: "${prompt}".`
  ].join("\n\n");
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
