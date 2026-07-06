import type { KnowledgeCard, UserSignal } from "../types.js";
import { buildKnowledgeGraph } from "./knowledgeGraph.js";
import {
  buildKnowledgeBoundary,
  classifyConceptZone,
  type KnowledgeBoundaryZone
} from "./knowledgeBoundary.js";
import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  slugConcept,
  type ConceptAliasOptions
} from "./conceptAliases.js";

export type WikilinkKind = "concept" | "card" | "ghost";

export interface Wikilink {
  /** The full matched token, e.g. "[[RAG]]". */
  raw: string;
  /** The target text with surrounding whitespace trimmed, e.g. "RAG". */
  target: string;
  /** Index of the "[[" in the source text. */
  start: number;
  /** Index just past the "]]" in the source text. */
  end: number;
}

export interface ResolvedWikilink {
  kind: WikilinkKind;
  /** Concept: concept slug. Card: card id. Ghost: slug of the raw target. */
  targetId: string;
  /** Concept/card: canonical library spelling. Ghost: the original target text. */
  label: string;
}

export interface Backlink {
  fromPostId: string;
  fromTitle: string;
  snippet: string;
  kind: WikilinkKind;
}

export type LinkedGraphNodeKind = "concept" | "card" | "note" | "ghost";

export interface LinkedGraphNode {
  id: string;
  kind: LinkedGraphNodeKind;
  label: string;
  weight: number;
  /** Only set for concept nodes. */
  zone?: KnowledgeBoundaryZone;
}

export type LinkedGraphEdgeKind = "mentions" | "wikilink";

export interface LinkedGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: LinkedGraphEdgeKind;
}

export interface LinkedKnowledgeGraph {
  nodes: LinkedGraphNode[];
  edges: LinkedGraphEdge[];
}

const WIKILINK_PATTERN = /\[\[([^[\]]+?)\]\]/g;
const SNIPPET_RADIUS = 40;

/**
 * Find every `[[target]]` token in `text`. Unclosed `[[…` and empty `[[]]`
 * targets are ignored. The target is returned trimmed; start/end bracket the
 * whole token so callers can slice a surrounding snippet.
 */
