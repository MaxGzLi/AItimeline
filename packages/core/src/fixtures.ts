import { createExpansionPlan } from "./harness/expansionPolicy";
import { evaluateInteraction } from "./harness/feedbackPolicy";
import type { InteractionSignal, KnowledgeCard, TopicState, UserProfile, UserSignal } from "./types";

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
    hook: "Most agent memory failures are not caused by forgetting. They are caused by mixing the wrong memories together.",
    thesis:
      "A durable agent should separate task memory, user memory, and world memory so retrieval can stay precise instead of dumping stale context into every run.",
    shortBody:
      "A durable agent should not store every interaction in one memory bucket. Separating task memory, user preferences, and external world facts makes retrieval cleaner and reduces stale context.",
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
    estimatedReadMinutes: 4,
    difficulty: "intermediate",
    confidence: "medium",
    harnessVersion: "harness-v0",
    thread: [
      {
        id: "agent-memory-layers-thread-example",
        kind: "example",
        title: "Example",
        body: "A shopping assistant should remember your size as user memory, the current checkout as task memory, and shipping policy as world memory."
      },
      {
        id: "agent-memory-layers-thread-contrast",
        kind: "contrast",
        title: "What goes wrong",
        body: "If all memory is retrieved together, the agent may treat an old task note as a current user preference."
      },
      {
        id: "agent-memory-layers-thread-extension",
        kind: "extension",
        title: "Where to go next",
        body: "The next layer is evaluation: testing whether memory improves outcomes instead of just increasing context length."
      }
    ],
    graphEdges: [
      {
        id: "agent-memory-layers-edge",
        sourceConcept: "AI Agent",
        relation: "requires",
        targetConcept: "Memory",
        evidence: "Durable agents need separated memory layers.",
        weight: 0.84
      }
    ],
    reviewPrompts: [
      {
        id: "agent-memory-layers-review",
        kind: "compare",
        prompt: "What is the difference between task memory and user memory?",
        answerHint: "Task memory is about the current job; user memory is about durable preferences.",
        dueInDays: 2
      }
    ],
    nextActions: ["continue_deeper", "schedule_review"]
  },
  {
    id: "rag-evaluation-loop",
    title: "RAG systems need eval sets before they need another retrieval trick",
    hook: "The fastest way to improve RAG is often not better chunking. It is knowing what failure looks like.",
    thesis:
      "A RAG system should build representative questions, expected citations, and failure labels before optimizing retrieval tactics.",
    shortBody:
      "Most RAG failures come from missing measurement. A small set of representative questions, expected citations, and failure labels can improve iteration speed more than another chunking tweak.",
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
    estimatedReadMinutes: 5,
    difficulty: "intermediate",
    confidence: "medium",
    harnessVersion: "harness-v0",
    thread: [
      {
        id: "rag-evaluation-loop-thread-example",
        kind: "example",
        title: "Example",
        body: "Create 30 real questions, list the expected source paragraphs, then track whether answers cite the right evidence."
      },
      {
        id: "rag-evaluation-loop-thread-contrast",
        kind: "contrast",
        title: "Common mistake",
        body: "Teams often tweak embeddings, chunk size, and reranking before they know which user questions are failing."
      },
      {
        id: "rag-evaluation-loop-thread-extension",
        kind: "extension",
        title: "Where to go next",
        body: "After evals exist, ranking can prioritize posts that explain the user's repeated failure categories."
      }
    ],
    graphEdges: [
      {
        id: "rag-evaluation-loop-edge",
        sourceConcept: "RAG",
        relation: "evaluates",
        targetConcept: "Evaluation",
        evidence: "RAG improvement depends on representative eval sets.",
        weight: 0.9
      }
    ],
    reviewPrompts: [
      {
        id: "rag-evaluation-loop-review",
        kind: "apply",
        prompt: "Design one eval question for a RAG system and name the expected citation.",
        answerHint: "The question should map to a known source passage and measurable answer.",
        dueInDays: 1
      }
    ],
    nextActions: ["continue_deeper", "schedule_review"]
  },
  {
    id: "knowledge-feed-product-loop",
    title: "A knowledge feed becomes defensible when every interaction improves the next card",
    hook: "The moat is not the feed. The moat is what the feed learns from every useful interaction.",
    thesis:
      "A knowledge timeline becomes defensible when likes, saves, questions, skips, and reviews change what the agent generates next.",
    shortBody:
      "The product loop is not feed consumption. It is signal capture: likes, saves, questions, and reviews become the user's learning graph, which then changes ranking and explanation style.",
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
    estimatedReadMinutes: 3,
    difficulty: "beginner",
    confidence: "medium",
    harnessVersion: "harness-v0",
    thread: [
      {
        id: "knowledge-feed-product-loop-thread-example",
        kind: "example",
        title: "Example",
        body: "If a user saves Agent Memory and skips three RAG posts, the next agent run should deepen memory and cool down RAG."
      },
      {
        id: "knowledge-feed-product-loop-thread-contrast",
        kind: "contrast",
        title: "Not a normal feed",
        body: "A normal feed optimizes attention. A learning feed optimizes productive attention plus durable recall."
      },
      {
        id: "knowledge-feed-product-loop-thread-extension",
        kind: "extension",
        title: "Where to go next",
        body: "Turn each signal into a next-action policy: deeper, broader, simpler, review, or cool down."
      }
    ],
    graphEdges: [
      {
        id: "knowledge-feed-product-loop-edge",
        sourceConcept: "Product Strategy",
        relation: "applies",
        targetConcept: "Knowledge Graph",
        evidence: "User interactions become graph and ranking signals.",
        weight: 0.78
      }
    ],
    reviewPrompts: [
      {
        id: "knowledge-feed-product-loop-review",
        kind: "explain",
        prompt: "Why is interaction feedback more defensible than static summaries?",
        answerHint: "Because each interaction updates future generation, ranking, graph, and review.",
        dueInDays: 2
      }
    ],
    nextActions: ["expand_broader", "schedule_review"]
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

export const demoInteractionSignals: InteractionSignal[] = [
  {
    postId: "agent-memory-layers",
    topicId: "ai-agent",
    conceptIds: ["AI Agent", "Memory", "Evaluation"],
    impression: true,
    dwellTimeMs: 11800,
    openedThread: true,
    liked: false,
    saved: true,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-06-08T05:00:00.000Z"
  },
  {
    postId: "rag-evaluation-loop",
    topicId: "rag",
    conceptIds: ["RAG", "Evaluation", "Vector Search"],
    impression: true,
    dwellTimeMs: 14200,
    openedThread: true,
    liked: true,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-06-08T05:05:00.000Z"
  },
  {
    postId: "knowledge-feed-product-loop",
    topicId: "product-strategy",
    conceptIds: ["Product Strategy", "Knowledge Graph", "Personalization"],
    impression: true,
    dwellTimeMs: 700,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: true,
    createdAt: "2026-06-08T05:10:00.000Z"
  }
];

export const demoTopicStates: TopicState[] = [
  {
    topicId: "ai-agent",
    interestScore: 0.78,
    fatigueScore: 0.08,
    comprehensionScore: 0.58
  },
  {
    topicId: "rag",
    interestScore: 0.86,
    fatigueScore: 0.05,
    comprehensionScore: 0.76
  },
  {
    topicId: "product-strategy",
    interestScore: 0.42,
    fatigueScore: 0.82,
    comprehensionScore: 0.64
  }
];

export const demoLearningFeedback = demoInteractionSignals.map((signal) =>
  evaluateInteraction(
    signal,
    demoTopicStates.find((topicState) => topicState.topicId === signal.topicId) ?? {
      topicId: signal.topicId,
      interestScore: 0,
      fatigueScore: 0,
      comprehensionScore: 0
    }
  )
);

export const demoExpansionPlan = createExpansionPlan({
  signals: demoInteractionSignals,
  feedback: demoLearningFeedback,
  topicStates: demoTopicStates,
  generatedAt: "2026-06-08T06:00:00.000Z"
});
