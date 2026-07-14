export type SubscriptionFeedEntryKind = "article" | "youtube";

export interface SubscriptionFeedEntry {
  title: string;
  link: string;
  publishedAt?: string;
  summary?: string;
  kind: SubscriptionFeedEntryKind;
}

export interface ParsedSubscriptionFeed {
  title?: string;
  siteUrl?: string;
  entries: SubscriptionFeedEntry[];
  kind: SubscriptionFeedEntryKind;
  error?: string;
}

export interface NormalizeYouTubeFeedUrlOptions {
  fetch?: typeof fetch;
}

export interface NormalizedSubscriptionFeedUrl {
  feedUrl: string;
  siteUrl?: string;
  kind: "rss" | "youtube_channel";
}

interface XmlNode {
  name: string;
  localName: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string[];
}

const youtubeChannelIdPattern = /^UC[A-Za-z0-9_-]{20,}$/;
const youtubeFeedBaseUrl = "https://www.youtube.com/feeds/videos.xml";

export function parseSubscriptionFeed(xml: string, feedUrl?: string): ParsedSubscriptionFeed {
  const itemKind = inferFeedEntryKind(feedUrl, xml);

  try {
    const parsed = parseXml(xml);

    if (parsed.error || !parsed.root) {
      return {
        entries: [],
        kind: itemKind,
        error: parsed.error ?? "Feed XML did not contain a root element."
      };
    }

    if (parsed.root.localName === "rss") {
      return parseRssFeed(parsed.root, itemKind);
    }

    if (parsed.root.localName === "feed") {
      return parseAtomFeed(parsed.root, itemKind);
    }

    return {
      entries: [],
      kind: itemKind,
      error: `Unsupported feed root "${parsed.root.name}".`
    };
  } catch (error) {
    return {
      entries: [],
      kind: itemKind,
      error: error instanceof Error ? error.message : "Feed XML could not be parsed."
    };
  }
}

export async function normalizeSubscriptionFeedUrl(
  inputUrl: string,
  options: NormalizeYouTubeFeedUrlOptions = {}
): Promise<NormalizedSubscriptionFeedUrl> {
  const parsedUrl = parseHttpUrl(inputUrl);

  if (!isYouTubeHost(parsedUrl.hostname)) {
    return {
      feedUrl: parsedUrl.toString(),
      siteUrl: parsedUrl.toString(),
      kind: "rss"
    };
  }

  const channelIdFromFeed = parsedUrl.pathname === "/feeds/videos.xml" ? parsedUrl.searchParams.get("channel_id") : null;

  if (channelIdFromFeed && youtubeChannelIdPattern.test(channelIdFromFeed)) {
    return buildYouTubeFeedNormalization(channelIdFromFeed);
  }

  const channelIdFromPath = parseYouTubeChannelPath(parsedUrl);

  if (channelIdFromPath) {
    return buildYouTubeFeedNormalization(channelIdFromPath);
  }

  const handle = parseYouTubeHandlePath(parsedUrl);

  if (handle) {
    const fetchImpl = options.fetch ?? globalThis.fetch;

    if (!fetchImpl) {
      throw new Error("A fetch implementation is required to resolve a YouTube handle.");
    }

    const html = await fetchTextWithRetry(fetchImpl, buildYouTubeHandleUrl(handle), youtubePageRequestInit);
    const channelId = extractYouTubeChannelIdFromHtml(html);

    if (!channelId) {
      throw new Error("Could not find a YouTube channel id on the handle page.");
    }

    return buildYouTubeFeedNormalization(channelId, buildYouTubeHandleUrl(handle));
  }

  throw new Error("Please enter a YouTube channel URL, @handle URL, or channel feed URL.");
}

