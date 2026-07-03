// 全局设置:API 地址 + 主题偏好,持久化到 AsyncStorage。主题偏好为「跟随系统」
// 时用 useColorScheme,否则强制 light/dark。
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { themeFor, type Theme, type ThemeName } from "../theme";
import { defaultApiBaseUrl } from "./api";

export type ThemePref = "system" | "light" | "dark";

const apiUrlKey = "aitimeline.mobile.apiBaseUrl";
const themePrefKey = "aitimeline.mobile.themePref";

interface SettingsValue {
  ready: boolean;
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => void;
  themePref: ThemePref;
  setThemePref: (pref: ThemePref) => void;
  themeName: ThemeName;
  theme: Theme;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [ready, setReady] = useState(false);
  const [apiBaseUrl, setApiBaseUrlState] = useState(defaultApiBaseUrl);
  const [themePref, setThemePrefState] = useState<ThemePref>("system");

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [storedUrl, storedPref] = await Promise.all([
          AsyncStorage.getItem(apiUrlKey),
          AsyncStorage.getItem(themePrefKey)
        ]);

        if (!active) {
          return;
        }

        if (storedUrl) {
          setApiBaseUrlState(storedUrl);
        }
        if (storedPref === "light" || storedPref === "dark" || storedPref === "system") {
          setThemePrefState(storedPref);
        }
      } finally {
        if (active) {
          setReady(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const setApiBaseUrl = useCallback((url: string) => {
    setApiBaseUrlState(url);
    void AsyncStorage.setItem(apiUrlKey, url);
  }, []);

  const setThemePref = useCallback((pref: ThemePref) => {
    setThemePrefState(pref);
    void AsyncStorage.setItem(themePrefKey, pref);
  }, []);

  const themeName: ThemeName =
    themePref === "system" ? (systemScheme === "dark" ? "dark" : "light") : themePref;

  const value = useMemo<SettingsValue>(
    () => ({
      ready,
      apiBaseUrl,
      setApiBaseUrl,
      themePref,
      setThemePref,
      themeName,
      theme: themeFor(themeName)
    }),
    [ready, apiBaseUrl, setApiBaseUrl, themePref, setThemePref, themeName]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);

  if (!value) {
    throw new Error("useSettings 必须在 SettingsProvider 内使用。");
  }

  return value;
}
