import type { KnowledgeCard } from "../types.js";
import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  normalizeConceptLabel,
  type ConceptAliasOptions
} from "./conceptAliases.js";

export interface ConceptMention {
  start: number;
  end: number;
  text: string;
  concept: string;
  slug: string;
}

export interface ConceptMentionMatcher {
  findMentions(text: string): ConceptMention[];
}

interface ConceptMentionCandidate {
  text: string;
  searchText: string;
  concept: string;
  slug: string;
}

const ASCII_WORD_CHARACTER = /[A-Za-z0-9_]/;

export function createConceptMentionMatcher(
  input: { cards: readonly KnowledgeCard[] } & ConceptAliasOptions
): ConceptMentionMatcher {
  const cards = input.cards.filter((card) => card.kind !== "connection_note");
  const aliasRecords = [...(input.conceptAliases ?? []), ...createAutomaticConceptAliases(input.cards, input.conceptAliases)];
  const resolver = createConceptAliasResolver(aliasRecords);
  const conceptBySlug = new Map<string, string>();

  for (const card of cards) {
    for (const concept of card.concepts) {
      const slug = resolver.slugConcept(concept);

      if (slug && !conceptBySlug.has(slug)) {
        conceptBySlug.set(slug, resolver.resolveConcept(concept));
      }
    }
  }

  const candidateByKey = new Map<string, ConceptMentionCandidate>();
  const addCandidate = (label: string) => {
    const text = normalizeConceptLabel(label);

    if (text.length < 2) {
      return;
    }

    const slug = resolver.slugConcept(text);
    const concept = conceptBySlug.get(slug);

    if (!slug || !concept) {
      return;
    }

    const searchText = text.toLowerCase();
    const key = `${searchText}:${slug}`;

    if (!candidateByKey.has(key)) {
      candidateByKey.set(key, {
        text,
        searchText,
        concept,
        slug
      });
    }
  };

  for (const card of cards) {
    for (const concept of card.concepts) {
      addCandidate(concept);
    }
  }

  for (const record of resolver.records) {
    addCandidate(record.canonical);

    for (const alias of record.aliases) {
      addCandidate(alias);
    }
  }

  const candidates = Array.from(candidateByKey.values()).sort(compareCandidates);

  return {
    findMentions(text: string): ConceptMention[] {
      if (!text || candidates.length === 0) {
        return [];
      }

      const mentions: ConceptMention[] = [];
      const lowerText = text.toLowerCase();
      // Rare lowercase mappings expand (e.g. U+0130 becomes two code units)
      // and would desync lowerText offsets from the raw text; fall back to
      // per-slice comparison in that case.
      const lowerAligned = lowerText.length === text.length;
      let index = 0;

      while (index < text.length) {
        const match = findCandidateAt(text, lowerText, lowerAligned, index, candidates);

        if (!match) {
          index += 1;
          continue;
        }

        mentions.push({
          start: index,
          end: match.end,
          text: text.slice(index, match.end),
          concept: match.candidate.concept,
          slug: match.candidate.slug
        });
        index = match.end;
      }

      return mentions;
    }
  };
}

function findCandidateAt(
  text: string,
  lowerText: string,
  lowerAligned: boolean,
  start: number,
  candidates: readonly ConceptMentionCandidate[]
): { candidate: ConceptMentionCandidate; end: number } | null {
  for (const candidate of candidates) {
    const end = start + candidate.text.length;

    if (end > text.length) {
      continue;
    }

    const matched = lowerAligned
      ? lowerText.startsWith(candidate.searchText, start)
      : text.slice(start, end).toLowerCase() === candidate.searchText;

    if (!matched) {
      continue;
    }

    if (hasAsciiCompatibleEdges(text, candidate.text, start, end)) {
      return { candidate, end };
    }
  }

  return null;
}

// A word boundary is only demanded where the candidate itself has an ASCII
// word character at that edge, so "AI芯片" cannot start midway through
// "OpenAI芯片" while "内存瓶颈" still matches flush against CJK prose.
function hasAsciiCompatibleEdges(text: string, candidateText: string, start: number, end: number): boolean {
  if (isAsciiWordCharacter(candidateText[0]) && isAsciiWordCharacter(text[start - 1])) {
    return false;
  }

  if (isAsciiWordCharacter(candidateText[candidateText.length - 1]) && isAsciiWordCharacter(text[end])) {
    return false;
  }

  return true;
}

function isAsciiWordCharacter(character: string | undefined): boolean {
  return character ? ASCII_WORD_CHARACTER.test(character) : false;
}

function compareCandidates(left: ConceptMentionCandidate, right: ConceptMentionCandidate): number {
  const lengthDiff = right.text.length - left.text.length;

  if (lengthDiff !== 0) {
    return lengthDiff;
  }

  return compareStrings(left.slug, right.slug) || compareStrings(left.concept, right.concept) || compareStrings(left.text, right.text);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