export function extractYouTubeChannelIdFromHtml(html: string): string | undefined {
  const patterns = [
    // externalId is the page owner's channel id; a plain "channelId" earlier in
    // the document can belong to a recommended channel, so it is only a fallback.
    /"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{20,})"/,
    /"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{20,})"/,
    /itemprop=["']channelId["']\s+content=["'](UC[A-Za-z0-9_-]{20,})["']/,
    /content=["'](UC[A-Za-z0-9_-]{20,})["']\s+itemprop=["']channelId["']/,
    /youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})/
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function parseRssFeed(root: XmlNode, kind: SubscriptionFeedEntryKind): ParsedSubscriptionFeed {
  const channel = findDirectChild(root, "channel");

  if (!channel) {
    return {
      entries: [],
      kind,
      error: "RSS feed did not contain a channel element."
    };
  }

  const title = readDirectChildText(channel, "title");
  const siteUrl = readDirectChildText(channel, "link");
  const entries = directChildren(channel, "item").map((item) => ({
    title: readDirectChildText(item, "title") || "Untitled feed item",
    link: readDirectChildText(item, "link") || readDirectChildText(item, "guid"),
    publishedAt: normalizeDateText(
      readDirectChildText(item, "pubDate") ||
        readDirectChildText(item, "published") ||
        readDirectChildText(item, "updated") ||
        readDirectChildText(item, "date")
    ),
    summary: normalizeSummary(
      readDirectChildText(item, "description") ||
        readDirectChildText(item, "summary") ||
        readDirectChildText(item, "encoded")
    ),
    kind
  }));

  return {
    title,
    siteUrl,
    entries: dedupeEntries(entries),
    kind
  };
}

function parseAtomFeed(root: XmlNode, kind: SubscriptionFeedEntryKind): ParsedSubscriptionFeed {
  const title = readDirectChildText(root, "title");
  const siteUrl = readAtomLink(root);
  const entries = directChildren(root, "entry").map((entry) => ({
    title: readDirectChildText(entry, "title") || "Untitled feed item",
    link: readAtomLink(entry) || readDirectChildText(entry, "id"),
    publishedAt: normalizeDateText(readDirectChildText(entry, "published") || readDirectChildText(entry, "updated")),
    summary: normalizeSummary(readDirectChildText(entry, "summary") || readDirectChildText(entry, "content")),
    kind
  }));

  return {
    title,
    siteUrl,
    entries: dedupeEntries(entries),
    kind
  };
}

function readAtomLink(node: XmlNode): string {
  const link =
    directChildren(node, "link").find((child) => {
      const rel = child.attrs.rel?.trim().toLowerCase();

      return !rel || rel === "alternate";
    }) ?? findDirectChild(node, "link");

  return link?.attrs.href?.trim() || (link ? textContent(link).trim() : "");
}

function inferFeedEntryKind(feedUrl: string | undefined, xml: string): SubscriptionFeedEntryKind {
  if (feedUrl) {
    try {
      const parsedUrl = new URL(feedUrl);

      if (isYouTubeHost(parsedUrl.hostname) && parsedUrl.pathname === "/feeds/videos.xml") {
        return "youtube";
      }
    } catch {
      // Fall back to XML markers below.
    }
  }

  return /<(?:[A-Za-z0-9_-]+:)?channelId\b|<(?:[A-Za-z0-9_-]+:)?videoId\b|youtube\.com\/watch\?/i.test(xml)
    ? "youtube"
    : "article";
}

function dedupeEntries(entries: SubscriptionFeedEntry[]): SubscriptionFeedEntry[] {
  const byKey = new Map<string, SubscriptionFeedEntry>();

  for (const entry of entries) {
    const key = entry.link || `${entry.title}|${entry.publishedAt ?? ""}`;

    if (!key.trim()) {
      continue;
    }

    byKey.set(key, entry);
  }

  return Array.from(byKey.values());
}

function normalizeDateText(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const date = new Date(value.trim());

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeSummary(value: string): string | undefined {
  const summary = stripTags(value).replace(/\s+/g, " ").trim();

  return summary || undefined;
}

function directChildren(node: XmlNode, localName: string): XmlNode[] {
  return node.children.filter((child) => child.localName === localName);
}

function findDirectChild(node: XmlNode, localName: string): XmlNode | undefined {
  return directChildren(node, localName)[0];
}

function readDirectChildText(node: XmlNode, localName: string): string {
  const child = findDirectChild(node, localName);

  return child ? textContent(child).trim() : "";
}

function textContent(node: XmlNode): string {
  return [node.text.join(""), ...node.children.map((child) => textContent(child))].join("");
}

function parseXml(xml: string): { root?: XmlNode; error?: string } {
  const documentNode = createXmlNode("#document", {});
  const stack: XmlNode[] = [documentNode];
  let index = 0;

  while (index < xml.length) {
    const tagStart = xml.indexOf("<", index);

    if (tagStart < 0) {
      appendText(stack, decodeXmlEntities(xml.slice(index)));
      break;
    }

    if (tagStart > index) {
      appendText(stack, decodeXmlEntities(xml.slice(index, tagStart)));
    }

    if (xml.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = xml.indexOf("]]>", tagStart + 9);

      if (cdataEnd < 0) {
        return { error: "CDATA section was not closed." };
      }

      appendText(stack, xml.slice(tagStart + 9, cdataEnd));
      index = cdataEnd + 3;
      continue;
    }

    if (xml.startsWith("<!--", tagStart)) {
      const commentEnd = xml.indexOf("-->", tagStart + 4);

      if (commentEnd < 0) {
        return { error: "XML comment was not closed." };
      }

      index = commentEnd + 3;
      continue;
    }

    if (xml.startsWith("<?", tagStart)) {
      const instructionEnd = xml.indexOf("?>", tagStart + 2);

      if (instructionEnd < 0) {
        return { error: "XML processing instruction was not closed." };
      }

      index = instructionEnd + 2;
      continue;
    }

    if (xml.startsWith("<!", tagStart)) {
      const declarationEnd = findTagEnd(xml, tagStart + 2);

      if (declarationEnd < 0) {
        return { error: "XML declaration was not closed." };
      }

      index = declarationEnd + 1;
      continue;
    }

    const tagEnd = findTagEnd(xml, tagStart + 1);

    if (tagEnd < 0) {
      return { error: "XML tag was not closed." };
    }

    const rawTag = xml.slice(tagStart + 1, tagEnd).trim();
    index = tagEnd + 1;

    if (!rawTag) {
      return { error: "XML tag was empty." };
    }

    if (rawTag.startsWith("/")) {
      const closeName = rawTag.slice(1).trim().split(/\s+/, 1)[0] ?? "";
      const current = stack[stack.length - 1];

      if (!current || current.localName !== localName(closeName)) {
        return { error: `XML closing tag "${closeName}" did not match.` };
      }

      stack.pop();
      continue;
    }

    const selfClosing = /\/\s*$/.test(rawTag);
    const normalizedTag = selfClosing ? rawTag.replace(/\/\s*$/, "").trim() : rawTag;
    const nameMatch = normalizedTag.match(/^([^\s/>]+)/);
    const name = nameMatch?.[1] ?? "";

    if (!name) {
      return { error: "XML opening tag had no name." };
    }

    const attrs = parseAttributes(normalizedTag.slice(name.length));
    const node = createXmlNode(name, attrs);

    stack[stack.length - 1]?.children.push(node);

    if (!selfClosing) {
      stack.push(node);
    }
  }

  if (stack.length !== 1) {
    return { error: `XML tag "${stack[stack.length - 1]?.name ?? ""}" was not closed.` };
  }

  const roots = documentNode.children.filter((node) => node.name !== "#text");

  if (roots.length !== 1) {
    return { error: "Feed XML must contain exactly one root element." };
  }

  return { root: roots[0] };
}

function createXmlNode(name: string, attrs: Record<string, string>): XmlNode {
  return {
    name,
    localName: localName(name),
    attrs,
    children: [],
    text: []
  };
}

function appendText(stack: XmlNode[], text: string): void {
  if (text) {
    stack[stack.length - 1]?.text.push(text);
  }
}

function findTagEnd(xml: string, startIndex: number): number {
  let quote: string | null = null;

  for (let index = startIndex; index < xml.length; index += 1) {
    const char = xml[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === ">") {
      return index;
    }
  }

  return -1;
}

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(rawAttrs))) {
    attrs[match[1]] = decodeXmlEntities(match[3] ?? match[4] ?? match[5] ?? "");
  }

  return attrs;
}

