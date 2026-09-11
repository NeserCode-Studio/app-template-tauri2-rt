import { createContext, useContext } from "react";

export interface SettingsDialogContextValue {
  openSettings: () => void;
}

export const SettingsDialogContext = createContext<SettingsDialogContextValue>({
  openSettings: () => {},
});

export function useSettingsDialog() {
  return useContext(SettingsDialogContext);
}
