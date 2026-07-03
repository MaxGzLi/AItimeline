import { askGrounded, type GroundedAnswer } from "../harness/askGrounded.js";
import type { ModelClient } from "../harness/modelRunner.js";
import {
  buildKnowledgeBoundary,
  classifyConceptZone,
  slugConcept,
  type KnowledgeBoundaryView,
  type KnowledgeBoundaryZone
} from "../graph/knowledgeBoundary.js";
import { planDiscoveryQueries } from "../discovery/sourceDiscovery.js";
import type { InteractionSignal, KnowledgePost, SourceRegistry, UserMemory, UserSignal } from "../types.js";

export type AgentTurnIntent = "grounded_qa" | "boundary_probe" | "discovery_proposal";

export type AgentTurnTier = "free" | "standard";

export type AgentTurnActionKind =
  | "discover_sources"
  | "start_series"
  | "continue_deeper"
  | "reframe_simpler"
  | "schedule_review";

export interface AgentTurnAction {
  kind: AgentTurnActionKind;
  label: string;
  concepts: string[];
  queries?: string[];
}

export interface AgentTurnResult {
  question: string;
  intent: AgentTurnIntent;
  tier: AgentTurnTier;
  zone: KnowledgeBoundaryZone;
  matchedConcepts: string[];
  answer: GroundedAnswer | null;
  answerCardId?: string;
  actions: AgentTurnAction[];
  signal?: InteractionSignal;
  notes: string[];
  createdAt: string;
}

export interface ConversationTurnInput {
  question: string;
  postId?: string;
  posts: KnowledgePost[];
  registry: SourceRegistry;
  memory?: UserMemory;
  userSignals?: UserSignal[];
  now?: string | Date;
}

export interface ConversationTurnOptions {
  client?: ModelClient;
  maxDiscoveryQueries?: number;
}

/**
 * Phase A conversation agent: rule-based routing, deterministic boundary
 * placement, grounded answers only. Every turn returns structured artifacts
 * (boundary zone, action proposals, an interaction signal) instead of loose
 * chat text, and never answers from model knowledge when the library has no
 * covering source.
 */
export async function runConversationTurn(
  input: ConversationTurnInput,
  options: ConversationTurnOptions = {}
): Promise<AgentTurnResult> {
  const createdAt = normalizeDate(input.now).toISOString();
  const question = input.question.trim();
  const boundary = buildKnowledgeBoundary({
    cards: input.posts,
    signals: input.userSignals,
    memory: input.memory
  });
  const matchedConcepts = extractConceptsFromQuestion(question, input.posts, input.memory);
  const targetPost = resolveTargetPost(input.posts, input.postId, matchedConcepts);
  const zone = resolveTurnZone(boundary, matchedConcepts);
  const notes: string[] = [];

  let answer: GroundedAnswer | null = null;
  let intent: AgentTurnIntent;
  let tier: AgentTurnTier = "free";

  if (targetPost) {
    answer = await askGrounded({ post: targetPost, registry: input.registry, question }, { client: options.client });
    intent = "grounded_qa";
    tier = answer.runnerKind === "model" ? "standard" : "free";
  } else if (matchedConcepts.length) {
    intent = "boundary_probe";
    notes.push("No imported source covers this question yet, so the agent reports boundary placement instead of answering.");
  } else {
    intent = "discovery_proposal";
    notes.push("This question is outside your knowledge base. The agent proposes discovering sources instead of answering from model memory.");
  }

  const actions = buildActions(zone, matchedConcepts, question, input.memory, options.maxDiscoveryQueries);
  const signal = targetPost ? buildQuestionSignal(targetPost, createdAt) : undefined;

  return {
    question,
    intent,
    tier,
    zone,
    matchedConcepts,
    answer,
    answerCardId: targetPost?.id,
    actions,
    signal,
    notes,
    createdAt
  };
}

