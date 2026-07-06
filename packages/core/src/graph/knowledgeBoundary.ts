import type { KnowledgeCard, UserMemory, UserSignal } from "../types.js";
import { createAutomaticConceptAliases, createConceptAliasResolver, type ConceptAliasOptions } from "./conceptAliases.js";

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

export interface BuildKnowledgeBoundaryInput extends ConceptAliasOptions {
  cards: KnowledgeCard[];
  signals?: UserSignal[];
  memory?: UserMemory;
}

/**
 * Deterministic view of the user's knowledge boundary. No model involved:
 * inside > learning > frontier precedence, dark = absent from the view.
 */
export function buildKnowledgeBoundary(input: BuildKnowledgeBoundaryInput): KnowledgeBoundaryView {
  const resolver = createConceptAliasResolver([
    ...(input.conceptAliases ?? []),
    ...createAutomaticConceptAliases(input.cards, input.conceptAliases)
  ]);
  const zoneByConcept: Record<string, Exclude<KnowledgeBoundaryZone, "dark">> = {};
  const labels = new Map<string, string>();
  const assign = (concept: string, zone: Exclude<KnowledgeBoundaryZone, "dark">) => {
    const label = resolver.resolveConcept(concept);
    const slug = resolver.slugConcept(label);

    if (!slug) {
      return;
    }

    if (!labels.has(slug)) {
      labels.set(slug, label);
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
    if (card.kind === "connection_note") {
      continue;
    }

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

export function classifyConceptZone(
  view: KnowledgeBoundaryView,
  concept: string,
  options: ConceptAliasOptions = {}
): KnowledgeBoundaryZone {
  const resolver = createConceptAliasResolver(options.conceptAliases);

  return view.zoneByConcept[resolver.slugConcept(concept)] ?? "dark";
}

const zonePriority: Record<Exclude<KnowledgeBoundaryZone, "dark">, number> = {
  inside: 3,
  learning: 2,
  frontier: 1
};
