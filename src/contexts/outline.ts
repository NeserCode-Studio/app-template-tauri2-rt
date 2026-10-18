import { createContext, useContext } from "react";

import type { Outline, OutlineNode } from "@/shared/schema";

export interface OutlineContextValue {
  /** 当前作品的完整结构树。 */
  outline: Outline;
  /** 当前打开的章节 id。 */
  currentChapterId: string | null;
  /** 按 order 升序排列的章节节点（不分卷，章节跳转器用）。 */
  chapters: OutlineNode[];
  /** 按 order 升序排列的卷节点。 */
  volumes: OutlineNode[];
  setOutline: (outline: Outline) => void;
  setCurrentChapterId: (id: string | null) => void;
  reload: () => Promise<void>;
}

export const OutlineContext = createContext<OutlineContextValue>({
  outline: { nodes: [] },
  currentChapterId: null,
  chapters: [],
  volumes: [],
  setOutline: () => {},
  setCurrentChapterId: () => {},
  reload: async () => {},
});

export function useOutline(): OutlineContextValue {
  const ctx = useContext(OutlineContext);
  if (!ctx) throw new Error("useOutline must be used within OutlineProvider");
  return ctx;
}
