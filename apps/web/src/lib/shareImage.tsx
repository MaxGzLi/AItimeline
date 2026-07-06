export interface RenderPngOptions {
  fileName?: string;
  height: number;
  pixelRatio?: number;
  width: number;
}

export type RenderPngPayload = ShareCardPngPayload | GraphComparisonPngPayload;

export interface ShareCardPngPayload {
  claim: string;
  eyebrow: string;
  graphImageUrl?: string;
  keyTakeaway: string;
  kind: "share-card";
  productName?: string;
  sourceLine: string;
  title: string;
}

export interface GraphComparisonPngPayload {
  claim: string;
  compareLabel: string;
  endImageUrl: string;
  endLabel: string;
  kind: "graph-comparison";
  productName?: string;
  startImageUrl: string;
  startLabel: string;
  summary: string;
}

type TextVariant = "math" | "normal";

interface ExportPalette {
  bg: string;
  blue: string;
  ink: string;
  line: string;
  module: string;
  muted: string;
  theme: "dark" | "light";
}

interface TextFonts {
  math: string;
  normal: string;
}

interface TextPiece {
  text: string;
  variant: TextVariant;
  width: number;
}

interface WrappedLine {
  pieces: TextPiece[];
  width: number;
}

interface ShareCardLayout {
  contentHeight: number;
  height: number;
  keyTakeawayLines: WrappedLine[];
  sourceLines: WrappedLine[];
  sourceY: number;
  textTop: number;
  titleLines: WrappedLine[];
  width: number;
}

interface GraphComparisonLayout {
  frameHeight: number;
  gridY: number;
  height: number;
  summaryLines: WrappedLine[];
  width: number;
}

const FONT_FAMILY = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const MONO_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const PRODUCT_NAME = "AITimeline";

const SHARE = {
  bottom: 54,
  graph: { height: 250, radius: 8, width: 320, x: 828, y: 52 },
  mark: { height: 62, radius: 8, width: 220, x: 928 },
  sourceGap: 42,
  sourceWidth: 740,
  textLeft: 72,
  textTop: 62,
  textWidth: 740
};

const COMPARE = {
  captionHeight: 43,
  frameGap: 24,
  headerGap: 28,
  mark: { height: 58, radius: 8, width: 210 },
  minImageHeight: 440,
  padding: 42
};

const fallbackPalettes: Record<"dark" | "light", Omit<ExportPalette, "theme">> = {
  dark: {
    bg: "#000000",
    blue: "#1d9bf0",
    ink: "#e7e9ea",
    line: "#2f3336",
    module: "#16181c",
    muted: "#71767b"
  },
  light: {
    bg: "#ffffff",
    blue: "#1d9bf0",
    ink: "#0f1419",
    line: "#eff3f4",
    module: "#f7f9f9",
    muted: "#536471"
  }
};

export async function renderElementToPng(payload: RenderPngPayload, options: RenderPngOptions): Promise<string> {
  await document.fonts?.ready;

  const measurementContext = createCanvasContext(1, 1);
  const palette = getExportPalette();

  if (payload.kind === "share-card") {
    const layout = layoutShareCard(measurementContext, payload, options);
    const { canvas, context } = createExportCanvas(layout.width, layout.height, options.pixelRatio ?? 2);

    await drawShareCard(context, payload, layout, palette);
    return canvas.toDataURL("image/png");
  }

  const layout = layoutGraphComparison(measurementContext, payload, options);
  const { canvas, context } = createExportCanvas(layout.width, layout.height, options.pixelRatio ?? 2);

  await drawGraphComparison(context, payload, layout, palette);
  return canvas.toDataURL("image/png");
}

export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function copyPngDataUrlToClipboard(dataUrl: string): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("Clipboard image writes are unavailable.");
  }

  const blob = dataUrlToBlob(dataUrl);
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}

export function safePngFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "share";
}

