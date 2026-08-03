import { normalizeConceptKey, normalizeConceptLabel } from "./conceptAliases.js";

/**
 * Deterministic concept-map layout for the timeline card lead visual.
 *
 * The card's own concepts become a centre + ring diagram: the centre is the
 * card's main concept, the ring is the rest, and every edge is a plain spoke
 * from the centre outwards. No relation is asserted — the card's `graphEdges`
 * carry relation words whose endpoints never pass the grounding gate, so this
 * layer draws membership only. Cards with nothing to draw report `degenerate`
 * so the UI keeps them text-only.
 *
 * Everything here is pure and seeded by `postId`, so the same card always draws
 * the same picture across renders, processes and machines.
 */

export interface ConceptMapLayoutInput {
  postId: string;
  primaryConcept?: string;
  concepts?: readonly string[];
  width?: number;
  height?: number;
}

/** Centre node, then the ring split by weight: heavier concepts sit closer in. */
export type ConceptMapNodeTier = "center" | "inner" | "outer";

export interface ConceptMapNode {
  /** Original concept text, untruncated — use it for accessible descriptions. */
  concept: string;
  /** Display text, truncated to the label budget. */
  label: string;
  tier: ConceptMapNodeTier;
  weight: number;
  x: number;
  y: number;
  /** Dot radius; for the centre node this is 0 (it is drawn as a chip). */
  radius: number;
  /** Label box centre and size. The centre chip's box includes its padding. */
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
  fontSize: number;
}

