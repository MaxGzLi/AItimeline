import { describe, expect, it } from "vitest";
import type { KnowledgeGraphEdge } from "../types.js";
import { estimateTextWidth, layoutConceptMap, type ConceptMapLayout } from "./conceptMapLayout.js";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function makeConcepts(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Concept ${index + 1}`);
}

function makeEdges(count: number, center = "Concept 1"): KnowledgeGraphEdge[] {
  const relations: KnowledgeGraphEdge["relation"][] = [
    "requires",
    "extends",
    "contrasts",
    "applies",
    "evaluates",
    "summarizes"
  ];

  return Array.from({ length: count }, (_, index) => ({
    id: `edge-${index + 1}`,
    sourceConcept: center,
    relation: relations[index % relations.length],
    targetConcept: `Concept ${index + 2}`,
    evidence: `Evidence ${index + 1}.`,
    weight: 0.9 - index * 0.01
  }));
}

const cjkConcepts = [
  "多头潜在注意力机制",
  "键值缓存压缩",
  "混合专家模型",
  "推理吞吐",
  "低秩投影",
  "上下文窗口",
  "显存带宽",
  "稀疏激活",
  "训练稳定性"
];

function cjkEdges(): KnowledgeGraphEdge[] {
  return cjkConcepts.slice(1).map((concept, index) => ({
    id: `cjk-edge-${index + 1}`,
    sourceConcept: cjkConcepts[0],
    relation: "extends",
    targetConcept: concept,
    evidence: "证据。",
    weight: 0.9 - index * 0.01
  }));
}

/**
 * Every box the renderer is allowed to paint text into: concept labels, the
 * node dots they must not cover, and the room reserved for relation captions.
 */
function collectBoxes(layout: ConceptMapLayout): Array<Box & { id: string }> {
  const boxes: Array<Box & { id: string }> = [];

  for (const node of layout.nodes) {
    boxes.push({
      id: `label:${node.concept}`,
      left: node.labelX - node.labelWidth / 2,
      right: node.labelX + node.labelWidth / 2,
      top: node.labelY - node.labelHeight / 2,
      bottom: node.labelY + node.labelHeight / 2
    });

    if (node.radius > 0) {
      boxes.push({
        id: `dot:${node.concept}`,
        left: node.x - node.radius,
        right: node.x + node.radius,
        top: node.y - node.radius,
        bottom: node.y + node.radius
      });
    }
  }

  for (const edge of layout.edges) {
    if (edge.labelMaxWidth <= 0) {
      continue;
    }

    boxes.push({
      id: `relation:${edge.from}->${edge.to}`,
      left: edge.labelX - edge.labelMaxWidth / 2,
      right: edge.labelX + edge.labelMaxWidth / 2,
      top: edge.labelY - edge.labelHeight / 2,
      bottom: edge.labelY + edge.labelHeight / 2
    });
  }

  return boxes;
}

function findOverlap(layout: ConceptMapLayout): string | null {
  const boxes = collectBoxes(layout);

  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const a = boxes[left];
      const b = boxes[right];
      const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

      if (overlaps) {
        return `${a.id} overlaps ${b.id}`;
      }
    }
  }

  return null;
}

describe("layoutConceptMap", () => {
  it("draws the same map for the same post every time", () => {
    const input = {
      postId: "post-stable",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(9),
      graphEdges: makeEdges(8)
    };

    expect(layoutConceptMap(input)).toEqual(layoutConceptMap(input));
  });

  it("gives different posts different ring rotations", () => {
    const shared = { primaryConcept: "Concept 1", concepts: makeConcepts(9), graphEdges: makeEdges(8) };
    const first = layoutConceptMap({ postId: "post-a", ...shared });
    const second = layoutConceptMap({ postId: "post-b", ...shared });

    expect(first.nodes.map((node) => [node.concept, node.x, node.y])).not.toEqual(
      second.nodes.map((node) => [node.concept, node.x, node.y])
    );
  });

  it("keeps every label clear of every other label, dot and relation caption", () => {
    for (const count of [0, 1, 2, 8, 20]) {
      const concepts = makeConcepts(count);
      const withEdges = layoutConceptMap({
        postId: `post-edges-${count}`,
        primaryConcept: concepts[0],
        concepts,
        graphEdges: makeEdges(Math.max(0, count - 1))
      });
      const withoutEdges = layoutConceptMap({
        postId: `post-spokes-${count}`,
        primaryConcept: concepts[0],
        concepts
      });

      expect(findOverlap(withEdges), `graph edges, ${count} concepts`).toBeNull();
      expect(findOverlap(withoutEdges), `concept spokes, ${count} concepts`).toBeNull();
    }
  });

  it("keeps long CJK labels clear of each other too", () => {
    const layout = layoutConceptMap({
      postId: "post-cjk",
      primaryConcept: cjkConcepts[0],
      concepts: cjkConcepts,
      graphEdges: cjkEdges()
    });

    expect(layout.degenerate).toBe(false);
    expect(layout.nodes).toHaveLength(9);
    expect(findOverlap(layout)).toBeNull();
  });

  it("keeps labels clear whatever seed the post id hashes to", () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const layout = layoutConceptMap({
        postId: `post-${seed}`,
        primaryConcept: cjkConcepts[0],
        concepts: cjkConcepts,
        graphEdges: cjkEdges()
      });

      expect(findOverlap(layout), `seed ${seed}`).toBeNull();
    }
  });

  it("drops the lightest concepts when a tight canvas cannot fit their labels", () => {
    const nodeCounts: number[] = [];

    // 360x200 is far below the timeline's own box: it forces the collision pass
    // to actually cut nodes, which the roomy default layout rarely needs.
    for (let seed = 0; seed < 40; seed += 1) {
      const layout = layoutConceptMap({
        postId: `post-tight-${seed}`,
        primaryConcept: cjkConcepts[0],
        concepts: cjkConcepts,
        graphEdges: cjkEdges(),
        width: 360,
        height: 200
      });

      const peerWeights = layout.nodes.slice(1).map((node) => node.weight);

      expect(findOverlap(layout), `tight canvas, seed ${seed}`).toBeNull();
      // Culling walks the ring heaviest first, so survivors stay weight-ordered.
      expect(peerWeights, `tight canvas, seed ${seed}`).toEqual([...peerWeights].sort((a, b) => b - a));
      nodeCounts.push(layout.nodes.length);
    }

    // Something always gets cut at this size, and the map never collapses.
    expect(Math.max(...nodeCounts)).toBeLessThan(9);
    expect(Math.min(...nodeCounts)).toBeGreaterThanOrEqual(3);
  });

  it("truncates the ring to nine nodes, heaviest concepts first", () => {
    const concepts = makeConcepts(21);
    const layout = layoutConceptMap({
      postId: "post-truncate",
      primaryConcept: "Concept 1",
      concepts,
      graphEdges: makeEdges(20)
    });
    const peers = layout.nodes.slice(1);

    expect(layout.nodes.length).toBeLessThanOrEqual(9);
    expect(layout.nodes[0].tier).toBe("center");
    expect(layout.nodes[0].concept).toBe("Concept 1");
    expect(peers.map((node) => node.weight)).toEqual([...peers.map((node) => node.weight)].sort((a, b) => b - a));
    // The eight heaviest edges target Concept 2..9; nothing lighter may sneak in.
    expect(peers.every((node) => concepts.slice(1, 9).includes(node.concept))).toBe(true);
  });

  it("only draws edges between nodes it kept", () => {
    const layout = layoutConceptMap({
      postId: "post-edges-only",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(21),
      graphEdges: makeEdges(20)
    });
    const kept = new Set(layout.nodes.map((node) => node.concept));

    expect(layout.edges.length).toBeGreaterThan(0);
    for (const edge of layout.edges) {
      expect(kept.has(edge.from)).toBe(true);
      expect(kept.has(edge.to)).toBe(true);
    }
  });

  it("returns relations verbatim", () => {
    const layout = layoutConceptMap({
      postId: "post-relations",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(4),
      graphEdges: makeEdges(3)
    });

    expect(layout.edges.map((edge) => edge.relation).sort()).toEqual(["contrasts", "extends", "requires"]);
  });

  it("falls back to a concept-only radial map with no relation labels", () => {
    const layout = layoutConceptMap({
      postId: "post-spokes",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(5)
    });

    expect(layout.degenerate).toBe(false);
    expect(layout.nodes[0].concept).toBe("Concept 1");
    expect(layout.nodes).toHaveLength(5);
    expect(layout.edges).toHaveLength(4);
    expect(layout.edges.every((edge) => edge.relation === undefined)).toBe(true);
    expect(layout.edges.every((edge) => edge.from === "Concept 1")).toBe(true);
  });

  it("ignores unusable edges and falls back to the concept ring", () => {
    const layout = layoutConceptMap({
      postId: "post-bad-edges",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(3),
      graphEdges: [
        { sourceConcept: "  ", targetConcept: "Concept 2" },
        { sourceConcept: "Concept 1", targetConcept: "concept 1" }
      ]
    });

    expect(layout.degenerate).toBe(false);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges.every((edge) => edge.relation === undefined)).toBe(true);
  });

  it("reports degenerate when there is nothing worth drawing", () => {
    const empty = layoutConceptMap({ postId: "post-empty" });
    const single = layoutConceptMap({ postId: "post-single", primaryConcept: "Concept 1", concepts: ["Concept 1"] });
    const blank = layoutConceptMap({ postId: "post-blank", concepts: ["  ", ""] });

    for (const layout of [empty, single, blank]) {
      expect(layout.degenerate).toBe(true);
      expect(layout.nodes).toEqual([]);
      expect(layout.edges).toEqual([]);
    }
  });

  it("anchors on the busiest concept when the card's main concept is off the graph", () => {
    const layout = layoutConceptMap({
      postId: "post-off-graph",
      primaryConcept: "Unrelated",
      concepts: ["Unrelated", "Concept 1"],
      graphEdges: makeEdges(3)
    });

    expect(layout.nodes[0].concept).toBe("Concept 1");
  });

  it("keeps every node and label inside the canvas", () => {
    const layout = layoutConceptMap({
      postId: "post-bounds",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(9),
      graphEdges: makeEdges(8)
    });

    for (const node of layout.nodes) {
      expect(node.labelX - node.labelWidth / 2).toBeGreaterThanOrEqual(0);
      expect(node.labelX + node.labelWidth / 2).toBeLessThanOrEqual(layout.width);
      expect(node.labelY - node.labelHeight / 2).toBeGreaterThanOrEqual(0);
      expect(node.labelY + node.labelHeight / 2).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe("estimateTextWidth", () => {
  it("counts CJK glyphs as a full em and latin letters as less", () => {
    expect(estimateTextWidth("知识图", 13)).toBeCloseTo(39);
    expect(estimateTextWidth("abc", 13)).toBeLessThan(estimateTextWidth("知识图", 13));
    expect(estimateTextWidth("", 13)).toBe(0);
  });
});
