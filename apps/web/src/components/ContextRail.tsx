import type { KnowledgeBoundaryView, KnowledgeGraph, ReviewItem } from "@aitimeline/core";
import { Search } from "lucide-react";
import { formatDueDate } from "../lib/format";

// Right rail = learning state only (review due, knowledge boundary, concepts),
// mirroring X's "what's happening" column.
export function ContextRail({
  boundary,
  graph,
  onOpenConcept,
  onOpenGraph,
  onOpenReview,
  onSearchChange,
  reviewQueue,
  searchQuery
}: {
  boundary: KnowledgeBoundaryView;
  graph: KnowledgeGraph;
  onOpenConcept: (concept: string) => void;
  onOpenGraph: () => void;
  onOpenReview: () => void;
  onSearchChange: (value: string) => void;
  reviewQueue: ReviewItem[];
  searchQuery: string;
}) {
  const zoneTotal = Math.max(1, boundary.inside.length + boundary.learning.length + boundary.frontier.length);

  return (
    <aside className="x-rail" aria-label="学习状态">
      <div className="x-search">
        <Search size={17} />
        <input
          aria-label="搜索时间线"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索你的知识库"
          value={searchQuery}
        />
      </div>

      <section className="x-module" aria-label="今日复习">
        <h2 className="x-module-head">今日复习</h2>
        {reviewQueue.length === 0 ? <p className="x-mrnote">暂时没有到期的复习。</p> : null}
        {reviewQueue.slice(0, 3).map((item) => (
          <button
            className="x-mrow"
            key={`${item.cardId}-${item.concept}`}
            onClick={onOpenReview}
            type="button"
          >
            <span className="x-mmain">
              <p className="x-mmeta">{formatDueDate(item.dueAt)} 到期 · 间隔 {item.intervalDays} 天</p>
              <p className="x-mname">{item.concept}</p>
            </span>
          </button>
        ))}
        {reviewQueue.length > 0 ? (
          <button className="x-mmore" onClick={onOpenReview} type="button">
            开始复习（{reviewQueue.length}）
          </button>
        ) : null}
      </section>

      <section className="x-module" aria-label="知识边界">
        <h2 className="x-module-head">知识边界</h2>
        <div className="x-bar" aria-hidden="true">
          <span style={{ background: "var(--x-blue)", width: `${(boundary.inside.length / zoneTotal) * 100}%` }} />
          <span style={{ background: "var(--x-repost)", width: `${(boundary.learning.length / zoneTotal) * 100}%` }} />
          <span style={{ background: "var(--x-warn)", width: `${(boundary.frontier.length / zoneTotal) * 100}%` }} />
        </div>
        <button className="x-mrow" onClick={onOpenGraph} type="button">
          <span className="x-mmain">
            <p className="x-mname">已掌握</p>
            <p className="x-msub">互动多、复习过的概念</p>
          </span>
          <span className="x-mnum">{boundary.inside.length}</span>
        </button>
        <button className="x-mrow" onClick={onOpenGraph} type="button">
          <span className="x-mmain">
            <p className="x-mname">学习区</p>
            <p className="x-msub">正在建立理解</p>
          </span>
          <span className="x-mnum">{boundary.learning.length}</span>
        </button>
        <button className="x-mrow" onClick={onOpenGraph} type="button">
          <span className="x-mmain">
            <p className="x-mname">前沿区</p>
            <p className="x-msub">刚接触的新概念</p>
          </span>
          <span className="x-mnum">{boundary.frontier.length}</span>
        </button>
      </section>

      <section className="x-module" aria-label="沉淀的概念">
        <h2 className="x-module-head">沉淀的概念</h2>
        {graph.nodes.slice(0, 5).map((node) => (
          <button className="x-mrow" key={node.id} onClick={() => onOpenConcept(node.label)} type="button">
            <span className="x-mmain">
              <p className="x-mmeta">概念</p>
              <p className="x-mname">#{node.label.replace(/\s+/g, "")}</p>
            </span>
            <span className="x-mnum">{node.weight}</span>
          </button>
        ))}
        <button className="x-mmore" onClick={onOpenGraph} type="button">
          查看知识图谱
        </button>
      </section>

      <p className="x-raillinks">
        <span>AITimeline</span>
        <span>·</span>
        <span>所有回答都有出处</span>
        <span>·</span>
        <span>本地优先</span>
      </p>
    </aside>
  );
}