function localName(name: string): string {
  return name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
}

// Common HTML named entities that real-world feeds emit inside titles and
// summaries even though strict XML only defines the five predefined ones.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  laquo: "«",
  raquo: "»",
  times: "×",
  deg: "°",
  eacute: "é"
};

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, rawName: string) => {
    const name = rawName.toLowerCase();

    if (name.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }

    if (name.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }

    return NAMED_ENTITIES[name] ?? entity;
  });
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function parseHttpUrl(inputUrl: string): URL {
  try {
    const trimmedUrl = inputUrl.trim();
    const parsedUrl = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("URL must use http or https.");
    }

    return parsedUrl;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Please enter a valid URL.");
  }
}

function parseYouTubeChannelPath(url: URL): string | undefined {
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (pathParts[0] === "channel" && pathParts[1] && youtubeChannelIdPattern.test(pathParts[1])) {
    return pathParts[1];
  }

  return undefined;
}

function parseYouTubeHandlePath(url: URL): string | undefined {
  const pathPart = url.pathname.split("/").filter(Boolean)[0];

  return pathPart?.startsWith("@") && pathPart.length > 1 ? pathPart : undefined;
}

function buildYouTubeFeedNormalization(channelId: string, siteUrl?: string): NormalizedSubscriptionFeedUrl {
  const feedUrl = new URL(youtubeFeedBaseUrl);
  feedUrl.searchParams.set("channel_id", channelId);

  return {
    feedUrl: feedUrl.toString(),
    siteUrl: siteUrl ?? `https://www.youtube.com/channel/${channelId}`,
    kind: "youtube_channel"
  };
}

function buildYouTubeHandleUrl(handle: string): string {
  return `https://www.youtube.com/${handle}`;
}

function isYouTubeHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^www\./, "");

  return normalized === "youtube.com" || normalized === "m.youtube.com";
}

// YouTube intermittently answers channel pages with 404 for non-browser
// clients; a desktop identity keeps handle resolution stable.
const youtubePageRequestInit: RequestInit = {
  headers: {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "accept-language": "en-US,en;q=0.9"
  }
};

const transientRetryDelayMs = 500;

async function fetchText(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<string> {
  const response = await fetchImpl(url, init);

  if (!response.ok) {
    throw new Error(`Feed URL request failed with ${response.status}.`);
  }

  return response.text();
}

async function fetchTextWithRetry(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<string> {
  try {
    return await fetchText(fetchImpl, url, init);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, transientRetryDelayMs));

    return fetchText(fetchImpl, url, init);
  }
}
