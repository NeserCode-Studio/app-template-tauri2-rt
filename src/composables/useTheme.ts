import { useEffect, useState, useCallback } from "react";

import type { ThemeType, UseThemeFn } from "@/shared";

export const useTheme: UseThemeFn = ({ localStorageKey = "theme" }) => {
  const [themeState, setThemeState] = useState<ThemeType>(() => {
    const stored = localStorage.getItem(localStorageKey) as ThemeType | null;
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  /* 同步主题到 DOM：初值与后续每次变化都走这里，保证 state 与 DOM 一致 */
  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeState === "dark");
  }, [themeState]);

  /* 系统主题变化监听：仅在用户未手动选择过主题时跟随系统 */
  useEffect(() => {
    const matchMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = (event: MediaQueryListEvent) => {
      if (localStorage.getItem(localStorageKey)) return;
      setThemeState(event.matches ? "dark" : "light");
    };
    matchMedia.addEventListener("change", onThemeChange);
    return () => matchMedia.removeEventListener("change", onThemeChange);
  }, [localStorageKey]);

  const setTheme = useCallback(
    (theme: ThemeType) => {
      setThemeState(theme);
      localStorage.setItem(localStorageKey, theme);
    },
    [localStorageKey]
  );

  return [themeState, setTheme];
};
