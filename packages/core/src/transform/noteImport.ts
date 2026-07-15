import {
  createAutomaticConceptAliases,
  createConceptAliasResolver,
  type ConceptAliasOptions
} from "../graph/conceptAliases.js";
import { createSourceRegistry, hashContent } from "../source/sourceRegistry.js";
import type { ContentLanguage } from "../harness/contentLanguage.js";
import type {
  KnowledgeChunk,
  KnowledgePost,
  Source,
  SourceAsset,
  SourceImport,
  SourceRegistry
} from "../types.js";

export interface UserNoteTransformOptions extends ConceptAliasOptions {
  createdAt?: string;
  /** Library concepts to match against so the note joins the knowledge graph. */
  libraryConcepts?: string[];
  libraryCards?: KnowledgePost[];
  kind?: "note" | "idea";
  userLabel?: string;
  contentLanguage?: ContentLanguage;
}

export interface UserNoteTransformResult {
  source: Source;
  asset: SourceAsset;
  chunks: KnowledgeChunk[];
  post: KnowledgePost;
  sourceRegistry: SourceRegistry;
  importRecord: SourceImport;
}

/**
 * Turns a user-authored note into a first-class source + post. The note is
 * self-grounded: its citations point at its own registry chunk, so the
 * grounding gate, evidence ledger and grounded Q&A all keep working. No model
 * is involved — the user's words are the ground truth.
 */
export function transformUserNote(text: string, options: UserNoteTransformOptions = {}): UserNoteTransformResult {
  const noteText = text.trim();

  if (!noteText) {
    throw new Error("A note needs some text before it can be posted.");
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  const noteHash = hashContent(`${noteText}|${createdAt}`).replace("fnv1a32-", "");
  const source: Source = {
    id: `note-${noteHash}`,
    title: buildNoteTitle(noteText),
    url: options.kind === "idea" ? `local://ideas/${noteHash}` : `local://notes/${noteHash}`,
    type: "user_note",
    author: options.userLabel ?? (options.contentLanguage === "en" ? "You" : "你"),
    publishedAt: createdAt
  };
  const asset: SourceAsset = {
    id: `${source.id}-text`,
    sourceId: source.id,
    kind: "text",
    content: noteText,
    createdAt
  };
  const concepts = matchLibraryConcepts(noteText, options.libraryConcepts ?? [], {
    libraryCards: options.libraryCards,
    conceptAliases: options.conceptAliases
  });
  const chunks: KnowledgeChunk[] = [
    {
      id: `${source.id}-chunk-1`,
      sourceId: source.id,
      content: noteText,
      conceptHints: concepts
    }
  ];
  const sourceRegistry = createSourceRegistry({
    sources: [source],
    assets: [asset],
    chunks,
    createdAt
  });
  const post: KnowledgePost = {
    id: `${source.id}-post`,
    kind: options.kind === "idea" ? "idea" : undefined,
    title: source.title,
    hook: noteText,
    thesis: noteText,
    shortBody: noteText,
    summary: noteText,
    keyTakeaway: firstSentence(noteText),
    concepts,
    sources: [source],
    citations: [{ sourceId: source.id, chunkId: chunks[0]!.id }],
    recommendedBecause:
      options.kind === "idea"
        ? options.contentLanguage === "en"
          ? "Your idea."
          : "你发布的想法。"
        : options.contentLanguage === "en"
          ? "Your note."
          : "你发布的笔记。",
    trustState: "emerging",
    createdAt,
    estimatedReadMinutes: Math.max(1, Math.round(noteText.length / 600)),
    difficulty: "beginner",
    confidence: "high",
    thread: [],
    graphEdges: [],
    reviewPrompts: [],
    nextActions: [],
    harnessVersion: options.kind === "idea" ? "user-idea-v1" : "user-note-v1"
  };
  const importRecord: SourceImport = {
    id: `import-${source.id}`,
    source,
    status: "ready",
    createdAt
  };

  return { source, asset, chunks, post, sourceRegistry, importRecord };
}

function buildNoteTitle(text: string): string {
  const firstLine = text.split(/\n+/, 1)[0] ?? text;

  return firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine;
}

function firstSentence(text: string): string {
  return text.split(/(?<=[。！？.!?])\s*/, 1)[0] ?? text;
}

export function matchLibraryConcepts(
  text: string,
  libraryConcepts: string[],
  options: ConceptAliasOptions & { libraryCards?: KnowledgePost[] } = {}
): string[] {
  const loweredText = text.toLowerCase();
  const seen = new Set<string>();
  const matches: string[] = [];
  const aliasRecords = [
    ...(options.conceptAliases ?? []),
    ...createAutomaticConceptAliases(options.libraryCards ?? [], options.conceptAliases)
  ];
  const resolver = createConceptAliasResolver(aliasRecords);

  for (const concept of libraryConcepts) {
    const resolved = resolver.resolveConcept(concept);
    const slug = resolver.slugConcept(resolved);
    const candidates = conceptMatchCandidates(concept, aliasRecords, resolver);

    if (!slug || seen.has(slug) || !candidates.some((candidate) => loweredText.includes(candidate))) {
      continue;
    }

    seen.add(slug);
    matches.push(resolved);
  }

  return matches.slice(0, 5);
}

function conceptMatchCandidates(
  concept: string,
  aliases: NonNullable<ConceptAliasOptions["conceptAliases"]>,
  resolver: ReturnType<typeof createConceptAliasResolver>
): string[] {
  const resolved = resolver.resolveConcept(concept);
  const slug = resolver.slugConcept(resolved);
  const candidates = new Set<string>([concept, resolved]);

  for (const record of aliases) {
    if (resolver.slugConcept(resolver.resolveConcept(record.canonical)) !== slug) {
      continue;
    }

    candidates.add(record.canonical);
    record.aliases.forEach((alias) => candidates.add(alias));
  }

  return Array.from(candidates).map((value) => value.trim().toLowerCase()).filter(Boolean);
}
