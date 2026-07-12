import type {
  KnowledgeChunk,
  Source,
  SourceAsset,
  SourceChunkVersion,
  SourceRegistry,
  SourceSnapshot
} from "../types.js";

export interface CreateSourceRegistryInput {
  sources: Source[];
  assets?: SourceAsset[];
  chunks?: KnowledgeChunk[];
  createdAt?: string;
}

export function createSourceRegistry(input: CreateSourceRegistryInput): SourceRegistry {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const sources = dedupeById(input.sources);
  const assets = dedupeById(input.assets ?? []);
  const chunks = dedupeById(input.chunks ?? []);
  const snapshots = assets.map((asset, index) => createSourceSnapshot(asset, createdAt, index + 1));
  const snapshotBySourceId = createPrimarySnapshotMap(assets, snapshots);
  const chunkVersions = chunks.map((chunk, index) =>
    createSourceChunkVersion(chunk, snapshotBySourceId.get(chunk.sourceId), createdAt, index + 1)
  );

  return {
    sources,
    assets,
    snapshots,
    chunks,
    chunkVersions
  };
}

export function mergeSourceRegistries(...registries: SourceRegistry[]): SourceRegistry {
  // Chunks fold with supersede semantics: callers pass registries in
  // chronological order, so a re-imported chunk shows its latest content while
  // the replaced text is archived on the outgoing version record. Everything
  // else stays first-wins because those ids are content-addressed or immutable.
  let folded: ChunkSupersedeInput = { chunks: [], chunkVersions: [] };
  for (const registry of registries) {
    folded = supersedeChunks(folded, {
      chunks: registry.chunks ?? [],
      chunkVersions: registry.chunkVersions ?? []
    });
  }

  return {
    sources: dedupeById(registries.flatMap((registry) => registry.sources)),
    assets: dedupeById(registries.flatMap((registry) => registry.assets)),
    snapshots: dedupeById(registries.flatMap((registry) => registry.snapshots)),
    chunks: folded.chunks,
    chunkVersions: folded.chunkVersions
  };
}

export interface ChunkSupersedeInput {
  chunks: KnowledgeChunk[];
  chunkVersions: SourceChunkVersion[];
}

// Latest-wins for the live chunk view, but the outgoing version record archives
// the replaced text so citations bound to it keep resolving to what they cited.
export function supersedeChunks(existing: ChunkSupersedeInput, incoming: ChunkSupersedeInput): ChunkSupersedeInput {
  const chunksById = new Map(existing.chunks.map((chunk) => [chunk.id, chunk]));
  const versions = [...existing.chunkVersions];
  const versionIndexById = new Map(versions.map((version, index) => [version.id, index]));

  for (const incomingChunk of incoming.chunks) {
    const current = chunksById.get(incomingChunk.id);
    if (current && hashContent(current.content) !== hashContent(incomingChunk.content)) {
      const currentHash = hashContent(current.content);
      for (let index = 0; index < versions.length; index += 1) {
        const version = versions[index];
        if (version.chunkId === current.id && version.contentHash === currentHash && version.content === undefined) {
          versions[index] = { ...version, content: current.content };
        }
      }
    }
    chunksById.set(incomingChunk.id, incomingChunk);
  }

  for (const incomingVersion of incoming.chunkVersions) {
    const existingIndex = versionIndexById.get(incomingVersion.id);
    if (existingIndex === undefined) {
      versionIndexById.set(incomingVersion.id, versions.length);
      versions.push(incomingVersion);
    }
  }

  return { chunks: [...chunksById.values()], chunkVersions: versions };
}

export function createSourceSnapshot(asset: SourceAsset, createdAt = asset.createdAt, version = 1): SourceSnapshot {
  const snapshotContent = getAssetSnapshotContent(asset);

  return {
    // Content-addressed: re-importing identical content dedupes to the same id,
    // while changed content yields a new snapshot instead of first-wins drift.
    id: `${asset.id}-snapshot-${hashContent(snapshotContent)}`,
    sourceId: asset.sourceId,
    assetId: asset.id,
    kind: asset.kind,
    version,
    contentHash: hashContent(snapshotContent),
    contentLength: snapshotContent.length,
    createdAt
  };
}

export function createSourceChunkVersion(
  chunk: KnowledgeChunk,
  snapshot: SourceSnapshot | undefined,
  createdAt: string,
  version = 1
): SourceChunkVersion {
  return {
    id: `${chunk.id}-version-${hashContent(chunk.content)}`,
    chunkId: chunk.id,
    sourceId: chunk.sourceId,
    snapshotId: snapshot?.id,
    version,
    contentHash: hashContent(chunk.content),
    contentLength: chunk.content.length,
    createdAt,
    startTimeSeconds: chunk.startTimeSeconds,
    endTimeSeconds: chunk.endTimeSeconds,
    conceptHints: chunk.conceptHints
  };
}

export function getRegistrySource(registry: SourceRegistry, sourceId: string): Source | undefined {
  return registry.sources.find((source) => source.id === sourceId);
}

export function getRegistryChunk(registry: SourceRegistry, chunkId: string): KnowledgeChunk | undefined {
  return registry.chunks.find((chunk) => chunk.id === chunkId);
}

// Version-aware resolution: a citation bound to a superseded version reads the
// archived text instead of drifting to whatever the chunk says today.
export function resolveCitedChunk(
  registry: SourceRegistry,
  citation: { chunkId?: string; chunkVersionId?: string }
): KnowledgeChunk | undefined {
  if (!citation.chunkId) return undefined;
  const chunk = getRegistryChunk(registry, citation.chunkId);
  if (!citation.chunkVersionId) return chunk;
  const version = (registry.chunkVersions ?? []).find((candidate) => candidate.id === citation.chunkVersionId);
  if (!version) return chunk;
  if (version.content !== undefined) {
    return chunk
      ? { ...chunk, content: version.content }
      : {
          id: version.chunkId,
          sourceId: version.sourceId,
          content: version.content,
          startTimeSeconds: version.startTimeSeconds,
          endTimeSeconds: version.endTimeSeconds,
          conceptHints: version.conceptHints
        };
  }
  return chunk;
}

export function getChunksForSource(registry: SourceRegistry, sourceId: string): KnowledgeChunk[] {
  return registry.chunks.filter((chunk) => chunk.sourceId === sourceId);
}

export function hashContent(content: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    deduped.push(item);
  }

  return deduped;
}

function createPrimarySnapshotMap(assets: SourceAsset[], snapshots: SourceSnapshot[]): Map<string, SourceSnapshot> {
  const snapshotBySourceId = new Map<string, SourceSnapshot>();

  for (let index = 0; index < snapshots.length; index += 1) {
    const asset = assets[index];
    const snapshot = snapshots[index];

    if (!asset || !snapshot) {
      continue;
    }

    const existing = snapshotBySourceId.get(snapshot.sourceId);

    if (!existing || asset.kind !== "image") {
      snapshotBySourceId.set(snapshot.sourceId, snapshot);
    }
  }

  return snapshotBySourceId;
}

function getAssetSnapshotContent(asset: SourceAsset): string {
  if (asset.kind === "image") {
    return [asset.url, asset.figureLabel, asset.caption].join("\n");
  }

  return asset.content;
}
