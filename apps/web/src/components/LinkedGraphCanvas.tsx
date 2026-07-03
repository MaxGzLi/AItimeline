import type { LinkedGraphNode, LinkedKnowledgeGraph } from "@aitimeline/core";
import { useEffect, useRef } from "react";

interface SimNode {
  id: string;
  kind: LinkedGraphNode["kind"];
  label: string;
  weight: number;
  zone?: LinkedGraphNode["zone"];
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Palette {
  bg: string;
  line: string;
  ink: string;
  muted: string;
  blue: string;
  repost: string;
  warn: string;
}

const NOTE_COLOR = "#536471"; // matches the non-agent .x-avatar background

// Force-simulation constants, tuned for the small graphs this prototype builds.
const REPULSION = 2600;
const SPRING = 0.02;
const SPRING_LENGTH = 92;
const CENTER_PULL = 0.012;
const DAMPING = 0.86;
const ALPHA_MIN = 0.02;
const ALPHA_DECAY = 0.975;
const REDUCED_MOTION_STEPS = 320;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;

// A self-authored Canvas force-directed graph: repulsion + springs + centering
// + damping, seeded deterministically so screenshots are reproducible. Nodes are
// draggable, the view zooms/pans, hovering highlights incident edges, and colors
// are read live from CSS variables so the active theme wins.
export function LinkedGraphCanvas({
  graph,
  onOpenConcept,
  onOpenCardId
}: {
  graph: LinkedKnowledgeGraph;
  onOpenConcept: (concept: string) => void;
  onOpenCardId: (cardId: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // All mutable simulation/interaction state lives in refs so the rAF loop and
  // pointer handlers never fight React's render cycle.
  const nodesRef = useRef<SimNode[]>([]);
  const sizeRef = useRef({ width: 0, height: 0 });
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const alphaRef = useRef(1);
  const rafRef = useRef(0);
  const runningRef = useRef(false);
  const dirtyRef = useRef(true);
  const hoverRef = useRef<string | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const reducedMotionRef = useRef(false);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  // Stable handler refs so the effect below runs once (never tearing down the
  // simulation just because a parent callback identity changed).
  const openConceptRef = useRef(onOpenConcept);
  openConceptRef.current = onOpenConcept;
  const openCardRef = useRef(onOpenCardId);
  openCardRef.current = onOpenCardId;

  // Re-run the setup effect whenever the graph's shape changes; positions of
  // surviving nodes are preserved through nodesRef, and the view (pan/zoom)
  // survives in viewRef, so a rebuild reheats without resetting the camera.
  const graphSignature = `${graph.nodes.map((node) => node.id).join("|")}::${graph.edges.length}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;

    if (!canvas || !wrap) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    // Non-null-typed aliases: the hoisted helpers below are function
    // declarations, so TS won't carry the guard's narrowing into them.
    const cnv: HTMLCanvasElement = canvas;
    const ctx: CanvasRenderingContext2D = context;

    reducedMotionRef.current =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function hash(text: string): number {
      let h = 2166136261;
      for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function buildNodes() {
      const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
      nodesRef.current = graphRef.current.nodes.map((node) => {
        const existing = previous.get(node.id);

        if (existing) {
          return { ...existing, kind: node.kind, label: node.label, weight: node.weight, zone: node.zone };
        }

        // Deterministic seed from the node id so a fresh layout is reproducible.
        const h = hash(node.id);
        const angle = (h % 3600) / 3600 * Math.PI * 2;
        const radius = 30 + (h % 200);
        return {
          id: node.id,
          kind: node.kind,
          label: node.label,
          weight: node.weight,
          zone: node.zone,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          vx: 0,
          vy: 0
        };
      });
    }

    function step() {
      const nodes = nodesRef.current;
      const alpha = alphaRef.current;

      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];

        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let distSq = dx * dx + dy * dy;

          if (distSq < 0.01) {
            dx = (hash(a.id) % 10) - 5 || 1;
            dy = (hash(b.id) % 10) - 5 || 1;
            distSq = dx * dx + dy * dy;
          }

          const dist = Math.sqrt(distSq);
          const force = (REPULSION / distSq) * alpha;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      const byId = new Map(nodes.map((node) => [node.id, node]));

      for (const edge of graphRef.current.edges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);

        if (!source || !target) {
          continue;
        }

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - SPRING_LENGTH) * SPRING * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      const dragId = dragRef.current?.id;

      for (const node of nodes) {
        node.vx -= node.x * CENTER_PULL * alpha;
        node.vy -= node.y * CENTER_PULL * alpha;

        if (node.id === dragId) {
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        node.vx *= DAMPING;
        node.vy *= DAMPING;
        node.x += node.vx;
        node.y += node.vy;
      }
    }

    function readPalette(): Palette {
      const styles = getComputedStyle(document.documentElement);
      const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
      return {
        bg: read("--x-bg", "#ffffff"),
        line: read("--x-line", "#eff3f4"),
        ink: read("--x-ink", "#0f1419"),
        muted: read("--x-muted", "#536471"),
        blue: read("--x-blue", "#1d9bf0"),
        repost: read("--x-repost", "#00ba7c"),
        warn: read("--x-warn", "#b98a00")
      };
    }

    function conceptColor(node: SimNode, palette: Palette): string {
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

    function nodeRadius(node: SimNode): number {
      if (node.kind === "concept") {
        return 6 + Math.min(node.weight, 8) * 1.4;
      }
      if (node.kind === "ghost") {
        return 5;
      }
      return 4;
    }

    function toScreen(node: SimNode) {
      const { scale, tx, ty } = viewRef.current;
      return { x: node.x * scale + tx, y: node.y * scale + ty };
    }

    function draw() {
      const { width, height } = sizeRef.current;

      if (width === 0 || height === 0) {
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      cnv.width = Math.round(width * dpr);
      cnv.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const palette = readPalette();
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, width, height);

      const nodes = nodesRef.current;
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const hovered = hoverRef.current;

      // Edges first, so nodes sit on top.
      for (const edge of graphRef.current.edges) {
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);

        if (!source || !target) {
          continue;
        }

        const incident = hovered !== null && (edge.source === hovered || edge.target === hovered);
        const from = toScreen(source);
        const to = toScreen(target);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.lineWidth = 1;

        if (incident) {
          ctx.strokeStyle = palette.blue;
          ctx.globalAlpha = 0.9;
        } else {
          ctx.strokeStyle = edge.kind === "wikilink" ? palette.muted : palette.line;
          ctx.globalAlpha = hovered !== null ? 0.4 : edge.kind === "wikilink" ? 0.8 : 1;
        }

        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      for (const node of nodes) {
        const point = toScreen(node);
        const radius = nodeRadius(node) * Math.min(1.6, Math.max(0.75, viewRef.current.scale));

        if (node.kind === "ghost") {
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
          ctx.strokeStyle = palette.muted;
          ctx.lineWidth = 1.4;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
          ctx.fillStyle =
            node.kind === "concept" ? conceptColor(node, palette) : node.kind === "note" ? NOTE_COLOR : palette.muted;
          ctx.globalAlpha = node.kind === "card" ? 0.85 : 1;
          ctx.fill();
          ctx.globalAlpha = 1;

          if (node.id === hovered) {
            ctx.beginPath();
            ctx.arc(point.x, point.y, radius + 2.5, 0, Math.PI * 2);
            ctx.strokeStyle = palette.blue;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }

        // Concept and ghost labels are always on; card/note labels only on hover.
        const showLabel = node.kind === "concept" || node.kind === "ghost" || node.id === hovered;

        if (showLabel && node.label) {
          ctx.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
          ctx.textBaseline = "middle";
          ctx.fillStyle = node.kind === "concept" ? palette.ink : palette.muted;
          ctx.globalAlpha = node.kind === "concept" || node.id === hovered ? 1 : 0.85;
          ctx.fillText(truncate(node.label), point.x + radius + 4, point.y);
          ctx.globalAlpha = 1;
        }
      }
    }

    function loop() {
      if (alphaRef.current > ALPHA_MIN) {
        step();
        alphaRef.current *= ALPHA_DECAY;
      }

      draw();
      const keepGoing = alphaRef.current > ALPHA_MIN || dirtyRef.current;
      dirtyRef.current = false;

      if (keepGoing) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        runningRef.current = false;
      }
    }

    function ensureRunning() {
      if (reducedMotionRef.current) {
        draw();
        return;
      }

      if (!runningRef.current) {
        runningRef.current = true;
        rafRef.current = requestAnimationFrame(loop);
      }
    }

    function requestDraw() {
      dirtyRef.current = true;
      ensureRunning();
    }

    function reheat() {
      if (reducedMotionRef.current) {
        for (let i = 0; i < 40; i += 1) {
          step();
        }
        draw();
        return;
      }

      alphaRef.current = Math.max(alphaRef.current, 0.3);
      ensureRunning();
    }

    function settle() {
      // Run the layout to convergence without animating.
      alphaRef.current = 1;
      for (let i = 0; i < REDUCED_MOTION_STEPS; i += 1) {
        step();
        alphaRef.current *= ALPHA_DECAY;
      }
      alphaRef.current = 0;
      draw();
    }

    function pointerToLocal(event: PointerEvent) {
      const rect = cnv.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function hitTest(local: { x: number; y: number }): SimNode | null {
      const nodes = nodesRef.current;
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i];
        const point = toScreen(node);
        const radius = nodeRadius(node) * Math.min(1.6, Math.max(0.75, viewRef.current.scale)) + 4;
        const dx = local.x - point.x;
        const dy = local.y - point.y;
        if (dx * dx + dy * dy <= radius * radius) {
          return node;
        }
      }
      return null;
    }

    function onPointerDown(event: PointerEvent) {
      cnv.setPointerCapture(event.pointerId);
      const local = pointerToLocal(event);
      pointerStartRef.current = local;
      const node = hitTest(local);

      if (node) {
        dragRef.current = { id: node.id, moved: false };
      } else {
        panRef.current = { x: local.x, y: local.y };
      }
    }

    function onPointerMove(event: PointerEvent) {
      const local = pointerToLocal(event);
      const drag = dragRef.current;

      if (drag) {
        const view = viewRef.current;
        const node = nodesRef.current.find((candidate) => candidate.id === drag.id);
        if (node) {
          node.x = (local.x - view.tx) / view.scale;
          node.y = (local.y - view.ty) / view.scale;
          node.vx = 0;
          node.vy = 0;
        }
        const dx = local.x - pointerStartRef.current.x;
        const dy = local.y - pointerStartRef.current.y;
        if (dx * dx + dy * dy > 16) {
          drag.moved = true;
        }
        reheat();
        return;
      }

      const pan = panRef.current;

      if (pan) {
        const view = viewRef.current;
        view.tx += local.x - pan.x;
        view.ty += local.y - pan.y;
        panRef.current = { x: local.x, y: local.y };
        requestDraw();
        return;
      }

      const node = hitTest(local);
      const nextHover = node?.id ?? null;
      cnv.style.cursor = node ? (node.kind === "ghost" ? "default" : "pointer") : "grab";

      if (nextHover !== hoverRef.current) {
        hoverRef.current = nextHover;
        requestDraw();
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (cnv.hasPointerCapture(event.pointerId)) {
        cnv.releasePointerCapture(event.pointerId);
      }

      const drag = dragRef.current;

      if (drag && !drag.moved) {
        const node = nodesRef.current.find((candidate) => candidate.id === drag.id);
        if (node) {
          if (node.kind === "concept") {
            openConceptRef.current(node.label);
          } else if (node.kind === "card" || node.kind === "note") {
            openCardRef.current(node.id);
          }
        }
      }

      dragRef.current = null;
      panRef.current = null;
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = cnv.getBoundingClientRect();
      const local = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const view = viewRef.current;
      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
      const ratio = nextScale / view.scale;
      // Keep the point under the cursor fixed while zooming.
      view.tx = local.x - (local.x - view.tx) * ratio;
      view.ty = local.y - (local.y - view.ty) * ratio;
      view.scale = nextScale;
      requestDraw();
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      const wasEmpty = sizeRef.current.width === 0;
      sizeRef.current = { width, height };
      if (wasEmpty && width > 0 && height > 0) {
        // First real size: center the world origin in the viewport.
        viewRef.current.tx = width / 2;
        viewRef.current.ty = height / 2;
      }
      requestDraw();
    });

    const themeObserver = new MutationObserver(() => requestDraw());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    buildNodes();

    if (reducedMotionRef.current) {
      // Defer until the ResizeObserver has centered the view.
      requestAnimationFrame(() => settle());
    } else {
      alphaRef.current = 1;
      ensureRunning();
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    resizeObserver.observe(wrap);

    return () => {
      cancelAnimationFrame(rafRef.current);
      runningRef.current = false;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();
      themeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSignature]);

  return (
    <div className="x-graphcanvas" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}

function truncate(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}
