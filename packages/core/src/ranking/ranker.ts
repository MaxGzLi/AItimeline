import type { KnowledgeCard, RankedKnowledgeCard, UserProfile } from "../types.js";

export function rankKnowledgeCards(
  cards: KnowledgeCard[],
  profile: UserProfile
): RankedKnowledgeCard[] {
  return cards
    .map((card) => {
      const reasons: string[] = [];
      let score = 0;

      const conceptHits = card.concepts.filter((concept) => profile.interests.includes(concept));
      if (conceptHits.length > 0) {
        score += conceptHits.length * 20;
        reasons.push(`Matches interests: ${conceptHits.join(", ")}`);
      }

      const weakHits = card.concepts.filter((concept) => profile.weakConcepts.includes(concept));
      if (weakHits.length > 0) {
        score += weakHits.length * 16;
        reasons.push(`Strengthens weak concepts: ${weakHits.join(", ")}`);
      }

      const noveltyHits = card.concepts.filter((concept) => !profile.knownConcepts.includes(concept));
      if (noveltyHits.length > 0) {
        score += Math.min(noveltyHits.length * 8, 24);
        reasons.push("Adds new concepts");
      }

      if (card.trustState === "supported") {
        score += 12;
        reasons.push("Supported by stronger sources");
      }

      score += Math.max(0, 8 - card.estimatedReadMinutes);

      return {
        ...card,
        score,
        scoreReasons: reasons
      };
    })
    .sort((left, right) => right.score - left.score);
}

