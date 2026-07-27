import type { SourceImport, TransformationStatus } from "@aitimeline/core";
import { CheckCircle2, Clock, LoaderCircle, XCircle } from "lucide-react";
import { formatRelativeTime, formatStatus } from "../lib/format";
import { t } from "../lib/i18n";

export function ImportRow({ item, count = 1 }: { item: SourceImport; count?: number }) {
  const meta = [formatStatus(item.status), formatRelativeTime(item.createdAt)].filter(Boolean).join(" · ");

  return (
    <div className="x-import-row">
      <div>
        <span>{item.source.title}</span>
        <small>{meta}</small>
      </div>
      <div className="x-import-row-end">
        {count > 1 ? (
          <span className="x-chip x-import-count" title={t("mr.imports.groupCount", { count })}>
            ×{count}
          </span>
        ) : null}
        <StatusIcon status={item.status} />
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: TransformationStatus }) {
  if (status === "ready") {
    return <CheckCircle2 className="x-status-ok" size={18} />;
  }

  if (status === "failed") {
    return <XCircle className="x-status-bad" size={18} />;
  }

  if (status === "queued") {
    return <Clock className="x-status-run" size={18} />;
  }

  return <LoaderCircle className="x-status-run x-spin" size={18} />;
}
