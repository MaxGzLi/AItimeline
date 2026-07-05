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
import {
  cacheArxivFigureImages,
  createFigureCaptionChunks,
  fetchArxivHtmlDecomposition,
  type ArxivHtmlDecomposition
} from "./arxivHtmlImport.js";

export interface ArticleFetchOptions {
  fetch?: typeof fetch;
  createdAt?: string;
  maxChunks?: number;
  minParagraphLength?: number;
  mediaRootDir?: string;
}

export interface ArticleTransformOptions extends ArticleFetchOptions {
  recommendedBecause?: string;
  runner?: KnowledgePostAgentRunner;
}

export interface ArticleFetchResult {
  source: Source;
  asset: SourceAsset;
  assets: SourceAsset[];
  paragraphs: string[];
  arxivHtml?: ArxivHtmlDecomposition;
}

export interface ArxivAtomPaper {
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string;
}

export interface ArticleTransformResult {
  source: Source;
  asset: SourceAsset;
  assets: SourceAsset[];
  chunks: KnowledgeChunk[];
  cards: KnowledgePost[];
  sourceRegistry: SourceRegistry;
  harnessRun?: AgentHarnessRun;
  validation: HarnessValidationResult[];
  importRecord: SourceImport;
  arxivHtml?: ArxivHtmlDecomposition;
}

const defaultMaxChunks = 8;
const defaultMinParagraphLength = 80;
const arxivApiUrl = "https://export.arxiv.org/api/query";
const newStyleArxivIdPattern = /^\d{4}\.\d{4,5}(?:v\d+)?$/i;
const oldStyleArxivIdPattern = /^[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?$/i;

export async function fetchArticle(url: string, options: ArticleFetchOptions = {}): Promise<ArticleFetchResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("A fetch implementation is required to import an article.");
  }

  const parsedUrl = parseArticleUrl(url);
  const createdAt = options.createdAt ?? new Date().toISOString();
  const arxivUrl = parseArxivArticleUrl(parsedUrl);

  if (arxivUrl) {
    return fetchArxivArticle(fetchImpl, arxivUrl, createdAt, options);
  }

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
    assets: [asset],
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
    assets: fetched.assets,
    chunks,
    createdAt
  });
  const importResult = await runSourceImport(
    {
      source: fetched.source,
      assets: fetched.assets,
      chunks,
      sourceRegistry,
      createdAt,
      recommendedBecause:
        options.recommendedBecause ??
        "你导入了这篇文章,所以把它的段落转成了可以进时间线的知识卡片。"
    },
    options.runner
  );

  return {
    source: fetched.source,
    asset: fetched.asset,
    assets: fetched.assets,
    chunks,
    cards: importResult.posts,
    sourceRegistry: importResult.sourceRegistry,
    harnessRun: importResult.harnessRun,
    validation: importResult.validation,
    importRecord: importResult.importRecord,
    arxivHtml: fetched.arxivHtml
  };
}

export function parseArxivAtom(xml: string): ArxivAtomPaper {
  const entry = readXmlTagContent(xml, "entry");

  if (!entry) {
    throw new Error("arXiv API response did not include an entry.");
  }

  const title = normalizeArxivText(readXmlTagContent(entry, "title") ?? "");
  const abstract = normalizeArxivText(readXmlTagContent(entry, "summary") ?? "");
  const publishedAt = normalizeArxivText(readXmlTagContent(entry, "published") ?? "");
  const authors = Array.from(entry.matchAll(/<author\b[^>]*>([\s\S]*?)<\/author>/gi))
    .map((match) => normalizeArxivText(readXmlTagContent(match[1] ?? "", "name") ?? ""))
    .filter((author) => author.length > 0);

  if (!title) {
    throw new Error("arXiv API response did not include a title.");
  }

  if (!abstract) {
    throw new Error("arXiv API response did not include an abstract.");
  }

  if (!publishedAt) {
    throw new Error("arXiv API response did not include a published date.");
  }

  return {
    title,
    abstract,
    authors,
    publishedAt
  };
}

interface ArxivArticleUrl {
  id: string;
  absUrl: URL;
  apiUrl: URL;
}

