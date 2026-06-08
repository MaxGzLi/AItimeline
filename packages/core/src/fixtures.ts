import type { KnowledgeCard, UserProfile, UserSignal } from "./types";

export const demoProfile: UserProfile = {
  interests: ["AI Agent", "RAG", "Product Strategy"],
  knownConcepts: ["LLM", "Prompting", "Vector Search"],
  savedConcepts: ["AI Agent", "Knowledge Graph"],
  weakConcepts: ["Evaluation", "RAG"]
};

export const demoCards: KnowledgeCard[] = [
  {
    id: "agent-memory-layers",
    title: "Agent memory works better when split into task, user, and world layers",
    summary:
      "A durable agent should not store every interaction in one memory bucket. Separating task memory, user preferences, and external world facts makes retrieval cleaner and reduces stale context.",
    keyTakeaway: "Memory quality is more important than memory volume.",
    concepts: ["AI Agent", "Memory", "Evaluation"],
    sources: [
      {
        id: "source-agent-memory",
        title: "Agent memory architecture notes",
        url: "https://example.com/agent-memory",
        type: "blog",
        author: "Research Notes"
      }
    ],
    recommendedBecause: "You saved agent workflow content and still have weak signals around evaluation.",
    trustState: "supported",
    createdAt: "2026-06-08T01:00:00.000Z",
    estimatedReadMinutes: 4
  },
  {
    id: "rag-evaluation-loop",
    title: "RAG systems need eval sets before they need another retrieval trick",
    summary:
      "Most RAG failures come from missing measurement. A small set of representative questions, expected citations, and failure labels can improve iteration speed more than another chunking tweak.",
    keyTakeaway: "Build the eval loop before optimizing retrieval.",
    concepts: ["RAG", "Evaluation", "Vector Search"],
    sources: [
      {
        id: "source-rag-evals",
        title: "RAG evaluation field guide",
        url: "https://example.com/rag-evals",
        type: "paper"
      }
    ],
    recommendedBecause: "RAG is in your interest list and evaluation is currently a weak concept.",
    trustState: "supported",
    createdAt: "2026-06-08T02:30:00.000Z",
    estimatedReadMinutes: 5
  },
  {
    id: "knowledge-feed-product-loop",
    title: "A knowledge feed becomes defensible when every interaction improves the next card",
    summary:
      "The product loop is not feed consumption. It is signal capture: likes, saves, questions, and reviews become the user's learning graph, which then changes ranking and explanation style.",
    keyTakeaway: "The moat is the user's accumulated learning graph.",
    concepts: ["Product Strategy", "Knowledge Graph", "Personalization"],
    sources: [
      {
        id: "source-product-loop",
        title: "Personal knowledge products memo",
        url: "https://example.com/knowledge-loop",
        type: "manual"
      }
    ],
    recommendedBecause: "You are shaping an open-core knowledge product and need a tight retention loop.",
    trustState: "emerging",
    createdAt: "2026-06-08T03:15:00.000Z",
    estimatedReadMinutes: 3
  }
];

export const demoSignals: UserSignal[] = [
  {
    id: "signal-1",
    cardId: "agent-memory-layers",
    type: "like",
    createdAt: "2026-06-08T04:00:00.000Z"
  },
  {
    id: "signal-2",
    cardId: "knowledge-feed-product-loop",
    type: "ask",
    prompt: "How does this become a paid app?",
    createdAt: "2026-06-08T04:05:00.000Z"
  },
  {
    id: "signal-3",
    cardId: "rag-evaluation-loop",
    type: "save",
    createdAt: "2026-06-08T04:10:00.000Z"
  }
];

