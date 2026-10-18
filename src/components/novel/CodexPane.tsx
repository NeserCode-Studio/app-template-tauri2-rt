import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { CODEX_TYPES, type CodexEntry, type CodexType } from "@/services/codex";
/**
 * 编辑器右栏的素材面板：只做写作时的查阅与快速新增。
 *
 * 全量内容、关联关系、类型配色都在工作区素材库页面（`/codex`）里维护。
 * 右栏宽度只有 300px 左右，条目一多塞不下搜索也塞不下关系，
 * 所以这里给一个跳转按钮而不是复制一套编辑表单。
 */
export default function CodexPane() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { entries, currentEntryId, colorOf, setCurrentEntryId, create } = useCodex();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<CodexType | "all">("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CodexType>("character");
  const [flashId, setFlashId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)) ||
        e.tags.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [entries, query, typeFilter]);
  const current = useMemo(
    () => entries.find((e) => e.id === currentEntryId) ?? null,
    [entries, currentEntryId]
  );
  /* 选中项短暂高亮，让"点了正文里的提及 → 右栏定位到它"能被看见。 */
  useEffect(() => {
    if (!currentEntryId) return;
    setFlashId(currentEntryId);
    const timer = window.setTimeout(() => setFlashId(null), 1200);
    return () => window.clearTimeout(timer);
  }, [currentEntryId]);
  async function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    await create(newType, name);
    setNewName("");
    setCreating(false);
  }
  const chip = (active: boolean) =>
    [
      "rounded px-1.5 py-0.5 text-[11px] transition-colors",
      active
        ? "bg-accent/60 font-medium text-accent-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
    ].join(" ");
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="row-label">{t("Codex.title")}</h2>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t("Codex.library.title")}
            title={t("Codex.library.title")}
            onClick={() => navigate("/codex")}
          >
            <ExternalLink className="icon-sm" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={t("Codex.new")}
            title={t("Codex.new")}
            onClick={() => setCreating((v) => !v)}
          >
            <Plus className="icon-sm" />
          </Button>
        </div>
      </div>
      <div className="relative">
        <Search className="icon-sm pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          placeholder={t("Codex.search")}
          aria-label={t("Codex.search")}
          className="h-7 pl-7 text-xs"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {/* 类型色点做筛选：与正文高亮同色，一眼对应 */}
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => setTypeFilter("all")} className={chip(typeFilter === "all")}>
          {t("Codex.title")}
        </button>
        {CODEX_TYPES.map((tp) => (
          <button
            key={tp}
            type="button"
            onClick={() => setTypeFilter(tp)}
            className={[
              chip(typeFilter === tp),
              "flex items-center gap-1",
            ].join(" ")}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: colorOf(tp) }} />
            {t(`Codex.type.${tp}`)}
          </button>
        ))}
      </div>
      {creating ? (
        <div className="flex items-center gap-1">
          <Select value={newType} onValueChange={(v) => setNewType(v as CodexType)}>
            <SelectTrigger className="h-7 w-20 shrink-0 text-xs" aria-label={t("Codex.new")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODEX_TYPES.map((tp) => (
                <SelectItem key={tp} value={tp}>
                  {t(`Codex.type.${tp}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            autoFocus
            value={newName}
            placeholder={t("Codex.name")}
            aria-label={t("Codex.name")}
            className="h-7 text-xs"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") void submitCreate();
              if (e.key === "Escape") setCreating(false);
            }}
          />
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!newName.trim()}
            onClick={() => void submitCreate()}
          >
            {t("Codex.create")}
          </Button>
        </div>
      ) : null}
      <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
        {filtered.length ? (
          <ul className="flex flex-col">
            {filtered.map((e: CodexEntry) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setCurrentEntryId(e.id)}
                  className={[
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors",
                    e.id === currentEntryId || e.id === flashId
                      ? "bg-accent/60 font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  ].join(" ")}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorOf(e.type) }}
                  />
                  <span className="truncate">{e.name}</span>
                  {e.aliases[0] ? (
                    <span className="ml-1 shrink-0 truncate text-[10px] text-muted-foreground/60">
                      / {e.aliases[0]}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-2 py-6 text-center">
            <p className="text-xs text-muted-foreground">{t("Codex.empty")}</p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">{t("Codex.emptyHint")}</p>
          </div>
        )}
      </div>
      {/* 选中条目摘要：够看清设定，不够编辑是有意的取舍 */}
      {current ? (
        <div className="flex shrink-0 flex-col gap-1 border-t pt-2">
          <div className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: colorOf(current.type) }}
            />
            <span className="truncate text-sm font-medium">{current.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/60">
              {t(`Codex.type.${current.type}`)}
            </span>
          </div>
          {current.body ? (
            <p className="max-h-24 overflow-y-auto text-[11px] leading-relaxed text-muted-foreground">
              {current.body}
            </p>
          ) : null}
          {current.relations.length ? (
            <p className="text-[10px] text-muted-foreground/60">
              {current.relations.length} {t("Codex.relations")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
