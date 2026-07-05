import type { SourceAsset } from "../types.js";

export type ArxivSectionKind = "motivation" | "method" | "experiment" | "result" | "conclusion" | "other";

export interface ArxivHtmlBucket {
  kind: ArxivSectionKind;
  title: string;
  chunks: string[];
}

export interface ArxivHtmlFigure {
  index: number;
  figureLabel: string;
  caption: string;
  imageRef: string;
}

export interface ArxivHtmlDecomposition {
  title?: string;
  buckets: ArxivHtmlBucket[];
  figures: ArxivHtmlFigure[];
  truncated: boolean;
}

export interface FetchArxivHtmlOptions {
  fetch?: typeof fetch;
}

export interface CacheArxivFigureImagesOptions {
  fetch?: typeof fetch;
  mediaRootDir?: string;
  sourceId: string;
  figures: ArxivHtmlFigure[];
  createdAt?: string;
}

const maxChunkCharacters = 1200;
const maxTotalChunks = 40;
const maxImageBytes = 8 * 1024 * 1024;
const imageExtensionsByMimeType = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/gif", "gif"],
  ["image/svg+xml", "svg"],
  ["image/webp", "webp"]
]);
const allowedImageExtensions = new Set(imageExtensionsByMimeType.values());
const bucketOrder: ArxivSectionKind[] = ["motivation", "method", "experiment", "result", "conclusion", "other"];

interface HtmlElement {
  tagName: string;
  openTag: string;
  innerHtml: string;
  outerHtml: string;
}

interface ImageBytes {
  bytes: Uint8Array;
  contentType?: string;
  sourceUrl?: string;
}

interface NodeFsPromisesSubset {
  mkdir(path: string, options: { recursive?: boolean }): Promise<unknown>;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
}

interface NodePathSubset {
  join(...paths: string[]): string;
}

export async function fetchArxivHtmlDecomposition(
  arxivId: string,
  options: FetchArxivHtmlOptions = {}
): Promise<ArxivHtmlDecomposition | undefined> {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("A fetch implementation is required to import arXiv HTML.");
  }

  const htmlUrl = buildArxivHtmlUrl(arxivId);
  const response = await fetchImpl(htmlUrl);

  if (!response.ok) {
    return undefined;
  }

  const html = await response.text();

  return parseArxivHtmlDecomposition(html, htmlUrl);
}

export function buildArxivHtmlUrl(arxivId: string): string {
  return `https://arxiv.org/html/${arxivId}`;
}

export function parseArxivHtmlDecomposition(html: string, htmlPageUrl: string): ArxivHtmlDecomposition | undefined {
  if (!hasLatexmlStructure(html)) {
    return undefined;
  }

  return decomposeArxivHtml(html, htmlPageUrl);
}

export function decomposeArxivHtml(html: string, htmlPageUrl: string): ArxivHtmlDecomposition {
  const title = extractDocumentTitle(html);
  const bucketDrafts = new Map<ArxivSectionKind, { titles: string[]; texts: string[] }>();
  const seenText = new Set<string>();

  for (const abstractElement of extractElementsByClass(html, "ltx_abstract")) {
    const abstractHtml = removeElementsByClass(abstractElement.innerHtml, "ltx_title");
    const abstractText = normalizeHtmlText(stripTags(abstractHtml));

    addBucketText(bucketDrafts, seenText, "motivation", "Abstract", abstractText);
  }

  for (const section of extractElementsByClass(html, "ltx_section")) {
    const titleElement = extractElementsByClass(section.innerHtml, "ltx_title")[0];
    const sectionTitle = normalizeHtmlText(stripTags(titleElement?.innerHtml ?? "")) || "Untitled section";

    if (isBoilerplateSectionTitle(sectionTitle)) {
      continue;
    }

    const bodyHtml = removeSectionNonText(section.innerHtml, titleElement?.outerHtml);
    const paragraphTexts = extractParagraphTexts(bodyHtml);
    const sectionText = paragraphTexts.length ? paragraphTexts.join("\n\n") : normalizeHtmlText(stripTags(bodyHtml));

    addBucketText(bucketDrafts, seenText, classifySectionKind(sectionTitle), sectionTitle, sectionText);
  }

  const buckets = buildBuckets(bucketDrafts);
  const truncated = limitTotalChunks(buckets, maxTotalChunks);

  return {
    title,
    buckets,
    figures: extractFigures(html, htmlPageUrl),
    truncated
  };
}

