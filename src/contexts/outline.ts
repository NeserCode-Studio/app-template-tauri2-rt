import { createContext, useContext } from "react";

import type { Outline, OutlineNode } from "@/shared/schema";
import type { ChapterMeta } from "@/services/chapter";

export interface OutlineContextValue {
  /** 当前作品的完整结构树。 */
  outline: Outline;
  /** 当前打开的章节 id。 */
  currentChapterId: string | null;
  /**
   * 正在阅读的章节 id（滚动正文时由视口位置推出）。
   *
   * 与 currentChapterId 分开是刻意的：后者是"编辑目标"，前者是"阅读位置"。
   * 连续章节流里往下滚过第 3 章时，用户还在写第 2 章，若把两者混成一个，
   * 高亮就会反向把编辑目标切走——滚动本身成了改数据的操作。
   * 两者一致时结构树只显示一份高亮，看不出差别。
   */
  readingChapterId: string | null;
  /** 一次性正文段落定位目标；编辑器消费后清空。 */
  pendingParagraphId: string | null;
  setPendingParagraphId: (id: string | null) => void;
  /** 上报阅读位置。只影响高亮，不改编辑目标。 */
  setReadingChapterId: (id: string | null) => void;
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
  /** 跨作品或跨章跳转：先切作品，等结构树装载后落到指定章与段落。 */
  openChapter: (
    workId: string,
    chapterId: string,
    paragraphId?: string | null
  ) => void;
  reload: () => Promise<void>;
  /** 重新读取章元信息（保存、切章后调用）。 */
  reloadChapterMetas: () => Promise<void>;
  /** 只刷新一章的元信息，避免保存后重读整部作品。 */
  refreshChapterMeta: (chapterId: string) => Promise<void>;
}

export const OutlineContext = createContext<OutlineContextValue>({
  outline: { nodes: [] },
  currentChapterId: null,
  readingChapterId: null,
  pendingParagraphId: null,
  setPendingParagraphId: () => {},
  setReadingChapterId: () => {},
  chapters: [],
  volumes: [],
  chapterMetas: {},
  setOutline: () => {},
  setCurrentChapterId: () => {},
  openChapter: () => {},
  reload: async () => {},
  reloadChapterMetas: async () => {},
  refreshChapterMeta: async () => {},
});

export function useOutline(): OutlineContextValue {
  const ctx = useContext(OutlineContext);
  if (!ctx) throw new Error("useOutline must be used within OutlineProvider");
  return ctx;
}