async function fetchArxivArticle(
  fetchImpl: typeof fetch,
  arxivUrl: ArxivArticleUrl,
  createdAt: string,
  options: ArticleFetchOptions
): Promise<ArticleFetchResult> {
  const htmlDecomposition = await tryFetchArxivHtmlDecomposition(fetchImpl, arxivUrl.id);

  if (htmlDecomposition?.buckets.length) {
    return buildArxivHtmlArticle(fetchImpl, arxivUrl, createdAt, htmlDecomposition, options);
  }

  const xml = await fetchArxivAtom(fetchImpl, arxivUrl.apiUrl.toString());
  const metadata = parseArxivAtom(xml);
  const paragraphs = [metadata.abstract];
  const source: Source = {
    id: buildArticleSourceId(arxivUrl.absUrl),
    title: metadata.title,
    url: arxivUrl.absUrl.toString(),
    type: "article",
    author: metadata.authors.length ? metadata.authors.join(", ") : undefined,
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
    assets: [asset],
    paragraphs
  };
}

async function tryFetchArxivHtmlDecomposition(
  fetchImpl: typeof fetch,
  arxivId: string
): Promise<ArxivHtmlDecomposition | undefined> {
  try {
    return await fetchArxivHtmlDecomposition(arxivId, { fetch: fetchImpl });
  } catch {
    return undefined;
  }
}

async function buildArxivHtmlArticle(
  fetchImpl: typeof fetch,
  arxivUrl: ArxivArticleUrl,
  createdAt: string,
  arxivHtml: ArxivHtmlDecomposition,
  options: ArticleFetchOptions
): Promise<ArticleFetchResult> {
  const source: Source = {
    id: buildArticleSourceId(arxivUrl.absUrl),
    title: arxivHtml.title ?? `arXiv ${arxivUrl.id}`,
    url: arxivUrl.absUrl.toString(),
    type: "article"
  };
  const bodyChunks = arxivHtml.buckets.flatMap((bucket) => bucket.chunks);
  const captionChunks = createFigureCaptionChunks(source.id, arxivHtml.figures);
  const paragraphs = [...bodyChunks, ...captionChunks.map((chunk) => chunk.content)];
  const asset: SourceAsset = {
    id: `${source.id}-text`,
    sourceId: source.id,
    kind: "text",
    content: paragraphs.join("\n\n"),
    createdAt
  };
  const imageAssets = await cacheArxivFigureImages({
    sourceId: source.id,
    figures: arxivHtml.figures,
    mediaRootDir: options.mediaRootDir,
    fetch: fetchImpl,
    createdAt
  });

  return {
    source,
    asset,
    assets: [asset, ...imageAssets],
    paragraphs,
    arxivHtml
  };
}

async function fetchArxivAtom(fetchImpl: typeof fetch, url: string): Promise<string> {
  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`arXiv request failed with ${response.status}.`);
  }

  return response.text();
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

function parseArxivArticleUrl(url: URL): ArxivArticleUrl | undefined {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  if (hostname !== "arxiv.org") {
    return undefined;
  }

  const pathSegments = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodePathSegment);
  const route = pathSegments[0]?.toLowerCase();

  if (route !== "abs" && route !== "pdf" && route !== "html") {
    return undefined;
  }

  const id = normalizeArxivId(pathSegments.slice(1).join("/"));

  if (!id) {
    return undefined;
  }

  const apiUrl = new URL(arxivApiUrl);
  apiUrl.searchParams.set("id_list", id);

  return {
    id,
    absUrl: new URL(`https://arxiv.org/abs/${id}`),
    apiUrl
  };
}

function normalizeArxivId(value: string): string | undefined {
  const id = value
    .trim()
    .replace(/^arxiv:/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/v(\d+)$/i, "v$1");

  if (newStyleArxivIdPattern.test(id) || oldStyleArxivIdPattern.test(id)) {
    return id;
  }

  return undefined;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
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

function readXmlTagContent(xml: string, tagName: string): string | undefined {
  return xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"))?.[1];
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

function normalizeArxivText(value: string): string {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (match, codePoint) => decodeNumericEntity(match, codePoint, 16))
    .replace(/&#(\d+);/g, (match, codePoint) => decodeNumericEntity(match, codePoint, 10))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeNumericEntity(match: string, value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);

  if (!Number.isFinite(codePoint)) {
    return match;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return match;
  }
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
