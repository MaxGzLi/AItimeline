import { Keyboard, Languages, Moon, Server, Sun } from "lucide-react";
import { t, type Language } from "../lib/i18n";
import type { ApiStatus } from "../lib/types";

export function SettingsView({
  apiMessage,
  apiStatus,
  language,
  onLanguageChange,
  onShowShortcuts,
  onToggleTheme,
  theme
}: {
  apiMessage: string;
  apiStatus: ApiStatus;
  language: Language;
  onLanguageChange: (value: Language) => void;
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
    </>
  );
}
