import { createContext, useContext } from "react";

export interface SettingsDialogContextValue {
  openSettings: () => void;
  openAbout: () => void;
}

export const SettingsDialogContext = createContext<SettingsDialogContextValue>({
  openSettings: () => {},
  openAbout: () => {},
});

export function useSettingsDialog() {
  return useContext(SettingsDialogContext);
}
