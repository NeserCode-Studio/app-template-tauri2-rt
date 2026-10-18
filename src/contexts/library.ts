/**
 * LibraryContext：作品列表与当前作品 id。
 *
 * 操作全部委托给 services/workspace，这里只维护 React 侧状态。
 */

import { createContext, useContext } from "react";
import type { Work, Workspace } from "@/shared/schema";

export interface LibraryContextValue {
  /** 工作区清单（作品顺序 + 归档）。 */
  workspace: Workspace | null;
  /** 当前作品 id。 */
  currentWorkId: string | null;
  /** 所有作品元数据（含归档）。 */
  works: Record<string, Work>;
  setWorkspace: (ws: Workspace) => void;
  setWorks: (works: Record<string, Work>) => void;
  setCurrentWorkId: (id: string | null) => void;
  /** 从磁盘重新装载清单与作品元数据。 */
  refresh: () => Promise<void>;
  /** 新建作品并设为当前作品。 */
  create: (title: string, type: string) => Promise<Work | null>;
  /** 重命名作品。 */
  rename: (workId: string, title: string) => Promise<void>;
  /** 设置作品别名（留空即清除）。 */
  setAlias: (workId: string, alias: string) => Promise<void>;
  /** 归档作品。 */
  archive: (workId: string) => Promise<void>;
  /** 恢复已归档作品。 */
  unarchive: (workId: string) => Promise<void>;
  /** 删除作品：整部目录移入回收站，清单同步摘除。 */
  remove: (workId: string) => Promise<void>;
  /** 从本地 txt 导入成新作品。 */
  importFromFile: (path: string, titles: {
    title: string;
    volumeTitle: string;
    chapterTitle: string;
  }) => Promise<Work | null>;
}

export const LibraryContext = createContext<LibraryContextValue>({
  workspace: null,
  currentWorkId: null,
  works: {},
  setWorkspace: () => {},
  setWorks: () => {},
  setCurrentWorkId: () => {},
  refresh: async () => {},
  create: async () => null,
  rename: async () => {},
  setAlias: async () => {},
  archive: async () => {},
  unarchive: async () => {},
  remove: async () => {},
  importFromFile: async () => null,
});

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used within LibraryProvider");
  return ctx;
}
