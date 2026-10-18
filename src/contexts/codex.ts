/**
 * 素材库 Context：类型化条目（人物 / 地点 / 物品…）与当前选中项。
 *
 * 素材条目按类型分目录存于 works/<id>/codex/<type>/<entryId>.json，
 * 因此这里需要一次性把各类型的条目全部读进内存：条目数量是几百级别，
 * 远小于正文，逐条按需读反而会让高亮匹配变得不可用。
 */

import { createContext, useContext } from "react";
import type { CodexEntry, CodexType } from "@/services/codex";

export interface CodexContextValue {
  /** 全部条目（跨类型），供搜索与提及匹配使用。 */
  entries: CodexEntry[];
  /** 当前选中的条目 id（右侧抽屉展示）。 */
  currentEntryId: string | null;
  /** 按类型筛选后的条目。 */
  byType: (type: CodexType) => CodexEntry[];
  setCurrentEntryId: (id: string | null) => void;
  /** 重新从磁盘装载。 */
  reload: () => Promise<void>;
  /** 新建条目并选中。 */
  create: (type: CodexType, name: string) => Promise<CodexEntry | null>;
  /** 保存（新建或更新）条目。 */
  save: (entry: CodexEntry) => Promise<void>;
  /** 删除条目。 */
  remove: (entry: CodexEntry) => Promise<void>;
}

export const CodexContext = createContext<CodexContextValue | null>(null);

export function useCodex(): CodexContextValue {
  const ctx = useContext(CodexContext);
  if (!ctx) throw new Error("useCodex must be used within CodexProvider");
  return ctx;
}
