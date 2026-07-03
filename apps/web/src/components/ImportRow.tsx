import type { SourceImport, TransformationStatus } from "@aitimeline/core";
import { CheckCircle2, Clock, LoaderCircle, XCircle } from "lucide-react";
import { formatStatus } from "../lib/format";

export function ImportRow({ item }: { item: SourceImport }) {
  return (
    <div className="x-import-row">
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
