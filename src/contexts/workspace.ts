/**
 * 工作区 Context：工作区根路径、是否已选择、最近工作区列表。
 *
 * 其它业务 Context（Library / Outline / Codex / Progress）都以 workspace root 为作用域，
 * 因此 WorkspaceProvider 必须位于它们之上。
 */

import { createContext, useContext } from "react";

export interface WorkspaceContextValue {
  /** 工作区根绝对路径，未选择时为 null。 */
  root: string | null;
  /** 最近使用的工作区路径列表（localStorage 持久化）。 */
  recent: string[];
  /** 是否已选择工作区。 */
  isOpen: boolean;
  /** 打开工作区（写入 root 与最近列表）。 */
  open: (root: string) => void;
  /** 关闭工作区（清空 root，保留最近列表）。 */
  close: () => void;
  /** 弹出目录选择框并打开；用户取消返回 null。 */
  pick: () => Promise<string | null>;
  /** 在系统文件管理器中打开工作区目录。 */
  reveal: () => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  root: null,
  recent: [],
  isOpen: false,
  open: () => {},
  close: () => {},
  pick: async () => null,
  reveal: async () => {},
});

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
