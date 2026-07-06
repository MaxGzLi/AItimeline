import type { ContentLanguage } from "../harness/contentLanguage.js";
import type { ModelClient } from "../harness/modelRunner.js";
import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  type ConceptAliasOptions
} from "../graph/conceptAliases.js";
import type { KnowledgePost } from "../types.js";
import type {
  AgentNearestPost,
  AgentTurnAction,
  AgentTurnResult
} from "./conversationAgent.js";

export interface IdeaRelatedPost extends AgentNearestPost {
  concepts: string[];
  sourceId?: string;
  sourceTitle?: string;
  sourceUrl?: string;
}

export interface IdeaObservationInput extends ConceptAliasOptions {
  idea: string;
  posts: KnowledgePost[];
  now?: string | Date;
}

export interface IdeaObservationOptions {
  client?: ModelClient;
  contentLanguage?: ContentLanguage;
}

interface IdeaModelPlan {
  probes: string[];
  researchQuestions: string[];
}

export async function runIdeaObservation(
  input: IdeaObservationInput,
  options: IdeaObservationOptions = {}
): Promise<AgentTurnResult> {
  const contentLanguage = options.contentLanguage ?? "zh";
  const createdAt = normalizeDate(input.now).toISOString();
  const idea = input.idea.trim();
  const relatedPosts = selectIdeaRelatedPosts({
    idea,
    posts: input.posts,
    conceptAliases: input.conceptAliases
  });
  const matchedConcepts = collectMatchedConcepts(relatedPosts);
  const modelPlan = options.client
    ? await generateIdeaModelPlan(idea, matchedConcepts, relatedPosts, options.client, contentLanguage)
    : null;
  const probes = (modelPlan?.probes.length ? modelPlan.probes : buildDeterministicIdeaProbes(relatedPosts, contentLanguage)).slice(0, 2);
  const researchQuestions = (
    modelPlan?.researchQuestions.length
      ? modelPlan.researchQuestions
      : buildDeterministicIdeaResearchQuestions(idea, matchedConcepts, contentLanguage)
  ).slice(0, 3);
  const actions: AgentTurnAction[] = [
    ...probes.map((probe) => ({
      kind: "idea_probe" as const,
      label: probe,
      question: probe,
      concepts: matchedConcepts
    })),
    ...researchQuestions.map((question) => ({
      kind: "research_idea" as const,
      label: contentLanguage === "en" ? "Find evidence" : "找证据",
      question,
      queries: [question],
      concepts: matchedConcepts
    }))
  ];

  return {
    question: idea,
    intent: "idea_observation",
    tier: options.client && modelPlan ? "standard" : "free",
    zone: relatedPosts.length ? "frontier" : "dark",
    matchedConcepts,
    answer: null,
    nearestPosts: relatedPosts,
    actions,
    notes: [formatIdeaObservationBody(relatedPosts, probes, researchQuestions, contentLanguage)],
    createdAt
  };
}

export function selectIdeaRelatedPosts(input: {
  idea: string;
  posts: KnowledgePost[];
} & ConceptAliasOptions): IdeaRelatedPost[] {
  const graphPosts = input.posts.filter((post) => post.kind !== "connection_note");
  const aliasRecords = [
    ...(input.conceptAliases ?? []),
    ...createAutomaticConceptAliases(graphPosts, input.conceptAliases)
  ];
  const resolver = createConceptAliasResolver(aliasRecords);
  const loweredIdea = input.idea.toLowerCase();
  const ideaTokens = tokenize(input.idea);

  return graphPosts
    .map((post) => {
      const resolvedConcepts = uniqueStrings(
        [
          ...post.concepts,
          ...(post.graphEdges ?? []).flatMap((edge) => [edge.sourceConcept, edge.targetConcept])
        ]
          .map((concept) => resolver.resolveConcept(concept))
          .filter(Boolean)
      );
      const conceptHits = resolvedConcepts.filter((concept) =>
        conceptVariants(concept, graphPosts, aliasRecords, resolver).some((variant) =>
          loweredIdea.includes(variant.toLowerCase())
        )
      );
      const haystackTokens = tokenize(
        [
          post.title,
          post.summary,
          post.keyTakeaway,
          post.concepts.join(" "),
          post.sources.map((source) => source.title).join(" ")
        ].join(" ")
      );
      const tokenOverlap = Array.from(ideaTokens).filter((token) => haystackTokens.has(token)).length;
      const score = conceptHits.length * 10 + tokenOverlap / Math.max(1, ideaTokens.size);
      const source = post.sources[0];

      return {
        post,
        score,
        conceptHits,
        source
      };
    })
    .filter((item) => item.score > 0 && item.conceptHits.length > 0)
    .sort((left, right) => right.score - left.score || right.post.createdAt.localeCompare(left.post.createdAt))
    .slice(0, 3)
    .map((item) => ({
      postId: item.post.id,
      title: item.post.title,
      overlapScore: Math.round(item.score * 100) / 100,
      concepts: item.conceptHits,
      sourceId: item.source?.id,
      sourceTitle: item.source?.title,
      sourceUrl: item.source?.url
    }));
}

