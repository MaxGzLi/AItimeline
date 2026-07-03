import type { KnowledgeCard, UserMemory, UserSignal } from "../types.js";

export type KnowledgeBoundaryZone = "inside" | "learning" | "frontier" | "dark";

export interface KnowledgeBoundaryView {
  /** Concepts the user has mastered (memory.knowledge.knownConcepts). */
  inside: string[];
  /** Concepts with active learning signals: weak, saved, or interacted-with. */
  learning: string[];
  /** Concepts present in the library but not yet touched by the user. */
  frontier: string[];
  zoneByConcept: Record<string, Exclude<KnowledgeBoundaryZone, "dark">>;
}

export interface BuildKnowledgeBoundaryInput {
  cards: KnowledgeCard[];
  signals?: UserSignal[];
  memory?: UserMemory;
}

/**
 * Deterministic view of the user's knowledge boundary. No model involved:
 * inside > learning > frontier precedence, dark = absent from the view.
 */
export function buildKnowledgeBoundary(input: BuildKnowledgeBoundaryInput): KnowledgeBoundaryView {
  const zoneByConcept: Record<string, Exclude<KnowledgeBoundaryZone, "dark">> = {};
  const labels = new Map<string, string>();
  const assign = (concept: string, zone: Exclude<KnowledgeBoundaryZone, "dark">) => {
    const slug = slugConcept(concept);

    if (!slug) {
      return;
    }

    if (!labels.has(slug)) {
      labels.set(slug, concept.trim());
    }

    const current = zoneByConcept[slug];

    if (!current || zonePriority[zone] > zonePriority[current]) {
      zoneByConcept[slug] = zone;
    }
  };

  const activeCardIds = new Set(
    (input.signals ?? [])
      .filter((signal) => signal.type === "like" || signal.type === "save" || signal.type === "ask" || signal.type === "review")
      .map((signal) => signal.cardId)
  );

  for (const card of input.cards) {
    for (const concept of card.concepts) {
      assign(concept, activeCardIds.has(card.id) ? "learning" : "frontier");
    }
  }

  for (const concept of input.memory?.knowledge.weakConcepts ?? []) {
    assign(concept, "learning");
  }

  for (const concept of input.memory?.knowledge.savedConcepts ?? []) {
    assign(concept, "learning");
  }

  for (const concept of input.memory?.knowledge.knownConcepts ?? []) {
    assign(concept, "inside");
  }

  const view: KnowledgeBoundaryView = { inside: [], learning: [], frontier: [], zoneByConcept };

  for (const [slug, zone] of Object.entries(zoneByConcept)) {
    view[zone].push(labels.get(slug) ?? slug);
  }

  view.inside.sort();
  view.learning.sort();
  view.frontier.sort();

  return view;
}

export function classifyConceptZone(view: KnowledgeBoundaryView, concept: string): KnowledgeBoundaryZone {
  return view.zoneByConcept[slugConcept(concept)] ?? "dark";
}

const zonePriority: Record<Exclude<KnowledgeBoundaryZone, "dark">, number> = {
  inside: 3,
  learning: 2,
  frontier: 1
};

export function slugConcept(concept: string): string {
  return concept.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
