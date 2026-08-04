import { askGrounded, type GroundedAnswer } from "../harness/askGrounded.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import type { ModelClient } from "../harness/modelRunner.js";
import {
  buildKnowledgeBoundary,
  classifyConceptZone,
  type KnowledgeBoundaryView,
  type KnowledgeBoundaryZone
} from "../graph/knowledgeBoundary.js";
import { createConceptAliasResolver, slugConcept, type ConceptAliasResolver } from "../graph/conceptAliases.js";
import { buildConceptSurfaceForms, textMentionsSurfaceForm } from "../graph/conceptSurfaceForms.js";
import { planDiscoveryQueries } from "../discovery/sourceDiscovery.js";
import type {
  ConceptAliasRecord,
  InteractionSignal,
  KnowledgePost,
  SourceRegistry,
  UserMemory,
  UserSignal
} from "../types.js";
import type { AgentTurnRecord } from "../storage/persistenceStore.js";

export type AgentTurnIntent = "grounded_qa" | "boundary_probe" | "discovery_proposal" | "idea_observation";

export type AgentTurnTier = "free" | "standard";

export type AgentTurnActionKind =
  | "confirm_discovery"
  | "idea_probe"
  | "research_idea"
  | "discover_sources"
  | "start_series"
  | "continue_deeper"
  | "reframe_simpler"
  | "schedule_review";

export interface AgentTurnConfirmationOption {
  id: string;
  label: string;
  queryModifier?: string;
  importLimit?: number;
}

export interface AgentTurnConfirmationQuestion {
  id: string;
  label: string;
  options: AgentTurnConfirmationOption[];
}

export interface AgentTurnAction {
  kind: AgentTurnActionKind;
  label: string;
  concepts: string[];
  question?: string;
  queries?: string[];
  questions?: AgentTurnConfirmationQuestion[];
}

export interface AgentNearestPost {
  postId: string;
  title: string;
  overlapScore: number;
}

export interface AgentTurnResult {
  question: string;
  intent: AgentTurnIntent;
  tier: AgentTurnTier;
  zone: KnowledgeBoundaryZone;
  matchedConcepts: string[];
  answer: GroundedAnswer | null;
  answerCardId?: string;
  nearestPosts: AgentNearestPost[];
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
  previousTurns?: AgentTurnRecord[];
  conceptAliases?: ConceptAliasRecord[];
  now?: string | Date;
}

export interface ConversationTurnOptions {
  client?: ModelClient;
  contentLanguage?: ContentLanguage;
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
    memory: input.memory,
    conceptAliases: input.conceptAliases
  });
  const matchedConcepts = extractConceptsFromQuestion(question, input.posts, input.memory, input.conceptAliases);
  const targetPost = resolveTargetPost(input.posts, input.postId, matchedConcepts);
  const zone = resolveTurnZone(boundary, matchedConcepts, input.conceptAliases);
  const nearestPosts = zone === "dark" ? findNearestPosts(question, input.posts) : [];
  const notes: string[] = [];
  const contentLanguage = options.contentLanguage ?? "zh";

  let answer: GroundedAnswer | null = null;
  let intent: AgentTurnIntent;
  let tier: AgentTurnTier = "free";

  if (targetPost) {
    const groundedQuestion =
      options.client && input.previousTurns?.length
        ? buildQuestionWithPreviousTurns(question, input.previousTurns, contentLanguage)
        : question;
    answer = await askGrounded(
      { post: targetPost, registry: input.registry, question: groundedQuestion },
      { client: options.client, contentLanguage }
    );
    intent = "grounded_qa";
    tier = answer.runnerKind === "model" ? "standard" : "free";
  } else if (matchedConcepts.length) {
    intent = "boundary_probe";
    notes.push(
      contentLanguage === "en"
        ? "No imported source covers this question yet, so I will place it on your knowledge boundary instead of answering directly."
        : "目前还没有导入的来源覆盖这个问题,所以先告诉你它落在你知识边界的什么位置,而不是直接回答。"
    );
  } else {
    intent = "discovery_proposal";
    notes.push(
      contentLanguage === "en"
        ? "This question is outside your library. I will not answer from model memory; I recommend finding relevant sources first."
        : "这个问题在你的知识库之外。我不会凭模型记忆作答,而是建议先去找相关来源。"
    );
  }

  const actions = buildActions(zone, matchedConcepts, question, input.memory, options.maxDiscoveryQueries, contentLanguage);
  const signal = targetPost ? buildQuestionSignal(targetPost, createdAt) : undefined;

  return {
    question,
    intent,
    tier,
    zone,
    matchedConcepts,
    answer,
    answerCardId: targetPost?.id,
    nearestPosts,
    actions,
    signal,
    notes,
    createdAt
  };
}