export function buildDeterministicIdeaProbes(
  relatedPosts: IdeaRelatedPost[],
  contentLanguage: ContentLanguage = "zh"
): string[] {
  const firstRelated = relatedPosts[0];

  if (contentLanguage === "en") {
    return [
      "Which part of this idea do you think can be tested?",
      ...(firstRelated
        ? [`Does it align with or conflict with "${firstRelated.title}" in your library?`]
        : [])
    ];
  }

  return [
    "这个想法里,哪部分你觉得是可以被验证的?",
    ...(firstRelated ? [`它和你库里《${firstRelated.title}》的说法一致还是冲突?`] : [])
  ];
}

export function buildDeterministicIdeaResearchQuestions(
  idea: string,
  concepts: string[],
  contentLanguage: ContentLanguage = "zh"
): string[] {
  const trimmedIdea = idea.length > 96 ? `${idea.slice(0, 95)}...` : idea;
  const seedConcepts = concepts.length ? concepts.slice(0, 3) : [trimmedIdea];

  return uniqueStrings(
    seedConcepts.map((concept) =>
      contentLanguage === "en"
        ? `What evidence supports or challenges this idea about ${concept}: ${trimmedIdea}?`
        : `有哪些证据支持或反驳这个关于「${concept}」的想法:${trimmedIdea}?`
    )
  ).slice(0, 3);
}

export function formatIdeaObservationBody(
  relatedPosts: IdeaRelatedPost[],
  probes: string[],
  researchQuestions: string[],
  contentLanguage: ContentLanguage = "zh"
): string {
  if (contentLanguage === "en") {
    return [
      "Library links",
      ...(relatedPosts.length
        ? relatedPosts.map((post) => {
            const source = post.sourceTitle ? ` Source: ${post.sourceTitle}.` : "";
            const concepts = post.concepts.length ? ` Concepts: ${post.concepts.join(", ")}.` : "";

            return `- "${post.title}".${concepts}${source}`;
          })
        : ["- No related material was found in your library."]),
      "",
      "Probes",
      ...probes.map((probe) => `- ${probe}`),
      "",
      "Testable subquestions",
      ...researchQuestions.map((question) => `- ${question}`)
    ].join("\n");
  }

  return [
    "库内关联",
    ...(relatedPosts.length
      ? relatedPosts.map((post) => {
          const source = post.sourceTitle ? ` 出处:《${post.sourceTitle}》。` : "";
          const concepts = post.concepts.length ? ` 关联概念:${post.concepts.join("、")}。` : "";

          return `- 《${post.title}》。${concepts}${source}`;
        })
      : ["- 库内没有相关材料。"]),
    "",
    "追问",
    ...probes.map((probe) => `- ${probe}`),
    "",
    "可检验子问题",
    ...researchQuestions.map((question) => `- ${question}`)
  ].join("\n");
}

function collectMatchedConcepts(relatedPosts: IdeaRelatedPost[]): string[] {
  return uniqueStrings(relatedPosts.flatMap((post) => post.concepts)).slice(0, 5);
}

async function generateIdeaModelPlan(
  idea: string,
  concepts: string[],
  relatedPosts: IdeaRelatedPost[],
  client: ModelClient,
  contentLanguage: ContentLanguage
): Promise<IdeaModelPlan | null> {
  try {
    const response = await client.complete({
      responseFormat: "json_object",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            contentLanguage === "en"
              ? "Return JSON with probes and researchQuestions arrays. Do not judge whether the user's idea is good or true."
              : "返回 JSON,包含 probes 和 researchQuestions 两个数组。不要评价用户想法好坏或真假。"
        },
        {
          role: "user",
          content: JSON.stringify({
            idea,
            concepts,
            relatedLibraryCards: relatedPosts.map((post) => ({
              title: post.title,
              concepts: post.concepts,
              sourceTitle: post.sourceTitle
            }))
          })
        }
      ]
    });
    const parsed = JSON.parse(response.content);

    if (!isRecord(parsed)) {
      return null;
    }

    return {
      probes: toStrings(parsed.probes).slice(0, 2),
      researchQuestions: toStrings(parsed.researchQuestions).slice(0, 3)
    };
  } catch {
    return null;
  }
}

function conceptVariants(
  concept: string,
  posts: KnowledgePost[],
  aliases: ReturnType<typeof createAutomaticConceptAliases>,
  resolver: ReturnType<typeof createConceptAliasResolver>
): string[] {
  const canonical = resolver.resolveConcept(concept);
  const canonicalSlug = resolver.slugConcept(canonical);
  const variants = new Set<string>([canonical]);

  for (const post of posts) {
    for (const postConcept of post.concepts) {
      if (resolver.slugConcept(resolver.resolveConcept(postConcept)) === canonicalSlug) {
        variants.add(postConcept);
      }
    }
  }

  for (const record of aliases) {
    if (resolver.slugConcept(resolver.resolveConcept(record.canonical)) !== canonicalSlug) {
      continue;
    }

    variants.add(record.canonical);
    record.aliases.forEach((alias) => variants.add(alias));
  }

  return Array.from(variants).filter(Boolean);
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

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();

    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDate(value: string | Date | undefined): Date {
  if (value instanceof Date) {
    return value;
  }

  return value ? new Date(value) : new Date();
}
