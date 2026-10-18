import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useI18n, useToast } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { CODEX_TYPES, type CodexEntry, type CodexType } from "@/services/codex";

/** 逗号 / 中文逗号 / 顿号 分隔的列表字段解析。 */
function parseList(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 右侧素材抽屉。
 *
 * 设计取舍：列表与详情上下排布而非左右——右栏宽度只有 300px 左右，
 * 再分两栏会让名称和正文都窄到读不了。
 */
export default function CodexPane() {
  const { t } = useI18n();
  const toast = useToast();
  const { entries, currentEntryId, setCurrentEntryId, create, save, remove } = useCodex();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<CodexType | "all">("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CodexType>("character");
  const [pendingDelete, setPendingDelete] = useState<CodexEntry | null>(null);
  /** 详情编辑草稿；null 表示不在编辑。 */
  const [draft, setDraft] = useState<CodexEntry | null>(null);

  const current = useMemo(
    () => entries.find((e) => e.id === currentEntryId) ?? null,
    [entries, currentEntryId]
  );

  /* 选中项变化时载入编辑草稿。 */
  useEffect(() => {
    setDraft(current);
  }, [current]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (!q) return true;
      /* 名称、别名、标签、正文都参与匹配：找人物时不该只搜名字。 */
      return (
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)) ||
        e.tags.some((a) => a.toLowerCase().includes(q)) ||
        e.body.toLowerCase().includes(q)
      );
    });
  }, [entries, query, typeFilter]);

  async function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      await create(newType, name);
      setNewName("");
      setCreating(false);
    } catch {
      toast.error("Library.toast.failed");
    }
  }

  async function submitSave() {
    if (!draft) return;
    if (!draft.name.trim()) return;
    try {
      await save(draft);
      toast.success("Codex.save");
    } catch {
      toast.error("Library.toast.failed");
    }
  }

  const dirty =
    draft !== null &&
    current !== null &&
    (draft.name !== current.name ||
      draft.body !== current.body ||
      draft.aliases.join(",") !== current.aliases.join(",") ||
      draft.tags.join(",") !== current.tags.join(",") ||
      draft.type !== current.type);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="row-label">{t("Codex.title")}</h2>
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

      {/* 搜索与类型筛选 */}
      <div className="flex flex-col gap-1.5">
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
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as CodexType | "all")}
        >
          <SelectTrigger className="h-7 text-xs" aria-label={t("Codex.title")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Codex.title")}</SelectItem>
            {CODEX_TYPES.map((tp) => (
              <SelectItem key={tp} value={tp}>
                {t(`Codex.type.${tp}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 新建表单 */}
      {creating ? (
        <div className="flex flex-col gap-1.5 rounded-md border p-2">
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
          <Select value={newType} onValueChange={(v) => setNewType(v as CodexType)}>
            <SelectTrigger className="h-7 text-xs" aria-label={t("Codex.name")}>
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
          <div className="flex gap-1">
            <Button
              size="sm"
              className="h-6 flex-1 text-xs"
              disabled={!newName.trim()}
              onClick={() => void submitCreate()}
            >
              {t("Codex.create")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 flex-1 text-xs"
              onClick={() => setCreating(false)}
            >
              {t("Editor.chapter.cancelRename")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* 条目列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length ? (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setCurrentEntryId(e.id)}
                  className={[
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors",
                    e.id === currentEntryId
                      ? "bg-accent/60 font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  ].join(" ")}
                >
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                    {t(`Codex.type.${e.type}`)}
                  </span>
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

      {/* 详情编辑 */}
      {draft ? (
        <div className="flex shrink-0 flex-col gap-1.5 border-t pt-2">
          <Select
            value={draft.type}
            onValueChange={(v) => setDraft({ ...draft, type: v as CodexType })}
          >
            <SelectTrigger className="h-7 text-xs" aria-label={t("Codex.title")}>
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

          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("Codex.name")}</Label>
            <Input
              value={draft.name}
              className="h-7 text-xs"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("Codex.aliases")}</Label>
            <Input
              value={draft.aliases.join(", ")}
              className="h-7 text-xs"
              onChange={(e) => setDraft({ ...draft, aliases: parseList(e.target.value) })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("Codex.tags")}</Label>
            <Input
              value={draft.tags.join(", ")}
              className="h-7 text-xs"
              onChange={(e) => setDraft({ ...draft, tags: parseList(e.target.value) })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[11px] text-muted-foreground">{t("Codex.body")}</Label>
            <textarea
              value={draft.body}
              rows={4}
              className="w-full resize-none rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:border-ring"
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              className="h-6 flex-1 text-xs"
              disabled={!dirty || !draft.name.trim()}
              onClick={() => void submitSave()}
            >
              {t("Codex.save")}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 text-destructive hover:text-destructive"
              aria-label={t("Codex.delete")}
              title={t("Codex.delete")}
              onClick={() => setPendingDelete(draft)}
            >
              <Trash2 className="icon-sm" />
            </Button>
          </div>
        </div>
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Codex.delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("Codex.deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Editor.chapter.cancelRename")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                void remove(pendingDelete).then(() => setPendingDelete(null));
              }}
            >
              {t("Codex.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
