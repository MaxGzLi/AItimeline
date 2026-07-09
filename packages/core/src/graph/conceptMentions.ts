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
  hasCjk: boolean;
  concept: string;
  slug: string;
}

const ASCII_WORD_CHARACTER = /[A-Za-z0-9_]/;
const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

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

    const hasCjk = CJK_CHARACTER.test(text);
    const searchText = hasCjk ? text : text.toLowerCase();
    const key = `${hasCjk ? "cjk" : "latin"}:${searchText}:${slug}`;

    if (!candidateByKey.has(key)) {
      candidateByKey.set(key, {
        text,
        searchText,
        hasCjk,
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
      let index = 0;

      while (index < text.length) {
        const match = findCandidateAt(text, lowerText, index, candidates);

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
  start: number,
  candidates: readonly ConceptMentionCandidate[]
): { candidate: ConceptMentionCandidate; end: number } | null {
  for (const candidate of candidates) {
    const end = start + candidate.text.length;

    if (end > text.length) {
      continue;
    }

    if (candidate.hasCjk) {
      if (text.startsWith(candidate.text, start)) {
        return { candidate, end };
      }

      continue;
    }

    if (!lowerText.startsWith(candidate.searchText, start)) {
      continue;
    }

    if (hasAsciiWordBoundary(text, start, end)) {
      return { candidate, end };
    }
  }

  return null;
}

function hasAsciiWordBoundary(text: string, start: number, end: number): boolean {
  return !isAsciiWordCharacter(text[start - 1]) && !isAsciiWordCharacter(text[end]);
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
