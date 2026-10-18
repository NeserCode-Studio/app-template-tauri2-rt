/**
 * WorkspaceProvider：持有工作区 root 状态，并在应用就绪时恢复上次工作区。
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocalStorageState } from "ahooks";
import { createLogger } from "@/lib/logger";
import { WorkspaceContext, type WorkspaceContextValue } from "./workspace";
import { pickWorkspaceDir } from "@/services/workspace";

const log = createLogger("WorkspaceProvider");

const RECENT_KEY = "novels-yes:recent-workspaces";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<string | null>(null);
  const [recent, setRecent] = useLocalStorageState<string[]>(RECENT_KEY, {
    defaultValue: [],
  });

  const open = useCallback(
    (path: string) => {
      setRoot(path);
      setRecent((prev) => [path, ...(prev ?? []).filter((p) => p !== path)].slice(0, 10));
      log.info("workspace opened", path);
    },
    [setRecent]
  );

  const close = useCallback(() => setRoot(null), []);

  /** 弹出选择框并打开；用户取消则返回 null。 */
  const pick = useCallback(async (): Promise<string | null> => {
    const selected = await pickWorkspaceDir();
    if (selected) open(selected);
    return selected;
  }, [open]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({ root, recent: recent ?? [], isOpen: root !== null, open, close, pick }),
    [root, recent, open, close, pick]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
