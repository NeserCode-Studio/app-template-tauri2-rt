import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Clock3,
  Eye,
  FileText,
  FolderOpen,
  LibraryBig,
  Loader2,
  MapPin,
  RotateCcw,
  ScanSearch,
  Search,
  Trash2,
} from "lucide-react";
import { toast as sonnerToast } from "sonner";

import SubtreePreview from "@/components/novel/SubtreePreview";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n, useToast } from "@/composables";
import { useLibrary } from "@/contexts/library";
import { useWorkspace } from "@/contexts/workspace";
import { useAppNavigation } from "@/lib/navigation";
import {
  listTrash,
  loadTrashPreview,
  purgeAllFromTrash,
  purgeFromTrash,
  restoreFromTrash,
  type TrashPreview,
  type TrashItem,
  type TrashKind,
} from "@/services/trash";
import { scanAndRepair } from "@/services/workspace";

type TrashFilter = "all" | TrashKind;

const FILTERS: TrashFilter[] = ["all", "work", "volume", "chapter"];

function kindIcon(kind: TrashKind) {
  switch (kind) {
    case "work":
      return BookOpen;
    case "volume":
      return LibraryBig;
    case "chapter":
      return FileText;
    default:
      return FolderOpen;
  }
}

export default function Trash() {
  const { t } = useI18n();
  const toast = useToast();
  const { root, isOpen } = useWorkspace();
  const { works, refresh, bumpDataVersion } = useLibrary();
  const { back } = useAppNavigation();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TrashFilter>("all");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [pendingPurge, setPendingPurge] = useState<TrashItem | null>(null);
  const [pendingPurgeAll, setPendingPurgeAll] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [previewing, setPreviewing] = useState<TrashItem | null>(null);
  const [preview, setPreview] = useState<TrashPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!root) {
      setItems([]);
      return;
    }
    setItems(await listTrash(root));
  }, [root]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const counts = useMemo(() => {
    const next: Record<TrashFilter, number> = {
      all: items.length,
      workspace: 0,
      work: 0,
      volume: 0,
      chapter: 0,
    };
    for (const item of items) next[item.kind] += 1;
    return next;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.kind !== filter) return false;
      return !needle || item.title.toLocaleLowerCase().includes(needle);
    });
  }, [filter, items, query]);

  const volumeChapters = (item: TrashItem): TrashItem["subtree"] =>
    item.subtree
      .filter((node) => node.type === "chapter")
      .sort((left, right) => left.order - right.order);

  const sourceOf = (item: TrashItem): string => {
    if (item.sourceTitle.trim()) return item.sourceTitle;
    if (item.kind === "workspace") return t("Trash.source.workspace");
    if (item.kind === "work") return t("Trash.source.library");
    const work = item.workId ? works[item.workId] : null;
    if (work?.title) return work.title;
    const path = item.originPath.split("/").filter(Boolean).slice(0, 2);
    return path.length ? path.join(" / ") : t(`Trash.kind.${item.kind}`);
  };

  const modifiedAtOf = (item: TrashItem): number =>
    item.modifiedAt ??
    item.node?.updatedAt ??
    item.subtree.reduce(
      (latest, node) => Math.max(latest, node.updatedAt),
      item.deletedAt
    );

  const formatTime = (timestamp: number): string =>
    new Date(timestamp).toLocaleString();

  async function openPreview(item: TrashItem) {
    if (!root) return;
    setPreviewing(item);
    setPreview(null);
    setPreviewLoading(true);
    try {
      setPreview(await loadTrashPreview(root, item.itemId));
    } catch {
      toast.error("Trash.previewFailed");
    } finally {
      setPreviewLoading(false);
    }
  }

  const notifyCount = (
    key: string,
    count: number,
    level: "success" | "error"
  ) => {
    sonnerToast[level](t(key).replace("{count}", String(count)));
  };

  async function restore(item: TrashItem) {
    if (!root || busyItemId) return;
    setBusyItemId(item.itemId);
    try {
      const restored = await restoreFromTrash(root, item.itemId);
      if (!restored) {
        toast.error("Trash.restoreFailed");
        return;
      }
      await refresh();
      bumpDataVersion();
      toast.success("Trash.restored");
      await reload();
    } finally {
      setBusyItemId(null);
    }
  }

  async function purge(item: TrashItem) {
    if (!root || busyItemId) return;
    setBusyItemId(item.itemId);
    try {
      await purgeFromTrash(root, item.itemId);
      setPendingPurge(null);
      toast.success("Trash.purged");
      await reload();
    } finally {
      setBusyItemId(null);
    }
  }

  async function purgeAll() {
    if (!root || busyItemId) return;
    setBusyItemId("all");
    try {
      const count = await purgeAllFromTrash(root);
      setPendingPurgeAll(false);
      notifyCount("Trash.purgedCount", count, "success");
      await reload();
    } finally {
      setBusyItemId(null);
    }
  }

  async function runScan() {
    if (!root || scanning) return;
    setScanning(true);
    try {
      const report = await scanAndRepair(root);
      toast.success("Trash.scanDone");
      if (report.orphans.length) {
        notifyCount("Trash.scanOrphans", report.orphans.length, "success");
      }
      if (report.flagsFixed.length) {
        notifyCount("Trash.scanFlags", report.flagsFixed.length, "success");
      }
      if (report.missing.length) {
        notifyCount("Trash.scanMissing", report.missing.length, "error");
      }
      const recovered = report.recoveredChapters.reduce(
        (sum, work) => sum + work.count,
        0
      );
      if (recovered) {
        notifyCount("Trash.scanRecovered", recovered, "success");
      }
      const dangling = report.danglingChapters.reduce(
        (sum, work) => sum + work.count,
        0
      );
      if (dangling) {
        notifyCount("Trash.scanDangling", dangling, "error");
      }
      if (
        !report.orphans.length &&
        !report.flagsFixed.length &&
        !report.missing.length &&
        !recovered &&
        !dangling
      ) {
        toast.success("Trash.scanClean");
      }
      await refresh();
      bumpDataVersion();
      await reload();
    } catch {
      toast.error("Library.toast.failed");
    } finally {
      setScanning(false);
    }
  }

  if (!isOpen || !root) return null;

  const PreviewIcon = previewing ? kindIcon(previewing.kind) : Trash2;

  return (
    <div className="bg-background flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="shrink-0 px-4 pt-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl items-start gap-4">
          <h1 className="min-w-0 flex-1 text-lg font-semibold">
            {t("Trash.title")}
          </h1>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void runScan()}
              disabled={scanning}
            >
              <ScanSearch className={scanning ? "animate-pulse" : undefined} />
              {t("Trash.scan")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPendingPurgeAll(true)}
              disabled={!items.length || busyItemId !== null}
            >
              <Trash2 />
              {t("Trash.purgeAll")}
            </Button>
            <Button variant="outline" size="sm" onClick={back}>
              {t("Trash.page.back")}
            </Button>
          </div>
        </div>
      </header>

      <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Trash.page.search")}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {FILTERS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={filter === value ? "secondary" : "ghost"}
                  className="h-7"
                  onClick={() => setFilter(value)}
                >
                  {t(
                    value === "all" ? "Trash.filter.all" : `Trash.kind.${value}`
                  )}
                  <span className="text-muted-foreground tabular-nums">
                    {counts[value]}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          {filtered.length ? (
            <ul className="flex flex-col gap-1 pt-1">
              {filtered.map((item) => {
                const Icon = kindIcon(item.kind);
                const chapters = volumeChapters(item);
                const busy = busyItemId === item.itemId;
                return (
                  <li
                    key={item.itemId}
                    className="hover:bg-muted/35 rounded-md px-2 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
                      <span className="bg-muted/60 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
                        <Icon className="text-muted-foreground size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {item.title}
                          </span>
                          <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px]">
                            {t(`Trash.kind.${item.kind}`)}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <MapPin className="size-3 shrink-0 opacity-60" />
                            <span className="truncate">
                              {t("Trash.page.source")}: {sourceOf(item)}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="size-3 opacity-60" />
                            {t("Trash.page.modified")}:{" "}
                            {formatTime(modifiedAtOf(item))}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Trash2 className="size-3 opacity-60" />
                            {t("Trash.page.deleted")}:{" "}
                            {formatTime(item.deletedAt)}
                          </span>
                          {item.kind === "volume" ? (
                            <span>
                              {t("Trash.page.chapterCount").replace(
                                "{count}",
                                String(chapters.length)
                              )}
                            </span>
                          ) : null}
                        </div>
                        {item.preview.trim() ? (
                          <p className="text-muted-foreground/80 mt-1.5 line-clamp-2 text-xs leading-relaxed">
                            {item.preview}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          title={t("Trash.preview")}
                          onClick={() => void openPreview(item)}
                        >
                          <Eye />
                          {t("Trash.preview")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={busy}
                          onClick={() => void restore(item)}
                        >
                          <RotateCcw />
                          {t("Trash.restore")}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive size-7 shrink-0"
                          aria-label={t("Trash.purge")}
                          title={t("Trash.purge")}
                          disabled={busy}
                          onClick={() => setPendingPurge(item)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <Trash2 className="text-muted-foreground/50 size-6" />
              <p className="mt-3 text-sm font-medium">
                {items.length ? t("Trash.page.noMatch") : t("Trash.empty")}
              </p>
              {items.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  {t("Trash.page.clearFilters")}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={previewing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewing(null);
            setPreview(null);
          }
        }}
      >
        <DialogContent className="grid max-h-[min(48rem,90vh)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl">
          {previewing ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex min-w-0 items-center gap-2 pr-6">
                  <PreviewIcon className="size-4 shrink-0" />
                  <span className="truncate">{previewing.title}</span>
                  <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-normal">
                    {t(`Trash.kind.${previewing.kind}`)}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {t("Trash.page.source")}: {sourceOf(previewing)}
                </DialogDescription>
              </DialogHeader>

              <div className="scrollbar-app min-h-0 overflow-y-auto pr-1">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">
                      {t("Trash.page.modified")}
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {formatTime(modifiedAtOf(previewing))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t("Trash.page.deleted")}
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {formatTime(previewing.deletedAt)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">
                      {t("Trash.page.originalPath")}
                    </dt>
                    <dd className="mt-0.5 font-mono break-all">
                      {previewing.originPath || "-"}
                    </dd>
                  </div>
                </dl>

                {preview?.description ? (
                  <p className="text-muted-foreground mt-4 text-sm leading-relaxed whitespace-pre-wrap">
                    {preview.description}
                  </p>
                ) : null}

                {previewing.kind === "volume" ? (
                  <div className="mt-4">
                    <SubtreePreview
                      volume={
                        previewing.subtree.find(
                          (node) => node.type === "volume"
                        ) ?? null
                      }
                      chapters={volumeChapters(previewing)}
                    />
                  </div>
                ) : null}

                {previewing.kind === "work" && preview?.outline.length ? (
                  <div className="mt-4">
                    <h3 className="text-muted-foreground mb-2 text-xs font-medium">
                      {t("Trash.page.workOutline")}
                    </h3>
                    <ul className="flex flex-col gap-1">
                      {preview.outline.map((node) => {
                        const Icon =
                          node.type === "volume" ? LibraryBig : FileText;
                        return (
                          <li
                            key={node.id}
                            className="text-muted-foreground flex items-center gap-2 text-xs"
                          >
                            <Icon className="size-3.5 shrink-0 opacity-60" />
                            <span className="truncate">{node.title}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                {previewLoading ? (
                  <div className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("Trash.page.previewLoading")}
                  </div>
                ) : preview?.body ? (
                  <div className="mt-4">
                    <h3 className="text-muted-foreground mb-2 text-xs font-medium">
                      {t("Trash.page.previewBody")}
                    </h3>
                    <div className="max-h-[45vh] overflow-y-auto text-sm leading-7 whitespace-pre-wrap">
                      {preview.body}
                    </div>
                    {preview.truncated ? (
                      <p className="text-muted-foreground mt-2 text-xs">
                        {t("Trash.page.previewTruncated")}
                      </p>
                    ) : null}
                  </div>
                ) : !previewLoading && !preview?.description ? (
                  <p className="text-muted-foreground mt-4 text-sm">
                    {t("Trash.page.previewEmpty")}
                  </p>
                ) : null}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPreviewing(null);
                    setPreview(null);
                  }}
                >
                  {t("Trash.page.close")}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingPurge !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPurge(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Trash.purge")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Trash.purgeConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("Editor.chapter.cancelRename")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingPurge) void purge(pendingPurge);
              }}
            >
              {t("Trash.purge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingPurgeAll} onOpenChange={setPendingPurgeAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Trash.purgeAll")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Trash.purgeAllConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("Editor.chapter.cancelRename")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void purgeAll()}>
              {t("Trash.purgeAll")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
