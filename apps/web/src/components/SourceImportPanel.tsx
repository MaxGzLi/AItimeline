import type { SourceImport } from "@aitimeline/core";
import { CheckCircle2, Link, LoaderCircle, Send, Video, XCircle } from "lucide-react";
import type { FormEvent } from "react";
import { formatStatus } from "../lib/format";
import { t } from "../lib/i18n";
import type { ApiStatus } from "../lib/types";

export function SourceImportPanel({
  apiMessage,
  apiStatus,
  cardCount,
  error,
  isImporting,
  latestImport,
  onSubmit,
  onUrlChange,
  url
}: {
  apiMessage: string;
  apiStatus: ApiStatus;
  cardCount: number;
  error: string | null;
  isImporting: boolean;
  latestImport?: SourceImport;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUrlChange: (value: string) => void;
  url: string;
}) {
  return (
    <section className="x-import">
      <div className="x-import-head">
        <div>
          <p className="x-label">{t("import.label")}</p>
          <h2>{t("import.title")}</h2>
        </div>
        <div className={`x-import-conn ${apiStatus}`}>
          {apiStatus === "connected" ? <CheckCircle2 size={17} /> : <Video size={17} />}
          <span>
            {apiStatus === "connected"
              ? t("api.status.connected")
              : apiStatus === "checking"
                ? t("api.status.checking")
                : t("api.status.offline")}
          </span>
        </div>
      </div>

      <form className="x-import-form" onSubmit={onSubmit}>
        <label className="x-import-field">
          <Link size={18} />
          <input
            aria-label={t("import.sourceUrl")}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder={t("import.placeholder")}
            value={url}
          />
        </label>
        <button className="x-pill start" disabled={isImporting} type="submit">
          {isImporting ? <LoaderCircle className="x-spin" size={18} /> : <Send size={18} />}
          <span>{isImporting ? t("import.working") : t("import.start")}</span>
        </button>
      </form>

      <div className="x-import-note">
        {error ? (
          <span className="x-import-err">
            <XCircle size={16} />
            {error}
          </span>
        ) : (
          <span>
            {latestImport ? formatStatus(latestImport.status) : t("import.ready")} · {t("import.cardCount", { count: cardCount })} · {apiMessage}
          </span>
        )}
      </div>
    </section>
  );
}
