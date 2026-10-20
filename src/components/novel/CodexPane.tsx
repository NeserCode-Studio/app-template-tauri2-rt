import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  MousePointerClick,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import { useAppNavigation } from "@/lib/navigation";
import { typeLabel } from "@/services/codex";
import { useJumpHighlight } from "@/hooks/useJumpHighlight";
import { CodexEntryCreateDialog } from "./codex/CodexEntryCreateDialog";

interface CodexPaneProps {
  onAppendToText?: (text: string) => void;
}

/**
 * 编辑器右栏的素材面板：只做写作时的查阅与快速新增。
 *
 * 全量内容、关联关系、类型配色都在工作区素材库视图里维护。
 * 右栏宽度只有 300px 左右，条目一多塞不下搜索也塞不下关系，
 * 所以这里给一个跳转按钮而不是复制一套编辑表单。
 */
export default function CodexPane({ onAppendToText }: CodexPaneProps) {
  const { t } = useI18n();
  const { go } = useAppNavigation();
  const { currentWorkId } = useLibrary();
  const { currentChapterId } = useOutline();
  const {
    entries,
    mentions,
    relations,
    typeConfigs,
    currentEntryId,
    colorOf,
    setCurrentEntryId,
  } = useCodex();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");
  const [chapterOnly, setChapterOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { highlightId, jumpTo } = useJumpHighlight("data-codex-entry");
  const chapterMentionIds = useMemo(() => {
    if (!chapterOnly) return null;
    if (!currentWorkId || !currentChapterId) return new Set<string>();
    return new Set(
      entries
        .filter((entry) =>
          (mentions[entry.id] ?? []).some(
            (mention) =>
              mention.workId === currentWorkId &&
              mention.chapterId === currentChapterId
          )
        )
        .map((entry) => entry.id)
    );
  }, [chapterOnly, currentChapterId, currentWorkId, entries, mentions]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.typeId !== typeFilter) return false;
      if (chapterMentionIds && !chapterMentionIds.has(e.id)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)) ||
        e.tags.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [chapterMentionIds, entries, query, typeFilter]);
  const current = useMemo(
    () => entries.find((e) => e.id === currentEntryId) ?? null,
    [entries, currentEntryId]
  );
  const primaryTypes = useMemo(() => {
    const first = typeConfigs.slice(0, 3);
    if (typeFilter === "all" || first.some((type) => type.id === typeFilter)) {
      return first;
    }
    const selected = typeConfigs.find((type) => type.id === typeFilter);
    return selected ? [selected, ...first.slice(0, 2)] : first;
  }, [typeConfigs, typeFilter]);
  const overflowTypes = useMemo(
    () =>
      typeConfigs.filter(
        (type) => !primaryTypes.some((visible) => visible.id === type.id)
      ),
    [primaryTypes, typeConfigs]
  );
  const hiddenTypeSelected = overflowTypes.some(
    (type) => type.id === typeFilter
  );
  const moreCount = overflowTypes.length;
  const moreLabel = t("Codex.filter.more").replace(
    "{count}",
    String(moreCount)
  );
  const moreShortLabel = t("Codex.filter.moreShort").replace(
    "{count}",
    String(moreCount)
  );
  /* 选中项短暂高亮，让"点了正文里的提及 → 右栏定位到它"能被看见。 */
  useEffect(() => {
    if (!currentEntryId) return;
    jumpTo(currentEntryId);
  }, [currentEntryId, jumpTo]);
  function openCreate() {
    setCreateOpen(true);
  }
  const chip = (active: boolean) =>
    [
      "inline-flex h-7 min-w-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-md border text-xs font-medium transition-colors",
      active
        ? "border-primary/30 bg-accent text-accent-foreground"
        : "border-border/70 bg-neutral-100/45 text-muted-foreground hover:bg-accent/55 hover:text-foreground dark:bg-neutral-800/30",
    ].join(" ");
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="icon-sm text-muted-foreground pointer-events-none absolute top-1/2 left-2 -translate-y-1/2" />
          <Input
            value={query}
            placeholder={t("Codex.search")}
            aria-label={t("Codex.search")}
            className="h-8 pl-8 text-xs"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label={t("Codex.library.title")}
          title={t("Codex.library.title")}
          onClick={() => go("codex")}
        >
          <ExternalLink className="icon-sm" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          aria-label={t("Codex.new")}
          title={t("Codex.new")}
          onClick={openCreate}
        >
          <Plus className="icon-sm" />
        </Button>
      </div>
      {/* 两行筛选：本章提及优先，超出两行的类型收进 +N 分类。 */}
      <div className="grid grid-cols-4 gap-1">
        <button
          type="button"
          aria-pressed={chapterOnly}
          disabled={!currentChapterId}
          title={t("Codex.filter.chapterMentionsHint")}
          onClick={() => setChapterOnly((value) => !value)}
          className={[
            chip(chapterOnly),
            "col-span-2 gap-1 border-dashed px-1.5 disabled:cursor-not-allowed disabled:opacity-50",
          ].join(" ")}
        >
          <BookOpen className="size-3 shrink-0" />
          <span className="min-w-0 truncate">
            {t("Codex.filter.chapterMentions")}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={typeFilter === "all"}
          title={t("Codex.all")}
          onClick={() => setTypeFilter("all")}
          className={[chip(typeFilter === "all"), "col-span-2 px-1.5"].join(" ")}
        >
          <span className="min-w-0 truncate">{t("Codex.all")}</span>
        </button>
        {primaryTypes.map((tp) => (
          <button
            key={tp.id}
            type="button"
            aria-pressed={typeFilter === tp.id}
            title={typeLabel(tp, t)}
            onClick={() => setTypeFilter(tp.id)}
            className={[
              chip(typeFilter === tp.id),
              "gap-0.5 px-1",
            ].join(" ")}
          >
            <span
              className="size-1 shrink-0 rounded-full"
              style={{ backgroundColor: colorOf(tp.id) }}
            />
            <span className="min-w-0 truncate">{typeLabel(tp, t)}</span>
          </button>
        ))}
        {overflowTypes.length ? (
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title={moreLabel}
                className={[
                  chip(hiddenTypeSelected),
                  "px-1 text-[11px] tabular-nums",
                ].join(" ")}
                aria-label={moreLabel}
              >
                <span className="min-w-0 truncate">{moreShortLabel}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-64 w-60 overflow-y-auto p-1.5"
            >
              <div className="flex flex-col gap-1">
                {overflowTypes.map((tp) => (
                  <button
                    key={tp.id}
                    type="button"
                    aria-pressed={typeFilter === tp.id}
                    onClick={() => {
                      setTypeFilter(tp.id);
                      setMoreOpen(false);
                    }}
                    className={[
                      chip(typeFilter === tp.id),
                      "w-full justify-start gap-1 px-2",
                    ].join(" ")}
                  >
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(tp.id) }}
                    />
                    <span className="truncate">{typeLabel(tp, t)}</span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
          {filtered.length ? (
            <ul className="flex flex-col gap-1">
              {filtered.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    data-codex-entry={e.id}
                    title={
                      onAppendToText ? t("Codex.appendHint") : undefined
                    }
                    onClick={() => setCurrentEntryId(e.id)}
                    onDoubleClick={(event) => {
                      if (!onAppendToText) return;
                      event.preventDefault();
                      onAppendToText(e.name);
                    }}
                    className={[
                      "flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-xs transition-colors",
                      e.id === currentEntryId
                        ? "border-primary/30 bg-accent/60 font-medium text-accent-foreground"
                        : "border-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      e.id === highlightId ? "jump-highlight" : "",
                    ].join(" ")}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(e.typeId) }}
                    />
                    <span
                      className="truncate"
                      style={{ color: colorOf(e.typeId) }}
                    >
                      {e.name}
                    </span>
                    {e.aliases[0] ? (
                      <span className="text-muted-foreground/60 ml-1 shrink-0 truncate text-[10px]">
                        / {e.aliases[0]}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-2 py-6 text-center">
              <p className="text-muted-foreground text-xs">
                {chapterOnly
                  ? t("Codex.emptyChapterMentions")
                  : t("Codex.empty")}
              </p>
              <p className="text-muted-foreground/70 mt-1 text-[11px]">
                {chapterOnly
                  ? t("Codex.emptyChapterMentionsHint")
                  : t("Codex.emptyHint")}
              </p>
            </div>
          )}
        </div>
        {onAppendToText ? (
          <p className="text-muted-foreground/65 mt-1 flex shrink-0 items-start gap-1.5 border-t px-1 pt-2 text-[11px] leading-relaxed">
            <MousePointerClick
              aria-hidden="true"
              className="mt-0.5 size-3 shrink-0"
            />
            <span>{t("Codex.appendHint")}</span>
          </p>
        ) : null}
      </div>
      {/* 选中条目摘要：够看清设定，不够编辑是有意的取舍 */}
      {current ? (
        <div className="flex shrink-0 flex-col gap-1 border-t pt-2">
          <div className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: colorOf(current.typeId) }}
            />
            <span
              className="truncate text-sm font-medium"
              style={{ color: colorOf(current.typeId) }}
            >
              {current.name}
            </span>
            <span className="text-muted-foreground/60 ml-auto shrink-0 text-[10px]">
              {typeLabel(
                typeConfigs.find((type) => type.id === current.typeId),
                t
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground h-6 shrink-0 px-1.5 text-[10px]"
              onClick={() => {
                setCurrentEntryId(null);
              }}
            >
              {t("Codex.clearSelection")}
            </Button>
          </div>
          {current.summary ? (
            <p className="text-muted-foreground max-h-24 overflow-y-auto text-[11px] leading-relaxed">
              {current.summary}
            </p>
          ) : null}
          {relations.some(
            (relation) =>
              relation.fromId === current.id || relation.toId === current.id
          ) ? (
            <p className="text-muted-foreground/60 text-[10px]">
              {
                relations.filter(
                  (relation) =>
                    relation.fromId === current.id ||
                    relation.toId === current.id
                ).length
              }{" "}
              {t("Codex.relations")}
            </p>
          ) : null}
        </div>
      ) : null}

      <CodexEntryCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialTypeId={typeFilter === "all" ? "character" : typeFilter}
      />
    </div>
  );
}
