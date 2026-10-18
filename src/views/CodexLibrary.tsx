import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Link2, Palette, Plus, Search, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

import { useI18n, useToast } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { CODEX_TYPES, RELATION_KINDS, type CodexEntry, type CodexType } from "@/services/codex";

/** 逗号 / 中文逗号 / 顿号 分隔的列表字段解析。 */
function parseList(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 工作区级素材库页面。
 *
 * 与编辑器 CodexPane 的分工：这里管全量内容、类型配置与关联；
 * 编辑器右栏只留一个轻量入口——条目一多，右栏塞不下搜索也塞不下关系。
 */
export default function CodexLibrary() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const {
    entries,
    typeConfigs,
    currentEntryId,
    colorOf,
    setCurrentEntryId,
    create,
    save,
    remove,
    setTypeColor,
  } = useCodex();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<CodexType | "all">("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CodexType>("character");
  const [pendingDelete, setPendingDelete] = useState<CodexEntry | null>(null);
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

  /** 关联项按类型色点展示；目标已删除的边直接忽略。 */
  const related = useMemo(() => {
    if (!draft) return [];
    const byId = new Map(entries.map((e) => [e.id, e]));
    return draft.relations
      .map((r) => ({ kind: r.kind, entry: byId.get(r.targetId) ?? null }))
      .filter((r): r is { kind: (typeof draft.relations)[number]["kind"]; entry: CodexEntry } =>
        Boolean(r.entry)
      );
  }, [draft, entries]);

  const fields = useMemo(
    () => typeConfigs.find((c) => c.id === draft?.type)?.fields ?? [],
    [typeConfigs, draft?.type]
  );

  const dirty =
    draft !== null &&
    current !== null &&
    (draft.name !== current.name ||
      draft.body !== current.body ||
      draft.type !== current.type ||
      draft.aliases.join(",") !== current.aliases.join(",") ||
      draft.tags.join(",") !== current.tags.join(",") ||
      JSON.stringify(draft.attributes) !== JSON.stringify(current.attributes) ||
      JSON.stringify(draft.relations) !== JSON.stringify(current.relations));

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

  /** 新增关联：目标与当前条目间建边，保存时自动补反向边。 */
  function addRelation(targetId: string) {
    if (!draft || !targetId) return;
    if (draft.relations.some((r) => r.targetId === targetId)) return;
    setDraft({ ...draft, relations: [...draft.relations, { targetId, kind: "mentions" }] });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("Codex.library.back")}
          onClick={() => navigate("/")}
        >
          <ArrowLeft className="icon-md" />
        </Button>
        <h1 className="text-base font-semibold">{t("Codex.library.title")}</h1>
        <span className="text-xs text-muted-foreground">{entries.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="icon-sm pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              placeholder={t("Codex.search")}
              aria-label={t("Codex.search")}
              className="h-7 w-56 pl-7 text-xs"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            <Plus className="icon-sm" />
            {t("Codex.new")}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 类型导航 */}
        <div className="scrollbar-app w-44 shrink-0 overflow-y-auto border-r">
        <nav className="flex flex-col gap-0.5 p-2">
          <button
            type="button"
            onClick={() => setTypeFilter("all")}
            className={[
              "flex items-center rounded-md px-2 py-1.5 text-left text-xs transition-colors",
              typeFilter === "all"
                ? "bg-accent/60 font-medium text-accent-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            ].join(" ")}
          >
            {t("Codex.title")}
          </button>
          {CODEX_TYPES.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setTypeFilter(tp)}
              className={[
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                typeFilter === tp
                  ? "bg-accent/60 font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              ].join(" ")}
            >
              {/* 色点与正文提及高亮同色，一眼对应类型 */}
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: colorOf(tp) }}
              />
              <span className="truncate">{t(`Codex.type.${tp}`)}</span>
              <span className="ml-auto text-[10px] text-muted-foreground/60">
                {entries.filter((e) => e.type === tp).length}
              </span>
            </button>
          ))}
        </nav>
        </div>

        {/* 条目列表 */}
        <div className="flex w-72 shrink-0 flex-col border-r">
          {creating ? (
            <div className="flex shrink-0 flex-col gap-1.5 border-b p-2">
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
                <SelectTrigger className="h-7 text-xs">
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

          <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
            {filtered.length ? (
              <ul className="flex flex-col">
                {filtered.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setCurrentEntryId(e.id)}
                      className={[
                        "flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs transition-colors",
                        e.id === currentEntryId
                          ? "bg-accent/60 font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      ].join(" ")}
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: colorOf(e.type) }}
                      />
                      <span className="truncate">{e.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                        {t(`Codex.type.${e.type}`)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-3 py-8 text-center">
                <p className="text-xs text-muted-foreground">{t("Codex.empty")}</p>
              </div>
            )}
          </div>
        </div>

        {/* 详情编辑 */}
        <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col p-4">
          {draft ? (
            <div className="flex max-w-2xl flex-col gap-3">
              <div className="flex items-center gap-2">
                <Select
                  value={draft.type}
                  onValueChange={(v) =>
                    setDraft({ ...draft, type: v as CodexType, attributes: {} })
                  }
                >
                  <SelectTrigger className="h-7 w-32 text-xs">
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
                <span className="text-[11px] text-muted-foreground">
                  {t("Codex.library.scopeHint")}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">{t("Codex.name")}</Label>
                <Input
                  value={draft.name}
                  className="h-8 text-sm"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">{t("Codex.aliases")}</Label>
                  <Input
                    value={draft.aliases.join(", ")}
                    className="h-7 text-xs"
                    onChange={(e) => setDraft({ ...draft, aliases: parseList(e.target.value) })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">{t("Codex.tags")}</Label>
                  <Input
                    value={draft.tags.join(", ")}
                    className="h-7 text-xs"
                    onChange={(e) => setDraft({ ...draft, tags: parseList(e.target.value) })}
                  />
                </div>
              </div>

              {/* 类型化字段：人物的身份/年龄，物品的持有者/状态… */}
              {fields.length ? (
                <div className="grid grid-cols-2 gap-3">
                  {fields.map((f) => (
                    <div key={f.key} className="flex flex-col gap-1">
                      <Label className="text-xs text-muted-foreground">{t(f.labelKey)}</Label>
                      <Input
                        value={draft.attributes[f.key] ?? ""}
                        className="h-7 text-xs"
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            attributes: { ...draft.attributes, [f.key]: e.target.value },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">{t("Codex.body")}</Label>
                <textarea
                  value={draft.body}
                  rows={6}
                  className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring"
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </div>

              {/* 关联：双向，保存时自动补反向边 */}
              <div className="flex flex-col gap-1.5 rounded-md border p-2">
                <div className="flex items-center gap-1.5">
                  <Link2 className="icon-sm text-muted-foreground" />
                  <Label className="text-xs text-muted-foreground">{t("Codex.relations")}</Label>
                </div>
                {related.map(({ kind, entry }) => (
                  <div key={entry.id} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(entry.type) }}
                    />
                    <Select
                      value={kind}
                      onValueChange={(v) =>
                        setDraft({
                          ...draft,
                          relations: draft.relations.map((r) =>
                            r.targetId === entry.id
                              ? { ...r, kind: v as typeof r.kind }
                              : r
                          ),
                        })
                      }
                    >
                      <SelectTrigger className="h-6 w-24 shrink-0 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RELATION_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {t(`Codex.relation.${k}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      className="truncate text-muted-foreground hover:text-accent-foreground hover:underline"
                      onClick={() => setCurrentEntryId(entry.id)}
                    >
                      {entry.name}
                    </button>
                    <button
                      type="button"
                      aria-label={t("Codex.relation.remove")}
                      className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          relations: draft.relations.filter((r) => r.targetId !== entry.id),
                        })
                      }
                    >
                      <X className="icon-sm" />
                    </button>
                  </div>
                ))}
                <Select value="" onValueChange={addRelation} disabled={entries.length < 2}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder={t("Codex.relation.add")} />
                  </SelectTrigger>
                  <SelectContent>
                    {entries
                      .filter(
                        (e) =>
                          e.id !== draft.id && !draft.relations.some((r) => r.targetId === e.id)
                      )
                      .map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={!dirty || !draft.name.trim()}
                  onClick={() => void submitSave()}
                >
                  {t("Codex.save")}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-destructive hover:text-destructive"
                  aria-label={t("Codex.delete")}
                  title={t("Codex.delete")}
                  onClick={() => setPendingDelete(draft)}
                >
                  <Trash2 className="icon-sm" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-10 text-center text-xs text-muted-foreground">
              {t("Codex.emptyHint")}
            </p>
          )}

          {/* 每种素材的高亮颜色 */}
          <div className="mt-6 max-w-2xl rounded-md border p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Palette className="icon-sm text-muted-foreground" />
              <Label className="text-xs text-muted-foreground">{t("Codex.library.colors")}</Label>
            </div>
            <div className="flex flex-wrap gap-3">
              {CODEX_TYPES.map((tp) => (
                <label key={tp} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="color"
                    aria-label={t(`Codex.type.${tp}`)}
                    className="size-6 cursor-pointer rounded border bg-transparent p-0"
                    value={colorOf(tp)}
                    onChange={(e) => void setTypeColor(tp, e.target.value)}
                  />
                  <span className="text-muted-foreground">{t(`Codex.type.${tp}`)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>

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