function layoutShareCard(
  context: CanvasRenderingContext2D,
  payload: ShareCardPngPayload,
  options: RenderPngOptions
): ShareCardLayout {
  const titleFonts = getFonts(52, 900, "normal", 700);
  const takeawayFonts = getFonts(28, 400, "normal", 600);
  const sourceFonts = getFonts(19, 700, "normal", 700);
  const titleLines = wrapText(context, payload.title, SHARE.textWidth, titleFonts);
  const keyTakeawayLines = wrapText(context, payload.keyTakeaway, SHARE.textWidth, takeawayFonts);
  const sourceLines = wrapText(context, payload.sourceLine, SHARE.sourceWidth, sourceFonts);
  const eyebrowHeight = 24;
  const titleHeight = getLinesHeight(titleLines, 56.2);
  const keyTakeawayHeight = getLinesHeight(keyTakeawayLines, 38.1);
  const sourceHeight = getLinesHeight(sourceLines, 26);
  const contentHeight = eyebrowHeight + 16 + titleHeight + 24 + keyTakeawayHeight;
  const initialSourceY = options.height - SHARE.bottom - sourceHeight;
  const availableBottom = initialSourceY - SHARE.sourceGap;
  const centeredTop = SHARE.textTop + Math.max(0, availableBottom - SHARE.textTop - contentHeight) / 2;
  const textTop = Math.max(SHARE.textTop, centeredTop);
  const sourceY = Math.max(initialSourceY, textTop + contentHeight + SHARE.sourceGap);
  const height = Math.ceil(Math.max(options.height, sourceY + sourceHeight + SHARE.bottom));

  return {
    contentHeight,
    height,
    keyTakeawayLines,
    sourceLines,
    sourceY,
    textTop,
    titleLines,
    width: options.width
  };
}

function layoutGraphComparison(
  context: CanvasRenderingContext2D,
  payload: GraphComparisonPngPayload,
  options: RenderPngOptions
): GraphComparisonLayout {
  const summaryWidth = options.width - COMPARE.padding * 2 - COMPARE.mark.width - 30;
  const summaryLines = wrapText(context, payload.summary, summaryWidth, getFonts(42, 900, "normal", 700));
  const headerHeight = Math.max(COMPARE.mark.height, 22 + 8 + getLinesHeight(summaryLines, 47.1));
  const gridY = COMPARE.padding + headerHeight + COMPARE.headerGap;
  const frameHeight = Math.max(
    COMPARE.minImageHeight + COMPARE.captionHeight,
    options.height - gridY - COMPARE.padding
  );
  const height = Math.ceil(Math.max(options.height, gridY + frameHeight + COMPARE.padding));

  return { frameHeight, gridY, height, summaryLines, width: options.width };
}

async function drawShareCard(
  context: CanvasRenderingContext2D,
  payload: ShareCardPngPayload,
  layout: ShareCardLayout,
  palette: ExportPalette
): Promise<void> {
  drawShareBackground(context, layout.width, layout.height, palette);

  if (payload.graphImageUrl) {
    const image = await loadImage(payload.graphImageUrl);
    drawImageFrame(context, image, SHARE.graph.x, SHARE.graph.y, SHARE.graph.width, SHARE.graph.height, SHARE.graph.radius, palette);
  }

  const x = SHARE.textLeft;
  let y = layout.textTop;

  context.textBaseline = "top";
  context.fillStyle = palette.muted;
  context.font = getFont(20, 800);
  context.fillText(payload.eyebrow, x, y);
  y += 24 + 16;

  drawLines(context, layout.titleLines, x, y, 56.2, palette.ink, getFonts(52, 900, "normal", 700));
  y += getLinesHeight(layout.titleLines, 56.2) + 24;

  drawLines(context, layout.keyTakeawayLines, x, y, 38.1, palette.ink, getFonts(28, 400, "normal", 600));
  drawLines(context, layout.sourceLines, x, layout.sourceY, 26, palette.muted, getFonts(19, 700, "normal", 700));
  drawProductMark(
    context,
    payload.productName ?? PRODUCT_NAME,
    payload.claim,
    SHARE.mark.x,
    layout.height - 46 - SHARE.mark.height,
    SHARE.mark.width,
    SHARE.mark.height,
    palette,
    true
  );
}

async function drawGraphComparison(
  context: CanvasRenderingContext2D,
  payload: GraphComparisonPngPayload,
  layout: GraphComparisonLayout,
  palette: ExportPalette
): Promise<void> {
  const startImage = await loadImage(payload.startImageUrl);
  const endImage = await loadImage(payload.endImageUrl);
  const frameWidth = (layout.width - COMPARE.padding * 2 - COMPARE.frameGap) / 2;
  const imageHeight = layout.frameHeight - COMPARE.captionHeight;
  const startX = COMPARE.padding;
  const endX = COMPARE.padding + frameWidth + COMPARE.frameGap;

  context.fillStyle = palette.bg;
  context.fillRect(0, 0, layout.width, layout.height);

  context.textBaseline = "top";
  context.fillStyle = palette.muted;
  context.font = getFont(18, 800);
  context.fillText(payload.compareLabel, COMPARE.padding, COMPARE.padding);
  drawLines(
    context,
    layout.summaryLines,
    COMPARE.padding,
    COMPARE.padding + 30,
    47.1,
    palette.ink,
    getFonts(42, 900, "normal", 700)
  );
  drawProductMark(
    context,
    payload.productName ?? PRODUCT_NAME,
    payload.claim,
    layout.width - COMPARE.padding - COMPARE.mark.width,
    COMPARE.padding,
    COMPARE.mark.width,
    COMPARE.mark.height,
    palette,
    false
  );

  drawComparisonFrame(context, startImage, startX, layout.gridY, frameWidth, imageHeight, payload.startLabel, palette);
  drawComparisonFrame(context, endImage, endX, layout.gridY, frameWidth, imageHeight, payload.endLabel, palette);
}

function drawShareBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: ExportPalette
): void {
  context.fillStyle = palette.bg;
  context.fillRect(0, 0, width, height);

  const gradient = context.createLinearGradient(0, 0, width * 0.55, height * 0.55);
  gradient.addColorStop(0, colorWithAlpha(palette.blue, 0.1));
  gradient.addColorStop(0.36, colorWithAlpha(palette.blue, 0));
  gradient.addColorStop(1, colorWithAlpha(palette.blue, 0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawImageFrame(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  palette: ExportPalette
): void {
  context.save();
  roundedRectPath(context, x, y, width, height, radius);
  context.clip();
  context.fillStyle = palette.bg;
  context.fillRect(x, y, width, height);
  context.drawImage(image, x, y, width, height);
  context.restore();

  context.strokeStyle = palette.line;
  context.lineWidth = 1;
  roundedRectPath(context, x + 0.5, y + 0.5, width - 1, height - 1, radius);
  context.stroke();
}

function drawComparisonFrame(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  imageHeight: number,
  caption: string,
  palette: ExportPalette
): void {
  const totalHeight = imageHeight + COMPARE.captionHeight;

  context.fillStyle = palette.bg;
  roundedRectPath(context, x, y, width, totalHeight, 8);
  context.fill();
  context.strokeStyle = palette.line;
  context.lineWidth = 1;
  roundedRectPath(context, x + 0.5, y + 0.5, width - 1, totalHeight - 1, 8);
  context.stroke();

  context.save();
  roundedRectPath(context, x, y, width, imageHeight, 8);
  context.clip();
  drawImageCover(context, image, x, y, width, imageHeight);
  context.restore();

  context.strokeStyle = palette.line;
  context.beginPath();
  context.moveTo(x, y + imageHeight + 0.5);
  context.lineTo(x + width, y + imageHeight + 0.5);
  context.stroke();

  context.fillStyle = palette.muted;
  context.font = getFont(15, 800);
  context.textBaseline = "top";
  context.fillText(caption, x + 16, y + imageHeight + 12);
}

function drawProductMark(
  context: CanvasRenderingContext2D,
  productName: string,
  claim: string,
  x: number,
  y: number,
  width: number,
  height: number,
  palette: ExportPalette,
  fillBackground: boolean
): void {
  if (fillBackground) {
    context.fillStyle = colorWithAlpha(palette.bg, palette.theme === "dark" ? 0.9 : 0.92);
    roundedRectPath(context, x, y, width, height, 8);
    context.fill();
  }

  context.strokeStyle = palette.line;
  context.lineWidth = 1;
  roundedRectPath(context, x + 0.5, y + 0.5, width - 1, height - 1, 8);
  context.stroke();

  context.textBaseline = "top";
  context.fillStyle = palette.ink;
  context.font = getFont(17, 900);
  context.fillText(productName, x + 16, y + 12);
  context.fillStyle = palette.blue;
  context.font = getFont(13, 800);
  context.fillText(claim, x + 16, y + 34);
}

function drawImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;

  if (sourceRatio > targetRatio) {
    sourceWidth = sourceHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = sourceWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawLines(
  context: CanvasRenderingContext2D,
  lines: WrappedLine[],
  x: number,
  y: number,
  lineHeight: number,
  color: string,
  fonts: TextFonts
): void {
  context.fillStyle = color;
  context.textBaseline = "top";

  lines.forEach((line, lineIndex) => {
    let cursorX = x;
    const cursorY = y + lineIndex * lineHeight;

    for (const piece of line.pieces) {
      context.font = piece.variant === "math" ? fonts.math : fonts.normal;
      context.fillText(piece.text, cursorX, cursorY);
      cursorX += piece.width;
    }
  });
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fonts: TextFonts
): WrappedLine[] {
  const lines: WrappedLine[] = [];
  const paragraphs = text.split(/\r\n|\r|\n/);

  for (const paragraph of paragraphs) {
    let currentPieces: TextPiece[] = [];
    let currentWidth = 0;

    const pushLine = () => {
      lines.push({ pieces: currentPieces, width: currentWidth });
      currentPieces = [];
      currentWidth = 0;
    };

    const addSegment = (segment: string, variant: TextVariant) => {
      const segmentWidth = measureText(context, segment, variant, fonts);

      if (segmentWidth > maxWidth && Array.from(segment).length > 1) {
        for (const char of Array.from(segment)) {
          addSegment(char, variant);
        }
        return;
      }

      if (currentPieces.length > 0 && currentWidth + segmentWidth > maxWidth) {
        pushLine();
      }

      const previous = currentPieces[currentPieces.length - 1];

      if (previous?.variant === variant) {
        previous.text += segment;
        previous.width += segmentWidth;
      } else {
        currentPieces.push({ text: segment, variant, width: segmentWidth });
      }

      currentWidth += segmentWidth;
    };

    for (const run of parseMathRuns(paragraph)) {
      for (const segment of splitSegments(run.text)) {
        addSegment(segment, run.variant);
      }
    }

    pushLine();
  }

  return lines.length > 0 ? lines : [{ pieces: [], width: 0 }];
}

function parseMathRuns(text: string): Array<{ text: string; variant: TextVariant }> {
  const runs: Array<{ text: string; variant: TextVariant }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf("$", cursor);

    if (start === -1) {
      runs.push({ text: text.slice(cursor), variant: "normal" });
      break;
    }

    if (start > cursor) {
      runs.push({ text: text.slice(cursor, start), variant: "normal" });
    }

    const delimiter = text.startsWith("$$", start) ? "$$" : "$";
    const end = text.indexOf(delimiter, start + delimiter.length);

    if (end === -1) {
      runs.push({ text: text.slice(start), variant: "normal" });
      break;
    }

    runs.push({ text: text.slice(start, end + delimiter.length), variant: "math" });
    cursor = end + delimiter.length;
  }

  return runs;
}

function splitSegments(text: string): string[] {
  return text.match(/\s+|[^\s]+/gu) ?? [];
}

function measureText(context: CanvasRenderingContext2D, text: string, variant: TextVariant, fonts: TextFonts): number {
  context.font = variant === "math" ? fonts.math : fonts.normal;
  return context.measureText(text).width;
}

function getLinesHeight(lines: WrappedLine[], lineHeight: number): number {
  return Math.max(1, lines.length) * lineHeight;
}

function getFonts(size: number, weight: number, style: "italic" | "normal" = "normal", mathWeight = weight): TextFonts {
  return {
    math: `${style === "italic" ? "italic " : ""}${mathWeight} ${size}px ${MONO_FONT_FAMILY}`,
    normal: getFont(size, weight)
  };
}

function getFont(size: number, weight: number): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

function getExportPalette(): ExportPalette {
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const fallback = fallbackPalettes[theme];

  return {
    bg: getCssVariable("--x-bg", fallback.bg),
    blue: getCssVariable("--x-blue", fallback.blue),
    ink: getCssVariable("--x-ink", fallback.ink),
    line: getCssVariable("--x-line", fallback.line),
    module: getCssVariable("--x-module", fallback.module),
    muted: getCssVariable("--x-muted", fallback.muted),
    theme
  };
}

function getCssVariable(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function colorWithAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : color;
}

function parseColor(color: string): { b: number; g: number; r: number } | null {
  const trimmed = color.trim();

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return {
      b: parseInt(`${b}${b}`, 16),
      g: parseInt(`${g}${g}`, 16),
      r: parseInt(`${r}${r}`, 16)
    };
  }

  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return {
      b: parseInt(trimmed.slice(5, 7), 16),
      g: parseInt(trimmed.slice(3, 5), 16),
      r: parseInt(trimmed.slice(1, 3), 16)
    };
  }

  const rgb = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);

  if (rgb) {
    return {
      b: Number(rgb[3]),
      g: Number(rgb[2]),
      r: Number(rgb[1])
    };
  }

  return null;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function createCanvasContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas export is unavailable.");
  }

  return context;
}

function createExportCanvas(
  width: number,
  height: number,
  pixelRatio: number
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas export is unavailable.");
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { canvas, context };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load PNG export image."));
    image.src = url;
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [metadata, payload] = dataUrl.split(",");
  const mime = metadata?.match(/^data:([^;]+)/)?.[1] ?? "image/png";
  const binary = atob(payload ?? "");
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}
