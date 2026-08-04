import type { LinkedKnowledgeGraph, SourceImport } from "@aitimeline/core";
import { describe, expect, it } from "vitest";
import { countRecentImports, groupImportsByTitle, summarizeLinkedGraph } from "./ledger";

function makeImport(overrides: { id: string; title: string; createdAt: string }): SourceImport {
  return {
    id: overrides.id,
    source: {
      id: `source-${overrides.id}`,
      title: overrides.title,
      url: `https://example.com/${overrides.id}`,
      type: "article"
    },
    status: "ready",
    createdAt: overrides.createdAt
  };
}

describe("groupImportsByTitle", () => {
  it("collapses repeated titles into one group and keeps the newest record", () => {
    const groups = groupImportsByTitle([
      makeImport({ id: "a1", title: "同一篇文章", createdAt: "2026-08-01T10:00:00.000Z" }),
      makeImport({ id: "a2", title: "同一篇文章", createdAt: "2026-08-03T10:00:00.000Z" }),
      makeImport({ id: "b1", title: "另一篇文章", createdAt: "2026-08-02T10:00:00.000Z" })
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].latest.id).toBe("a2");
    expect(groups[0].count).toBe(2);
    expect(groups[1].latest.id).toBe("b1");
  });

  it("sorts groups newest-first by their latest record", () => {
    const groups = groupImportsByTitle([
      makeImport({ id: "old", title: "旧来源", createdAt: "2026-07-01T00:00:00.000Z" }),
      makeImport({ id: "new", title: "新来源", createdAt: "2026-08-03T00:00:00.000Z" })
    ]);

    expect(groups.map((group) => group.latest.id)).toEqual(["new", "old"]);
  });

  it("returns an empty list for no imports", () => {
    expect(groupImportsByTitle([])).toEqual([]);
  });
});

describe("countRecentImports", () => {
  const now = "2026-08-04T12:00:00.000Z";

  it("counts only records inside the trailing 7-day window", () => {
    const count = countRecentImports(
      [
        makeImport({ id: "in-1", title: "刚导入", createdAt: "2026-08-04T00:00:00.000Z" }),
        makeImport({ id: "in-2", title: "三天前", createdAt: "2026-08-01T12:00:00.000Z" }),
        makeImport({ id: "out-old", title: "八天前", createdAt: "2026-07-27T11:59:59.000Z" }),
        makeImport({ id: "out-future", title: "未来时间", createdAt: "2026-08-05T00:00:00.000Z" })
      ],
      now
    );

    expect(count).toBe(2);
  });

  it("treats the exact window boundary as outside", () => {
    const boundary = makeImport({ id: "boundary", title: "整七天前", createdAt: "2026-07-28T12:00:00.000Z" });

    expect(countRecentImports([boundary], now)).toBe(0);
  });

  it("ignores records with unparseable timestamps", () => {
    const broken = makeImport({ id: "broken", title: "坏时间戳", createdAt: "not-a-date" });

    expect(countRecentImports([broken], now)).toBe(0);
    expect(countRecentImports([broken], "also-not-a-date")).toBe(0);
  });
});

describe("summarizeLinkedGraph", () => {
  it("counts concepts, held cards and links; ghosts stay out", () => {
    const graph: LinkedKnowledgeGraph = {
      nodes: [
        { id: "concept-a", kind: "concept", label: "Concept A", weight: 3 },
        { id: "concept-b", kind: "concept", label: "Concept B", weight: 1 },
        { id: "card-1", kind: "card", label: "Card 1", weight: 1 },
        { id: "note-1", kind: "note", label: "Note 1", weight: 1 },
        { id: "idea-1", kind: "idea", label: "Idea 1", weight: 1 },
        { id: "ghost-1", kind: "ghost", label: "Ghost", weight: 0 }
      ],
      edges: [
        { id: "mentions:card-1->concept-a", source: "card-1", target: "concept-a", kind: "mentions" },
        { id: "wikilink:note-1->concept-b", source: "note-1", target: "concept-b", kind: "wikilink" }
      ]
    };

    expect(summarizeLinkedGraph(graph)).toEqual({ conceptCount: 2, cardCount: 3, linkCount: 2 });
  });

  it("returns zeros for an empty graph", () => {
    expect(summarizeLinkedGraph({ nodes: [], edges: [] })).toEqual({ conceptCount: 0, cardCount: 0, linkCount: 0 });
  });
});
