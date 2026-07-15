import type { ConceptAliasOptions } from "../graph/conceptAliases.js";
import { createSourceRegistry, hashContent } from "../source/sourceRegistry.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import { matchLibraryConcepts } from "./noteImport.js";
import type {
  KnowledgeChunk,
  KnowledgePost,
  Source,
  SourceAsset,
  SourceImport,
  SourceRegistry
} from "../types.js";

export interface ConversationCaptureInput {
  topic: string;
  excerpt: string;
  agentName?: string;
}

export interface ConversationCaptureOptions extends ConceptAliasOptions {
  capturedAt?: string;
  libraryConcepts?: string[];
  libraryCards?: KnowledgePost[];
  contentLanguage?: ContentLanguage;
}

export interface ConversationCaptureResult {
  source: Source;
  asset: SourceAsset;
  chunks: KnowledgeChunk[];
  post: KnowledgePost;
  sourceRegistry: SourceRegistry;
  importRecord: SourceImport;
}

export const conversationExcerptMinLength = 120;
export const conversationExcerptMaxLength = 4000;

/**
 * Turns a learning exchange captured from an external agent conversation into
 * a first-class source + post. Like user notes, the capture is self-grounded:
 * the excerpt is registered as the citable source text and the card's
 * citations point at it, so the grounding gate and evidence ledger keep
 * working. No model is involved — the card is extractive, and the source is
 * "what was said", visibly attributed to the agent rather than presented as an
 * original source.
 *
 * The source id is content-addressed from the excerpt alone, so re-capturing
 * the same exchange is naturally idempotent.
 */
export function transformConversationCapture(
  input: ConversationCaptureInput,
  options: ConversationCaptureOptions = {}
): ConversationCaptureResult {
  const topic = input.topic.trim();
  const excerptText = input.excerpt.trim();

  if (!topic) {
    throw new Error("A conversation capture needs a topic.");
  }

  if (excerptText.length < conversationExcerptMinLength) {
    throw new Error(
      `A conversation excerpt needs at least ${conversationExcerptMinLength} characters of the actual exchange.`
    );
  }

  const excerpt =
    excerptText.length > conversationExcerptMaxLength
      ? `${excerptText.slice(0, conversationExcerptMaxLength - 1)}…`
      : excerptText;
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  const agentName = input.agentName?.trim() || "AI agent";
  const captureHash = hashContent(excerpt).replace("fnv1a32-", "");
  const source: Source = {
    id: `conversation-${captureHash}`,
    title: topic,
    url: `local://conversations/${captureHash}`,
    type: "conversation",
    author: agentName,
    publishedAt: capturedAt
  };
  const asset: SourceAsset = {
    id: `${source.id}-text`,
    sourceId: source.id,
    kind: "text",
    content: excerpt,
    createdAt: capturedAt
  };
  const concepts = matchLibraryConcepts(`${topic}\n${excerpt}`, options.libraryConcepts ?? [], {
    libraryCards: options.libraryCards,
    conceptAliases: options.conceptAliases
  });
  const chunks: KnowledgeChunk[] = [
    {
      id: `${source.id}-chunk-1`,
      sourceId: source.id,
      content: excerpt,
      conceptHints: concepts
    }
  ];
  const sourceRegistry = createSourceRegistry({
    sources: [source],
    assets: [asset],
    chunks,
    createdAt: capturedAt
  });
  const post: KnowledgePost = {
    id: `${source.id}-post`,
    title: topic,
    hook: firstSentence(excerpt),
    thesis: excerpt,
    shortBody: excerpt,
    summary: excerpt,
    keyTakeaway: firstSentence(excerpt),
    concepts,
    sources: [source],
    citations: [{ sourceId: source.id, chunkId: chunks[0]!.id }],
    recommendedBecause:
      options.contentLanguage === "en"
        ? `Captured from your learning conversation with ${agentName}.`
        : `采集自你与 ${agentName} 的学习对话。`,
    trustState: "emerging",
    createdAt: capturedAt,
    estimatedReadMinutes: Math.max(1, Math.round(excerpt.length / 600)),
    difficulty: "beginner",
    confidence: "medium",
    thread: [],
    graphEdges: [],
    reviewPrompts: [],
    nextActions: [],
    harnessVersion: "conversation-capture-v1"
  };
  const importRecord: SourceImport = {
    id: `import-${source.id}`,
    source,
    status: "ready",
    createdAt: capturedAt
  };

  return { source, asset, chunks, post, sourceRegistry, importRecord };
}

function firstSentence(text: string): string {
  return text.split(/(?<=[。！？.!?])\s*/, 1)[0] ?? text;
}
