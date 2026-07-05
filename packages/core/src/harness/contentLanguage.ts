import type { HarnessValidationIssue } from "../types.js";

export type ContentLanguage = "zh";

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
  threshold = defaultContentLanguageThreshold
): HarnessValidationIssue[] {
  if (!isRecord(post)) {
    return [];
  }

  return collectLanguageFields(post)
    .filter(({ value }) => calculateCjkRatio(value) < threshold)
    .map(({ path }) => ({
      path,
      message: `${path} must be rewritten primarily in Simplified Chinese, keeping key English terms.`,
      severity: "error"
    }));
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
