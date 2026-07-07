import { normalizeMathDelimiters } from "@aitimeline/core";
import katex from "katex";
import type { ReactNode } from "react";
import "katex/dist/katex.min.css";

export { normalizeMathDelimiters };

export type MathTextSegment =
  | { kind: "text"; text: string }
  | { displayMode: boolean; kind: "math"; latex: string; raw: string };

interface MathMatch {
  displayMode: boolean;
  end: number;
  latex: string;
  raw: string;
  start: number;
}

const DISPLAYSTYLE_MARKER = "{\\displaystyle";
const BARE_LATEX_COMMAND =
  /\\(?:sum|prod|int|lim|frac|dfrac|tfrac|sqrt|text|mathrm|mathbf|mathit|mathbb|mathcal|operatorname|left|right|cdot|times|alpha|beta|gamma|delta|epsilon|varepsilon|theta|vartheta|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|omega|partial|nabla|infty|leq|geq|neq|approx|propto|in|notin|subset|supset|cup|cap|forall|exists|argmax|argmin|max|min|log|ln|exp|sin|cos|tan)(?![A-Za-z])/g;
const STRUCTURAL_LATEX_COMMAND =
  /\\(?:sum|prod|int|lim|frac|dfrac|tfrac|sqrt|text|operatorname|cdot|times|leq|geq|neq|approx|propto|partial|nabla|infty|argmax|argmin)(?![A-Za-z])/;

const splitCache = new Map<string, MathTextSegment[]>();

export function splitMathText(text: string): MathTextSegment[] {
  const normalizedText = normalizeMathDelimiters(text);
  const cached = splitCache.get(normalizedText);

  if (cached) {
    return cached;
  }

  const segments = splitBareLatexSegments(splitDisplaystyleSegments(splitDollarSegments([{ kind: "text", text: normalizedText }])));

  if (splitCache.size >= 1000) {
    splitCache.clear();
  }

  splitCache.set(normalizedText, segments);
  return segments;
}

export function renderMathInText(text: string): ReactNode {
  const segments = splitMathText(text);

  if (segments.length === 1 && segments[0]?.kind === "text") {
    return segments[0].text;
  }

  return segments.map((segment, index) =>
    segment.kind === "text" ? segment.text : renderMathSegment(segment, `math-${index}`)
  );
}

export function renderMathSegment(segment: Extract<MathTextSegment, { kind: "math" }>, key: string): ReactNode {
  const html = renderKatex(segment.latex, segment.displayMode);

  if (!html) {
    return segment.raw;
  }

  const className = segment.displayMode ? "x-math-block" : "x-math";
  const Element = segment.displayMode ? "div" : "span";

  return (
    <Element
      className={className}
      // KaTeX is the only allowed dangerouslySetInnerHTML boundary here:
      // the HTML is generated locally from plain text, never accepted as user HTML.
      dangerouslySetInnerHTML={{ __html: html }}
      key={key}
    />
  );
}

function splitDollarSegments(segments: MathTextSegment[]): MathTextSegment[] {
  return splitTextSegments(segments, (text) => findDollarMath(text, 0));
}

function splitDisplaystyleSegments(segments: MathTextSegment[]): MathTextSegment[] {
  const nextSegments: MathTextSegment[] = [];

  for (const segment of segments) {
    if (segment.kind === "math") {
      nextSegments.push(segment);
      continue;
    }

    const text = segment.text;
    let cursor = 0;

    while (cursor < text.length) {
      const match = findDisplaystyleMath(text, cursor);

      if (!match) {
        appendTextSegment(nextSegments, text.slice(cursor));
        break;
      }

      const before = text.slice(cursor, match.start);
      const duplicateLength = findDuplicateDisplaystyleTailLength(before, match.latex);
      const visibleBefore = duplicateLength > 0 ? before.slice(0, before.length - duplicateLength) : before;

      appendTextSegment(nextSegments, visibleBefore);
      nextSegments.push({
        displayMode: false,
        kind: "math",
        latex: match.latex,
        raw: match.raw
      });
      cursor = match.end;
    }
  }

  return nextSegments;
}

function splitBareLatexSegments(segments: MathTextSegment[]): MathTextSegment[] {
  return splitTextSegments(segments, (text) => findBareLatexMath(text, 0));
}

