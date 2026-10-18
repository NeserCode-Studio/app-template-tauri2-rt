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
  /** 设置工作区别名（留空即清除）。 */
  setWorkspaceAlias: (alias: string) => Promise<void>;
  /** 新建作品并设为当前作品。 */
  create: (title: string, type: string) => Promise<Work | null>;
  /** 重命名作品。 */
  rename: (workId: string, title: string) => Promise<void>;
  /** 归档作品。 */
  archive: (workId: string) => Promise<void>;
  /** 恢复已归档作品。 */
  unarchive: (workId: string) => Promise<void>;
  /** 删除作品：整部目录移入回收站，清单同步摘除。 */
  remove: (workId: string) => Promise<void>;
  /**
   * 磁盘数据版本号：任何绕过 React 直接落盘的改动都要 bump 一次。
   *
   * 结构树 provider 只在 [root, currentWorkId] 变化时装载。回收站恢复
   * 是在作品库页做的，那条路径不经过任何 React 状态，编辑器里的
   * outline 就会一直停在"已删除"的旧快照上——恢复完看不见，一刷新
   * 才出现。把"数据变了"这件事变成一个可订阅的信号，比让每个改动方
   * 记得去调 reload 可靠：后者漏一处就复现一次这个 bug。
   */
  dataVersion: number;
  /** 通知其它 provider：磁盘数据已变更，应重新装载。 */
  bumpDataVersion: () => void;
}

export const LibraryContext = createContext<LibraryContextValue>({
  workspace: null,
  currentWorkId: null,
  works: {},
  setWorkspace: () => {},
  setWorks: () => {},
  setCurrentWorkId: () => {},
  refresh: async () => {},
  setWorkspaceAlias: async () => {},
  create: async () => null,
  rename: async () => {},
  archive: async () => {},
  unarchive: async () => {},
  remove: async () => {},
  dataVersion: 0,
  bumpDataVersion: () => {},
});

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used within LibraryProvider");
  return ctx;
}
