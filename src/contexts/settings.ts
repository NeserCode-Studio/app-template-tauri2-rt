import { createContext, useContext } from "react";

export type SettingsTab = "search" | "general" | "writing" | "ai";

export interface SettingsDialogContextValue {
  openSettings: (tab?: SettingsTab) => void;
  openAbout: () => void;
}

export const SettingsDialogContext = createContext<SettingsDialogContextValue>({
  openSettings: () => {},
  openAbout: () => {},
});

export function useSettingsDialog() {
  return useContext(SettingsDialogContext);
}
