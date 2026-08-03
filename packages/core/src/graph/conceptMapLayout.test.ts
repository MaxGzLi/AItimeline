import { describe, expect, it } from "vitest";
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

const longCjkConcepts = [
  "多头潜在注意力机制的实现",
  "键值缓存压缩与显存带宽",
  "混合专家模型路由",
  "推理吞吐与并发批处理",
  "低秩投影的秩选择",
  "上下文窗口扩展",
  "显存带宽瓶颈",
  "稀疏激活比例",
  "训练稳定性与损失尖峰"
];

/**
 * Every box the renderer is allowed to paint text into: concept labels and the
 * node dots they must not cover.
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
      concepts: makeConcepts(9)
    };

    expect(layoutConceptMap(input)).toEqual(layoutConceptMap(input));
  });

  it("gives different posts different ring rotations", () => {
    const shared = { primaryConcept: "Concept 1", concepts: makeConcepts(9) };
    const first = layoutConceptMap({ postId: "post-a", ...shared });
    const second = layoutConceptMap({ postId: "post-b", ...shared });

    expect(first.nodes.map((node) => [node.concept, node.x, node.y])).not.toEqual(
      second.nodes.map((node) => [node.concept, node.x, node.y])
    );
  });

  it("keeps every label clear of every other label and dot", () => {
    for (const count of [0, 1, 2, 8, 20]) {
      const concepts = makeConcepts(count);
      const layout = layoutConceptMap({
        postId: `post-spokes-${count}`,
        primaryConcept: concepts[0],
        concepts
      });

      expect(findOverlap(layout), `concept spokes, ${count} concepts`).toBeNull();
    }
  });

  it("keeps long CJK labels clear of each other too", () => {
    const layout = layoutConceptMap({
      postId: "post-cjk",
      primaryConcept: cjkConcepts[0],
      concepts: cjkConcepts
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
        concepts: cjkConcepts
      });

      expect(findOverlap(layout), `seed ${seed}`).toBeNull();
    }
  });

  it("drops the lightest concepts when a tight canvas cannot fit their labels", () => {
    const nodeCounts: number[] = [];

    // Long labels in a box narrower than the timeline's own: this forces the
    // collision pass to actually cut nodes, which the roomy default rarely needs.
    for (let seed = 0; seed < 40; seed += 1) {
      const layout = layoutConceptMap({
        postId: `post-tight-${seed}`,
        primaryConcept: longCjkConcepts[0],
        concepts: longCjkConcepts,
        width: 420,
        height: 220
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
      concepts
    });
    const peers = layout.nodes.slice(1);

    expect(layout.nodes.length).toBeLessThanOrEqual(9);
    expect(layout.nodes[0].tier).toBe("center");
    expect(layout.nodes[0].concept).toBe("Concept 1");
    expect(peers.map((node) => node.weight)).toEqual([...peers.map((node) => node.weight)].sort((a, b) => b - a));
    // The eight heaviest concepts are Concept 2..9; nothing lighter may sneak in.
    expect(peers.every((node) => concepts.slice(1, 9).includes(node.concept))).toBe(true);
  });

  it("shrinks the box when there is little to draw, and honours an explicit size", () => {
    const heightFor = (peerCount: number) =>
      layoutConceptMap({
        postId: `post-height-${peerCount}`,
        primaryConcept: "Concept 1",
        concepts: makeConcepts(peerCount + 1)
      }).height;

    expect(heightFor(1)).toBe(160);
    expect(heightFor(2)).toBe(160);
    expect(heightFor(3)).toBe(200);
    expect(heightFor(5)).toBe(240);
    expect(
      layoutConceptMap({
        postId: "post-height-explicit",
        primaryConcept: "Concept 1",
        concepts: makeConcepts(3),
        width: 400,
        height: 300
      })
    ).toMatchObject({ width: 400, height: 300 });
  });

  it("only draws edges between nodes it kept", () => {
    const layout = layoutConceptMap({
      postId: "post-edges-only",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(21)
    });
    const kept = new Set(layout.nodes.map((node) => node.concept));

    expect(layout.edges.length).toBeGreaterThan(0);
    for (const edge of layout.edges) {
      expect(kept.has(edge.from)).toBe(true);
      expect(kept.has(edge.to)).toBe(true);
    }
  });

  it("never puts a relation on an edge", () => {
    const layout = layoutConceptMap({
      postId: "post-no-relations",
      primaryConcept: cjkConcepts[0],
      concepts: cjkConcepts
    });

    expect(layout.edges).toHaveLength(8);
    for (const edge of layout.edges) {
      expect(Object.keys(edge).sort()).toEqual(["from", "to", "weight", "x1", "x2", "y1", "y2"]);
      expect("relation" in edge).toBe(false);
    }
  });

  it("draws a radial map of the card's own concepts", () => {
    const layout = layoutConceptMap({
      postId: "post-spokes",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(5)
    });

    expect(layout.degenerate).toBe(false);
    expect(layout.nodes[0].concept).toBe("Concept 1");
    expect(layout.nodes).toHaveLength(5);
    expect(layout.edges).toHaveLength(4);
    expect(layout.edges.every((edge) => edge.from === "Concept 1")).toBe(true);
  });

  it("skips blank and duplicate concepts", () => {
    const layout = layoutConceptMap({
      postId: "post-duplicates",
      primaryConcept: "Concept 1",
      concepts: ["Concept 1", "  ", "concept 1", "Concept 2", "Concept 2", "Concept 3"]
    });

    expect(layout.nodes.map((node) => node.concept)).toEqual(["Concept 1", "Concept 2", "Concept 3"]);
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

  it("falls back to the first usable concept when the card has no main concept", () => {
    const layout = layoutConceptMap({
      postId: "post-no-primary",
      concepts: ["  ", "Concept 1", "Concept 2"]
    });

    expect(layout.nodes[0].concept).toBe("Concept 1");
    expect(layout.nodes[0].tier).toBe("center");
  });

  it("centres what it drew inside the box", () => {
    for (const peerCount of [1, 2, 5, 8]) {
      const layout = layoutConceptMap({
        postId: `post-centred-${peerCount}`,
        primaryConcept: cjkConcepts[0],
        concepts: cjkConcepts.slice(0, peerCount + 1)
      });
      const boxes = collectBoxes(layout);
      const left = Math.min(...boxes.map((box) => box.left));
      const right = Math.max(...boxes.map((box) => box.right));
      const top = Math.min(...boxes.map((box) => box.top));
      const bottom = Math.max(...boxes.map((box) => box.bottom));

      expect(left, `${peerCount} peers`).toBeCloseTo(layout.width - right, 5);
      expect(top, `${peerCount} peers`).toBeCloseTo(layout.height - bottom, 5);
    }
  });

  it("keeps every node and label inside the canvas", () => {
    const layout = layoutConceptMap({
      postId: "post-bounds",
      primaryConcept: "Concept 1",
      concepts: makeConcepts(9)
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
