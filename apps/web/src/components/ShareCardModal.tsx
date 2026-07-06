import type { KnowledgeCard, LinkedKnowledgeGraph } from "@aitimeline/core";
import { Copy, Download, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDueDate } from "../lib/format";
import {
  createDeterministicGraphLayout,
  getCurrentGraphTheme,
  renderGraphSnapshotDataUrl
} from "../lib/graphSnapshot";
import { getI18nLanguage, t } from "../lib/i18n";
import { buildCardNeighborhoodGraph } from "../lib/localGraph";
import { copyPngDataUrlToClipboard, downloadDataUrl, renderElementToPng, safePngFileName } from "../lib/shareImage";

const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 675;

export function ShareCardModal({
  card,
  graph,
  onClose
}: {
  card: KnowledgeCard;
  graph?: LinkedKnowledgeGraph;
  onClose: () => void;
}) {
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"copying" | "generating" | "idle">("generating");
  const [notice, setNotice] = useState("");
  const localGraph = useMemo(() => (graph ? buildCardNeighborhoodGraph(graph, card.id) : null), [card.id, graph]);
  const graphSignature = localGraph ? `${localGraph.nodes.map((node) => node.id).join("|")}::${localGraph.edges.length}` : "";
  const language = getI18nLanguage();

  useEffect(() => {
    let cancelled = false;

    async function generatePreview() {
      setStatus("generating");
      setNotice("");
      setPngUrl(null);

      try {
        const graphImageUrl =
          localGraph && localGraph.nodes.length > 1
            ? renderGraphSnapshotDataUrl(
                {
                  graph: localGraph,
                  height: 250,
                  layout: createDeterministicGraphLayout(localGraph),
                  theme: getCurrentGraphTheme(),
                  width: 320
                },
                2
              )
            : undefined;
        const nextUrl = await renderElementToPng(
          {
            claim: t("share.claim"),
            eyebrow: t("share.eyebrow"),
            graphImageUrl,
            keyTakeaway: card.keyTakeaway,
            kind: "share-card",
            sourceLine: getShareSourceLine(card),
            title: card.title
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
          setNotice(t("share.error"));
          setStatus("idle");
        }
      }
    }

    void generatePreview();

    return () => {
      cancelled = true;
    };
  }, [card, graphSignature, language, localGraph]);

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

    downloadDataUrl(pngUrl, `aitimeline-${safePngFileName(card.id)}.png`);
  }

  return (
    <div className="x-overlay x-share-overlay" role="dialog" aria-modal="true" aria-label={t("share.dialog")}>
      <section className="x-modal x-share-modal">
        <div className="x-share-head">
          <div>
            <p className="x-label">
              <Share2 size={14} aria-hidden="true" /> {t("share.label")}
            </p>
            <h2>{t("share.title")}</h2>
          </div>
          <button className="x-iconbtn" onClick={onClose} title={t("share.close")} type="button">
            <X size={19} />
          </button>
        </div>

        <div className="x-share-preview" aria-live="polite">
          {pngUrl ? (
            <img alt={t("share.previewAlt")} src={pngUrl} />
          ) : (
            <div className="x-share-loading">{status === "generating" ? t("share.generating") : t("share.emptyPreview")}</div>
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

function getShareSourceLine(card: KnowledgeCard): string {
  const source = card.sources[0];
  const citationCount = card.citations?.length ?? card.sources.length;

  return t("share.sourceLine", {
    citations: t("share.citations", { count: citationCount }),
    date: formatDueDate(card.createdAt),
    title: source?.title ?? t("format.unknownSource")
  });
}
