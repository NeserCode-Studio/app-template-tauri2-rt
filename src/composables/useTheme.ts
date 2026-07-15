import { useEffect, useState, useCallback } from "react";

import type { ThemeType, UseThemeFn } from "@/shared";

export const useTheme: UseThemeFn = ({ localStorageKey = "theme" }) => {
  const localTheme = localStorage.getItem(localStorageKey) as ThemeType;
  const [themeState, setThemeState] = useState<ThemeType>(
    localTheme ?? "light"
  );

  /* Initial Theme & Media Query Listener */
  useEffect(() => {
    const localTheme = localStorage.getItem(localStorageKey);
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const initialTheme = localTheme || (prefersDark ? "dark" : "light");
    document.documentElement.classList.toggle("dark", initialTheme === "dark");

    const matchMedia = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = (event: MediaQueryListEvent) => {
      const isDarkMode = event.matches;
      if (!localStorage.getItem(localStorageKey)) {
        document.documentElement.classList.toggle("dark", isDarkMode);
        setThemeState(isDarkMode ? "dark" : "light");
      }
    };

    matchMedia.addEventListener("change", onThemeChange);
    return () => matchMedia.removeEventListener("change", onThemeChange);
  }, [localStorageKey]);

  const setTheme = useCallback((theme: ThemeType) => {
    document?.querySelector("html")?.classList.toggle("dark");
    setThemeState(theme);
    localStorage.setItem(localStorageKey, theme);
  }, [localStorageKey]);

  return [themeState, setTheme];
};