function extractConceptsFromQuestion(
  question: string,
  posts: KnowledgePost[],
  memory: UserMemory | undefined,
  conceptAliases: ConceptAliasRecord[] | undefined
): string[] {
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

  const resolver = createConceptAliasResolver(conceptAliases ?? []);
  const labelsByCanonicalSlug = collectAliasLabels(conceptAliases, resolver);

  return Array.from(vocabulary.values())
    .filter((term) =>
      collectSurfaceForms(term, labelsByCanonicalSlug.get(resolver.slugConcept(term))).some((form) =>
        textMentionsSurfaceForm(question, form)
      )
    )
    .sort((left, right) => right.length - left.length)
    .slice(0, 5);
}

/**
 * Every way this concept can legitimately be written: its own name, whatever
 * the user merged into it, and the abbreviations / Chinese wordings derived
 * from each. The concept string itself is never rewritten — only recognised.
 */
function collectSurfaceForms(term: string, aliasLabels: string[] | undefined): string[] {
  const forms = new Set<string>();

  for (const label of [term, ...(aliasLabels ?? [])]) {
    forms.add(label);

    for (const derived of buildConceptSurfaceForms(label)) {
      forms.add(derived);
    }
  }

  return Array.from(forms);
}

function collectAliasLabels(
  conceptAliases: ConceptAliasRecord[] | undefined,
  resolver: ConceptAliasResolver
): Map<string, string[]> {
  const labelsByCanonicalSlug = new Map<string, string[]>();

  for (const record of conceptAliases ?? []) {
    const slug = resolver.slugConcept(record.canonical);

    if (!slug) {
      continue;
    }

    labelsByCanonicalSlug.set(slug, [
      ...(labelsByCanonicalSlug.get(slug) ?? []),
      record.canonical,
      ...record.aliases
    ]);
  }

  return labelsByCanonicalSlug;
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

function resolveTurnZone(
  boundary: KnowledgeBoundaryView,
  matchedConcepts: string[],
  conceptAliases: ConceptAliasRecord[] | undefined
): KnowledgeBoundaryZone {
  if (!matchedConcepts.length) {
    return "dark";
  }

  // The boundary view keys zones by resolved concept, so classification has to
  // resolve through the same alias records or every merged concept reads dark.
  const zones = matchedConcepts.map((concept) => classifyConceptZone(boundary, concept, { conceptAliases }));

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
  maxDiscoveryQueries: number | undefined,
  contentLanguage: ContentLanguage
): AgentTurnAction[] {
  if (zone === "inside") {
    return [
      {
        kind: "schedule_review",
        label: contentLanguage === "en" ? "Quiz this concept" : "测测这个概念",
        concepts: matchedConcepts
      }
    ];
  }

  if (zone === "learning") {
    return [
      {
        kind: "continue_deeper",
        label: contentLanguage === "en" ? "Go deeper" : "深入了解一下",
        concepts: matchedConcepts
      },
      {
        kind: "reframe_simpler",
        label: contentLanguage === "en" ? "Explain more simply" : "换个更简单的说法",
        concepts: matchedConcepts
      }
    ];
  }

  if (zone === "frontier") {
    return [
      {
        kind: "start_series",
        label: contentLanguage === "en" ? "Start a learning series" : "开一个学习系列",
        concepts: matchedConcepts
      },
      {
        kind: "discover_sources",
        label: contentLanguage === "en" ? "Find related sources" : "找找相关来源",
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
      kind: "confirm_discovery",
      label: contentLanguage === "en" ? "Confirm research scope" : "确认研究范围",
      concepts: matchedConcepts,
      queries: [question.slice(0, 120)],
      questions: buildDiscoveryConfirmationQuestions(contentLanguage)
    },
    {
      kind: "discover_sources",
      label: contentLanguage === "en" ? "Find sources for this question" : "为这个问题找来源",
      concepts: matchedConcepts,
      queries: [question.slice(0, 120)]
    }
  ];
}

export function buildDiscoveryConfirmationQuestions(contentLanguage: ContentLanguage): AgentTurnConfirmationQuestion[] {
  if (contentLanguage === "en") {
    return [
      {
        id: "focus",
        label: "What do you want?",
        options: [
          { id: "definition", label: "Definition and principles", queryModifier: "definition principles" },
          { id: "latest", label: "Latest developments", queryModifier: "latest research developments" },
          { id: "comparison", label: "Compare with my library", queryModifier: "comparison with known concepts" }
        ]
      },
      {
        id: "depth",
        label: "How deep?",
        options: [
          { id: "quick", label: "Quick answer (2 sources)", queryModifier: "concise overview", importLimit: 2 },
          { id: "deep", label: "Deep read (4 sources)", queryModifier: "deep dive analysis", importLimit: 4 }
        ]
      }
    ];
  }

  return [
    {
      id: "focus",
      label: "你想要哪种?",
      options: [
        { id: "definition", label: "定义与原理", queryModifier: "定义 原理" },
        { id: "latest", label: "最新进展", queryModifier: "最新进展 研究" },
        { id: "comparison", label: "与我已知的对比", queryModifier: "与已知概念对比" }
      ]
    },
    {
      id: "depth",
      label: "查多深?",
      options: [
        { id: "quick", label: "快速回答(导 2 篇)", queryModifier: "快速综述", importLimit: 2 },
        { id: "deep", label: "深入研读(导 4 篇)", queryModifier: "深入分析", importLimit: 4 }
      ]
    }
  ];
}

function findNearestPosts(question: string, posts: KnowledgePost[]): AgentNearestPost[] {
  const questionTokens = tokenize(question);

  if (!questionTokens.size) {
    return [];
  }

  return posts
    .map((post) => {
      const haystack = [
        post.title,
        post.summary,
        post.keyTakeaway,
        post.concepts.join(" "),
        post.sources.map((source) => source.title).join(" ")
      ].join(" ");
      const postTokens = tokenize(haystack);
      const overlap = Array.from(questionTokens).filter((token) => postTokens.has(token)).length;
      const score = overlap / Math.max(1, questionTokens.size);

      return { postId: post.id, title: post.title, overlapScore: Math.round(score * 100) / 100 };
    })
    .filter((item) => item.overlapScore > 0)
    .sort((left, right) => right.overlapScore - left.overlapScore || left.title.localeCompare(right.title))
    .slice(0, 2);
}

function buildQuestionWithPreviousTurns(
  question: string,
  previousTurns: AgentTurnRecord[],
  contentLanguage: ContentLanguage
): string {
  const turns = previousTurns.slice(-5);

  if (!turns.length) {
    return question;
  }

  const history = turns
    .map((turn, index) => `${index + 1}. ${turn.question} (${turn.status ?? "answered"})`)
    .join("\n");
  const label = contentLanguage === "en" ? "Recent turns in this thread" : "同一线程最近轮次";

  return `${label}:\n${history}\n\nCurrent question: ${question}`;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );
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
