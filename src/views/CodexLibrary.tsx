import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  CalendarClock,
  ChevronRight,
  Grid2X2,
  List,
  Loader2,
  MousePointerClick,
  Plus,
  Radar,
  Search,
  Settings2,
  X,
} from "lucide-react";

import { useI18n, useToast } from "@/composables";
import { useCodex } from "@/contexts/codex";
import { useLongTask } from "@/contexts/long-task";
import {
  typeLabel,
  type Entry,
  type Relation,
  type TypeConfig,
} from "@/services/codex";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { CodexDetail } from "@/components/novel/codex/CodexDetail";
import { CodexEntryCreateDialog } from "@/components/novel/codex/CodexEntryCreateDialog";
import { CodexPreview } from "@/components/novel/codex/CodexPreview";
import { CodexTypeManager } from "@/components/novel/codex/CodexTypeManager";
import { TypeGlyph } from "@/components/novel/codex/TypeGlyph";
import { useJumpHighlight } from "@/hooks/useJumpHighlight";
import { createLogger } from "@/lib/logger";

type ViewMode = "grid" | "list" | "timeline";
type SortMode = "name" | "updated" | "type";
type SortDirection = "asc" | "desc";

const LIST_GRID_CLASS =
  "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 sm:grid-cols-[minmax(10rem,1fr)_7rem_minmax(10rem,1.4fr)_5.5rem]";
const log = createLogger("CodexLibrary");

function useNarrowLayout() {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 1099px)").matches
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1099px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

function entryHaystack(entry: Entry): string {
  const fields = Object.values(entry.fields)
    .map((value) =>
      value.kind === "refs"
        ? value.value.join(" ")
        : value.kind === "number"
          ? `${value.value}`
          : value.value
    )
    .join("\n");
  return [
    entry.name,
    entry.aliases.join("\n"),
    entry.tags.join("\n"),
    entry.summary,
    entry.body,
    fields,
  ].join("\n");
}

function fieldNumber(entry: Entry, key: string): number | null {
  const value = entry.fields[key];
  return value?.kind === "number" && Number.isFinite(value.value)
    ? value.value
    : null;
}

function fieldText(entry: Entry, key: string): string {
  const value = entry.fields[key];
  if (!value || value.kind === "ref" || value.kind === "refs") return "";
  return String(value.value);
}

function referencedIds(entry: Entry, key: string): string[] {
  const value = entry.fields[key];
  if (value?.kind === "ref") return value.value ? [value.value] : [];
  if (value?.kind === "refs") return value.value;
  return [];
}

