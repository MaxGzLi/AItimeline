import type { KnowledgePost, KnowledgePostMediaOrigin, SourceImageAsset } from "../types.js";
import { inferImageExtension, sanitizePathSegment, writeMediaFile } from "./arxivHtmlImport.js";

// 首图缓存上限比 arXiv 插图更紧:信息流首屏一次要加载几十张,大图拖垮首屏。
const maxLeadImageBytes = 3 * 1024 * 1024;

// 落盘写入器。默认就是 arXiv 插图缓存用的那一个;可注入是为了让单测不碰真实文件系统
// (core 不引 node 类型,测试里没法自己开临时目录)。
export type MediaFileWriter = (
  mediaRootDir: string,
  sourceId: string,
  fileName: string,
  bytes: Uint8Array
) => Promise<void>;

export interface LeadImageCacheOptions {
  mediaRootDir?: string;
  writeMedia?: MediaFileWriter;
}

export interface CacheLeadImageAssetOptions extends LeadImageCacheOptions {
  fetch?: typeof fetch;
  sourceId: string;
  imageUrl: string;
  caption: string;
  createdAt?: string;
}

// 下载并缓存一张「首图」到本地 media 目录。任何一步失败都返回 undefined,
// 调用方静默跳过——配图是加分项,抽不到不能让导入失败。
export async function cacheLeadImageAsset(
  options: CacheLeadImageAssetOptions
): Promise<SourceImageAsset | undefined> {
  const mediaRootDir = options.mediaRootDir;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (!mediaRootDir || !fetchImpl) {
    return undefined;
  }

  try {
    const url = new URL(options.imageUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    const response = await fetchImpl(url.toString());

    if (!response.ok) {
      return undefined;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!isImageContentType(contentType)) {
      return undefined;
    }

    const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);

    if (Number.isFinite(declaredLength) && declaredLength > maxLeadImageBytes) {
      return undefined;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (!bytes.byteLength || bytes.byteLength > maxLeadImageBytes) {
      return undefined;
    }

    const extension = inferImageExtension(contentType, url.toString());

    if (!extension) {
      return undefined;
    }

    const safeSourceId = sanitizePathSegment(options.sourceId);
    const fileName = `lead.${extension}`;

    await (options.writeMedia ?? writeMediaFile)(mediaRootDir, safeSourceId, fileName, bytes);

    return {
      id: `${options.sourceId}-image-lead`,
      sourceId: options.sourceId,
      kind: "image",
      url: `/media/${encodeURIComponent(safeSourceId)}/${encodeURIComponent(fileName)}`,
      caption: options.caption,
      figureLabel: "",
      createdAt: options.createdAt ?? new Date().toISOString()
    };
  } catch {
    return undefined;
  }
}

// 首图只挂在导入产出的第一张卡上:同一张图重复贴满整批卡片会把信息流变成复读机。
export function attachLeadMediaToFirstCard(
  cards: KnowledgePost[],
  asset: SourceImageAsset | undefined,
  origin: KnowledgePostMediaOrigin
): KnowledgePost[] {
  if (!asset || !cards.length || cards[0]?.media?.length) {
    return cards;
  }

  return cards.map((card, index) =>
    index === 0 ? { ...card, media: [{ assetId: asset.id, caption: asset.caption, origin }] } : card
  );
}

function isImageContentType(contentType: string): boolean {
  return /^image\//i.test(contentType.split(";", 1)[0]?.trim() ?? "");
}
