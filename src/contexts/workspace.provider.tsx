/**
 * WorkspaceProvider：持有当前会话的工作区状态。
 *
 * 刷新时故意遗忘当前工作区，只保留最近工作区列表；这样首页始终要求
 * 用户重新确认要进入的库，而不会自动把上一次选择当成当前上下文。
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocalStorageState } from "ahooks";
import { createLogger } from "@/lib/logger";
import { WorkspaceContext, type WorkspaceContextValue } from "./workspace";
import { pickWorkspaceDir, revealWorkspaceDir } from "@/services/workspace";
import { moveWorkspaceToTrash } from "@/services/trash";

const log = createLogger("WorkspaceProvider");

const RECENT_KEY = "novels-yes:recent-workspaces";
const RECENT_OPENED_KEY = "novels-yes:recent-workspace-opened";
const LEGACY_CURRENT_KEY = "novels-yes:current-workspace";

function forgetLegacyRoot(): void {
  try {
    localStorage.removeItem(LEGACY_CURRENT_KEY);
  } catch (err) {
    log.warn("legacy workspace root cleanup failed", err);
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [root, setRootState] = useState<string | null>(() => {
    forgetLegacyRoot();
    return null;
  });
  const [recent, setRecent] = useLocalStorageState<string[]>(RECENT_KEY, {
    defaultValue: [],
  });
  const [recentOpenedAt, setRecentOpenedAt] = useLocalStorageState<
    Record<string, number>
  >(RECENT_OPENED_KEY, { defaultValue: {} });

  const setRoot = useCallback((path: string | null) => {
    setRootState(path);
  }, []);

  const open = useCallback(
    (path: string) => {
      const openedAt = Date.now();
      setRoot(path);
      setRecent((prev) => [path, ...(prev ?? []).filter((p) => p !== path)].slice(0, 10));
      setRecentOpenedAt((prev) => ({ ...(prev ?? {}), [path]: openedAt }));
      log.info("workspace opened", path);
    },
    [setRecent, setRecentOpenedAt, setRoot]
  );

  const close = useCallback(() => setRoot(null), [setRoot]);

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

  /**
   * 把整个工作区移入回收站并关闭它。
   *
   * 关闭是必须的：磁盘内容已经变了，留在打开状态会让 UI 显示
   * 一份已经不存在的作品清单，用户再点任何东西都会报错。
   */
  const deleteWorkspace = useCallback(async () => {
    if (!root) return;
    await moveWorkspaceToTrash(root, root);
    /* 从最近列表里摘掉：它已经不在"最近用过"的状态下了。 */
    setRecent((prev) => (prev ?? []).filter((p) => p !== root));
    setRecentOpenedAt((prev) => {
      const next = { ...(prev ?? {}) };
      delete next[root];
      return next;
    });
    setRoot(null);
    log.info("workspace moved to trash", root);
  }, [root, setRecent, setRecentOpenedAt, setRoot]);

  /** 弹出选择框并打开；用户取消则返回 null。 */
  const pickPath = useCallback(async (): Promise<string | null> => {
    return pickWorkspaceDir();
  }, []);

  const pick = useCallback(async (): Promise<string | null> => {
    const selected = await pickPath();
    if (selected) open(selected);
    return selected;
  }, [open, pickPath]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      root,
      recent: recent ?? [],
      recentOpenedAt: recentOpenedAt ?? {},
      isOpen: root !== null,
      open,
      close,
      pick,
      pickPath,
      reveal,
      deleteWorkspace,
    }),
    [
      root,
      recent,
      recentOpenedAt,
      open,
      close,
      pick,
      pickPath,
      reveal,
      deleteWorkspace,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
