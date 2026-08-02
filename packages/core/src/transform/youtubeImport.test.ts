import { describe, expect, it } from "vitest";
import type { MediaFileWriter } from "./mediaAssets.js";
import { transformYouTubeUrl } from "./youtubeImport.js";

const videoUrl = "https://www.youtube.com/watch?v=leadimg123";
const videoId = "leadimg123";
const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
const mediaRootDir = "/media-root";
const jpegBytes = new Uint8Array([255, 216, 255, 224, 9, 9, 9]);

const playerResponse = {
  videoDetails: { title: "Turning sources into a knowledge timeline", author: "AITimeline Demo", lengthSeconds: "934" },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [{ baseUrl: "https://www.youtube.com/api/timedtext?v=leadimg123", languageCode: "en" }]
    }
  }
};
const timedText = {
  events: [
    {
      tStartMs: 0,
      dDurationMs: 4200,
      segs: [{ utf8: "An AI Agent turns source material into durable knowledge with citations attached." }]
    },
    {
      tStartMs: 4300,
      dDurationMs: 5000,
      segs: [{ utf8: "A Knowledge Graph plus Memory signals decide when the timeline should resurface a card." }]
    }
  ]
};

// 抄本请求固定成功,只有封面请求按用例变化。
function createStubs(thumbnailResponse: () => Response) {
  const requestedUrls: string[] = [];
  const writtenFiles: Array<{ path: string; bytes: Uint8Array }> = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.includes("/youtubei/v1/player")) {
      return new Response(JSON.stringify(playerResponse), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (url.includes("/api/timedtext")) {
      return new Response(JSON.stringify(timedText), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    if (url === thumbnailUrl) {
      return thumbnailResponse();
    }

    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  const writeMedia: MediaFileWriter = async (rootDir, sourceId, fileName, bytes) => {
    writtenFiles.push({ path: `${rootDir}/${sourceId}/${fileName}`, bytes });
  };

  return { fetchImpl, writeMedia, requestedUrls, writtenFiles };
}

describe("youtube thumbnail import", () => {
  it("registers the hqdefault thumbnail as the lead media of the first card", async () => {
    const { fetchImpl, writeMedia, requestedUrls, writtenFiles } = createStubs(
      () => new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg" } })
    );
    const result = await transformYouTubeUrl(videoUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      fetch: fetchImpl,
      mediaRootDir,
      writeMedia
    });

    expect(requestedUrls).toContain(thumbnailUrl);
    expect(writtenFiles).toEqual([{ path: `${mediaRootDir}/youtube-${videoId}/lead.jpg`, bytes: jpegBytes }]);
    expect(result.assets.filter((asset) => asset.kind === "image")).toEqual([
      {
        id: `youtube-${videoId}-image-lead`,
        sourceId: `youtube-${videoId}`,
        kind: "image",
        url: `/media/youtube-${videoId}/lead.jpg`,
        caption: "Turning sources into a knowledge timeline",
        figureLabel: "",
        createdAt: "2026-08-02T00:00:00.000Z"
      }
    ]);
    // 资产要进 registry,否则 API 响应补不出 url,信息流看不到图。
    expect(result.sourceRegistry.assets.some((asset) => asset.id === `youtube-${videoId}-image-lead`)).toBe(true);
    expect(result.cards[0]?.media).toEqual([
      {
        assetId: `youtube-${videoId}-image-lead`,
        caption: "Turning sources into a knowledge timeline",
        origin: "video"
      }
    ]);
    expect(result.cards.slice(1).every((card) => !card.media?.length)).toBe(true);
    expect(result.importRecord.status).toBe("ready");
  });

  it("still imports the video when the thumbnail download fails", async () => {
    const { fetchImpl, writeMedia, requestedUrls, writtenFiles } = createStubs(
      () => new Response("gone", { status: 404 })
    );
    const result = await transformYouTubeUrl(videoUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      fetch: fetchImpl,
      mediaRootDir,
      writeMedia
    });

    expect(requestedUrls).toContain(thumbnailUrl);
    expect(writtenFiles).toEqual([]);
    expect(result.assets.some((asset) => asset.kind === "image")).toBe(false);
    expect(result.cards.every((card) => !card.media?.length)).toBe(true);
    expect(result.cards.length).toBeGreaterThan(0);
    expect(result.importRecord.status).toBe("ready");
  });

  it("does not fetch the thumbnail when no media root is configured", async () => {
    const { fetchImpl, requestedUrls } = createStubs(
      () => new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg" } })
    );
    const result = await transformYouTubeUrl(videoUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      fetch: fetchImpl
    });

    expect(requestedUrls).not.toContain(thumbnailUrl);
    expect(result.assets.some((asset) => asset.kind === "image")).toBe(false);
    expect(result.importRecord.status).toBe("ready");
  });
});