export function parseWikilinks(text: string): Wikilink[] {
  const links: Wikilink[] = [];

  if (!text) {
    return links;
  }

  WIKILINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = WIKILINK_PATTERN.exec(text)) !== null) {
    const target = match[1].trim();

    if (!target) {
      continue;
    }

    links.push({
      raw: match[0],
      target,
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return links;
}

/**
 * Resolve a wikilink target against the library. Precedence: a concept (the
 * union of every card's `concepts`, matched case-insensitively or by equal
 * slug) wins over a card title (exact, case-insensitive); anything unmatched is
 * a ghost link waiting to be filled in.
 */
export function resolveWikilink(target: string, context: { cards: KnowledgeCard[] } & ConceptAliasOptions): ResolvedWikilink {
  const resolver = createConceptAliasResolver([
    ...(context.conceptAliases ?? []),
    ...createAutomaticConceptAliases(context.cards, context.conceptAliases)
  ]);
  const trimmed = target.trim();
  const slug = resolver.slugConcept(trimmed);

  for (const card of context.cards) {
    if (card.kind === "connection_note") {
      continue;
    }

    for (const concept of card.concepts) {
      if (resolver.slugConcept(concept) === slug) {
        return {
          kind: "concept",
          targetId: resolver.slugConcept(concept),
          label: resolver.resolveConcept(concept)
        };
      }
    }
  }

  for (const card of context.cards) {
    if (card.title.toLowerCase() === trimmed.toLowerCase()) {
      return { kind: "card", targetId: card.id, label: card.title };
    }
  }

  return { kind: "ghost", targetId: slug, label: trimmed };
}

/**
 * Index every wikilink authored by the user back to what it points at. Scans a
 * note's own body plus the public `user_comment` blocks on any post. Keyed by
 * `targetId` (concept slug / card id / ghost slug) so a card view can look up
 * both its own id and its concepts.
 */
export function buildBacklinkIndex(cards: KnowledgeCard[], options: ConceptAliasOptions = {}): Map<string, Backlink[]> {
  const index = new Map<string, Backlink[]>();

  const push = (targetId: string, backlink: Backlink) => {
    const existing = index.get(targetId);

    if (!existing) {
      index.set(targetId, [backlink]);
      return;
    }

    // Drop exact duplicates (same source post + same rendered snippet) so a
    // repeated link doesn't stack identical rows.
    if (existing.some((entry) => entry.fromPostId === backlink.fromPostId && entry.snippet === backlink.snippet)) {
      return;
    }

    existing.push(backlink);
  };

  for (const card of cards) {
    if (card.kind === "connection_note") {
      continue;
    }

    for (const text of authoredTexts(card)) {
      for (const link of parseWikilinks(text)) {
        const resolved = resolveWikilink(link.target, { cards, conceptAliases: options.conceptAliases });
        push(resolved.targetId, {
          fromPostId: card.id,
          fromTitle: card.title,
          snippet: extractSnippet(text, link.start, link.end),
          kind: resolved.kind
        });
      }
    }
  }

  return index;
}

/**
 * Assemble the linked knowledge graph: concept hubs (reusing the concept graph's
 * nodes and weights, tinted by knowledge-boundary zone) plus one node per post
 * (card or note) and any ghost targets, connected by `mentions` edges
 * (card → concept it lists) and `wikilink` edges (authored `[[…]]` links).
 * Deterministic: identical input yields identical, stably ordered output.
 */
export function buildLinkedKnowledgeGraph(input: {
  cards: KnowledgeCard[];
  signals: UserSignal[];
} & ConceptAliasOptions): LinkedKnowledgeGraph {
  const { cards, signals } = input;
  const graphCards = cards.filter((card) => card.kind !== "connection_note");
  const conceptGraph = buildKnowledgeGraph(graphCards, signals, { conceptAliases: input.conceptAliases });
  const boundary = buildKnowledgeBoundary({ cards: graphCards, signals, conceptAliases: input.conceptAliases });
  const resolver = createConceptAliasResolver([
    ...(input.conceptAliases ?? []),
    ...createAutomaticConceptAliases(graphCards, input.conceptAliases)
  ]);

  const nodes = new Map<string, LinkedGraphNode>();
  const edges = new Map<string, LinkedGraphEdge>();

  for (const node of conceptGraph.nodes) {
    nodes.set(node.id, {
      id: node.id,
      kind: "concept",
      label: node.label,
      weight: node.weight,
      zone: classifyConceptZone(boundary, node.label, { conceptAliases: input.conceptAliases })
    });
  }

  const conceptNodeIds = new Set(nodes.keys());

  const ensureConceptNode = (targetId: string, label: string) => {
    if (!nodes.has(targetId)) {
      nodes.set(targetId, {
        id: targetId,
        kind: "concept",
        label,
        weight: 0,
        zone: classifyConceptZone(boundary, label, { conceptAliases: input.conceptAliases })
      });
    }
  };

  for (const card of graphCards) {
    const isNote = card.sources[0]?.type === "user_note";
    nodes.set(card.id, {
      id: card.id,
      kind: isNote ? "note" : "card",
      label: card.title,
      weight: 1
    });
  }

  const addEdge = (source: string, target: string, kind: LinkedGraphEdgeKind) => {
    const id = `${kind}:${source}->${target}`;

    if (!edges.has(id)) {
      edges.set(id, { id, source, target, kind });
    }
  };

  // Card → concept "mentions" edges, only to concepts that surfaced as hubs so
  // no edge dangles off a missing node.
  for (const card of graphCards) {
    for (const concept of card.concepts) {
      const slug = resolver.slugConcept(concept);

      if (conceptNodeIds.has(slug)) {
        addEdge(card.id, slug, "mentions");
      }
    }
  }

  // Authored wikilink edges. A concept target absent from the hub set (its cards
  // were never interacted with) still earns a node so the link is visible; a
  // ghost target earns a hollow node.
  for (const card of cards) {
    for (const text of authoredTexts(card)) {
      for (const link of parseWikilinks(text)) {
        const resolved = resolveWikilink(link.target, { cards: graphCards, conceptAliases: input.conceptAliases });

        if (resolved.kind === "concept") {
          ensureConceptNode(resolved.targetId, resolved.label);
        } else if (resolved.kind === "ghost" && !nodes.has(resolved.targetId)) {
          nodes.set(resolved.targetId, {
            id: resolved.targetId,
            kind: "ghost",
            label: resolved.label,
            weight: 0
          });
        }

        addEdge(card.id, resolved.targetId, "wikilink");
      }
    }
  }

  return {
    nodes: [...nodes.values()].sort(compareNodes),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id))
  };
}

const nodeKindRank: Record<LinkedGraphNodeKind, number> = {
  concept: 0,
  note: 1,
  card: 2,
  ghost: 3
};

function compareNodes(left: LinkedGraphNode, right: LinkedGraphNode): number {
  if (nodeKindRank[left.kind] !== nodeKindRank[right.kind]) {
    return nodeKindRank[left.kind] - nodeKindRank[right.kind];
  }

  if (left.weight !== right.weight) {
    return right.weight - left.weight;
  }

  return left.id.localeCompare(right.id);
}

function authoredTexts(card: KnowledgeCard): string[] {
  const texts: string[] = [];

  if (card.sources[0]?.type === "user_note") {
    texts.push(card.summary);
  }

  for (const block of card.thread ?? []) {
    if (block.kind === "user_comment") {
      texts.push(block.body);
    }
  }

  return texts;
}

function extractSnippet(text: string, start: number, end: number): string {
  const pre = start > SNIPPET_RADIUS ? "…" : "";
  const post = end + SNIPPET_RADIUS < text.length ? "…" : "";
  const window = text.slice(Math.max(0, start - SNIPPET_RADIUS), Math.min(text.length, end + SNIPPET_RADIUS));

  return `${pre}${window}${post}`.replace(/\s+/g, " ").trim();
}

export { slugConcept };