/** A bare spoke from the centre to one of its concepts; it carries no relation. */
export interface ConceptMapEdge {
  from: string;
  to: string;
  weight: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ConceptMapLayout {
  nodes: ConceptMapNode[];
  edges: ConceptMapEdge[];
  /** Nothing worth drawing (fewer than two nodes survived) — keep the card text-only. */
  degenerate: boolean;
  width: number;
  height: number;
}

const defaultWidth = 520;
const defaultHeight = 240;
const maxPeripheralNodes = 8;
const centerFontSize = 14;
const centerChipHeight = 32;
const centerChipPaddingX = 12;
const maxCenterLabelWidth = 168;
const nodeFontSize = 13;
const nodeLabelHeight = 17;
const maxNodeLabelWidth = 120;
const innerDotRadius = 5;
const outerDotRadius = 4;
const labelGap = 6;
const ringInsetY = 42;
const canvasMargin = 4;
/** Kept between boxes so neighbouring labels never touch. */
const boxPadding = 2;
const innerRingFactor = 0.82;
const tau = Math.PI * 2;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ConceptCandidate {
  key: string;
  label: string;
  weight: number;
  order: number;
}

export function layoutConceptMap(input: ConceptMapLayoutInput): ConceptMapLayout {
  const width = input.width ?? defaultWidth;
  const center = pickCenter(input.primaryConcept, input.concepts);

  if (!center) {
    return { nodes: [], edges: [], degenerate: true, width, height: input.height ?? defaultHeight };
  }

  const candidates = spokesOf(center.key, input.concepts);

  if (candidates.length === 0) {
    return { nodes: [], edges: [], degenerate: true, width, height: input.height ?? defaultHeight };
  }

  const peers = candidates.slice(0, maxPeripheralNodes).map((peer) => ({
    ...peer,
    display: truncateToWidth(peer.label, nodeFontSize, maxNodeLabelWidth)
  }));
  // A small ring in a tall box reads as empty space, so a sparse map gets a
  // shorter box and the ring widens until the longest label hits the edge.
  const height = input.height ?? (peers.length >= 5 ? defaultHeight : peers.length >= 3 ? 200 : 160);
  const radiusX = Math.max(
    60,
    width / 2 -
      canvasMargin -
      innerDotRadius -
      labelGap -
      Math.max(...peers.map((peer) => estimateTextWidth(peer.display, nodeFontSize)))
  );
  const centerNode = layoutCenterNode(center.label, width, height);
  const placed: Box[] = [boxAround(centerNode.labelX, centerNode.labelY, centerNode.labelWidth, centerNode.labelHeight)];
  const nodes: ConceptMapNode[] = [centerNode];
  const angles = assignAngles(input.postId, peers);
  const innerCount = peers.length > 2 ? Math.ceil(peers.length / 2) : 0;

  for (const [rank, peer] of peers.entries()) {
    const node = layoutPeerNode(peer, angles.get(peer.key) ?? 0, rank < innerCount, radiusX, width, height);
    const labelBox = boxAround(node.labelX, node.labelY, node.labelWidth, node.labelHeight);
    const dotBox = boxAround(node.x, node.y, node.radius * 2, node.radius * 2);

    if (boxesIntersect(labelBox, dotBox) || placed.some((box) => boxesIntersect(box, labelBox) || boxesIntersect(box, dotBox))) {
      continue;
    }

    placed.push(labelBox, dotBox);
    nodes.push(node);
  }

  if (nodes.length < 2) {
    return { nodes: [], edges: [], degenerate: true, width, height };
  }

  centerComposition(nodes, placed, width, height);

  const drawnEdges = layoutEdges(
    peers.map((peer) => spokeEdge(center, peer)),
    nodes
  );

  return { nodes, edges: drawnEdges, degenerate: false, width, height };
}

/** Rough advance width for `text`; wide (CJK) glyphs count as a full em. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;

    if (isWideGlyph(code)) {
      units += 1;
    } else if (char === " ") {
      units += 0.3;
    } else if (char >= "A" && char <= "Z") {
      units += 0.62;
    } else {
      units += 0.55;
    }
  }

  return units * fontSize;
}

function isWideGlyph(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

function truncateToWidth(text: string, fontSize: number, maxWidth: number): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) {
    return text;
  }

  const chars = [...text];

  for (let end = chars.length - 1; end > 0; end -= 1) {
    const candidate = `${chars.slice(0, end).join("")}…`;

    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      return candidate;
    }
  }

  return "…";
}

interface SpokeEdge {
  sourceKey: string;
  sourceLabel: string;
  targetKey: string;
  targetLabel: string;
  weight: number;
  order: number;
}

function pickCenter(
  primaryConcept: string | undefined,
  concepts: readonly string[] | undefined
): { key: string; label: string } | undefined {
  const primaryLabel = normalizeConceptLabel(primaryConcept ?? "");
  const primaryKey = normalizeConceptKey(primaryLabel);

  if (primaryKey) {
    return { key: primaryKey, label: primaryLabel };
  }

  for (const concept of concepts ?? []) {
    const label = normalizeConceptLabel(concept);
    const key = normalizeConceptKey(label);

    if (key) {
      return { key, label };
    }
  }

  return undefined;
}

/** The ring: the remaining concepts, kept in their card order. */
function spokesOf(centerKey: string, concepts: readonly string[] | undefined): ConceptCandidate[] {
  const spokes: ConceptCandidate[] = [];
  const seen = new Set<string>([centerKey]);

  for (const concept of concepts ?? []) {
    const label = normalizeConceptLabel(concept);
    const key = normalizeConceptKey(label);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    spokes.push({ key, label, weight: 1 - spokes.length / 100, order: spokes.length });
  }

  return spokes;
}

function spokeEdge(center: { key: string; label: string }, peer: ConceptCandidate): SpokeEdge {
  return {
    sourceKey: center.key,
    sourceLabel: center.label,
    targetKey: peer.key,
    targetLabel: peer.label,
    weight: peer.weight,
    order: peer.order
  };
}

function layoutCenterNode(label: string, width: number, height: number): ConceptMapNode {
  const display = truncateToWidth(label, centerFontSize, maxCenterLabelWidth);
  const x = width / 2;
  const y = height / 2;

  return {
    concept: label,
    label: display,
    tier: "center",
    weight: 1,
    x,
    y,
    radius: 0,
    labelX: x,
    labelY: y,
    labelWidth: estimateTextWidth(display, centerFontSize) + centerChipPaddingX * 2,
    labelHeight: centerChipHeight,
    fontSize: centerFontSize
  };
}

function layoutPeerNode(
  peer: ConceptCandidate & { display: string },
  angle: number,
  isInner: boolean,
  ringRadiusX: number,
  width: number,
  height: number
): ConceptMapNode {
  const factor = isInner ? innerRingFactor : 1;
  const radiusX = ringRadiusX * factor;
  const radiusY = Math.max(40, height / 2 - ringInsetY) * factor;
  const x = width / 2 + radiusX * Math.cos(angle);
  const y = height / 2 + radiusY * Math.sin(angle);
  const dotRadius = isInner ? innerDotRadius : outerDotRadius;
  const display = peer.display;
  const labelWidth = estimateTextWidth(display, nodeFontSize);
  const horizontal = Math.abs(Math.cos(angle)) > 0.4;
  const labelX = horizontal
    ? x + Math.sign(Math.cos(angle)) * (dotRadius + labelGap + labelWidth / 2)
    : x;
  const labelY = horizontal ? y : y + (Math.sin(angle) >= 0 ? 1 : -1) * (dotRadius + labelGap + nodeLabelHeight / 2);

  return {
    concept: peer.label,
    label: display,
    tier: isInner ? "inner" : "outer",
    weight: peer.weight,
    x,
    y,
    radius: dotRadius,
    labelX: clamp(labelX, labelWidth / 2 + canvasMargin, width - labelWidth / 2 - canvasMargin),
    labelY: clamp(labelY, nodeLabelHeight / 2 + canvasMargin, height - nodeLabelHeight / 2 - canvasMargin),
    labelWidth,
    labelHeight: nodeLabelHeight,
    fontSize: nodeFontSize
  };
}

/**
 * Culling can leave the drawing hugging one side, and a two-node map always
 * does. Shifting everything by the same offset re-centres it without touching
 * the relative geometry the collision pass just cleared.
 */
function centerComposition(nodes: ConceptMapNode[], placed: Box[], width: number, height: number): void {
  const left = Math.min(...placed.map((box) => box.left));
  const right = Math.max(...placed.map((box) => box.right));
  const top = Math.min(...placed.map((box) => box.top));
  const bottom = Math.max(...placed.map((box) => box.bottom));
  const offsetX = (width - right - left) / 2;
  const offsetY = (height - bottom - top) / 2;

  if (offsetX === 0 && offsetY === 0) {
    return;
  }

  for (const node of nodes) {
    node.x += offsetX;
    node.y += offsetY;
    node.labelX += offsetX;
    node.labelY += offsetY;
  }

  for (const box of placed) {
    box.left += offsetX;
    box.right += offsetX;
    box.top += offsetY;
    box.bottom += offsetY;
  }
}

/**
 * Every peer gets its own sector of the ring; which peer lands in which sector
 * (and the wobble inside it) comes from the post-seeded hash, never from a RNG.
 */
function assignAngles(postId: string, peers: ConceptCandidate[]): Map<string, number> {
  // A lone neighbour reads as a sentence, so it sits beside the centre rather
  // than at whatever angle the hash picked.
  if (peers.length === 1) {
    const side = hashStringFnv1a(`${postId}#side`) % 2 === 0 ? 0 : Math.PI;

    return new Map([[peers[0].key, side]]);
  }

  const sector = tau / peers.length;
  const rotation = (hashStringFnv1a(`${postId}#rotation`) / 0x100000000) * tau;
  const slots = peers
    .map((peer, index) => ({ peer, index, hash: hashStringFnv1a(`${postId}|${peer.key}`) }))
    .sort((left, right) => left.hash - right.hash || left.index - right.index);
  const angles = new Map<string, number>();

  for (const [slot, entry] of slots.entries()) {
    const jitter = (hashStringFnv1a(`${postId}~${entry.peer.key}`) / 0x100000000 - 0.5) * sector * 0.3;
    angles.set(entry.peer.key, rotation + slot * sector + jitter);
  }

  return angles;
}

function layoutEdges(edges: SpokeEdge[], nodes: ConceptMapNode[]): ConceptMapEdge[] {
  const byKey = new Map(nodes.map((node) => [normalizeConceptKey(node.concept), node]));
  const drawable = edges
    .filter((edge) => byKey.has(edge.sourceKey) && byKey.has(edge.targetKey))
    .sort((left, right) => right.weight - left.weight || left.order - right.order);
  const laidOut: ConceptMapEdge[] = [];

  for (const edge of drawable) {
    const from = byKey.get(edge.sourceKey);
    const to = byKey.get(edge.targetKey);

    if (!from || !to) {
      continue;
    }

    const start = boundaryPoint(from, to.x, to.y);
    const end = boundaryPoint(to, from.x, from.y);

    laidOut.push({
      from: from.concept,
      to: to.concept,
      weight: edge.weight,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y
    });
  }

  return laidOut;
}

/** Where the edge should stop: the chip's border for the centre, the dot's rim for a peer. */
function boundaryPoint(node: ConceptMapNode, towardX: number, towardY: number): { x: number; y: number } {
  const dx = towardX - node.x;
  const dy = towardY - node.y;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = dx / length;
  const unitY = dy / length;
  const inset =
    node.tier === "center"
      ? Math.min(
          Math.abs(unitX) > 1e-6 ? node.labelWidth / 2 / Math.abs(unitX) : Infinity,
          Math.abs(unitY) > 1e-6 ? node.labelHeight / 2 / Math.abs(unitY) : Infinity
        ) + 3
      : node.radius + 3;

  return { x: node.x + unitX * inset, y: node.y + unitY * inset };
}

function boxAround(centerX: number, centerY: number, width: number, height: number): Box {
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2
  };
}

function boxesIntersect(left: Box, right: Box): boolean {
  return (
    left.left < right.right + boxPadding &&
    left.right + boxPadding > right.left &&
    left.top < right.bottom + boxPadding &&
    left.bottom + boxPadding > right.top
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** FNV-1a 32-bit, same shape as the ranker's session-seed hash. */
function hashStringFnv1a(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}
