import { runSourceImport } from "../source/sourceImportWorker.js";
import { createSourceRegistry, hashContent } from "../source/sourceRegistry.js";
import type {
  AgentHarnessRun,
  HarnessValidationResult,
  KnowledgeChunk,
  KnowledgePost,
  KnowledgePostAgentRunner,
  Source,
  SourceAsset,
  SourceImport,
  SourceRegistry
} from "../types.js";

export interface ArticleFetchOptions {
  fetch?: typeof fetch;
  createdAt?: string;
  maxChunks?: number;
  minParagraphLength?: number;
}

export interface ArticleTransformOptions extends ArticleFetchOptions {
  recommendedBecause?: string;
  runner?: KnowledgePostAgentRunner;
}

export interface ArticleFetchResult {
  source: Source;
  asset: SourceAsset;
  paragraphs: string[];
}

export interface ArticleTransformResult {
  source: Source;
  asset: SourceAsset;
  chunks: KnowledgeChunk[];
  cards: KnowledgePost[];
  sourceRegistry: SourceRegistry;
  harnessRun?: AgentHarnessRun;
  validation: HarnessValidationResult[];
  importRecord: SourceImport;
}

const defaultMaxChunks = 8;
const defaultMinParagraphLength = 80;

export async function fetchArticle(url: string, options: ArticleFetchOptions = {}): Promise<ArticleFetchResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("A fetch implementation is required to import an article.");
  }

  const parsedUrl = parseArticleUrl(url);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const html = await fetchArticleHtml(fetchImpl, parsedUrl.toString());
  const metadata = extractArticleMetadata(html, parsedUrl);
  const paragraphs = extractArticleParagraphs(html, {
    maxChunks: options.maxChunks ?? defaultMaxChunks,
    minParagraphLength: options.minParagraphLength ?? defaultMinParagraphLength
  });

  if (!paragraphs.length) {
    throw new Error("Article did not contain enough readable text.");
  }

  const source: Source = {
    id: buildArticleSourceId(parsedUrl),
    title: metadata.title,
    url: parsedUrl.toString(),
    type: "article",
    author: metadata.author,
    publishedAt: metadata.publishedAt
  };
  const asset: SourceAsset = {
    id: `${source.id}-text`,
    sourceId: source.id,
    kind: "text",
    content: paragraphs.join("\n\n"),
    createdAt
  };

  return {
    source,
    asset,
    paragraphs
  };
}

export async function transformArticleUrl(
  url: string,
  options: ArticleTransformOptions = {}
): Promise<ArticleTransformResult> {
  const fetched = await fetchArticle(url, options);
  const createdAt = options.createdAt ?? fetched.asset.createdAt;
  const chunks = fetched.paragraphs.map((paragraph, index) => ({
    id: `${fetched.source.id}-chunk-${index + 1}`,
    sourceId: fetched.source.id,
    content: paragraph,
    conceptHints: extractConceptHints(paragraph)
  }));
  const sourceRegistry = createSourceRegistry({
    sources: [fetched.source],
    assets: [fetched.asset],
    chunks,
    createdAt
  });
  const importResult = await runSourceImport(
    {
      source: fetched.source,
      assets: [fetched.asset],
      chunks,
      sourceRegistry,
      createdAt,
      recommendedBecause:
        options.recommendedBecause ??
        "You imported this article, so the agent converted its paragraphs into timeline-ready knowledge."
    },
    options.runner
  );

  return {
    source: fetched.source,
    asset: fetched.asset,
    chunks,
    cards: importResult.posts,
    sourceRegistry: importResult.sourceRegistry,
    harnessRun: importResult.harnessRun,
    validation: importResult.validation,
    importRecord: importResult.importRecord
  };
}

async function fetchArticleHtml(fetchImpl: typeof fetch, url: string): Promise<string> {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Article request failed with ${response.status}.`);
  }

  return response.text();
}

function parseArticleUrl(url: string): URL {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Article URL must use http or https.");
    }

    return parsedUrl;
  } catch (error) {
    if (error instanceof Error && error.message === "Article URL must use http or https.") {
      throw error;
    }

    throw new Error("Please enter a valid article URL.");
  }
}

function extractArticleMetadata(html: string, url: URL): { title: string; author?: string; publishedAt?: string } {
  return {
    title:
      readMetaContent(html, "property", "og:title") ??
      readMetaContent(html, "name", "twitter:title") ??
      readTagText(html, "title") ??
      url.hostname,
    author:
      readMetaContent(html, "name", "author") ??
      readMetaContent(html, "property", "article:author"),
    publishedAt:
      readMetaContent(html, "property", "article:published_time") ??
      readMetaContent(html, "name", "date") ??
      readMetaContent(html, "itemprop", "datePublished")
  };
}

function extractArticleParagraphs(
  html: string,
  options: { maxChunks: number; minParagraphLength: number }
): string[] {
  const contentHtml = readTagHtml(html, "article") ?? readTagHtml(html, "main") ?? readTagHtml(html, "body") ?? html;
  const cleanHtml = removeNonContentTags(contentHtml);
  const paragraphs = Array.from(cleanHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => normalizeArticleText(stripTags(match[1] ?? "")))
    .filter((paragraph) => paragraph.length >= options.minParagraphLength);

  if (paragraphs.length) {
    return paragraphs.slice(0, options.maxChunks);
  }

  const fallbackText = normalizeArticleText(stripTags(cleanHtml));

  return chunkText(fallbackText, options.minParagraphLength * 2).slice(0, options.maxChunks);
}

function readMetaContent(html: string, attribute: string, value: string): string | undefined {
  const metaPattern = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}=["']${escapeRegExp(value)}["'])([^>]*)>`, "i");
  const meta = html.match(metaPattern)?.[1];
  const content = meta?.match(/\bcontent=["']([^"']+)["']/i)?.[1];

  return content ? normalizeArticleText(content) : undefined;
}

function readTagText(html: string, tagName: string): string | undefined {
  const tagHtml = readTagHtml(html, tagName);
  const text = tagHtml ? normalizeArticleText(stripTags(tagHtml)) : "";

  return text || undefined;
}

function readTagHtml(html: string, tagName: string): string | undefined {
  return html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"))?.[1];
}

function removeNonContentTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ");
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(li|h1|h2|h3|h4|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function normalizeArticleText(value: string): string {
  return decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function chunkText(text: string, targetLength: number): string[] {
  if (text.length < targetLength) {
    return text ? [text] : [];
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;

    if (next.length >= targetLength && current) {
      chunks.push(current);
      current = sentence;
      continue;
    }

    current = next;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function extractConceptHints(text: string): string[] {
  const conceptCandidates = [
    "AI Agent",
    "RAG",
    "Knowledge Graph",
    "Memory",
    "Recommendation",
    "Evaluation",
    "NotebookLM",
    "YouTube"
  ];
  const lowerText = text.toLowerCase();

  return conceptCandidates.filter((concept) => lowerText.includes(concept.toLowerCase()));
}

function buildArticleSourceId(url: URL): string {
  return `article-${hashContent(url.toString()).replace("fnv1a32-", "")}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
