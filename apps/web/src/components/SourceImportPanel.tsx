import type { SourceImport } from "@aitimeline/core";
import { CheckCircle2, Link, LoaderCircle, Send, Video, XCircle } from "lucide-react";
import type { FormEvent } from "react";
import { formatStatus } from "../lib/format";
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
    <section className="source-import">
      <div className="source-import-heading">
        <div>
          <p className="section-label">来源智能体</p>
          <h2>URL 导入</h2>
        </div>
        <div className={`source-kind ${apiStatus}`}>
          {apiStatus === "connected" ? <CheckCircle2 size={17} /> : <Video size={17} />}
          <span>{apiStatus === "connected" ? "已连接" : apiStatus === "checking" ? "连接中" : "离线"}</span>
        </div>
      </div>

      <form className="source-form" onSubmit={onSubmit}>
        <label className="source-input-shell">
          <Link size={18} />
          <input
            aria-label="来源 URL"
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="粘贴文章或 YouTube 链接"
            value={url}
          />
        </label>
        <button className="primary-action source-submit" disabled={isImporting} type="submit">
          {isImporting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
          <span>{isImporting ? "导入中" : "导入"}</span>
        </button>
      </form>

      <div className="import-feedback">
        {error ? (
          <span className="import-error">
            <XCircle size={16} />
            {error}
          </span>
        ) : (
          <span>
            {latestImport ? formatStatus(latestImport.status) : "就绪"} · 生成了 {cardCount} 张卡 · {apiMessage}
          </span>
        )}
      </div>
    </section>
  );
}
