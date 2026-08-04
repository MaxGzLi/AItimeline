// 小红书周报图文的素材导出:从本地快照确定性地取出本周新增的知识卡,
// 输出排版所需的最小字段(标题/论点/要点/概念/出处/引文)。不走模型,不发网络。
//
// 用法: node scripts/export-xhs-weekly.mjs [快照路径] [周起始日 YYYY-MM-DD]
//   快照路径默认 apps/api/data/aitimeline.json;周起始默认本周一(本地时区)。
//   输出 JSON 到 stdout,重定向保存。

import { readFileSync } from "node:fs";

const snapshotPath = process.argv[2] ?? "apps/api/data/aitimeline.json";
const weekStartArg = process.argv[3];

function startOfWeek(now) {
  const day = now.getDay();
  const diff = (day + 6) % 7; // 周一为一周起点
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
  return monday;
}

const weekStart = weekStartArg ? new Date(`${weekStartArg}T00:00:00`) : startOfWeek(new Date());
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

const cards = (snapshot.posts ?? [])
  .filter((post) => new Date(post.createdAt) >= weekStart)
  .map((post) => ({
    id: post.id,
    createdAt: post.createdAt,
    title: post.title,
    thesis: post.thesis,
    keyTakeaway: post.keyTakeaway,
    summary: post.summary,
    concepts: post.concepts,
    source: post.sources?.[0]
      ? {
          title: post.sources[0].title,
          url: post.sources[0].url,
          author: post.sources[0].author ?? null
        }
      : null,
    quotes: (post.thread ?? [])
      .flatMap((block) => block.citations ?? [])
      .map((citation) => citation.quote)
      .filter(Boolean)
  }))
  .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

const localDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

process.stdout.write(
  `${JSON.stringify(
    {
      weekStart: localDate(weekStart),
      exportedAt: new Date().toISOString(),
      cardCount: cards.length,
      cards
    },
    null,
    2
  )}\n`
);
