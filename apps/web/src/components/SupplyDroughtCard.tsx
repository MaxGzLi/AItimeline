import { LoaderCircle } from "lucide-react";
import { t } from "../lib/i18n";
import type { ApiSupplyRefillResponse, SupplyStatus } from "../lib/types";

export type SupplyRefillState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: ApiSupplyRefillResponse }
  | { status: "error"; message: string };

export function SupplyDroughtCard({
  onImportLink,
  onOpenReview,
  onRefillCandidates,
  onSubscriptions,
  refillState,
  status
}: {
  onImportLink: () => void;
  onOpenReview: () => void;
  onRefillCandidates: () => void;
  onSubscriptions: () => void;
  refillState: SupplyRefillState;
  status: SupplyStatus;
}) {
  if (!status.drought) {
    return null;
  }

  const refillLabel =
    refillState.status === "running"
      ? t("supply.refilling")
      : refillState.status === "done"
        ? refillResultLabel(refillState.result)
        : t("supply.action.refill");

  return (
    <section className="x-supply-card" aria-label={t("supply.aria")}>
      <div className="x-supply-copy">
        <p className="x-supply-diagnosis">{t("supply.diagnosis", { count: status.newCards48h })}</p>
        <p className="x-supply-facts">
          {t("supply.factLine", {
            pending: status.pendingCandidates,
            review: status.reviewDueCount,
            subscriptions: status.activeSubscriptions
          })}
        </p>
        {refillState.status === "error" ? <p className="x-supply-error">{refillState.message}</p> : null}
      </div>

      <div className="x-supply-actions">
        <button className="x-supply-action" onClick={onSubscriptions} type="button">
          {t("supply.action.subscriptions")}
        </button>
        <button
          className="x-supply-action"
          disabled={refillState.status === "running"}
          onClick={onRefillCandidates}
          type="button"
        >
          {refillState.status === "running" ? <LoaderCircle className="x-spin" size={14} /> : null}
          <span>{refillLabel}</span>
        </button>
        <button className="x-supply-action" onClick={onImportLink} type="button">
          {t("supply.action.import")}
        </button>
        {status.reviewDueCount > 0 ? (
          <button className="x-supply-link" onClick={onOpenReview} type="button">
            {t("supply.action.review")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function refillResultLabel(result: ApiSupplyRefillResponse): string {
  if (result.queued > 0) {
    return t("supply.refillQueued", { count: result.queued });
  }

  if (result.skipped > 0 && result.budgetRemaining === 0) {
    return t("supply.refillBudgetEmpty");
  }

  return t("supply.refillNone");
}
