/** ViewModeProvider：写作视图模式（普通 / 专注 / 打字机 / 禅）。 */

import { useMemo, type ReactNode } from "react";
import { useLocalStorageState } from "ahooks";

import { ViewModeContext, type ViewMode, type ViewModeContextValue } from "./viewmode";

const MODE_KEY = "novels-yes:view-mode";

export function ViewModeProvider({ children }: { children: ReactNode }) {
  /* 持久化：写作是长会话，重启应用不该把用户从专注模式里拽出来。 */
  const [mode, setModeRaw] = useLocalStorageState<ViewMode>(MODE_KEY, { defaultValue: "off" });

  const value = useMemo<ViewModeContextValue>(
    () => ({ mode: mode ?? "off", setMode: setModeRaw }),
    [mode, setModeRaw]
  );

  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}
