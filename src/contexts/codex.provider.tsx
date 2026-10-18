/**
 * CodexProvider：工作区级素材库的内存索引与增删改。
 *
 * 素材库属于工作区而非作品，所以不再随 `currentWorkId` 重装——
 * 切换作品时条目与关系都保持不变。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createEntry,
  loadAllEntries,
  loadTypeConfigs,
  migrateLegacyEntries,
  removeEntry,
  saveEntry,
  saveTypeConfigs,
  DEFAULT_CODEX_COLORS,
  type CodexEntry,
  type CodexType,
  type CodexTypeConfig,
} from "@/services/codex";
import { createLogger } from "@/lib/logger";
import { useWorkspace } from "./workspace";
import { CodexContext, type CodexContextValue } from "./codex";
import { loadWorkspace } from "@/services/workspace";

const log = createLogger("CodexProvider");

function byName(a: CodexEntry, b: CodexEntry): number {
  return a.name.localeCompare(b.name, "zh-Hans-CN");
}

/** 迁移只做一次：标记按工作区根路径存，避免每次启动重扫旧目录。 */
const MIGRATION_FLAG = "codex-migrated:";

export function CodexProvider({ children }: { children: ReactNode }) {
  const { root } = useWorkspace();
  const [entries, setEntries] = useState<CodexEntry[]>([]);
  const [typeConfigs, setTypeConfigs] = useState<CodexTypeConfig[]>([]);
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(null);

  /* 工作区变化时装载；无工作区时清空。 */
  useEffect(() => {
    if (!root) {
      setEntries([]);
      setTypeConfigs([]);
      setCurrentEntryId(null);
      return;
    }
    let alive = true;
    void (async () => {
      const flag = MIGRATION_FLAG + root;
      if (!localStorage.getItem(flag)) {
        try {
          const ws = await loadWorkspace(root);
          const report = await migrateLegacyEntries(root, [...ws.order, ...ws.archived]);
          localStorage.setItem(flag, JSON.stringify(report));
          if (report.copied) {
            log.info("codex migrated", { copied: report.copied, duplicates: report.duplicates.length });
          }
        } catch (err) {
          log.error("codex migration failed", err);
        }
      }
      const [nextEntries, nextConfigs] = await Promise.all([
        loadAllEntries(root),
        loadTypeConfigs(root),
      ]);
      if (!alive) return;
      setEntries(nextEntries);
      setTypeConfigs(nextConfigs);
      log.info("codex loaded", { count: nextEntries.length });
    })().catch((err) => log.error("codex load failed", err));
    return () => {
      alive = false;
    };
  }, [root]);

  const reload = useCallback(async () => {
    if (!root) return;
    setEntries(await loadAllEntries(root));
  }, [root]);

  const create = useCallback(
    async (type: CodexType, name: string) => {
      if (!root) return null;
      const entry = await createEntry(root, type, name);
      setEntries((prev) => [...prev, entry].sort(byName));
      setCurrentEntryId(entry.id);
      return entry;
    },
    [root]
  );

  const save = useCallback(
    async (entry: CodexEntry) => {
      if (!root) return;
      await saveEntry(root, entry);
      /*
       * 关系是双向的：保存一条会让对方条目也跟着落盘，
       * 因此整表重排而不是就地替换，免得关联列表停留在旧状态。
       */
      setEntries(await loadAllEntries(root));
    },
    [root]
  );

  const remove = useCallback(
    async (entry: CodexEntry) => {
      if (!root) return;
      await removeEntry(root, entry);
      setEntries(await loadAllEntries(root));
      setCurrentEntryId((prev) => (prev === entry.id ? null : prev));
    },
    [root]
  );

  const setTypeColor = useCallback(
    async (type: CodexType, color: string) => {
      if (!root) return;
      const next = typeConfigs.map((c) => (c.id === type ? { ...c, color } : c));
      setTypeConfigs(next);
      await saveTypeConfigs(root, next);
    },
    [root, typeConfigs]
  );

  const byType = useCallback((type: CodexType) => entries.filter((e) => e.type === type), [entries]);

  const colorOf = useCallback(
    (type: CodexType) =>
      typeConfigs.find((c) => c.id === type)?.color ?? DEFAULT_CODEX_COLORS[type],
    [typeConfigs]
  );

  const value = useMemo<CodexContextValue>(
    () => ({
      entries,
      typeConfigs,
      currentEntryId,
      byType,
      colorOf,
      setCurrentEntryId,
      reload,
      create,
      save,
      remove,
      setTypeColor,
    }),
    [
      entries,
      typeConfigs,
      currentEntryId,
      byType,
      colorOf,
      reload,
      create,
      save,
      remove,
      setTypeColor,
    ]
  );

  return <CodexContext.Provider value={value}>{children}</CodexContext.Provider>;
}
