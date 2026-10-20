import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/composables";
import { useSearch } from "@/contexts/search";
import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import { useCodex } from "@/contexts/codex";
import { useAppNavigation } from "@/lib/navigation";
import { MAX_HITS, type SearchHit } from "@/services/search";

/** 搜索防抖：每次按键都全盘扫章的话，输入中文会明显卡。 */
const DEBOUNCE_MS = 180;

export interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * 全站搜索对话框。
 *
 * 打开即可输入；结果按作品分组，命中处给上下文片段。选中章后
 * 跳到该章，素材条目则跳到素材库页面并选中。
 */
export default function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { t } = useI18n();
  const { go } = useAppNavigation();
  const { search } = useSearch();
  const { setCurrentWorkId } = useLibrary();
  const { setCurrentChapterId } = useOutline();
  const { setCurrentEntryId } = useCodex();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);
  /** 递增的请求序号：过期的响应直接丢弃，避免旧结果覆盖新结果。 */
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    seq.current += 1;
  }, [open]);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const q = query.trim();
    if (!q) {
      setHits([]);
      setRunning(false);
      return;
    }
    const mine = ++seq.current;
    setRunning(true);
    timer.current = window.setTimeout(() => {
      void search(q)
        .then((next) => {
          if (mine !== seq.current) return;
          setHits(next);
          setRunning(false);
        })
        .catch(() => {
          if (mine !== seq.current) return;
          setHits([]);
          setRunning(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [query, search, open]);

  /** 按作品分组；素材条目单列一组。 */
  const groups = useMemo(() => {
    const byWork = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const key = h.kind === "codex" ? "__codex__" : `${h.workTitle}|${h.workId}`;
      byWork.set(key, [...(byWork.get(key) ?? []), h]);
    }
    return [...byWork.entries()];
  }, [hits]);

  function pick(hit: SearchHit) {
    if (hit.kind === "codex") {
      setCurrentEntryId(hit.id);
      go("library", { workspaceView: "materials" });
    } else {
      setCurrentWorkId(hit.workId);
      setCurrentChapterId(hit.id);
      go("editor");
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex items-center gap-2 text-sm">
            {t("Search.title")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("Search.hint")}
          </DialogDescription>
        </DialogHeader>

        <div className="relative px-4 pt-2">
          <Search className="icon-sm pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            placeholder={t("Search.placeholder")}
            aria-label={t("Search.placeholder")}
            className="h-9 pl-7"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onOpenChange(false);
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && hits[0]) pick(hits[0]);
            }}
          />
          {running ? (
            <Loader2 className="icon-sm absolute right-6 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        <ScrollArea className="mt-3 h-80">
          {!query.trim() ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {t("Search.hint")}
            </p>
          ) : !running && !hits.length ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {t("Search.empty")}
            </p>
          ) : (
            <div className="px-2 pb-3">
              {groups.map(([key, list]) => (
                <section key={key} className="mb-2">
                  <h3 className="px-2 py-1 text-[11px] text-muted-foreground/70">
                    {key === "__codex__" ? t("Codex.title") : list[0].workTitle}
                    <span className="ml-1 tabular-nums">{list.length}</span>
                  </h3>
                  <ul className="flex flex-col">
                    {list.map((hit) => (
                      <li key={`${hit.kind}:${hit.id}`}>
                        <button
                          type="button"
                          onClick={() => pick(hit)}
                          className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <span className="flex items-center gap-1.5">
                            <FileText className="icon-sm shrink-0 text-muted-foreground" />
                            <span className="truncate text-xs font-medium">{hit.title}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60 tabular-nums">
                              {hit.count}
                            </span>
                          </span>
                          {hit.snippet ? (
                            <span className="line-clamp-1 pl-4 text-[11px] text-muted-foreground/70">
                              {hit.snippet}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {hits.length >= MAX_HITS ? (
                <p className="px-2 py-1 text-[10px] text-muted-foreground/60">
                  {t("Search.truncated")}
                </p>
              ) : null}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
