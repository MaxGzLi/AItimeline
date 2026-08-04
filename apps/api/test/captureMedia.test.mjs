// sanitizeCapturedMedia:剪藏媒体引用的服务端收口(数量上限、URL 协议、形状)。
// capture.mjs 顶部引用 core dist,跑本测试前需先 build core(npm test / CI 均如此)。
import { describe, expect, it } from "vitest";
import { sanitizeCapturedMedia } from "../src/domains/capture.mjs";

const image = (n) => ({ kind: "image", url: `https://pbs.twimg.com/media/img${n}?format=jpg&name=large` });

describe("sanitizeCapturedMedia", () => {
  it("keeps well-formed image and video entries", () => {
    const media = sanitizeCapturedMedia([
      image(1),
      { kind: "video", url: "https://x.com/alice/status/42", posterUrl: "https://pbs.twimg.com/poster.jpg" }
    ]);

    expect(media).toEqual([
      { kind: "image", url: "https://pbs.twimg.com/media/img1?format=jpg&name=large" },
      { kind: "video", url: "https://x.com/alice/status/42", posterUrl: "https://pbs.twimg.com/poster.jpg" }
    ]);
  });

  it("caps images at 4 and videos at 1", () => {
    const media = sanitizeCapturedMedia([
      image(1), image(2), image(3), image(4), image(5),
      { kind: "video", url: "https://x.com/a/status/1" },
      { kind: "video", url: "https://x.com/a/status/2" }
    ]);

    expect(media.filter((item) => item.kind === "image")).toHaveLength(4);
    expect(media.filter((item) => item.kind === "video")).toHaveLength(1);
  });

  it("drops non-http urls, unknown kinds, and malformed entries", () => {
    const media = sanitizeCapturedMedia([
      { kind: "image", url: "javascript:alert(1)" },
      { kind: "image", url: "file:///etc/passwd" },
      { kind: "image" },
      { kind: "gif", url: "https://example.com/a.gif" },
      "not-an-object",
      null,
      { kind: "video", url: "https://x.com/a/status/3", posterUrl: "data:image/png;base64,x" }
    ]);

    expect(media).toEqual([{ kind: "video", url: "https://x.com/a/status/3" }]);
  });

  it("returns an empty list for non-array input", () => {
    expect(sanitizeCapturedMedia(undefined)).toEqual([]);
    expect(sanitizeCapturedMedia("x")).toEqual([]);
  });
});
