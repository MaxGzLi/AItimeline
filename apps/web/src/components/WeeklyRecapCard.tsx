import type { WeeklyConceptTrend, WeeklyRecapRecord } from "@aitimeline/core";
import { Copy, Download, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { copyPngDataUrlToClipboard, downloadDataUrl, renderElementToPng, safePngFileName } from "../lib/shareImage";
import { getDateLocale, getI18nLanguage, t } from "../lib/i18n";

const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 675;

export function WeeklyRecapCard({
  onDismiss,
  recap,
  theme
}: {
  onDismiss: (recap: WeeklyRecapRecord) => void;
  recap: WeeklyRecapRecord;
  theme: "light" | "dark";
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const language = getI18nLanguage();
  const narrativeLines = language === "en" ? recap.narrative.en : recap.narrative.zh;
  const weekRange = formatWeekRange(recap.weekStart, recap.weekEnd);
  const stats = useMemo(() => getWeeklyStats(recap), [recap, language]);

  return (
    <section className="x-weekly-card" aria-label={t("weekly.aria")}>
      <div className="x-weekly-head">
        <div>
          <p className="x-weekly-range">{weekRange}</p>
          <h2>{t("weekly.title")}</h2>
        </div>
        <button className="x-iconbtn" onClick={() => onDismiss(recap)} title={t("weekly.dismiss")} type="button">
          <X size={18} />
        </button>
      </div>

      <div className="x-weekly-copy">
        {narrativeLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      <WeeklyTrendCanvas theme={theme} trend={recap.conceptTrend} />

      <div className="x-weekly-foot">
        <div className="x-weekly-stats">
          {stats.map((stat) => (
            <div className="x-weekly-stat" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
        <button className="x-act" onClick={() => setShareOpen(true)} title={t("weekly.share")} type="button">
          <Share2 size={17} />
          <span>{t("share.open")}</span>
        </button>
      </div>

      {shareOpen ? (
        <WeeklyRecapShareModal
          narrativeLines={narrativeLines}
          onClose={() => setShareOpen(false)}
          recap={recap}
          stats={stats}
          weekRange={weekRange}
        />
      ) : null}
    </section>
  );
}

function WeeklyTrendCanvas({ theme, trend }: { theme: "light" | "dark"; trend: WeeklyConceptTrend }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const trendSignature = useMemo(
    () => `${trend.weekStartIndex}:${trend.points.map((point) => `${point.date}:${point.totalConcepts}`).join("|")}`,
    [trend]
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!wrap || !canvas || !context) {
      return;
    }

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const pixelRatio = window.devicePixelRatio || 1;

      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawTrend(context, trend, width, height, getChartPalette());
    };

    // Defer to the next frame: App's own effect writes data-theme to <html>
    // after this child effect runs, and the palette reads computed CSS variables.
    const frame = requestAnimationFrame(draw);

    const observer = new ResizeObserver(draw);
    observer.observe(wrap);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [theme, trend, trendSignature]);

  return (
    <div className="x-weekly-chart" ref={wrapRef}>
      <canvas aria-label={t("weekly.trendAria")} ref={canvasRef} role="img" />
    </div>
  );
}

function WeeklyRecapShareModal({
  narrativeLines,
  onClose,
  recap,
  stats,
  weekRange
}: {
  narrativeLines: string[];
  onClose: () => void;
  recap: WeeklyRecapRecord;
  stats: Array<{ label: string; value: string }>;
  weekRange: string;
}) {
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"copying" | "generating" | "idle">("generating");
  const [notice, setNotice] = useState("");
  const language = getI18nLanguage();

  useEffect(() => {
    let cancelled = false;

    async function generatePreview() {
      setStatus("generating");
      setNotice("");
      setPngUrl(null);

      try {
        const nextUrl = await renderElementToPng(
          {
            claim: t("weekly.shareClaim"),
            kind: "weekly-recap",
            narrativeLines,
            stats,
            title: t("weekly.title"),
            trend: recap.conceptTrend,
            weekRange
          },
          {
            height: SHARE_HEIGHT,
            pixelRatio: 2,
            width: SHARE_WIDTH
          }
        );

        if (!cancelled) {
          setPngUrl(nextUrl);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) {
          setNotice(t("weekly.shareError"));
          setStatus("idle");
        }
      }
    }

    void generatePreview();

    return () => {
      cancelled = true;
    };
  }, [language, narrativeLines, recap.conceptTrend, stats, weekRange]);

  async function handleCopy() {
    if (!pngUrl) {
      return;
    }

    setStatus("copying");
    setNotice("");

    try {
      await copyPngDataUrlToClipboard(pngUrl);
      setNotice(t("share.copyDone"));
    } catch {
      setNotice(t("share.copyUnsupported"));
    } finally {
      setStatus("idle");
    }
  }

  function handleDownload() {
    if (!pngUrl) {
      return;
    }

    downloadDataUrl(pngUrl, `aitimeline-weekly-${safePngFileName(recap.id)}.png`);
  }

  return (
    <div className="x-overlay x-share-overlay" role="dialog" aria-modal="true" aria-label={t("share.dialog")}>
      <section className="x-modal x-share-modal">
        <div className="x-share-head">
          <div>
            <p className="x-label">
              <Share2 size={14} aria-hidden="true" /> {t("weekly.share")}
            </p>
            <h2>{t("share.title")}</h2>
          </div>
          <button className="x-iconbtn" onClick={onClose} title={t("share.close")} type="button">
            <X size={19} />
          </button>
        </div>

        <div className="x-share-preview" aria-live="polite">
          {pngUrl ? (
            <img alt={t("weekly.sharePreviewAlt")} src={pngUrl} />
          ) : (
            <div className="x-share-loading">{status === "generating" ? t("share.generating") : t("weekly.shareEmpty")}</div>
          )}
        </div>

        <div className="x-share-actions">
          <button className="x-pill start" disabled={!pngUrl} onClick={handleDownload} type="button">
            <Download size={17} /> {t("share.download")}
          </button>
          <button className="x-pill start secondary" disabled={!pngUrl || status === "copying"} onClick={() => void handleCopy()} type="button">
            <Copy size={17} /> {status === "copying" ? t("share.copying") : t("share.copy")}
          </button>
        </div>
        {notice ? <p className="x-share-notice">{notice}</p> : null}
      </section>
    </div>
  );
}

function getWeeklyStats(recap: WeeklyRecapRecord): Array<{ label: string; value: string }> {
  return [
    { label: t("weekly.metric.cards"), value: String(recap.stats.newCardCount) },
    { label: t("weekly.metric.concepts"), value: String(recap.stats.newConceptCount) },
    {
      label: t("weekly.metric.review"),
      value: `${recap.stats.reviewCompletedCount}/${recap.stats.reviewDueCount}`
    }
  ];
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  return t("weekly.range", {
    end: formatDate(weekEnd),
    start: formatDate(weekStart)
  });
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(getDateLocale(), {
    day: "numeric",
    month: "short"
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function drawTrend(
  context: CanvasRenderingContext2D,
  trend: WeeklyConceptTrend,
  width: number,
  height: number,
  palette: ChartPalette
): void {
  context.clearRect(0, 0, width, height);

  const plot = {
    left: 28,
    right: width - 18,
    top: 18,
    bottom: height - 32
  };
  const points = trend.points;
  const maxValue = Math.max(1, ...points.map((point) => point.totalConcepts));

  context.strokeStyle = palette.line;
  context.lineWidth = 1;
  for (let index = 0; index < 3; index += 1) {
    const y = plot.top + ((plot.bottom - plot.top) * index) / 2;
    context.beginPath();
    context.moveTo(plot.left, y + 0.5);
    context.lineTo(plot.right, y + 0.5);
    context.stroke();
  }

  drawTrendSegment(context, points, plot, maxValue, 0, Math.max(0, trend.weekStartIndex), palette.muted, 2.5);
  drawTrendSegment(context, points, plot, maxValue, Math.max(0, trend.weekStartIndex), points.length - 1, palette.blue, 3.5);

  context.textBaseline = "top";
  context.font = "700 11px Inter, ui-sans-serif, system-ui, sans-serif";
  context.fillStyle = palette.muted;
  let lastLabelX = -Infinity;

  points.forEach((point, index) => {
    if (!isMondayDate(point.date)) {
      return;
    }

    const x = trendPointX(index, points.length, plot);

    if (x - lastLabelX < 48) {
      return;
    }

    context.fillText(formatAxisDate(point.date), Math.max(0, x - 12), plot.bottom + 10);
    lastLabelX = x;
  });
}

function drawTrendSegment(
  context: CanvasRenderingContext2D,
  points: WeeklyConceptTrend["points"],
  plot: { bottom: number; left: number; right: number; top: number },
  maxValue: number,
  startIndex: number,
  endIndex: number,
  color: string,
  lineWidth: number
): void {
  if (points.length === 0 || endIndex <= startIndex) {
    return;
  }

  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (let index = startIndex; index <= endIndex; index += 1) {
    const x = trendPointX(index, points.length, plot);
    const y = trendPointY(points[index].totalConcepts, maxValue, plot);

    if (index === startIndex) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
}

function trendPointX(
  index: number,
  count: number,
  plot: { bottom: number; left: number; right: number; top: number }
): number {
  if (count <= 1) {
    return (plot.left + plot.right) / 2;
  }

  return plot.left + ((plot.right - plot.left) * index) / (count - 1);
}

function trendPointY(
  value: number,
  maxValue: number,
  plot: { bottom: number; left: number; right: number; top: number }
): number {
  return plot.bottom - ((plot.bottom - plot.top) * value) / maxValue;
}

function isMondayDate(date: string): boolean {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay() === 1;
}

function formatAxisDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  return `${parsed.getUTCMonth() + 1}/${parsed.getUTCDate()}`;
}

interface ChartPalette {
  blue: string;
  line: string;
  muted: string;
}

function getChartPalette(): ChartPalette {
  return {
    blue: getCssVariable("--x-blue", "#1d9bf0"),
    line: getCssVariable("--x-line", "#eff3f4"),
    muted: getCssVariable("--x-muted", "#536471")
  };
}

function getCssVariable(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