function extractConceptsFromQuestion(
  question: string,
  posts: KnowledgePost[],
  memory: UserMemory | undefined
): string[] {
  const loweredQuestion = question.toLowerCase();
  const vocabulary = new Map<string, string>();
  const addTerm = (term: string) => {
    const trimmed = term.trim();
    const slug = slugConcept(trimmed);

    if (trimmed && slug && !vocabulary.has(slug)) {
      vocabulary.set(slug, trimmed);
    }
  };

  for (const post of posts) {
    post.concepts.forEach(addTerm);
  }

  (memory?.knowledge.knownConcepts ?? []).forEach(addTerm);
  (memory?.knowledge.weakConcepts ?? []).forEach(addTerm);
  (memory?.knowledge.savedConcepts ?? []).forEach(addTerm);
  (memory?.profile.interests ?? []).forEach(addTerm);

  return Array.from(vocabulary.values())
    .filter((term) => loweredQuestion.includes(term.toLowerCase()))
    .sort((left, right) => right.length - left.length)
    .slice(0, 5);
}

function resolveTargetPost(
  posts: KnowledgePost[],
  postId: string | undefined,
  matchedConcepts: string[]
): KnowledgePost | undefined {
  if (postId) {
    return posts.find((post) => post.id === postId);
  }

  if (!matchedConcepts.length) {
    return undefined;
  }

  const matchedSlugs = new Set(matchedConcepts.map(slugConcept));
  let best: { post: KnowledgePost; overlap: number } | undefined;

  for (const post of posts) {
    const overlap = post.concepts.filter((concept) => matchedSlugs.has(slugConcept(concept))).length;

    if (!overlap) {
      continue;
    }

    if (
      !best ||
      overlap > best.overlap ||
      (overlap === best.overlap && post.createdAt > best.post.createdAt)
    ) {
      best = { post, overlap };
    }
  }

  return best?.post;
}

function resolveTurnZone(boundary: KnowledgeBoundaryView, matchedConcepts: string[]): KnowledgeBoundaryZone {
  if (!matchedConcepts.length) {
    return "dark";
  }

  const zones = matchedConcepts.map((concept) => classifyConceptZone(boundary, concept));

  // The expansion opportunity dominates: a question touching the frontier is a
  // frontier question even when it also mentions mastered concepts.
  if (zones.includes("frontier")) {
    return "frontier";
  }

  if (zones.includes("learning")) {
    return "learning";
  }

  if (zones.includes("inside")) {
    return "inside";
  }

  return "dark";
}

function buildActions(
  zone: KnowledgeBoundaryZone,
  matchedConcepts: string[],
  question: string,
  memory: UserMemory | undefined,
  maxDiscoveryQueries?: number
): AgentTurnAction[] {
  if (zone === "inside") {
    return [
      {
        kind: "schedule_review",
        label: "Test yourself on this concept",
        concepts: matchedConcepts
      }
    ];
  }

  if (zone === "learning") {
    return [
      { kind: "continue_deeper", label: "Go deeper on this", concepts: matchedConcepts },
      { kind: "reframe_simpler", label: "Explain it more simply", concepts: matchedConcepts }
    ];
  }

  if (zone === "frontier") {
    return [
      { kind: "start_series", label: "Start a learning series", concepts: matchedConcepts },
      {
        kind: "discover_sources",
        label: "Find sources on this",
        concepts: matchedConcepts,
        queries: planDiscoveryQueries({
          concepts: matchedConcepts,
          nextAction: "expand_broader",
          goals: memory?.profile.goals,
          maxQueries: maxDiscoveryQueries
        })
      }
    ];
  }

  return [
    {
      kind: "discover_sources",
      label: "Find sources for this question",
      concepts: matchedConcepts,
      queries: [question.slice(0, 120)]
    }
  ];
}

function buildQuestionSignal(post: KnowledgePost, createdAt: string): InteractionSignal {
  return {
    postId: post.id,
    topicId: slugConcept(post.concepts[0] ?? post.id),
    conceptIds: post.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: true,
    reviewed: false,
    skippedQuickly: false,
    createdAt
  };
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}
