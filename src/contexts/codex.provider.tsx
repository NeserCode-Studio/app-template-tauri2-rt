/**
 * CodexProvider：素材条目在内存中的索引与增删改。
 *
 * 条目数量是几百级别（远小于正文），全部读进内存后提及高亮、
 * 素材搜索才能在输入时即时响应。写入仍走磁盘。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { CodexContext, type CodexContextValue } from "./codex";
import { useWorkspace } from "./workspace";
import { useLibrary } from "./library";
import {
  createEntry,
  loadAllEntries,
  removeEntry,
  saveEntry,
  type CodexEntry,
  type CodexType,
} from "@/services/codex";
import { createLogger } from "@/lib/logger";

const log = createLogger("CodexProvider");

export function CodexProvider({ children }: { children: ReactNode }) {
  const { root } = useWorkspace();
  const { currentWorkId } = useLibrary();
  const [entries, setEntries] = useState<CodexEntry[]>([]);
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);

  /** 作品切换时重装；无工作区时清空。 */
  useEffect(() => {
    if (!root || !currentWorkId) {
      setEntries([]);
      setCurrentEntryId(null);
      return;
    }
    let alive = true;
    loadAllEntries(root, currentWorkId)
      .then((next) => {
        if (!alive) return;
        setEntries(next);
        log.info("codex loaded", { workId: currentWorkId, count: next.length });
      })
      .catch((err) => log.error("codex load failed", err));
    return () => {
      alive = false;
    };
  }, [root, currentWorkId]);

  const reload = useCallback(async () => {
    if (!root || !currentWorkId) return;
    setEntries(await loadAllEntries(root, currentWorkId));
  }, [root, currentWorkId]);

  const create = useCallback(
    async (type: CodexType, name: string) => {
      if (!root || !currentWorkId) return null;
      const entry = await createEntry(root, currentWorkId, type, name);
      setEntries((prev) =>
        [...prev, entry].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))
      );
      setCurrentEntryId(entry.id);
      return entry;
    },
    [root, currentWorkId]
  );

  const save = useCallback(
    async (entry: CodexEntry) => {
      if (!root || !currentWorkId) return;
      await saveEntry(root, currentWorkId, entry);
      /* 就地替换；类型变了则要从旧类型里挪走，故整体按 id 重排。 */
      setEntries((prev) => {
        const rest = prev.filter((e) => e.id !== entry.id);
        return [...rest, { ...entry, updatedAt: Date.now() }].sort((a, b) =>
          a.name.localeCompare(b.name, "zh-Hans-CN")
        );
      });
    },
    [root, currentWorkId]
  );

  const remove = useCallback(
    async (entry: CodexEntry) => {
      if (!root || !currentWorkId) return;
      await removeEntry(root, currentWorkId, entry);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setCurrentEntryId((prev) => (prev === entry.id ? null : prev));
    },
    [root, currentWorkId]
  );

  const byType = useCallback(
    (type: CodexType) => entries.filter((e) => e.type === type),
    [entries]
  );

  const value = useMemo<CodexContextValue>(
    () => ({
      entries,
      currentEntryId,
      byType,
      setCurrentEntryId,
      reload,
      create,
      save,
      remove,
    }),
    [entries, currentEntryId, byType, reload, create, save, remove]
  );

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}
