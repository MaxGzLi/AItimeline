import type { HarnessValidationIssue } from "../types.js";

export type ContentLanguage = "zh" | "en";

export const defaultContentLanguageThreshold = 0.3;

const cjkCharactersPattern = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu;
const latinWordsPattern = /\p{Script=Latin}+/gu;

// CJK characters are compared against Latin WORDS, not letters: an English
// technical term is one unit of meaning, so a Chinese-primary sentence that
// keeps a few long English terms ("Agent Memory 的三种形式:token、parametric、
// latent") must not be swamped by the terms' letter count.
export function calculateCjkRatio(text: string): number {
  const cjkCount = (text.match(cjkCharactersPattern) ?? []).length;
  const latinWordCount = (text.match(latinWordsPattern) ?? []).length;
  const denominator = cjkCount + latinWordCount;

  return denominator === 0 ? 0 : cjkCount / denominator;
}

export function validateKnowledgePostContentLanguage(
  post: unknown,
  language: ContentLanguage = "zh",
  threshold = defaultContentLanguageThreshold
): HarnessValidationIssue[] {
  if (!isRecord(post)) {
    return [];
  }

  return collectLanguageFields(post)
    .filter(({ value }) =>
      language === "zh" ? calculateCjkRatio(value) < threshold : calculateCjkRatio(value) >= threshold
    )
    .map(({ path }) => ({
      path,
      message:
        language === "zh"
          ? `${path} must be rewritten primarily in Simplified Chinese, keeping key English terms.`
          : `${path} must be rewritten primarily in English, preserving verbatim source quotes and key source terms.`,
      severity: "error"
    }));
}

export function parseContentLanguage(value: unknown): ContentLanguage | undefined {
  return value === "zh" || value === "en" ? value : undefined;
}

export function getKnowledgePostLanguagePolicy(language: ContentLanguage): string[] {
  if (language === "en") {
    return [
      "Language policy:",
      "- Write all user-facing text fields (title, hook, thesis, shortBody, keyTakeaway, summary, thread, reviewPrompts, recommendedBecause) in natural English.",
      "- Preserve source quotes verbatim in the source language.",
      "- Keep technical terms, proper nouns, concepts, and graphEdges concept names in their original wording so graph nodes stay continuous.",
      "- Every entry in concepts must be a phrase that appears verbatim in the source chunks; never invent, merge, or reword concept names.",
      "- Except inside citation quote fields, never copy source sentences verbatim; explain in your own English words while retaining key source terms and numbers.",
      "- Numbers must match the cited evidence exactly.",
      "- graphEdges evidence must stay in the source language: quote or closely paraphrase the cited chunk; do not translate it.",
      "- Every source-fact field (summary, thesis, shortBody, graphEdges evidence) must retain at least one key term or number taken from the cited evidence."
    ];
  }

  return [
    "Language policy:",
    "- Write all user-facing text in Simplified Chinese.",
    "- Keep technical terms, proper nouns, and concept names in their original English (e.g., AI Agent, RAG, LLM); do not translate them.",
    "- Quotes from sources must stay verbatim in the source language.",
    "- Except inside citation quote fields, never copy sentences from the evidence verbatim; explain in your own words in Simplified Chinese while keeping the key English terms.",
    "- Numbers must match the cited evidence exactly.",
    "- Keep concepts and graphEdges concept names in English so graph nodes stay continuous.",
    "- Every entry in concepts must be a phrase that appears verbatim in the source chunks; never invent, merge, or reword concept names.",
    "- graphEdges evidence must stay in the source language: quote or closely paraphrase the cited chunk; do not translate it into Chinese.",
    "- Every source-fact field (summary, thesis, shortBody, graphEdges evidence) must retain at least one key English term or number taken from the cited evidence."
  ];
}

export function getGroundedAnswerLanguagePolicy(language: ContentLanguage): string[] {
  if (language === "en") {
    return [
      "Language policy:",
      "- Write the user-facing answer in natural English.",
      "- Preserve source quotes verbatim in the source language.",
      "- Keep technical terms, proper nouns, and concept names in their original wording.",
      "- Except inside citation quote fields, never copy source sentences verbatim; answer in your own English words while retaining key source terms and numbers.",
      "- Numbers must match the cited evidence exactly.",
      "- Every source-grounded answer must retain at least one key term or number taken from the cited evidence."
    ];
  }

  return [
    "Language policy:",
    "- Write all user-facing text in Simplified Chinese.",
    "- Keep technical terms, proper nouns, and concept names in their original English (e.g., AI Agent, RAG, LLM); do not translate them.",
    "- Quotes from sources must stay verbatim in the source language.",
    "- Except inside citation quote fields, never copy sentences from the evidence verbatim; explain in your own words in Simplified Chinese while keeping the key English terms.",
    "- Numbers must match the cited evidence exactly.",
    "- Every source-grounded answer must retain at least one key English term or number taken from the cited evidence."
  ];
}

function collectLanguageFields(post: Record<string, unknown>): { path: string; value: string }[] {
  const fields: { path: string; value: string }[] = [];
  const addField = (path: string, value: unknown) => {
    if (typeof value === "string") {
      fields.push({ path, value });
    }
  };

  addField("$.title", post.title);
  addField("$.hook", post.hook);
  addField("$.thesis", post.thesis);
  addField("$.shortBody", post.shortBody);
  addField("$.keyTakeaway", post.keyTakeaway);
  addField("$.summary", post.summary);
  addField("$.recommendedBecause", post.recommendedBecause);

  if (Array.isArray(post.thread)) {
    post.thread.forEach((block, index) => {
      if (isRecord(block)) {
        addField(`$.thread[${index}].body`, block.body);
      }
    });
  }

  if (Array.isArray(post.reviewPrompts)) {
    post.reviewPrompts.forEach((prompt, index) => {
      if (isRecord(prompt)) {
        addField(`$.reviewPrompts[${index}].prompt`, prompt.prompt);
      }
    });
  }

  return fields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
