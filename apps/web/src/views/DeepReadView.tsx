import type { ConceptAliasRecord, KnowledgeCard } from "@aitimeline/core";
import { DeepReadArticleView } from "../components/DeepReadArticleView";
import type { DeepReadArticleRecord } from "../lib/types";

interface DeepReadViewProps {
  // Reader data
  article: DeepReadArticleRecord | null;
  cards: KnowledgeCard[];
  conceptAliases: ConceptAliasRecord[];

  // Reader interactions
  onBack: () => void;
  onOpenConcept: (concept: string) => void;
}

export function DeepReadView({
  article,
  cards,
  conceptAliases,
  onBack,
  onOpenConcept
}: DeepReadViewProps) {
  return (
    <DeepReadArticleView
      article={article}
      cards={cards}
      conceptAliases={conceptAliases}
      onOpenConcept={onOpenConcept}
      onBack={onBack}
    />
  );
}
