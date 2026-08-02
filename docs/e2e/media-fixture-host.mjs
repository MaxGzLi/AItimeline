// Local-only fixture host for feed screenshot runs.
// Serves article pages plus generated PNG bytes (no binaries checked in, no
// network) so the article import path can cache a real lead image offline.
//
// Usage: node docs/e2e/media-fixture-host.mjs [port]   (default 8899)
// Pages: /article/hero (og:image, wide) /article/portrait (og:image, tall)
//        /article/figure (body <img>, white chart) /article/plain-1..3 (no image)
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const port = Number(process.argv[2] ?? 8899);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, pixelAt) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// 宽幅「文章头图」:深色渐变 + 几块高饱和色块,一眼能看出是照片位而不是空白。
const heroPng = encodePng(1600, 900, (x, y) => {
  const u = x / 1600;
  const v = y / 900;
  const base = [24 + 90 * u, 32 + 60 * v, 78 + 150 * (1 - u * v)];
  if (v > 0.62 && u > 0.08 && u < 0.46) return [247, 184, 46];
  if (v > 0.46 && v < 0.6 && u > 0.08 && u < 0.7) return [29, 155, 240];
  if (u > 0.72 && v < 0.4) return [249, 24, 128];
  return base.map((value) => Math.max(0, Math.min(255, Math.round(value))));
});

// 论文插图形态:白底 + 黑色坐标轴与柱子,用来验证「插图不能被裁掉」。
const figurePng = encodePng(1200, 760, (x, y) => {
  const white = [255, 255, 255];
  if (x > 120 && x < 132 && y > 60 && y < 660) return [15, 20, 25];
  if (y > 648 && y < 660 && x > 120 && x < 1120) return [15, 20, 25];
  const bars = [
    { start: 200, end: 320, top: 240 },
    { start: 400, end: 520, top: 150 },
    { start: 600, end: 720, top: 380 },
    { start: 800, end: 920, top: 90 }
  ];
  for (const bar of bars) {
    if (x > bar.start && x < bar.end && y > bar.top && y < 648) return [29, 155, 240];
  }
  return white;
});

// 竖图:用来暴露「封顶后 contain 会留白边 / cover 会干净裁切」的差别。
const portraitPng = encodePng(900, 1600, (x, y) => {
  const v = y / 1600;
  if (v > 0.30 && v < 0.44 && x > 120 && x < 780) return [29, 155, 240];
  if (v > 0.52 && v < 0.62 && x > 120 && x < 600) return [247, 184, 46];
  if (v > 0.70 && v < 0.78 && x > 120 && x < 700) return [249, 24, 128];
  return [22 + 40 * v, 26 + 30 * v, 40 + 70 * v].map((value) => Math.round(value));
});

function articleHtml({ title, head, body, paragraphs }) {
  return `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="${title}" />
    <meta name="author" content="AITimeline Feed Visuals Fixture" />
    <meta property="article:published_time" content="2026-07-30T00:00:00.000Z" />
    ${head}
  </head>
  <body>
    <article>
      ${body}
      ${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("\n      ")}
    </article>
  </body>
</html>`;
}

