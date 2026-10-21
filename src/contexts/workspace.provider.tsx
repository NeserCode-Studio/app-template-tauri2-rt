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
import {
  deleteWorkspaceDir,
  migrateWorkspaceDir,
  pickWorkspaceDir,
  revealWorkspaceDir,
} from "@/services/workspace";

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
      setRecent((prev) =>
        [path, ...(prev ?? []).filter((p) => p !== path)].slice(0, 10)
      );
      setRecentOpenedAt((prev) => ({ ...(prev ?? {}), [path]: openedAt }));
      log.info("workspace opened", path);
    },
    [setRecent, setRecentOpenedAt, setRoot]
  );

  const close = useCallback(() => setRoot(null), [setRoot]);

  const removeRecent = useCallback(
    (path: string) => {
      setRecent((prev) => (prev ?? []).filter((p) => p !== path));
      setRecentOpenedAt((prev) => {
        const next = { ...(prev ?? {}) };
        delete next[path];
        return next;
      });
      setRootState((current) => (current === path ? null : current));
      log.info("recent workspace record removed", path);
    },
    [setRecent, setRecentOpenedAt]
  );

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

  /** 永久删除整个工作区并关闭它；工作区删除不提供恢复入口。 */
  const deleteWorkspace = useCallback(async () => {
    if (!root) return;
    try {
      await deleteWorkspaceDir(root);
      setRecent((prev) => (prev ?? []).filter((p) => p !== root));
      setRecentOpenedAt((prev) => {
        const next = { ...(prev ?? {}) };
        delete next[root];
        return next;
      });
      setRoot(null);
      log.info("workspace permanently deleted", root);
    } catch (err) {
      log.error("workspace delete failed", { root, err });
      throw err;
    }
  }, [root, setRecent, setRecentOpenedAt, setRoot]);

  /** 弹出选择框并打开；用户取消则返回 null。 */
  const pickPath = useCallback(async (): Promise<string | null> => {
    return pickWorkspaceDir();
  }, []);

  const pickMigrationTarget = useCallback(async (): Promise<string | null> => {
    return pickWorkspaceDir("选择工作区迁移目标目录（必须是空目录）");
  }, []);

  const migrate = useCallback(
    async (target: string) => {
      if (!root) throw new Error("workspace is unavailable");
      try {
        const result = await migrateWorkspaceDir(root, target);
        const nextRoot = result.root;
        setRecent((prev) =>
          [
            nextRoot,
            ...(prev ?? []).filter(
              (path) => path !== root && path !== nextRoot
            ),
          ].slice(0, 10)
        );
        setRecentOpenedAt((prev) => {
          const next = { ...(prev ?? {}) };
          delete next[root];
          next[nextRoot] = Date.now();
          return next;
        });
        setRoot(nextRoot);
        if (!result.sourceRemoved) {
          log.warn("workspace migrated but source directory remains", {
            from: root,
            to: nextRoot,
          });
        } else {
          log.info("workspace migrated", { from: root, to: nextRoot });
        }
        return result;
      } catch (err) {
        log.error("workspace migration failed", { root, target, err });
        throw err;
      }
    },
    [root, setRecent, setRecentOpenedAt, setRoot]
  );

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
      removeRecent,
      pick,
      pickPath,
      pickMigrationTarget,
      migrate,
      reveal,
      deleteWorkspace,
    }),
    [
      root,
      recent,
      recentOpenedAt,
      open,
      close,
      removeRecent,
      pick,
      pickPath,
      pickMigrationTarget,
      migrate,
      reveal,
      deleteWorkspace,
    ]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
