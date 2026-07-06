import type { LinkedGraphNode, LinkedKnowledgeGraph } from "@aitimeline/core";

export type GraphSnapshotTheme = "light" | "dark";

export interface GraphSnapshotNode {
  id: string;
  kind: LinkedGraphNode["kind"];
  label: string;
  weight: number;
  x: number;
  y: number;
  zone?: LinkedGraphNode["zone"];
}

export interface GraphSnapshotLayout {
  nodes: GraphSnapshotNode[];
}

interface GraphPalette {
  bg: string;
  frame: string;
  ink: string;
  line: string;
  muted: string;
  blue: string;
  repost: string;
  warn: string;
}

export interface DrawGraphSnapshotOptions {
  alphaForNode?: (nodeId: string) => number;
  graph: LinkedKnowledgeGraph;
  height: number;
  label?: string;
  layout: GraphSnapshotLayout;
  theme: GraphSnapshotTheme;
  width: number;
}

const NOTE_COLOR = "#536471";
const FIT_PADDING = 34;

export function getCurrentGraphTheme(): GraphSnapshotTheme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function createDeterministicGraphLayout(graph: LinkedKnowledgeGraph): GraphSnapshotLayout {
  const centerNode =
    graph.nodes.find((node) => node.kind === "card" || node.kind === "note" || node.kind === "idea") ??
    graph.nodes[0];
  const nodes = graph.nodes.slice(0, 22).map((node, index) => {
    if (centerNode && node.id === centerNode.id) {
      return { ...node, x: 0, y: 0 };
    }

    const hashValue = hash(node.id);
    const ring = node.kind === "concept" ? 84 : 126;
    const angle = ((hashValue % 3600) / 3600) * Math.PI * 2 + index * 0.17;
    const radius = ring + (hashValue % 36);

    return {
      ...node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  });

  return { nodes };
}

export function renderGraphSnapshotDataUrl(options: DrawGraphSnapshotOptions, pixelRatio = 2): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(options.width * pixelRatio);
  canvas.height = Math.round(options.height * pixelRatio);

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas graph export is unavailable.");
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawGraphSnapshot(context, options);
  return canvas.toDataURL("image/png");
}

export function drawGraphSnapshot(context: CanvasRenderingContext2D, options: DrawGraphSnapshotOptions): void {
  const { graph, height, layout, theme, width } = options;
  const palette = getPalette(theme);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const alphaForNode = options.alphaForNode ?? (() => 1);
  const transform = getFitTransform(layout.nodes, width, height);

  context.save();
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.bg;
  context.fillRect(0, 0, width, height);

  if (options.label) {
    context.fillStyle = palette.ink;
    context.font = "700 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
    context.textBaseline = "top";
    context.fillText(options.label, 18, 16);
  }

  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);

    if (!source || !target) {
      continue;
    }

    const alpha = Math.min(alphaForNode(source.id), alphaForNode(target.id));

    if (alpha <= 0.01) {
      continue;
    }

    const from = project(source, transform);
    const to = project(target, transform);
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.lineWidth = edge.kind === "wikilink" ? 1.4 : 1;
    context.strokeStyle = edge.kind === "wikilink" ? palette.muted : palette.line;
    context.globalAlpha = edge.kind === "wikilink" ? Math.min(0.82, alpha) : Math.min(0.72, alpha);
    context.stroke();
  }

  for (const node of layout.nodes) {
    const alpha = alphaForNode(node.id);

    if (alpha <= 0.01) {
      continue;
    }

    const point = project(node, transform);
    const radius = nodeRadius(node) * Math.min(1.55, Math.max(0.75, transform.scale));
    context.globalAlpha = alpha;

    if (node.kind === "ghost" || node.kind === "idea") {
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.strokeStyle = node.kind === "idea" ? palette.blue : palette.muted;
      context.lineWidth = node.kind === "idea" ? 1.8 : 1.4;
      context.setLineDash(node.kind === "idea" ? [5, 3] : [3, 3]);
      context.stroke();
      context.setLineDash([]);
    } else {
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle =
        node.kind === "concept" ? conceptColor(node, palette) : node.kind === "note" ? NOTE_COLOR : palette.muted;
      context.fill();
    }

    if (node.kind === "concept" || node.kind === "ghost" || node.kind === "idea") {
      context.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
      context.textBaseline = "middle";
      context.fillStyle = node.kind === "concept" ? palette.ink : palette.muted;
      context.globalAlpha = node.kind === "concept" ? alpha : alpha * 0.86;
      context.fillText(truncate(node.label), point.x + radius + 4, point.y);
    }
  }

  context.globalAlpha = 1;
  context.restore();
}

function getPalette(theme: GraphSnapshotTheme): GraphPalette {
  if (theme === "dark") {
    return {
      bg: "#000000",
      frame: "#2f3336",
      ink: "#e7e9ea",
      line: "#2f3336",
      muted: "#71767b",
      blue: "#1d9bf0",
      repost: "#00ba7c",
      warn: "#ffd400"
    };
  }

  return {
    bg: "#ffffff",
    frame: "#eff3f4",
    ink: "#0f1419",
    line: "#eff3f4",
    muted: "#536471",
    blue: "#1d9bf0",
    repost: "#00ba7c",
    warn: "#b98a00"
  };
}

function conceptColor(node: GraphSnapshotNode, palette: GraphPalette): string {
  switch (node.zone) {
    case "inside":
      return palette.blue;
    case "learning":
      return palette.repost;
    case "frontier":
      return palette.warn;
    default:
      return palette.muted;
  }
}

function nodeRadius(node: GraphSnapshotNode): number {
  if (node.kind === "concept") {
    return 6 + Math.min(node.weight, 8) * 1.4;
  }

  if (node.kind === "ghost") {
    return 5;
  }

  if (node.kind === "idea") {
    return 5.5;
  }

  return 4;
}

function getFitTransform(nodes: GraphSnapshotNode[], width: number, height: number): { scale: number; tx: number; ty: number } {
  if (nodes.length === 0) {
    return { scale: 1, tx: width / 2, ty: height / 2 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const radius = nodeRadius(node);
    const labelWidth = node.kind === "concept" || node.kind === "ghost" || node.kind === "idea" ? truncate(node.label).length * 7 + 4 : 0;
    minX = Math.min(minX, node.x - radius);
    maxX = Math.max(maxX, node.x + radius + labelWidth);
    minY = Math.min(minY, node.y - radius);
    maxY = Math.max(maxY, node.y + radius);
  }

  const graphWidth = Math.max(maxX - minX, 1);
  const graphHeight = Math.max(maxY - minY, 1);
  const availableWidth = Math.max(width - FIT_PADDING * 2, 1);
  const availableHeight = Math.max(height - FIT_PADDING * 2, 1);
  const scale = Math.min(1.8, Math.max(0.25, Math.min(availableWidth / graphWidth, availableHeight / graphHeight)));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    scale,
    tx: width / 2 - centerX * scale,
    ty: height / 2 - centerY * scale
  };
}

function project(node: GraphSnapshotNode, transform: { scale: number; tx: number; ty: number }): { x: number; y: number } {
  return {
    x: node.x * transform.scale + transform.tx,
    y: node.y * transform.scale + transform.ty
  };
}

function truncate(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}...` : label;
}

function hash(text: string): number {
  let value = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }

  return value >>> 0;
}
