import type { SourceImport, TransformationStatus } from "@aitimeline/core";
import { CheckCircle2, Clock, LoaderCircle, XCircle } from "lucide-react";
import { formatStatus } from "../lib/format";

export function ImportRow({ item }: { item: SourceImport }) {
  return (
    <div className="import-row">
      <div>
        <span>{item.source.title}</span>
        <small>{formatStatus(item.status)}</small>
      </div>
      <StatusIcon status={item.status} />
    </div>
  );
}

function StatusIcon({ status }: { status: TransformationStatus }) {
  if (status === "ready") {
    return <CheckCircle2 className="status-ready" size={18} />;
  }

  if (status === "failed") {
    return <XCircle className="status-failed" size={18} />;
  }

  if (status === "queued") {
    return <Clock className="status-working" size={18} />;
  }

  return <LoaderCircle className="status-working spin" size={18} />;
}