export async function cacheArxivFigureImages(
  options: CacheArxivFigureImagesOptions
): Promise<Array<Extract<SourceAsset, { kind: "image" }>>> {
  const mediaRootDir = options.mediaRootDir;

  if (!mediaRootDir) {
    return [];
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const assets: Array<Extract<SourceAsset, { kind: "image" }>> = [];
  const safeSourceId = sanitizePathSegment(options.sourceId);

  for (const figure of options.figures) {
    try {
      const image = await readFigureImage(figure.imageRef, fetchImpl);

      if (!image || image.bytes.byteLength > maxImageBytes) {
        continue;
      }

      const extension = inferImageExtension(image.contentType, image.sourceUrl ?? figure.imageRef);

      if (!extension) {
        continue;
      }

      const fileName = `${figure.index}.${extension}`;
      await writeMediaFile(mediaRootDir, safeSourceId, fileName, image.bytes);
      assets.push({
        id: `${options.sourceId}-image-${figure.index}`,
        sourceId: options.sourceId,
        kind: "image",
        url: `/media/${encodeURIComponent(safeSourceId)}/${encodeURIComponent(fileName)}`,
        caption: ensureCaptionHasLabel(figure.figureLabel, figure.caption),
        figureLabel: figure.figureLabel,
        createdAt
      });
    } catch {
      continue;
    }
  }

  return assets;
}

export function createFigureCaptionChunks(sourceId: string, figures: ArxivHtmlFigure[]) {
  return figures
    .map((figure) => ensureCaptionHasLabel(figure.figureLabel, figure.caption))
    .filter((caption) => caption.length > 0)
    .map((caption, index) => ({
      id: `${sourceId}-figure-caption-${index + 1}`,
      sourceId,
      content: caption
    }));
}

function hasLatexmlStructure(html: string): boolean {
  return /\bltx_page_main\b/i.test(html) || /\bltx_section\b/i.test(html);
}

function addBucketText(
  bucketDrafts: Map<ArxivSectionKind, { titles: string[]; texts: string[] }>,
  seenText: Set<string>,
  kind: ArxivSectionKind,
  title: string,
  text: string
): void {
  const normalizedText = text.trim();

  if (!normalizedText || seenText.has(normalizedText)) {
    return;
  }

  seenText.add(normalizedText);
  const draft = bucketDrafts.get(kind) ?? { titles: [], texts: [] };

  if (!draft.titles.includes(title)) {
    draft.titles.push(title);
  }

  draft.texts.push(normalizedText);
  bucketDrafts.set(kind, draft);
}

function buildBuckets(bucketDrafts: Map<ArxivSectionKind, { titles: string[]; texts: string[] }>): ArxivHtmlBucket[] {
  const buckets: ArxivHtmlBucket[] = [];

  for (const kind of bucketOrder) {
    const draft = bucketDrafts.get(kind);

    if (!draft) {
      continue;
    }

    const chunks = chunkText(draft.texts.join("\n\n"), maxChunkCharacters);

    if (!chunks.length) {
      continue;
    }

    buckets.push({
      kind,
      title: draft.titles.join(" / "),
      chunks
    });
  }

  return buckets;
}

function limitTotalChunks(buckets: ArxivHtmlBucket[], maxChunks: number): boolean {
  let total = 0;
  let truncated = false;

  for (const bucket of buckets) {
    if (total >= maxChunks) {
      bucket.chunks = [];
      truncated = true;
      continue;
    }

    const remaining = maxChunks - total;

    if (bucket.chunks.length > remaining) {
      bucket.chunks = bucket.chunks.slice(0, remaining);
      truncated = true;
    }

    total += bucket.chunks.length;
  }

  for (let index = buckets.length - 1; index >= 0; index -= 1) {
    if (buckets[index].chunks.length === 0) {
      buckets.splice(index, 1);
    }
  }

  return truncated;
}

function classifySectionKind(title: string): ArxivSectionKind {
  const normalizedTitle = title.toLowerCase();

  if (titleIncludesAny(normalizedTitle, ["abstract", "introduction", "background", "related work", "motivation", "problem"])) {
    return "motivation";
  }

  if (titleIncludesAny(normalizedTitle, ["method", "approach", "model", "architecture", "mechanism", "framework", "taxonomy", "design"])) {
    return "method";
  }

  if (titleIncludesAny(normalizedTitle, ["experiment", "setup", "evaluation", "implementation", "benchmark"])) {
    return "experiment";
  }

  if (titleIncludesAny(normalizedTitle, ["result", "discussion", "ablation", "analysis"])) {
    return "result";
  }

  if (titleIncludesAny(normalizedTitle, ["limitation", "conclusion", "future", "challenge"])) {
    return "conclusion";
  }

  return "other";
}

function isBoilerplateSectionTitle(title: string): boolean {
  return /\b(?:acknowledg\w*|references|conflict of interest|data availability|ethics statement|funding|author contributions?)\b/i.test(
    title
  );
}

function titleIncludesAny(title: string, terms: string[]): boolean {
  return terms.some((term) => title.includes(term));
}

function extractDocumentTitle(html: string): string | undefined {
  const candidate =
    extractElementsByClass(html, "ltx_title").find((element) => /<h1\b/i.test(element.openTag)) ??
    extractElementsByClass(html, "ltx_title")[0];
  const title = normalizeHtmlText(stripTags(candidate?.innerHtml ?? ""));

  return title || undefined;
}

function removeSectionNonText(sectionHtml: string, titleOuterHtml?: string): string {
  let bodyHtml = sectionHtml;

  if (titleOuterHtml) {
    bodyHtml = bodyHtml.replace(titleOuterHtml, " ");
  }

  return removeElementsByTag(removeElementsByTag(removeElementsByTag(bodyHtml, "figure"), "table"), "svg");
}

function extractParagraphTexts(html: string): string[] {
  const ltxParagraphs = extractElementsByClass(html, "ltx_para");
  const paragraphs = ltxParagraphs.length ? ltxParagraphs : extractElementsByTag(html, "p");

  return paragraphs
    .map((paragraph) => normalizeHtmlText(stripTags(paragraph.innerHtml)))
    .filter((paragraph) => paragraph.length > 0);
}

function extractFigures(html: string, htmlPageUrl: string): ArxivHtmlFigure[] {
  const baseUrl = resolveDocumentBaseUrl(html, htmlPageUrl);
  const seenImageRefs = new Set<string>();
  const figures: ArxivHtmlFigure[] = [];

  for (const figure of extractElementsByTag(html, "figure")) {
    const src = readAttribute(extractElementsByTag(figure.innerHtml, "img")[0]?.openTag ?? "", "src");

    if (!src) {
      continue;
    }

    const imageRef = resolveImageRef(src, baseUrl);

    if (seenImageRefs.has(imageRef)) {
      continue;
    }

    seenImageRefs.add(imageRef);
    const captionElement =
      extractElementsByTag(figure.innerHtml, "figcaption")[0] ??
      extractElementsByClass(figure.innerHtml, "ltx_caption")[0];
    const caption = normalizeHtmlText(stripTags(captionElement?.innerHtml ?? ""));
    const figureLabel = extractFigureLabel(caption) ?? `Figure ${figures.length + 1}`;

    figures.push({
      index: figures.length + 1,
      figureLabel,
      caption,
      imageRef
    });
  }

  return figures;
}

function resolveDocumentBaseUrl(html: string, htmlPageUrl: string): string {
  const baseTag = html.match(/<base\b[^>]*>/i)?.[0];
  const baseHref = baseTag ? readAttribute(baseTag, "href") : undefined;

  if (!baseHref) {
    return htmlPageUrl;
  }

  try {
    return new URL(baseHref, htmlPageUrl).toString();
  } catch {
    return htmlPageUrl;
  }
}

function extractFigureLabel(caption: string): string | undefined {
  const match = caption.match(/\b(Figure|Table)\s+([A-Za-z0-9]+(?:[.\-][A-Za-z0-9]+)*)/i);

  if (!match) {
    return undefined;
  }

  const labelKind = match[1].toLowerCase() === "table" ? "Table" : "Figure";

  return `${labelKind} ${match[2]}`;
}

function resolveImageRef(src: string, htmlPageUrl: string): string {
  if (/^data:/i.test(src)) {
    return src;
  }

  return new URL(src, htmlPageUrl).toString();
}

async function readFigureImage(imageRef: string, fetchImpl: typeof fetch | undefined): Promise<ImageBytes | undefined> {
  if (/^data:/i.test(imageRef)) {
    return decodeDataUri(imageRef);
  }

  const url = new URL(imageRef);

  if (!isAllowedArxivHost(url.hostname) || (url.protocol !== "https:" && url.protocol !== "http:")) {
    return undefined;
  }

  if (!fetchImpl) {
    throw new Error("A fetch implementation is required to cache arXiv image assets.");
  }

  const response = await fetchImpl(url.toString());

  if (!response.ok) {
    return undefined;
  }

  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);

  if (Number.isFinite(contentLength) && contentLength > maxImageBytes) {
    return undefined;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  return {
    bytes,
    contentType: response.headers.get("content-type") ?? undefined,
    sourceUrl: url.toString()
  };
}

function decodeDataUri(dataUri: string): ImageBytes | undefined {
  const match = dataUri.match(/^data:([^;,]+)?((?:;[^,]*)*),(.*)$/is);

  if (!match) {
    return undefined;
  }

  const contentType = match[1]?.toLowerCase();
  const parameters = match[2] ?? "";
  const payload = match[3] ?? "";
  const bytes = parameters.toLowerCase().includes(";base64")
    ? decodeBase64(payload)
    : new TextEncoder().encode(decodeURIComponent(payload));

  return {
    bytes,
    contentType,
    sourceUrl: dataUri
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function inferImageExtension(contentType: string | undefined, sourceUrl: string): string | undefined {
  const normalizedContentType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  const extensionFromContentType = normalizedContentType
    ? imageExtensionsByMimeType.get(normalizedContentType)
    : undefined;

  if (extensionFromContentType) {
    return extensionFromContentType;
  }

  if (/^data:/i.test(sourceUrl)) {
    return undefined;
  }

  const extension = new URL(sourceUrl).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const normalizedExtension = extension === "jpeg" ? "jpg" : extension;

  return normalizedExtension && allowedImageExtensions.has(normalizedExtension) ? normalizedExtension : undefined;
}

function isAllowedArxivHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();

  return normalizedHostname === "arxiv.org" || normalizedHostname.endsWith(".arxiv.org");
}

async function writeMediaFile(
  mediaRootDir: string,
  sourceId: string,
  fileName: string,
  bytes: Uint8Array
): Promise<void> {
  const { mkdir, writeFile } = await importNodeModule<NodeFsPromisesSubset>("node:fs/promises");
  const { join } = await importNodeModule<NodePathSubset>("node:path");
  const directory = join(mediaRootDir, sourceId);

  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, fileName), bytes);
}