// 每篇文章的正文必须彼此明显不同,否则导入时会被近重复合并掉,首图也跟着丢。
const pages = {
  "/article/hero": articleHtml({
    title: "Grounded retrieval needs a visible evidence path",
    head: `<meta property="og:image" content="http://127.0.0.1:${port}/hero.png" />`,
    body: "",
    paragraphs: [
      "An AI Agent that answers from a retrieved corpus is only trustworthy when the reader can walk backwards from the sentence to the exact chunk that produced it, which means the evidence path has to be a stored object rather than a rendering detail.",
      "RAG pipelines usually log the retrieved documents and stop there, but a learning product needs chunk-level provenance: the quote, its offsets, and the snapshot version of the source at the moment of import.",
      "When a claim carries a numeric value, the grounding gate should refuse it unless the same number appears verbatim in a cited chunk, because paraphrase drift on numbers is the failure mode readers notice first.",
      "Evaluation therefore measures citation resolution rate, not answer plausibility: how often the cited chunk id still exists, still contains the quote, and still belongs to the source the card names."
    ]
  }),
  "/article/figure": articleHtml({
    title: "Ranking a learning feed by concept mastery",
    head: "",
    body: `<img src="/figure.png" alt="Card acceptance rate by grounding tier" />`,
    paragraphs: [
      "Recommendation inside a learning feed is not an engagement problem; the ranker is trying to schedule attention across concepts the reader half-knows, which makes mastery estimates the primary feature rather than click likelihood.",
      "A Knowledge Graph gives the ranker distance: a card two hops from a strong concept is a stretch, a card five hops away is noise, and the same card can move between those buckets as Memory updates.",
      "Freshness still matters, but it competes with review urgency, so the scoring function has to express a trade between a new import and a card that is about to be forgotten.",
      "The chart above compares acceptance rates across grounding tiers, and the gap between fully cited cards and partially cited ones is wide enough to justify rejecting the latter outright."
    ]
  }),
  "/article/plain-1": articleHtml({
    title: "Spaced review turns imported cards into recall",
    head: "",
    body: "",
    paragraphs: [
      "Importing a source produces cards; remembering the source requires a schedule, and the gap between those two things is where most reading tools quietly fail their users.",
      "A spaced review state per card tracks interval, ease, and last grade, and the scheduler promotes a concept to mastered only after several successful recalls spread across increasing gaps.",
      "Grading has to be cheap at the moment of review: remembered, fuzzy, forgot, with the forgot path resetting the interval rather than nudging it, because a partial reset teaches the scheduler nothing.",
      "Review pressure should feed the ranker directly, so a due card can outrank a fresh import when the concept is close to slipping out of Memory entirely."
    ]
  }),
  "/article/plain-2": articleHtml({
    title: "Background curation keeps the supply pool from drying up",
    head: "",
    body: "",
    paragraphs: [
      "A personal feed with no background supply becomes a graveyard within a week: the reader exhausts what they imported and the surface stops rewarding a visit.",
      "Background curation runs as a job queue with a daily budget, spending quota on discovery searches, source quality checks, and imports, and refunding quota when a fetch fails for reasons the system caused.",
      "The quality gate rejects marketing pages and thin listicles before they reach the harness, which keeps the pool small but usable instead of large and unreadable.",
      "Drought detection watches released-card counts per topic rather than raw totals, because a pool full of one concept still reads as empty to someone studying another."
    ]
  }),
  "/article/portrait": articleHtml({
    title: "Prompt caching changes the economics of long context",
    head: `<meta property="og:image" content="http://127.0.0.1:${port}/portrait.png" />`,
    body: "",
    paragraphs: [
      "Long system prompts used to be billed on every turn, which pushed teams toward shorter instructions than their agents actually needed to behave predictably across a session.",
      "Cache breakpoints move that cost to a one-time write, so the stable half of a prompt — tool definitions, policy text, few-shot examples — stops competing with the conversation for budget.",
      "The ordering rule is unforgiving: anything that changes per request has to sit after everything cached, otherwise the prefix no longer matches and the cache silently never hits.",
      "Measuring a cache is therefore about read-to-write ratio rather than latency alone, because a cache that is written more often than it is read costs more than no cache at all."
    ]
  }),
  "/article/plain-3": articleHtml({
    title: "A knowledge graph is only useful when it is cited",
    head: "",
    body: "",
    paragraphs: [
      "Concept graphs drawn from generated text tend to look impressive and mean nothing, because the edges assert relationships no source ever stated.",
      "An edge should carry the same provenance as a sentence: which card asserted it, which chunk supported it, and what relation word the source actually used.",
      "Alias handling decides whether the graph collapses or explodes, so abbreviations and bilingual names for the same concept have to fold into one canonical node before edges are counted.",
      "Once edges are cited, the graph becomes a query surface: show me every card that connects evaluation to retrieval, and show me the quote that justified the link."
    ]
  })
};

createServer((request, response) => {
  const path = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname;

  if (path === "/hero.png" || path === "/figure.png" || path === "/portrait.png") {
    const bytes = path === "/hero.png" ? heroPng : path === "/figure.png" ? figurePng : portraitPng;
    response.writeHead(200, { "content-type": "image/png", "content-length": String(bytes.length) });
    response.end(bytes);
    return;
  }

  const page = pages[path];

  if (!page) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
    return;
  }

  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(page);
}).listen(port, "127.0.0.1", () => {
  console.log(`fixture host listening on http://127.0.0.1:${port}`);
});
