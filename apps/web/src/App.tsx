import {
  buildKnowledgeGraph,
  createReviewQueue,
  demoCards,
  demoProfile,
  demoSignals,
  rankKnowledgeCards,
  type KnowledgeCard,
  type TrustState
} from "@aitimeline/core";
import {
  Bell,
  Bookmark,
  Bot,
  Brain,
  CircleHelp,
  Compass,
  GitBranch,
  Heart,
  Home,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  Sparkles
} from "lucide-react";

const rankedCards = rankKnowledgeCards(demoCards, demoProfile);
const graph = buildKnowledgeGraph(demoCards, demoSignals);
const reviewQueue = createReviewQueue(demoCards, demoSignals, new Date("2026-06-08T08:00:00.000Z"));

const navItems = [
  { label: "Timeline", icon: Home, active: true },
  { label: "Explore", icon: Compass },
  { label: "Graph", icon: GitBranch },
  { label: "Review", icon: Brain },
  { label: "Agents", icon: Bot },
  { label: "Settings", icon: Settings }
];

export function App() {
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

function KnowledgeCardView({ card }: { card: KnowledgeCard & { score: number; scoreReasons: string[] } }) {
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
          <span>{card.sources[0]?.title}</span>
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

function formatTrustState(state: TrustState): string {
  const labels: Record<TrustState, string> = {
    emerging: "Emerging",
    supported: "Supported",
    contested: "Contested"
  };
  return labels[state];
}

function formatDueDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