async function importNodeModule<T>(specifier: string): Promise<T> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<T>;

  return dynamicImport(specifier);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/(^-+|-+$)/g, "") || "source";
}

function ensureCaptionHasLabel(figureLabel: string, caption: string): string {
  const normalizedCaption = normalizeHtmlText(caption);

  if (!normalizedCaption) {
    return figureLabel;
  }

  return normalizedCaption.toLowerCase().startsWith(figureLabel.toLowerCase())
    ? normalizedCaption
    : `${figureLabel}: ${normalizedCaption}`;
}

function extractElementsByClass(html: string, className: string): HtmlElement[] {
  const elements: HtmlElement[] = [];
  const openTagPattern = /<([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let match: RegExpExecArray | null;

  while ((match = openTagPattern.exec(html))) {
    const openTag = match[0];

    if (!tagHasClass(openTag, className)) {
      continue;
    }

    const tagName = match[1].toLowerCase();
    const startIndex = match.index;
    const innerStart = startIndex + openTag.length;
    const endIndex = findMatchingCloseTag(html, tagName, innerStart);

    if (endIndex === undefined) {
      continue;
    }

    elements.push({
      tagName,
      openTag,
      innerHtml: html.slice(innerStart, endIndex.start),
      outerHtml: html.slice(startIndex, endIndex.end)
    });
  }

  return elements;
}

function extractElementsByTag(html: string, tagName: string): HtmlElement[] {
  const elements: HtmlElement[] = [];
  const openTagPattern = new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  let match: RegExpExecArray | null;

  while ((match = openTagPattern.exec(html))) {
    const openTag = match[0];
    const startIndex = match.index;
    const innerStart = startIndex + openTag.length;
    const endIndex = findMatchingCloseTag(html, tagName.toLowerCase(), innerStart);

    if (endIndex === undefined) {
      if (tagName.toLowerCase() === "img") {
        elements.push({
          tagName,
          openTag,
          innerHtml: "",
          outerHtml: openTag
        });
      }

      continue;
    }

    elements.push({
      tagName,
      openTag,
      innerHtml: html.slice(innerStart, endIndex.start),
      outerHtml: html.slice(startIndex, endIndex.end)
    });
  }

  return elements;
}

function removeElementsByClass(html: string, className: string): string {
  return extractElementsByClass(html, className).reduce(
    (currentHtml, element) => currentHtml.replace(element.outerHtml, " "),
    html
  );
}

function removeElementsByTag(html: string, tagName: string): string {
  return extractElementsByTag(html, tagName).reduce(
    (currentHtml, element) => currentHtml.replace(element.outerHtml, " "),
    html
  );
}

function findMatchingCloseTag(
  html: string,
  tagName: string,
  searchFrom: number
): { start: number; end: number } | undefined {
  if (isVoidHtmlTag(tagName)) {
    return undefined;
  }

  const tagPattern = new RegExp(`</?${escapeRegExp(tagName)}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = searchFrom;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html))) {
    const isClosingTag = /^<\//.test(match[0]);

    if (isClosingTag) {
      depth -= 1;

      if (depth === 0) {
        return {
          start: match.index,
          end: match.index + match[0].length
        };
      }

      continue;
    }

    if (!/\/>$/.test(match[0])) {
      depth += 1;
    }
  }

  return undefined;
}

function isVoidHtmlTag(tagName: string): boolean {
  return ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"].includes(
    tagName.toLowerCase()
  );
}

function tagHasClass(tag: string, className: string): boolean {
  const classValue = readAttribute(tag, "class");

  return classValue ? classValue.split(/\s+/).includes(className) : false;
}

function readAttribute(tag: string, attributeName: string): string | undefined {
  const pattern = new RegExp(
    `\\b${escapeRegExp(attributeName)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = tag.match(pattern);

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h1|h2|h3|h4|blockquote|figcaption)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function normalizeHtmlText(value: string): string {
  return decodeHtmlEntities(value).replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s+/g, "\n").replace(/\s+\n/g, "\n").trim();
}

function decodeHtmlEntities(value: string): string {
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

function chunkText(text: string, maxLength: number): string[] {
  const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    for (const part of splitLongText(paragraph, maxLength)) {
      const next = current ? `${current}\n\n${part}` : part;

      if (next.length > maxLength && current) {
        chunks.push(current);
        current = part;
        continue;
      }

      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function splitLongText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const sentences = text.split(/(?<=[.!?。！？])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const hardParts = sentence.length > maxLength ? splitEvery(sentence, maxLength) : [sentence];

    for (const hardPart of hardParts) {
      const next = current ? `${current} ${hardPart}` : hardPart;

      if (next.length > maxLength && current) {
        parts.push(current);
        current = hardPart;
        continue;
      }

      current = next;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function splitEvery(text: string, maxLength: number): string[] {
  const parts: string[] = [];

  for (let index = 0; index < text.length; index += maxLength) {
    parts.push(text.slice(index, index + maxLength));
  }

  return parts;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
