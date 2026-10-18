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
}

export const LibraryContext = createContext<LibraryContextValue>({
  workspace: null,
  currentWorkId: null,
  works: {},
  setWorkspace: () => {},
  setWorks: () => {},
  setCurrentWorkId: () => {},
});

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used within LibraryProvider");
  return ctx;
}