function splitTextSegments(
  segments: MathTextSegment[],
  findMatch: (text: string) => MathMatch | null
): MathTextSegment[] {
  const nextSegments: MathTextSegment[] = [];

  for (const segment of segments) {
    if (segment.kind === "math") {
      nextSegments.push(segment);
      continue;
    }

    const text = segment.text;
    let cursor = 0;

    while (cursor < text.length) {
      const match = findMatch(text.slice(cursor));

      if (!match) {
        appendTextSegment(nextSegments, text.slice(cursor));
        break;
      }

      if (match.start > 0) {
        appendTextSegment(nextSegments, text.slice(cursor, cursor + match.start));
      }

      nextSegments.push({
        displayMode: match.displayMode,
        kind: "math",
        latex: match.latex,
        raw: match.raw
      });
      cursor += match.end;
    }
  }

  return nextSegments;
}

function appendTextSegment(segments: MathTextSegment[], text: string): void {
  if (!text) {
    return;
  }

  const previous = segments[segments.length - 1];

  if (previous?.kind === "text") {
    previous.text += text;
    return;
  }

  segments.push({ kind: "text", text });
}

function findDollarMath(text: string, startAt: number): MathMatch | null {
  for (let index = startAt; index < text.length; index += 1) {
    if (text[index] !== "$" || isEscaped(text, index)) {
      continue;
    }

    if (text[index + 1] === "$") {
      const end = findClosingDoubleDollar(text, index + 2);

      if (end === -1) {
        continue;
      }

      const latex = text.slice(index + 2, end);

      if (!latex.trim()) {
        index = end + 1;
        continue;
      }

      return {
        displayMode: true,
        end: end + 2,
        latex: latex.trim(),
        raw: text.slice(index, end + 2),
        start: index
      };
    }

    const end = findClosingSingleDollar(text, index + 1);

    if (end === -1) {
      continue;
    }

    const latex = text.slice(index + 1, end);

    if (!isRenderableInlineDollar(latex, text[end + 1])) {
      index = end;
      continue;
    }

    return {
      displayMode: false,
      end: end + 1,
      latex: latex.trim(),
      raw: text.slice(index, end + 1),
      start: index
    };
  }

  return null;
}

function findClosingDoubleDollar(text: string, startAt: number): number {
  for (let index = startAt; index < text.length - 1; index += 1) {
    if (text[index] === "$" && text[index + 1] === "$" && !isEscaped(text, index)) {
      return index;
    }
  }

  return -1;
}

function findClosingSingleDollar(text: string, startAt: number): number {
  for (let index = startAt; index < text.length; index += 1) {
    const character = text[index];

    if (character === "\n" || character === "\r") {
      return -1;
    }

    if (character === "$" && text[index + 1] !== "$" && !isEscaped(text, index)) {
      return index;
    }
  }

  return -1;
}

function findDisplaystyleMath(text: string, startAt: number): MathMatch | null {
  let start = text.indexOf(DISPLAYSTYLE_MARKER, startAt);

  while (start !== -1) {
    let contentStart = start + DISPLAYSTYLE_MARKER.length;

    while (/\s/.test(text[contentStart] ?? "")) {
      contentStart += 1;
    }

    const end = findBalancedBraceEnd(text, start);

    if (end !== -1) {
      const latex = text.slice(contentStart, end).trim();

      if (latex) {
        return {
          displayMode: false,
          end: end + 1,
          latex,
          raw: text.slice(start, end + 1),
          start
        };
      }
    }

    start = text.indexOf(DISPLAYSTYLE_MARKER, start + DISPLAYSTYLE_MARKER.length);
  }

  return null;
}

function findBareLatexMath(text: string, startAt: number): MathMatch | null {
  BARE_LATEX_COMMAND.lastIndex = startAt;

  for (let commandMatch = BARE_LATEX_COMMAND.exec(text); commandMatch; commandMatch = BARE_LATEX_COMMAND.exec(text)) {
    const commandStart = commandMatch.index;
    const start = findBareLatexStart(text, commandStart);
    const end = findBareLatexEnd(text, commandStart + commandMatch[0].length);
    const raw = trimBareLatexCandidate(text.slice(start, end));
    const offset = text.slice(start, end).indexOf(raw);
    const matchStart = start + Math.max(0, offset);
    const matchEnd = matchStart + raw.length;

    if (isRenderableBareLatex(raw)) {
      return {
        displayMode: false,
        end: matchEnd,
        latex: raw,
        raw,
        start: matchStart
      };
    }
  }

  return null;
}

