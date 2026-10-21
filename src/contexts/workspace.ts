/**
 * 工作区 Context：工作区根路径、是否已选择、最近工作区列表。
 *
 * 其它业务 Context（Library / Outline / Codex / Progress）都以 workspace root 为作用域，
 * 因此 WorkspaceProvider 必须位于它们之上。
 */

import { createContext, useContext } from "react";

import type { WorkspaceMigrationResult } from "@/services/workspace";

export interface WorkspaceContextValue {
  /** 工作区根绝对路径，未选择时为 null。 */
  root: string | null;
  /** 最近使用的工作区路径列表（localStorage 持久化）。 */
  recent: string[];
  /** 最近一次打开各工作区的时间，按路径索引。 */
  recentOpenedAt: Record<string, number>;
  /** 是否已选择工作区。 */
  isOpen: boolean;
  /** 打开工作区（写入 root 与最近列表）。 */
  open: (root: string) => void;
  /** 关闭工作区（清空 root，保留最近列表）。 */
  close: () => void;
  /** 从最近列表移除一条记录；若它是当前工作区也一并关闭。 */
  removeRecent: (path: string) => void;
  /** 弹出目录选择框并打开；用户取消返回 null。 */
  pick: () => Promise<string | null>;
  /** 只弹出目录选择框，不切换当前工作区。 */
  pickPath: () => Promise<string | null>;
  /** 选择迁移目标目录（必须是空目录）。 */
  pickMigrationTarget: () => Promise<string | null>;
  /** 迁移当前工作区到目标目录并切换过去。 */
  migrate: (target: string) => Promise<WorkspaceMigrationResult>;
  /** 在系统文件管理器中打开工作区目录。 */
  reveal: () => Promise<void>;
  /** 永久删除整个工作区，并关闭当前工作区。 */
  deleteWorkspace: () => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  root: null,
  recent: [],
  recentOpenedAt: {},
  isOpen: false,
  open: () => {},
  close: () => {},
  removeRecent: () => {},
  pick: async () => null,
  pickPath: async () => null,
  pickMigrationTarget: async () => null,
  migrate: async () => {
    throw new Error("workspace migration is unavailable");
  },
  reveal: async () => {},
  deleteWorkspace: async () => {},
});

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx)
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
