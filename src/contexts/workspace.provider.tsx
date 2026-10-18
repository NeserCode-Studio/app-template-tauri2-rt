/**
 * WorkspaceProvider：持有工作区 root 状态，并在应用就绪时恢复上次工作区。
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocalStorageState } from "ahooks";
import { createLogger } from "@/lib/logger";
import { WorkspaceContext, type WorkspaceContextValue } from "./workspace";
import { pickWorkspaceDir, revealWorkspaceDir } from "@/services/workspace";

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

  /**
   * 在系统文件管理器里打开工作区目录。
   *
   * 存在的意义：作品库顶部的路径是一个按钮但只做"换个工作区"，
   * 而用户经常只是想看看磁盘上到底存了什么（手动改稿、备份、
   * 确认文件没丢）。这两件事挤在一个动作上时，用户找不到后者。
   */
  const reveal = useCallback(async () => {
    if (!root) return;
    try {
      await revealWorkspaceDir(root);
    } catch (err) {
      log.warn("reveal workspace dir failed", err);
    }
  }, [root]);

  /** 弹出选择框并打开；用户取消则返回 null。 */
  const pick = useCallback(async (): Promise<string | null> => {
    const selected = await pickWorkspaceDir();
    if (selected) open(selected);
    return selected;
  }, [open]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({ root, recent: recent ?? [], isOpen: root !== null, open, close, pick, reveal }),
    [root, recent, open, close, pick, reveal]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
