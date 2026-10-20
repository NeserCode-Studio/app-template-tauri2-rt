/**
 * WorkspaceProvider：持有工作区 root 状态，并在应用就绪时恢复上次工作区。
 */

import { useCallback, useMemo, type ReactNode } from "react";
import { useLocalStorageState } from "ahooks";
import { createLogger } from "@/lib/logger";
import { WorkspaceContext, type WorkspaceContextValue } from "./workspace";
import { pickWorkspaceDir, revealWorkspaceDir } from "@/services/workspace";
import { moveWorkspaceToTrash } from "@/services/trash";

const log = createLogger("WorkspaceProvider");

const RECENT_KEY = "novels-yes:recent-workspaces";
const CURRENT_KEY = "novels-yes:current-workspace";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  /*
   * root 是页面上下文的一部分。只记“最近工作区”还不够：刷新时若 root
   * 回到 null，/library 与 /editor 会立刻被重定向，用户刚选的库像丢了一样。
   */
  const [root, setRoot] = useLocalStorageState<string | null>(CURRENT_KEY, {
    defaultValue: null,
  });
  const [recent, setRecent] = useLocalStorageState<string[]>(RECENT_KEY, {
    defaultValue: [],
  });

  const open = useCallback(
    (path: string) => {
      setRoot(path);
      setRecent((prev) => [path, ...(prev ?? []).filter((p) => p !== path)].slice(0, 10));
      log.info("workspace opened", path);
    },
    [setRecent, setRoot]
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
    setRoot(null);
    log.info("workspace moved to trash", root);
  }, [root, setRecent, setRoot]);

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
      isOpen: root !== null,
      open,
      close,
      pick,
      pickPath,
      reveal,
      deleteWorkspace,
    }),
    [root, recent, open, close, pick, pickPath, reveal, deleteWorkspace]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
