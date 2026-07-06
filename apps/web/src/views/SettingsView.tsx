import { Ban, Keyboard, Languages, Moon, RotateCcw, Server, Sun } from "lucide-react";
import { t, type Language } from "../lib/i18n";
import type { ApiStatus, DismissedPostSummary } from "../lib/types";

export function SettingsView({
  apiMessage,
  apiStatus,
  language,
  dismissedPosts,
  onLanguageChange,
  onHardDismiss,
  onRestoreDismissed,
  onShowShortcuts,
  onToggleTheme,
  theme
}: {
  apiMessage: string;
  apiStatus: ApiStatus;
  dismissedPosts: DismissedPostSummary[];
  language: Language;
  onHardDismiss: (postId: string) => void;
  onLanguageChange: (value: Language) => void;
  onRestoreDismissed: (postId: string) => void;
  onShowShortcuts: () => void;
  onToggleTheme: () => void;
  theme: "light" | "dark";
}) {
  return (
    <>
      <button className="x-setrow" onClick={onToggleTheme} type="button">
        {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        <span className="x-smain">
          <p className="x-sname">{t("settings.theme")}</p>
          <p className="x-ssub">{t("settings.theme.hint")}</p>
        </span>
        <span className="x-sval">{theme === "dark" ? t("settings.theme.dark") : t("settings.theme.light")}</span>
      </button>

      <div className="x-setrow" role="group" aria-label={t("settings.language")}>
        <Languages size={19} />
        <span className="x-smain">
          <p className="x-sname">{t("settings.language")}</p>
          <p className="x-ssub">{t("settings.languageHint")}</p>
        </span>
        <span className="x-sval">
          <button
            className={`x-chip action${language === "zh" ? " active" : ""}`}
            onClick={() => onLanguageChange("zh")}
            type="button"
          >
            {t("settings.language.zh")}
          </button>
          <button
            className={`x-chip action${language === "en" ? " active" : ""}`}
            onClick={() => onLanguageChange("en")}
            type="button"
          >
            {t("settings.language.en")}
          </button>
        </span>
      </div>

      <div className="x-setrow" role="status">
        <Server size={19} />
        <span className="x-smain">
          <p className="x-sname">{t("settings.api")}</p>
          <p className="x-ssub">{apiMessage}</p>
        </span>
        <span className="x-sval">
          {apiStatus === "connected"
            ? t("api.status.connected")
            : apiStatus === "checking"
              ? t("api.status.checking")
              : t("api.status.offline")}
        </span>
      </div>

      <div className="x-setrow" role="note">
        <Server size={19} />
        <span className="x-smain">
          <p className="x-sname">{t("settings.model")}</p>
          <p className="x-ssub">{t("settings.modelHint")}</p>
        </span>
      </div>

      <button className="x-setrow" onClick={onShowShortcuts} type="button">
        <Keyboard size={19} />
        <span className="x-smain">
          <p className="x-sname">{t("settings.keyboard")}</p>
          <p className="x-ssub">{t("settings.keyboardHint")}</p>
        </span>
      </button>

      <section className="x-settings-section" aria-labelledby="settings-dismissed-title">
        <div className="x-settings-section-head">
          <h2 id="settings-dismissed-title">{t("settings.dismissed")}</h2>
          <p>{t("settings.dismissedHint")}</p>
        </div>

        {dismissedPosts.length > 0 ? (
          dismissedPosts.map((record) => (
            <div className="x-setrow x-setrow-static x-dismissed-row" key={record.postId}>
              <span className="x-smain">
                <p className="x-sname">{record.title}</p>
                <p className="x-ssub">
                  {formatDismissedMeta(record)}
                </p>
              </span>
              <span className="x-sval x-dismissed-actions">
                <button
                  aria-label={t("settings.dismissed.restoreTitle", { title: record.title })}
                  className="x-chip action"
                  onClick={() => onRestoreDismissed(record.postId)}
                  type="button"
                >
                  <RotateCcw size={14} />
                  {t("settings.dismissed.restore")}
                </button>
                {record.mode === "soft" ? (
                  <button
                    aria-label={t("settings.dismissed.hardTitle", { title: record.title })}
                    className="x-chip action danger"
                    onClick={() => onHardDismiss(record.postId)}
                    type="button"
                  >
                    <Ban size={14} />
                    {t("settings.dismissed.hardAction")}
                  </button>
                ) : null}
              </span>
            </div>
          ))
        ) : (
          <div className="x-setrow x-setrow-static">
            <span className="x-smain">
              <p className="x-sname">{t("settings.dismissed.empty")}</p>
              <p className="x-ssub">{t("settings.dismissed.emptyHint")}</p>
            </span>
          </div>
        )}
      </section>
    </>
  );
}

function formatDismissedMeta(record: DismissedPostSummary): string {
  const mode =
    record.mode === "soft" ? t("settings.dismissed.mode.soft") : t("settings.dismissed.mode.hard");
  const date = formatDismissedDate(record.dismissedAt);
  const status =
    record.mode === "hard"
      ? t("settings.dismissed.permanent")
      : record.isActive && (record.daysUntilReturn ?? 0) > 0
        ? t("settings.dismissed.autoReturn", { days: record.daysUntilReturn ?? 0 })
        : t("settings.dismissed.autoReturned");

  return t("settings.dismissed.meta", { mode, date, status });
}

function formatDismissedDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
