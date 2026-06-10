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
  const snapshotBySourceId = new Map(snapshots.map((snapshot) => [snapshot.sourceId, snapshot]));
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
  return {
    sources: dedupeById(registries.flatMap((registry) => registry.sources)),
    assets: dedupeById(registries.flatMap((registry) => registry.assets)),
    snapshots: dedupeById(registries.flatMap((registry) => registry.snapshots)),
    chunks: dedupeById(registries.flatMap((registry) => registry.chunks)),
    chunkVersions: dedupeById(registries.flatMap((registry) => registry.chunkVersions))
  };
}

export function createSourceSnapshot(asset: SourceAsset, createdAt = asset.createdAt, version = 1): SourceSnapshot {
  return {
    id: `${asset.id}-snapshot-v${version}`,
    sourceId: asset.sourceId,
    assetId: asset.id,
    kind: asset.kind,
    version,
    contentHash: hashContent(asset.content),
    contentLength: asset.content.length,
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
    id: `${chunk.id}-version-v${version}`,
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
