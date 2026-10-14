import { createContext, useContext } from "react";
import type { UseThemeFnReturn } from "@/shared";

export interface ThemeContextValue {
  theme: UseThemeFnReturn[0];
  setThemeMode: UseThemeFnReturn[1];
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setThemeMode: () => {},
});

export function useThemeContext() {
  return useContext(ThemeContext);
}