function findBareLatexStart(text: string, commandStart: number): number {
  let index = commandStart;

  while (index > 0 && isBareLatexCharacter(text[index - 1])) {
    index -= 1;
  }

  const candidate = text.slice(index, commandStart);
  const boundary = Math.max(
    candidate.lastIndexOf("\n"),
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("！"),
    candidate.lastIndexOf("?"),
    candidate.lastIndexOf("？"),
    candidate.lastIndexOf(";"),
    candidate.lastIndexOf("；"),
    candidate.lastIndexOf(":"),
    candidate.lastIndexOf("：")
  );

  return boundary === -1 ? index : index + boundary + 1;
}

function findBareLatexEnd(text: string, commandEnd: number): number {
  let index = commandEnd;
  let braceDepth = 0;

  while (index < text.length) {
    const character = text[index];

    if (!character || (!isBareLatexCharacter(character) && braceDepth === 0)) {
      break;
    }

    if (!isEscaped(text, index)) {
      if (character === "{") {
        braceDepth += 1;
      } else if (character === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    index += 1;
  }

  return index;
}

function trimBareLatexCandidate(candidate: string): string {
  const leadingTrimmed = candidate.trimStart();
  const leadingWordsTrimmed = leadingTrimmed.replace(/^([A-Za-z]{2,}\s+)+(?=[A-Za-z0-9\\({\[]*[_^=\\])/u, "");
  const tokens = leadingWordsTrimmed.trimEnd().split(/(\s+)/);

  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1] ?? "";

    if (!/^[A-Za-z]{2,}[,.)\]]*$/.test(last)) {
      break;
    }

    // Trailing differentials (dx, dt, ...) are part of the formula, not prose.
    if (/^d[a-z][,.)\]]*$/.test(last)) {
      break;
    }

    tokens.pop();

    while (tokens.length > 0 && /^\s+$/.test(tokens[tokens.length - 1] ?? "")) {
      tokens.pop();
    }
  }

  return tokens.join("").trim();
}

function isRenderableBareLatex(candidate: string): boolean {
  if (candidate.length < 3 || candidate.length > 240 || !/\\[A-Za-z]+/.test(candidate)) {
    return false;
  }

  if (!STRUCTURAL_LATEX_COMMAND.test(candidate) && !/[_^={}]/.test(candidate)) {
    return false;
  }

  return true;
}

