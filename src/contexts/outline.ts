import { createContext, useContext } from "react";

import type { Outline, OutlineNode } from "@/shared/schema";
import type { ChapterMeta } from "@/services/chapter";

export interface OutlineContextValue {
  /** 当前作品的完整结构树。 */
  outline: Outline;
  /** 当前打开的章节 id。 */
  currentChapterId: string | null;
  /** 按 order 升序排列的章节节点（不分卷，章节跳转器用）。 */
  chapters: OutlineNode[];
  /** 按 order 升序排列的卷节点。 */
  volumes: OutlineNode[];
  /**
   * 章的落盘元信息：字数与正文更新时间。
   *
   * 结构树节点的 updatedAt 只在结构操作时更新，反映不了"这段正文什么时候写的"，
   * 因此侧栏卡片的字数与最近更新时间必须从章文件取。
   */
  chapterMetas: Record<string, ChapterMeta>;
  setOutline: (outline: Outline) => void;
  setCurrentChapterId: (id: string | null) => void;
  reload: () => Promise<void>;
  /** 重新读取章元信息（保存、切章后调用）。 */
  reloadChapterMetas: () => Promise<void>;
}

export const OutlineContext = createContext<OutlineContextValue>({
  outline: { nodes: [] },
  currentChapterId: null,
  chapters: [],
  volumes: [],
  chapterMetas: {},
  setOutline: () => {},
  setCurrentChapterId: () => {},
  reload: async () => {},
  reloadChapterMetas: async () => {},
});

export function useOutline(): OutlineContextValue {
  const ctx = useContext(OutlineContext);
  if (!ctx) throw new Error("useOutline must be used within OutlineProvider");
  return ctx;
}
