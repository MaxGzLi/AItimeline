import {
  buildKnowledgeGraph,
  createReviewQueue,
  demoCards,
  demoProfile,
  demoSignals,
  rankKnowledgeCards,
  transformMockYouTubeUrl,
  type KnowledgeCard,
  type RankedKnowledgeCard,
  type SourceImport,
  type TransformationStatus,
  type TrustState
} from "@aitimeline/core";
import { useMemo, useState, type FormEvent } from "react";
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
  GitBranch,
  Heart,
  Home,
  Link,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Video,
  XCircle
} from "lucide-react";

const sampleYouTubeUrl = "https://www.youtube.com/watch?v=aitimeline-demo";

const navItems = [
  { label: "Timeline", icon: Home, active: true },
  { label: "Explore", icon: Compass },
  { label: "Graph", icon: GitBranch },
  { label: "Review", icon: Brain },
  { label: "Agents", icon: Bot },
  { label: "Settings", icon: Settings }
];

export function App() {
  const [sourceUrl, setSourceUrl] = useState(sampleYouTubeUrl);
  const [sourceImports, setSourceImports] = useState<SourceImport[]>([]);
  const [importedCards, setImportedCards] = useState<KnowledgeCard[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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
  const graph = useMemo(() => buildKnowledgeGraph(allCards, allSignals), [allCards, allSignals]);
  const reviewQueue = useMemo(
    () => createReviewQueue(allCards, allSignals, new Date("2026-06-08T08:00:00.000Z")),
    [allCards, allSignals]
  );

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
      setSourceImports((imports) => updateImportStatus(imports, pendingImport.id, "ready"));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
    }
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
            <KnowledgeCardView card={card} key={card.id} />
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

function KnowledgeCardView({ card }: { card: RankedKnowledgeCard }) {
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
          <button className="icon-button compact" title="Ask AI">
            <MessageCircle size={18} />
          </button>
          <button className="icon-button compact" title="Explain">
            <CircleHelp size={18} />
          </button>
        </div>
      </footer>
    </article>
  );
}

function mergeCards(newCards: KnowledgeCard[], currentCards: KnowledgeCard[]): KnowledgeCard[] {
  const newCardIds = new Set(newCards.map((card) => card.id));
  return [...newCards, ...currentCards.filter((card) => !newCardIds.has(card.id))];
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

function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
