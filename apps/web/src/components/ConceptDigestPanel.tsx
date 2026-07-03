import type { ConceptDigest } from "@aitimeline/core";
import { Layers, XCircle } from "lucide-react";
import { formatConceptRole } from "../lib/format";

export function ConceptDigestPanel({
  digest,
  onClose,
  onOpenCardId
}: {
  digest: ConceptDigest;
  onClose: () => void;
  onOpenCardId: (cardId: string) => void;
}) {
  return (
    <div
      aria-label={`关于「${digest.concept}」的全部碎片`}
      aria-modal="true"
      className="x-overlay"
      onClick={onClose}
      role="dialog"
    >
      <div className="x-modal" onClick={(event) => event.stopPropagation()}>
        <div className="x-concept-head">
          <div>
            <p className="x-label x-concept-eyebrow">
              <Layers size={14} aria-hidden="true" /> 概念
            </p>
            <h2>{digest.concept}</h2>
            <p className="x-concept-sub">{digest.cardCount} 张碎片,连成一整篇</p>
          </div>
          <button aria-label="关闭概念视图" className="x-iconbtn" onClick={onClose} type="button">
            <XCircle size={18} />
          </button>
        </div>

        <ol className="x-concept-list">
          {digest.entries.map((entry) => (
            <li key={entry.cardId}>
              <button className="x-concept-entry" onClick={() => onOpenCardId(entry.cardId)} type="button">
                <span className={`x-concept-role x-concept-role-${entry.role}`}>{formatConceptRole(entry.role)}</span>
                <span className="x-concept-body">
                  <strong>{entry.title}</strong>
                  <span className="x-concept-take">{entry.keyTakeaway}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