function TimelineView({
  events,
  allEntries,
  relations,
  currentEntryId,
  onSelect,
  onEdit,
  onCreate,
  highlightedEntryId,
}: {
  events: Entry[];
  allEntries: Entry[];
  relations: Relation[];
  currentEntryId: string | null;
  onSelect: (entryId: string) => void;
  onEdit: (entryId: string) => void;
  onCreate: () => void;
  highlightedEntryId: string | null;
}) {
  const { t } = useI18n();
  const { colorOf } = useCodex();
  const ordered = useMemo(
    () =>
      [...events].sort((a, b) => {
        const aOrder = fieldNumber(a, "order");
        const bOrder = fieldNumber(b, "order");
        if (aOrder === null && bOrder === null) {
          return a.name.localeCompare(b.name, "zh-Hans-CN");
        }
        if (aOrder === null) return 1;
        if (bOrder === null) return -1;
        return aOrder - bOrder || a.name.localeCompare(b.name, "zh-Hans-CN");
      }),
    [events]
  );
  const relatedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!currentEntryId) return ids;
    ids.add(currentEntryId);
    for (const relation of relations) {
      if (relation.fromId === currentEntryId) ids.add(relation.toId);
      if (relation.toId === currentEntryId) ids.add(relation.fromId);
    }
    for (const event of events) {
      const refs = [
        ...referencedIds(event, "place"),
        ...referencedIds(event, "participants"),
      ];
      if (refs.includes(currentEntryId)) ids.add(event.id);
    }
    return ids;
  }, [currentEntryId, events, relations]);

  if (!ordered.length) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <CalendarClock className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium">{t("Codex.timeline.empty")}</p>
          <p className="text-muted-foreground mt-1 max-w-sm text-xs leading-relaxed">
            {t("Codex.timeline.emptyHint")}
          </p>
        </div>
        <Button type="button" size="sm" onClick={onCreate}>
          <Plus className="size-3.5" />
          {t("Codex.new")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col pt-2">
      {ordered.map((event, index) => {
        const color = colorOf(event.typeId);
        const time = fieldText(event, "time").trim();
        const placeIds = referencedIds(event, "place");
        const participantIds = referencedIds(event, "participants");
        const place = placeIds
          .map((id) => allEntries.find((entry) => entry.id === id)?.name)
          .filter((name): name is string => Boolean(name));
        const participants = participantIds
          .map((id) => allEntries.find((entry) => entry.id === id)?.name)
          .filter((name): name is string => Boolean(name));
        const refs = [...new Set([...place, ...participants])];
        const selected = event.id === currentEntryId;
        const related = relatedIds.has(event.id);
        const last = index === ordered.length - 1;
        return (
          <div key={event.id} className="relative pl-8">
            <span
              className={[
                "bg-border absolute left-2 w-px",
                index === 0 ? "top-5" : "top-0",
                last ? "bottom-5" : "bottom-0",
              ].join(" ")}
            />
            <span
              className="bg-background absolute top-[15px] left-[3px] size-2.5 rounded-full border-2"
              style={{ borderColor: color }}
            />
            <button
              type="button"
              data-codex-entry={event.id}
              onClick={() => onSelect(event.id)}
              onDoubleClick={() => onEdit(event.id)}
              className={[
                "mb-2.5 w-full rounded-md border px-3 py-2.5 text-left transition-colors",
                event.id === highlightedEntryId ? "jump-highlight" : "",
                selected
                  ? "border-primary/30 bg-accent/45"
                  : related
                    ? "border-border bg-muted/15 hover:bg-accent/30"
                    : "hover:border-foreground/15 hover:bg-accent/25 bg-transparent",
              ].join(" ")}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={[
                    "shrink-0 text-[11px] font-medium tabular-nums",
                    time
                      ? "text-foreground"
                      : "text-amber-700 dark:text-amber-300",
                  ].join(" ")}
                >
                  {time || t("Codex.timeline.unknown")}
                </span>
                <span className="text-muted-foreground/60 ml-auto shrink-0 text-[11px] tabular-nums">
                  {fieldNumber(event, "order") ?? "-"}
                </span>
              </div>
              <div className="mt-1 flex items-start gap-2">
                <span
                  className="mt-[7px] size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color }}>
                    {event.name}
                  </p>
                  <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">
                    {event.summary || event.body || t("Codex.summaryEmpty")}
                  </p>
                </div>
              </div>
              {refs.length ? (
                <div className="mt-2 flex flex-wrap gap-1 pl-3.5">
                  {refs.slice(0, 4).map((name) => (
                    <span
                      key={name}
                      className="bg-muted text-muted-foreground max-w-32 truncate rounded px-1.5 py-0.5 text-[11px]"
                    >
                      {name}
                    </span>
                  ))}
                  {refs.length > 4 ? (
                    <span className="text-muted-foreground/60 px-1 text-[11px]">
                      +{refs.length - 4}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TypeRailItem({
  type,
  count,
  active,
  onClick,
}: {
  type: TypeConfig | null;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const { colorOf } = useCodex();
  const color = type ? colorOf(type.id) : "var(--muted-foreground)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "group flex min-h-9 w-full items-center gap-2 rounded-md border px-2 text-left text-sm transition-colors",
        active
          ? "border-primary/30 bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/55 hover:text-foreground border-transparent",
      ].join(" ")}
    >
      <span
        className="bg-muted/60 flex size-5 shrink-0 items-center justify-center rounded"
        style={{ color }}
      >
        {type ? (
          <TypeGlyph icon={type.icon} className="size-3" />
        ) : (
          <BookOpen className="size-3" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {type ? typeLabel(type, t) : t("Codex.all")}
      </span>
      <span className="text-muted-foreground/60 text-[11px] tabular-nums">
        {count}
      </span>
    </button>
  );
}

function EntryCard({
  entry,
  type,
  selected,
  mentionCount,
  conflict,
  highlighted,
  onSelect,
  onEdit,
}: {
  entry: Entry;
  type: TypeConfig | null;
  selected: boolean;
  mentionCount: number;
  conflict: boolean;
  highlighted: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const { colorOf } = useCodex();
  const color = colorOf(entry.typeId);
  return (
    <button
      type="button"
      data-codex-entry={entry.id}
      onClick={onSelect}
      onDoubleClick={onEdit}
      className={[
        "flex min-h-28 w-full min-w-0 flex-col rounded-md border p-3 text-left transition-colors",
        highlighted ? "jump-highlight" : "",
        selected
          ? "border-primary/30 bg-accent/25"
          : "border-border/50 hover:border-border hover:bg-accent/20 bg-transparent",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0" style={{ color }}>
          <TypeGlyph icon={type?.icon} className="size-4" />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          style={{ color }}
        >
          {entry.name || "-"}
        </span>
        {conflict ? (
          <AlertTriangle
            className="size-3 shrink-0 text-amber-500"
            aria-label={t("Codex.aliasConflict")}
          />
        ) : null}
        <span className="text-muted-foreground/60 shrink-0 text-[11px] tabular-nums">
          {mentionCount} {t("Codex.mentions.short")}
        </span>
      </div>
      <div className="text-muted-foreground mt-1 flex min-w-0 items-center gap-2 pl-6 text-[11px]">
        <span className="truncate">{typeLabel(type, t)}</span>
        {entry.tags.length ? (
          <>
            <span aria-hidden>·</span>
            <span className="truncate">
              {entry.tags.slice(0, 2).join(" / ")}
            </span>
          </>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-2 line-clamp-2 min-h-9 text-xs leading-relaxed">
        {entry.summary || entry.aliases.join(" / ") || t("Codex.summaryEmpty")}
      </p>
    </button>
  );
}

function EntryRow({
  entry,
  type,
  selected,
  mentionCount,
  conflict,
  highlighted,
  onSelect,
  onEdit,
}: {
  entry: Entry;
  type: TypeConfig | null;
  selected: boolean;
  mentionCount: number;
  conflict: boolean;
  highlighted: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const { colorOf } = useCodex();
  return (
    <button
      type="button"
      data-codex-entry={entry.id}
      onClick={onSelect}
      onDoubleClick={onEdit}
      className={[
        LIST_GRID_CLASS,
        "border-border/70 min-h-12 rounded-md border px-3 text-left text-sm transition-colors",
        highlighted ? "jump-highlight" : "",
        selected
          ? "border-primary/30 bg-accent/45"
          : "hover:bg-neutral-100/70 dark:hover:bg-neutral-800/35",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: colorOf(entry.typeId) }}
        />
        <span
          className="truncate font-medium"
          style={{ color: colorOf(entry.typeId) }}
        >
          {entry.name}
        </span>
        {conflict ? (
          <AlertTriangle className="size-3 shrink-0 text-amber-500" />
        ) : null}
      </span>
      <span className="text-muted-foreground hidden truncate text-[13px] sm:block">
        {typeLabel(type, t)}
      </span>
      <span className="text-muted-foreground/75 hidden truncate text-[13px] sm:block">
        {entry.summary || entry.tags.join(" · ") || "-"}
      </span>
      <span className="text-muted-foreground/60 flex min-w-0 items-center justify-end gap-1 overflow-hidden text-[11px] whitespace-nowrap tabular-nums">
        {mentionCount} {t("Codex.mentions.short")}
        <ChevronRight className="size-3 opacity-50" />
      </span>
    </button>
  );
}

function EmptyState({
  filtered,
  onCreate,
  onClear,
}: {
  filtered: boolean;
  onCreate: () => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        {filtered ? (
          <Search className="size-5" />
        ) : (
          <BookOpen className="size-5" />
        )}
      </div>
      <div>
        <p className="text-sm font-medium">
          {filtered ? t("Codex.emptyFiltered") : t("Codex.empty")}
        </p>
        <p className="text-muted-foreground mt-1 max-w-sm text-xs leading-relaxed">
          {filtered ? t("Codex.emptyFilteredHint") : t("Codex.emptyV2Hint")}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={filtered ? "outline" : "default"}
        onClick={filtered ? onClear : onCreate}
      >
        {filtered ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
        {filtered ? t("Codex.clearFilters") : t("Codex.new")}
      </Button>
    </div>
  );
}

export default function CodexLibrary() {
  const { t } = useI18n();
  const toast = useToast();
  const { run: runLongTask } = useLongTask();
  const narrow = useNarrowLayout();
  const {
    entries,
    relations,
    mentions,
    typeConfigs,
    currentEntryId,
    setCurrentEntryId,
    colorOf,
    scanAllMentions,
  } = useCodex();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [createOpen, setCreateOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const { highlightId, jumpTo } = useJumpHighlight("data-codex-entry");

  const current = entries.find((entry) => entry.id === currentEntryId) ?? null;
  const timelineEventType =
    typeConfigs.find((type) => type.id === "event") ?? null;
  const timelineAvailable = Boolean(timelineEventType);

  useEffect(() => {
    if (
      typeFilter !== "all" &&
      !typeConfigs.some((type) => type.id === typeFilter)
    ) {
      setTypeFilter("all");
    }
  }, [typeConfigs, typeFilter]);

  useEffect(() => {
    if (
      viewMode === "timeline" &&
      typeFilter !== "all" &&
      typeFilter !== "event"
    ) {
      setViewMode("grid");
    }
  }, [typeFilter, viewMode]);

  async function scanMentions() {
    if (scanning) return;
    setScanning(true);
    setScanProgress(null);
    try {
      const report = await runLongTask(
        {
          title: t("LongTask.mentionScan.title"),
          description: t("LongTask.mentionScan.description"),
        },
        async (task) =>
          scanAllMentions((progress) => {
            setScanProgress({ done: progress.done, total: progress.total });
            task.update({
              done: progress.done,
              total: progress.total,
              detail: t("Codex.scan.running"),
            });
          })
      );
      if (!report) throw new Error("workspace is unavailable");
      log.info("mention scan completed", report);
      toast.success("Codex.scan.done");
    } catch (err) {
      log.error("mention scan failed", err);
      toast.error("Codex.scan.failed");
    } finally {
      setScanning(false);
      setScanProgress(null);
    }
  }

  const conflictIds = useMemo(() => {
    const owners = new Map<string, Set<string>>();
    for (const entry of entries) {
      for (const word of [entry.name, ...entry.aliases]) {
        const key = word.trim();
        if (!key) continue;
        owners.set(key, new Set([...(owners.get(key) ?? []), entry.id]));
      }
    }
    const conflicts = new Set<string>();
    for (const ids of owners.values()) {
      if (ids.size > 1) {
        for (const id of ids) conflicts.add(id);
      }
    }
    return conflicts;
  }, [entries]);

  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const entry of entries) {
      next.set(entry.typeId, (next.get(entry.typeId) ?? 0) + 1);
    }
    return next;
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = entries.filter((entry) => {
      if (typeFilter !== "all" && entry.typeId !== typeFilter) return false;
      return !needle || entryHaystack(entry).toLowerCase().includes(needle);
    });
    const typeOrder = new Map(typeConfigs.map((type) => [type.id, type.order]));
    result.sort((a, b) => {
      let comparison: number;
      if (sortMode === "updated") {
        comparison = a.updatedAt - b.updatedAt;
      } else if (sortMode === "type") {
        comparison =
          (typeOrder.get(a.typeId) ?? 999) - (typeOrder.get(b.typeId) ?? 999) ||
          a.name.localeCompare(b.name, "zh-Hans-CN");
      } else {
        comparison = a.name.localeCompare(b.name, "zh-Hans-CN");
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });
    return result;
  }, [entries, query, sortDirection, sortMode, typeConfigs, typeFilter]);

  const timelineEvents = useMemo(
    () => filtered.filter((entry) => entry.typeId === "event"),
    [filtered]
  );
  const visibleEntries = viewMode === "timeline" ? timelineEvents : filtered;

  const builtinTypes = typeConfigs.filter((type) => type.builtin);
  const customTypes = typeConfigs.filter((type) => !type.builtin);
  const initialNewType =
    viewMode === "timeline"
      ? "event"
      : typeFilter !== "all"
        ? typeFilter
        : (typeConfigs[0]?.id ?? "");
  const filteredActive = Boolean(query.trim()) || typeFilter !== "all";
  const visibleCount = visibleEntries.length;

  function openCreate() {
    setCreateOpen(true);
  }

  function selectEntry(entryId: string) {
    setCurrentEntryId(entryId);
    if (narrow) setDetailOpen(true);
  }

  function jumpToEntry(entryId: string) {
    const target = entries.find((entry) => entry.id === entryId);
    const targetVisible = filtered.some((entry) => entry.id === entryId);
    const timelineNeedsGrid =
      viewMode === "timeline" && target?.typeId !== "event";
    setCurrentEntryId(entryId);
    if (!targetVisible) {
      setQuery("");
      setTypeFilter("all");
    }
    if (timelineNeedsGrid) setViewMode("grid");
    window.requestAnimationFrame(() => jumpTo(entryId));
  }

  function editEntry(entryId: string | null = currentEntryId) {
    if (!entryId) return;
    setCurrentEntryId(entryId);
    setDetailOpen(true);
  }

  function clearFilters() {
    setQuery("");
    setTypeFilter("all");
  }

  function changeSortMode(value: SortMode) {
    setSortMode(value);
    setSortDirection(value === "updated" ? "desc" : "asc");
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    ) {
      return;
    }
    if (!visibleEntries.length) return;
    const currentIndex = visibleEntries.findIndex(
      (entry) => entry.id === currentEntryId
    );
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowLeft"
    ) {
      event.preventDefault();
      const direction =
        event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1;
      const nextIndex =
        currentIndex < 0
          ? 0
          : (currentIndex + direction + visibleEntries.length) %
            visibleEntries.length;
      setCurrentEntryId(visibleEntries[nextIndex].id);
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(
            `[data-codex-entry="${visibleEntries[nextIndex].id}"]`
          )
          ?.scrollIntoView({ block: "nearest" });
      });
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selectedId = visibleEntries.some(
        (entry) => entry.id === currentEntryId
      )
        ? currentEntryId
        : visibleEntries[0]?.id;
      if (selectedId) editEntry(selectedId);
    }
    if (event.key === "Escape") {
      setDetailOpen(false);
      setCurrentEntryId(null);
    }
  }

  const rail = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto p-2">
        <TypeRailItem
          type={null}
          count={entries.length}
          active={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
        />
        <p className="text-muted-foreground/70 px-2 pt-3 pb-1 text-[11px] font-semibold">
          {t("Codex.type.builtinSection")}
        </p>
        <div className="flex flex-col gap-0.5">
          {builtinTypes.map((type) => (
            <TypeRailItem
              key={type.id}
              type={type}
              count={counts.get(type.id) ?? 0}
              active={typeFilter === type.id}
              onClick={() => setTypeFilter(type.id)}
            />
          ))}
        </div>
        {customTypes.length ? (
          <>
            <p className="text-muted-foreground/70 px-2 pt-3 pb-1 text-[11px] font-semibold">
              {t("Codex.type.customSection")}
            </p>
            <div className="flex flex-col gap-0.5">
              {customTypes.map((type) => (
                <TypeRailItem
                  key={type.id}
                  type={type}
                  count={counts.get(type.id) ?? 0}
                  active={typeFilter === type.id}
                  onClick={() => setTypeFilter(type.id)}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
      <button
        type="button"
        className="text-muted-foreground hover:bg-accent/55 hover:text-foreground flex h-11 shrink-0 items-center gap-2 border-t px-3 text-xs transition-colors"
        onClick={() => setManagerOpen(true)}
      >
        <Settings2 className="size-3.5" />
        {t("Codex.type.manage")}
      </button>
    </div>
  );

  const content = (
    <div
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {narrow ? (
        <div className="scrollbar-app flex shrink-0 items-center gap-1 overflow-x-auto border-b px-3 py-2">
          <button
            type="button"
            aria-pressed={typeFilter === "all"}
            className={[
              "shrink-0 rounded border px-2 py-1 text-sm",
              typeFilter === "all"
                ? "border-primary/30 bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60 border-transparent",
            ].join(" ")}
            onClick={() => setTypeFilter("all")}
          >
            {t("Codex.all")} {entries.length}
          </button>
          <span className="bg-border mx-1 h-4 w-px shrink-0" />
          <span className="text-muted-foreground/70 shrink-0 text-[11px] font-semibold">
            {t("Codex.type.builtinSection")}
          </span>
          {builtinTypes.map((type) => (
            <button
              key={type.id}
              type="button"
              aria-pressed={typeFilter === type.id}
              className={[
                "flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-sm",
                typeFilter === type.id
                  ? "border-primary/30 bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 border-transparent",
              ].join(" ")}
              onClick={() => setTypeFilter(type.id)}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: colorOf(type.id) }}
              />
              {typeLabel(type, t)}
            </button>
          ))}
          {customTypes.length ? (
            <>
              <span className="bg-border mx-1 h-4 w-px shrink-0" />
              <span className="text-muted-foreground/70 shrink-0 text-[11px] font-semibold">
                {t("Codex.type.customSection")}
              </span>
              {customTypes.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  aria-pressed={typeFilter === type.id}
                  className={[
                    "flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-sm",
                    typeFilter === type.id
                      ? "border-primary/30 bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/60 border-transparent",
                  ].join(" ")}
                  onClick={() => setTypeFilter(type.id)}
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: colorOf(type.id) }}
                  />
                  {typeLabel(type, t)}
                </button>
              ))}
            </>
          ) : null}
          <span className="bg-border mx-1 h-4 w-px shrink-0" />
          <button
            type="button"
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex shrink-0 items-center gap-1 rounded px-2 py-1 text-sm"
            onClick={() => setManagerOpen(true)}
          >
            <Settings2 className="size-3" />
            {t("Codex.type.manage")}
          </button>
        </div>
      ) : null}

      <div className="scrollbar-app min-h-0 w-full flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <p className="text-muted-foreground text-sm font-medium">
            {viewMode === "timeline"
              ? typeLabel(timelineEventType, t)
              : typeFilter === "all"
                ? t("Codex.all")
                : typeLabel(
                    typeConfigs.find((type) => type.id === typeFilter),
                    t
                  )}
          </p>
          <span className="text-muted-foreground/60 text-[11px] tabular-nums">
            {visibleCount}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {query ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
                onClick={() => setQuery("")}
              >
                <X className="size-3" />
                {t("Codex.clearSearch")}
              </button>
            ) : null}
            <span className="text-muted-foreground/70 hidden items-center gap-1 text-[11px] sm:flex">
              <MousePointerClick className="size-3.5" />
              {t("Codex.library.doubleClick")}
            </span>
          </div>
        </div>

        {viewMode === "timeline" ? (
          <div className="px-4 pb-8">
            <TimelineView
              events={timelineEvents}
              allEntries={entries}
              relations={relations}
              currentEntryId={currentEntryId}
              highlightedEntryId={highlightId}
              onSelect={selectEntry}
              onEdit={editEntry}
              onCreate={openCreate}
            />
          </div>
        ) : filtered.length ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(215px,1fr))] gap-2.5 px-4 pb-8">
              {filtered.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  type={
                    typeConfigs.find((type) => type.id === entry.typeId) ?? null
                  }
                  selected={entry.id === currentEntryId}
                  mentionCount={mentions[entry.id]?.length ?? 0}
                  conflict={conflictIds.has(entry.id)}
                  highlighted={entry.id === highlightId}
                  onSelect={() => selectEntry(entry.id)}
                  onEdit={() => editEntry(entry.id)}
                />
              ))}
            </div>
          ) : (
            <div className="w-full min-w-0">
              <div className="px-1">
                <div
                  className={[
                    LIST_GRID_CLASS,
                    "text-muted-foreground rounded-md border bg-neutral-100/60 px-3 py-2 text-xs font-medium dark:bg-neutral-800/35",
                  ].join(" ")}
                >
                  <span>{t("Codex.name")}</span>
                  <span className="hidden sm:block">{t("Codex.type")}</span>
                  <span className="hidden sm:block">{t("Codex.summary")}</span>
                  <span className="text-right">
                    {t("Codex.mentions.short")}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1 p-1">
                {filtered.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    type={
                      typeConfigs.find((type) => type.id === entry.typeId) ??
                      null
                    }
                    selected={entry.id === currentEntryId}
                    mentionCount={mentions[entry.id]?.length ?? 0}
                    conflict={conflictIds.has(entry.id)}
                    highlighted={entry.id === highlightId}
                    onSelect={() => selectEntry(entry.id)}
                    onEdit={() => editEntry(entry.id)}
                  />
                ))}
              </div>
            </div>
          )
        ) : (
          <EmptyState
            filtered={filteredActive}
            onCreate={openCreate}
            onClear={clearFilters}
          />
        )}
      </div>
    </div>
  );

  const searchBox = (
    <div
      className={
        narrow ? "relative w-full" : "relative w-[min(20rem,28vw)] min-w-44"
      }
    >
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Input
        value={query}
        placeholder={t("Codex.searchShort")}
        aria-label={t("Codex.search")}
        className="h-9 bg-neutral-100/70 pr-3 pl-9 text-sm dark:bg-neutral-800/35"
        onChange={(event) => setQuery(event.target.value)}
      />
    </div>
  );

  const libraryHeading = (
    <>
      <div
        className={[
          "flex min-w-0 items-center gap-2",
          narrow ? "flex-1" : "",
        ].join(" ")}
      >
        <h1 className="truncate text-lg font-semibold">
          {t("Codex.library.title")}
        </h1>
        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px] tabular-nums">
          {entries.length}
        </span>
      </div>
    </>
  );

  const actionGroups = (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9 px-2.5"
        disabled={scanning || entries.length === 0}
        onClick={() => void scanMentions()}
        aria-label={t("Codex.scan")}
        title={t("Codex.scanHint")}
      >
        {scanning ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Radar className="size-3.5" />
        )}
        <span className="hidden text-xs sm:inline">
          {scanning
            ? scanProgress
              ? `${t("Codex.scan.running")} ${scanProgress.done}/${scanProgress.total}`
              : t("Codex.scan.running")
            : t("Codex.scan")}
        </span>
      </Button>
      <div className="flex items-center rounded-md border bg-neutral-100/60 p-0.5 dark:bg-neutral-800/35">
        <button
          type="button"
          aria-pressed={viewMode === "grid"}
          className={[
            "flex size-7 items-center justify-center rounded border",
            viewMode === "grid"
              ? "border-primary/30 bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground border-transparent",
          ].join(" ")}
          onClick={() => setViewMode("grid")}
          aria-label={t("Codex.view.grid")}
          title={t("Codex.view.grid")}
        >
          <Grid2X2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-pressed={viewMode === "list"}
          className={[
            "flex size-7 items-center justify-center rounded border",
            viewMode === "list"
              ? "border-primary/30 bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground border-transparent",
          ].join(" ")}
          onClick={() => setViewMode("list")}
          aria-label={t("Codex.view.list")}
          title={t("Codex.view.list")}
        >
          <List className="size-3.5" />
        </button>
        {timelineAvailable ? (
          <button
            type="button"
            aria-pressed={viewMode === "timeline"}
            className={[
              "flex size-7 items-center justify-center rounded border",
              viewMode === "timeline"
                ? "border-primary/30 bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground border-transparent",
            ].join(" ")}
            onClick={() => {
              setViewMode("timeline");
              setTypeFilter("event");
            }}
            aria-label={t("Codex.view.timeline")}
            title={t("Codex.view.timeline")}
          >
            <CalendarClock className="size-3.5" />
          </button>
        ) : null}
      </div>

      {viewMode !== "timeline" ? (
        <div className="flex h-9 items-center rounded-md border bg-neutral-100/60 p-0.5 dark:bg-neutral-800/35">
          <Select
            value={sortMode}
            onValueChange={(value) => changeSortMode(value as SortMode)}
          >
            <SelectTrigger
              className={[
                "text-muted-foreground hover:bg-accent/40 data-[state=open]:bg-accent/40 dark:hover:bg-accent/40 h-8 border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent",
                narrow ? "w-9 [&>svg:last-child]:hidden" : "w-40",
              ].join(" ")}
              aria-label={t("Codex.sort")}
              title={t("Codex.sort")}
            >
              {narrow ? (
                <ArrowUpDown className="size-3.5" />
              ) : (
                <>
                  <ArrowUpDown className="size-3.5" />
                  <SelectValue />
                </>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{t("Codex.sort.name")}</SelectItem>
              <SelectItem value="updated">{t("Codex.sort.updated")}</SelectItem>
              <SelectItem value="type">{t("Codex.sort.type")}</SelectItem>
            </SelectContent>
          </Select>
          <span className="bg-border h-4 w-px shrink-0" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground size-8 rounded"
            aria-label={t(
              sortDirection === "asc"
                ? "Codex.sort.switchToDesc"
                : "Codex.sort.switchToAsc"
            )}
            title={t(
              sortDirection === "asc"
                ? "Codex.sort.switchToDesc"
                : "Codex.sort.switchToAsc"
            )}
            onClick={() =>
              setSortDirection((direction) =>
                direction === "asc" ? "desc" : "asc"
              )
            }
          >
            {sortDirection === "asc" ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );

  const createButton = (
    <Button
      type="button"
      size="sm"
      className="h-9 px-3 text-sm"
      onClick={openCreate}
      aria-label={t("Codex.new")}
    >
      <Plus className="size-3.5" />
      <span className="hidden sm:inline">{t("Codex.new")}</span>
    </Button>
  );

  return (
    <div className="bg-background flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="bg-background shrink-0 border-b">
        {narrow ? (
          <>
            <div className="flex h-12 items-center gap-1.5 px-3">
              {libraryHeading}
              <div className="ml-auto shrink-0">{createButton}</div>
            </div>
            <div className="flex items-center gap-2 px-3 pb-2">
              <div className="min-w-0 flex-1">{searchBox}</div>
              {actionGroups}
            </div>
          </>
        ) : (
          <div className="flex h-14 items-center gap-3 px-3">
            {libraryHeading}
            <div className="ml-auto flex min-w-0 items-center gap-2">
              {searchBox}
              {actionGroups}
              {createButton}
            </div>
          </div>
        )}
      </header>

      <div className="flex min-h-0 w-full flex-1">
        {!narrow ? (
          <aside className="w-44 shrink-0 border-r bg-neutral-100/55 dark:bg-neutral-800/35">
            {rail}
          </aside>
        ) : null}
        {narrow ? (
          <div className="min-w-0 flex-1">{content}</div>
        ) : (
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId="codex-library-preview-width"
            className="min-h-0 flex-1"
          >
            <ResizablePanel defaultSize={78} minSize={58}>
              <div className="h-full min-w-0">{content}</div>
            </ResizablePanel>
            <ResizableHandle
              withHandle
              aria-label={t("Codex.preview.resize")}
            />
            <ResizablePanel defaultSize={22} minSize={16} maxSize={24}>
              <aside
                className="h-full bg-neutral-100/45 dark:bg-neutral-800/30"
                aria-label={t("Codex.preview.title")}
              >
                <CodexPreview
                  entry={current}
                  onEdit={() => editEntry()}
                  onSelectEntry={jumpToEntry}
                />
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      <Dialog
        open={detailOpen && Boolean(current)}
        onOpenChange={(open) => {
          setDetailOpen(open);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="bg-background flex h-[min(82vh,780px)] w-[min(1080px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">
            {current?.name || t("Codex.library.title")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("Codex.detail.description")}
          </DialogDescription>
          {current ? (
            <CodexDetail
              key={current.id}
              entry={current}
              onClose={() => setDetailOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <CodexTypeManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        onTypeCreated={(typeId) => {
          setTypeFilter(typeId);
        }}
      />

      <CodexEntryCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        initialTypeId={initialNewType}
        onCreated={(entry) => editEntry(entry.id)}
      />
    </div>
  );
}
