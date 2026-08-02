import { describe, expect, it } from "vitest";
import { transformArticleUrl } from "./articleImport.js";
import type { MediaFileWriter } from "./mediaAssets.js";

const articleUrl = "https://example.com/learning-agent-timeline";
const mediaRootDir = "/media-root";
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

function articleHtml(head: string, body: string): string {
  return `
    <html>
      <head>
        <meta property="og:title" content="Learning agents need a timeline surface" />
        ${head}
      </head>
      <body>
        <article>
          ${body}
          <p>An AI Agent can turn source material into durable knowledge when it keeps citations, extracts concepts, and creates a learning surface that users can revisit.</p>
          <p>A Knowledge Graph helps Memory become useful because saved concepts, weak concepts, and Recommendation signals can point the user toward review at the right time.</p>
        </article>
      </body>
    </html>
  `;
}

// 每个用例只需要说明「文章 HTML 长什么样」和「图片请求返回什么」,落盘和网络都被替换掉。
function createStubs(html: string, imageResponse: (url: string) => Response) {
  const requestedUrls: string[] = [];
  const writtenFiles: Array<{ path: string; bytes: Uint8Array }> = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url === articleUrl) {
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    }

    return imageResponse(url);
  }) as unknown as typeof fetch;
  const writeMedia: MediaFileWriter = async (rootDir, sourceId, fileName, bytes) => {
    writtenFiles.push({ path: `${rootDir}/${sourceId}/${fileName}`, bytes });
  };

  return { fetchImpl, writeMedia, requestedUrls, writtenFiles };
}

function pngResponse(): Response {
  return new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } });
}

describe("article lead image extraction", () => {
  it("caches og:image as the lead media of the first card", async () => {
    const { fetchImpl, writeMedia, requestedUrls, writtenFiles } = createStubs(
      articleHtml('<meta property="og:image" content="https://cdn.example.com/hero.png" />', ""),
      pngResponse
    );
    const result = await transformArticleUrl(articleUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      fetch: fetchImpl,
      mediaRootDir,
      writeMedia
    });

    expect(requestedUrls).toContain("https://cdn.example.com/hero.png");
    expect(writtenFiles).toEqual([{ path: `${mediaRootDir}/${result.source.id}/lead.png`, bytes: pngBytes }]);
    expect(result.assets.filter((asset) => asset.kind === "image")).toEqual([
      {
        id: `${result.source.id}-image-lead`,
        sourceId: result.source.id,
        kind: "image",
        url: `/media/${result.source.id}/lead.png`,
        caption: "Learning agents need a timeline surface",
        figureLabel: "",
        createdAt: "2026-08-02T00:00:00.000Z"
      }
    ]);
    expect(result.cards[0]?.media).toEqual([
      {
        assetId: `${result.source.id}-image-lead`,
        caption: "Learning agents need a timeline surface",
        origin: "article"
      }
    ]);
    // 同一张图不能贴满整批卡片。
    expect(result.cards.slice(1).every((card) => !card.media?.length)).toBe(true);
    expect(result.importRecord.status).toBe("ready");
  });

  it("imports an article with no image at all and attaches no media", async () => {
    const { fetchImpl, writeMedia, requestedUrls, writtenFiles } = createStubs(
      articleHtml("", ""),
      () => new Response("not found", { status: 404 })
    );
    const result = await transformArticleUrl(articleUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      fetch: fetchImpl,
      mediaRootDir,
      writeMedia
    });

    expect(requestedUrls).toEqual([articleUrl]);
    expect(writtenFiles).toEqual([]);
    expect(result.assets.some((asset) => asset.kind === "image")).toBe(false);
    expect(result.cards.every((card) => !card.media?.length)).toBe(true);
    expect(result.importRecord.status).toBe("ready");
  });

  it("falls back to the first body image and resolves its relative URL", async () => {
    const { fetchImpl, writeMedia, requestedUrls } = createStubs(
      articleHtml("", '<img src="/assets/diagram.png" alt="Timeline architecture diagram" />'),
      pngResponse
    );
    const result = await transformArticleUrl(articleUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      fetch: fetchImpl,
      mediaRootDir,
      writeMedia
    });

    expect(requestedUrls).toContain("https://example.com/assets/diagram.png");
    expect(result.cards[0]?.media).toEqual([
      {
        assetId: `${result.source.id}-image-lead`,
        caption: "Timeline architecture diagram",
        origin: "article"
      }
    ]);
  });

  it("skips the lead image when the download fails and still imports the article", async () => {
    const { fetchImpl, writeMedia, writtenFiles } = createStubs(
      articleHtml('<meta property="og:image" content="https://cdn.example.com/hero.png" />', ""),
      () => new Response("gone", { status: 500 })
    );
    const result = await transformArticleUrl(articleUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      fetch: fetchImpl,
      mediaRootDir,
      writeMedia
    });

    expect(writtenFiles).toEqual([]);
    expect(result.assets.some((asset) => asset.kind === "image")).toBe(false);
    expect(result.cards[0]?.media).toBeUndefined();
    expect(result.importRecord.status).toBe("ready");
  });

  it("skips a lead image that is not an image or is over the size cap", async () => {
    const html = articleHtml('<meta property="og:image" content="https://cdn.example.com/hero.png" />', "");
    const notAnImageStubs = createStubs(
      html,
      () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    const tooLargeStubs = createStubs(
      html,
      () =>
        new Response(pngBytes, {
          status: 200,
          headers: { "content-type": "image/png", "content-length": String(4 * 1024 * 1024) }
        })
    );
    const notAnImage = await transformArticleUrl(articleUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      mediaRootDir,
      fetch: notAnImageStubs.fetchImpl,
      writeMedia: notAnImageStubs.writeMedia
    });
    const tooLarge = await transformArticleUrl(articleUrl, {
      createdAt: "2026-08-02T00:00:00.000Z",
      mediaRootDir,
      fetch: tooLargeStubs.fetchImpl,
      writeMedia: tooLargeStubs.writeMedia
    });

    expect(notAnImageStubs.writtenFiles).toEqual([]);
    expect(tooLargeStubs.writtenFiles).toEqual([]);
    expect(notAnImage.assets.some((asset) => asset.kind === "image")).toBe(false);
    expect(tooLarge.assets.some((asset) => asset.kind === "image")).toBe(false);
    expect(notAnImage.importRecord.status).toBe("ready");
    expect(tooLarge.importRecord.status).toBe("ready");
  });
});
