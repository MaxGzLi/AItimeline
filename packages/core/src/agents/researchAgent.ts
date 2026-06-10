import type { KnowledgeCard, Source } from "../types.js";

export interface ResearchAgentConfig {
  id: string;
  name: string;
  topics: string[];
  sourceTypes: Source["type"][];
  refreshCadenceHours: number;
}

export interface ResearchBrief {
  agentId: string;
  topics: string[];
  queryPlan: string[];
  sourceTypes: Source["type"][];
}

export function buildResearchBrief(config: ResearchAgentConfig): ResearchBrief {
  return {
    agentId: config.id,
    topics: config.topics,
    queryPlan: config.topics.map((topic) => `${topic} recent high-signal analysis`),
    sourceTypes: config.sourceTypes
  };
}

export function createKnowledgeCard(input: KnowledgeCard): KnowledgeCard {
  return {
    ...input,
    concepts: [...new Set(input.concepts.map((concept) => concept.trim()).filter(Boolean))]
  };
}