function findBalancedBraceEnd(text: string, start: number): number {
  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (isEscaped(text, index)) {
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findDuplicateDisplaystyleTailLength(before: string, latex: string): number {
  const mathSkeleton = toSymbolSkeleton(latex);

  if (mathSkeleton.length < 4) {
    return 0;
  }

  const trailingWhitespaceLength = before.length - before.trimEnd().length;
  const comparableEnd = before.length - trailingWhitespaceLength;
  const windowStart = Math.max(0, comparableEnd - 240);
  const tail = before.slice(windowStart, comparableEnd);
  let best: { length: number; score: number } | null = null;

  for (let start = 0; start < tail.length; start += 1) {
    if (start > 0 && !isDuplicateCandidateBoundary(tail[start - 1] ?? "")) {
      continue;
    }

    const rawCandidate = tail.slice(start);
    const candidateSkeleton = toSymbolSkeleton(rawCandidate);

    if (!candidateLooksFormulaLike(rawCandidate) || candidateSkeleton.length < 4) {
      continue;
    }

    const lengthRatio = candidateSkeleton.length / mathSkeleton.length;

    if (lengthRatio < 0.58 || lengthRatio > 1.35) {
      continue;
    }

    const score = skeletonSimilarity(candidateSkeleton, mathSkeleton);

    if (score < 0.78) {
      continue;
    }

    const length = comparableEnd - (windowStart + start) + trailingWhitespaceLength;

    if (!best || score > best.score || (score === best.score && length < best.length)) {
      best = { length, score };
    }
  }

  return best?.length ?? 0;
}

const katexHtmlCache = new Map<string, string | null>();

function renderKatex(latex: string, displayMode: boolean): string | null {
  const cacheKey = `${displayMode ? "block" : "inline"}:${latex}`;

  if (katexHtmlCache.has(cacheKey)) {
    return katexHtmlCache.get(cacheKey) ?? null;
  }

  let html: string | null = null;

  try {
    // throwOnError must stay true: with false KaTeX renders red error markup
    // instead of throwing, and the raw-text fallback would never trigger.
    html = katex.renderToString(latex, {
      displayMode,
      throwOnError: true
    });
  } catch {
    html = null;
  }

  if (katexHtmlCache.size >= 1000) {
    katexHtmlCache.clear();
  }

  katexHtmlCache.set(cacheKey, html);
  return html;
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  let cursor = index - 1;

  while (cursor >= 0 && text[cursor] === "\\") {
    slashCount += 1;
    cursor -= 1;
  }

  return slashCount % 2 === 1;
}

function isRenderableInlineDollar(latex: string, nextCharacter: string | undefined): boolean {
  if (!latex.trim() || isPlainNumberOrCurrency(latex)) {
    return false;
  }

  // TeX-style delimiter rules keep currency out of math: the content must hug
  // both dollars, the closing dollar must not sit before a digit ("$5 ... $10"),
  // and formula content never contains CJK prose.
  if (/^\s/.test(latex) || /\s$/.test(latex)) {
    return false;
  }

  if (nextCharacter && /\d/.test(nextCharacter)) {
    return false;
  }

  if (/[\u4e00-\u9fff]/.test(latex)) {
    return false;
  }

  return true;
}

function isPlainNumberOrCurrency(value: string): boolean {
  return /^[\s$€£¥￥+-]*\d[\d\s,._]*(?:\.\d+)?\s*(?:%|USD|EUR|GBP|JPY|CNY|RMB|\u7f8e\u5143|\u6b27\u5143|\u82f1\u9551|\u65e5\u5143|\u4eba\u6c11\u5e01)?\s*$/i.test(
    value
  );
}

function isBareLatexCharacter(character: string | undefined): boolean {
  return !!character && /[A-Za-z0-9\\{}_\[\]\^=+\-*\/(),.|<>\s·×÷∑∏√∞≈≤≥≠→←↔…]/u.test(character);
}

function isDuplicateCandidateBoundary(character: string): boolean {
  return /[\s(\[{（，,;；:：。.!?！？]/.test(character);
}

function candidateLooksFormulaLike(candidate: string): boolean {
  return /[=+\-*\/_^(){}\[\]∑∏√∞≈≤≥≠]/u.test(candidate);
}

function toSymbolSkeleton(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\\(?:displaystyle|left|right)(?![A-Za-z])/g, "")
    .replace(/\\(?:text|mathrm|mathbf|mathit|mathbb|mathcal|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\(?:sum)(?![A-Za-z])/g, "∑")
    .replace(/\\(?:prod)(?![A-Za-z])/g, "∏")
    .replace(/\\(?:sqrt)(?![A-Za-z])/g, "√")
    .replace(/\\(?:infty)(?![A-Za-z])/g, "∞")
    .replace(/\\(?:cdot|times)(?![A-Za-z])/g, "×")
    .replace(/\\(?:leq)(?![A-Za-z])/g, "≤")
    .replace(/\\(?:geq)(?![A-Za-z])/g, "≥")
    .replace(/\\(?:neq)(?![A-Za-z])/g, "≠")
    .replace(/\\(?:approx)(?![A-Za-z])/g, "≈")
    .replace(/\\alpha(?![A-Za-z])/g, "α")
    .replace(/\\beta(?![A-Za-z])/g, "β")
    .replace(/\\gamma(?![A-Za-z])/g, "γ")
    .replace(/\\delta(?![A-Za-z])/g, "δ")
    .replace(/\\theta(?![A-Za-z])/g, "θ")
    .replace(/\\lambda(?![A-Za-z])/g, "λ")
    .replace(/\\mu(?![A-Za-z])/g, "μ")
    .replace(/\\pi(?![A-Za-z])/g, "π")
    .replace(/\\sigma(?![A-Za-z])/g, "σ")
    .replace(/\\phi(?![A-Za-z])/g, "φ")
    .replace(/\\omega(?![A-Za-z])/g, "ω")
    .replace(/\\([A-Za-z]+)(?![A-Za-z])/g, "$1")
    .replace(/[{}\s]/g, "")
    .toLowerCase();
}

function skeletonSimilarity(left: string, right: string): number {
  const distance = levenshteinDistance(left, right);
  const longest = Math.max(left.length, right.length);

  return longest === 0 ? 1 : 1 - distance / longest;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 0;
}
