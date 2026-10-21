import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookMarked,
  BookOpen,
  Clock3,
  Database,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  Loader2,
  PenLine,
  Pilcrow,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

import WorkCard from "@/components/novel/WorkCard";
import TrashDialog from "@/components/novel/TrashDialog";
import ConfirmDeleteDialog from "@/components/framework/ConfirmDeleteDialog";
import ImportDialog, {
  type ImportPreview,
} from "@/components/novel/ImportDialog";
import { useI18n, useToast } from "@/composables";
import { useLibrary } from "@/contexts/library";
import { useWorkspace } from "@/contexts/workspace";
import { useLongTask } from "@/contexts/long-task";
import { loadStats, recordWorkWords } from "@/services/stats";
import {
  countWorkWords,
  createChapter,
  reparagraphWork,
  type ReparagraphProgress,
} from "@/services/chapter";
import {
  appendCardsToChapter,
  importTitleFromPath,
  saveImportSections,
} from "@/services/import";
import { addNode as addOutlineNode } from "@/services/outline";
import { createLogger } from "@/lib/logger";
import { navigationStateOf, useAppNavigation } from "@/lib/navigation";
import type { Work } from "@/shared/schema";

const log = createLogger("Library");

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function workspaceNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || path;
}

/** 新建与书本设置共用同一套字段，减少两处表单逐渐漂移。 */
type DialogMode =
  { kind: "create" } | { kind: "settings"; workId: string } | null;

export default function Library() {
  const { t } = useI18n();
  const toast = useToast();
  const { run: runLongTask } = useLongTask();
  const { go } = useAppNavigation();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    root,
    isOpen,
    reveal,
    pickMigrationTarget,
    migrate,
    deleteWorkspace,
  } = useWorkspace();
  const {
    workspace,
    works,
    currentWorkId,
    create,
    updateWork,
    archive,
    unarchive,
    remove,
    refresh,
    bumpDataVersion,
    setWorkspaceAlias,
    setCurrentWorkId,
  } = useLibrary();

  const [dialog, setDialog] = useState<DialogMode>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [autoParagraph, setAutoParagraph] = useState(true);
  const [confirmReparagraph, setConfirmReparagraph] = useState(false);
  const [reparagraping, setReparagraping] = useState(false);
  const [reparagraphProgress, setReparagraphProgress] =
    useState<ReparagraphProgress | null>(null);
  const [pendingArchive, setPendingArchive] = useState<string | null>(null);
  /** 待输入确认删除的作品 / 工作区。 */
  const [pendingWorkDelete, setPendingWorkDelete] = useState<string | null>(
    null
  );
  const [pendingWorkspaceDelete, setPendingWorkspaceDelete] = useState<
    string | null
  >(null);
  const [pendingMigration, setPendingMigration] = useState<string | null>(null);
  /** 工作区别名的待确认新值：改名与"保存设置"不是一回事。 */
  const [pendingAlias, setPendingAlias] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aliasName, setAliasName] = useState("");
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({});
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const createRequested =
    navigationStateOf(location.state).intent === "create-work";
  const legacyMaterialsView =
    new URLSearchParams(location.search).get("view") === "materials";
  const workspaceDisplayName =
    workspace?.alias?.trim() ||
    (root ? workspaceNameFromPath(root) : t("Library.title"));
  const worksRef = useRef(works);
  const workspaceRef = useRef(workspace);
  worksRef.current = works;
  workspaceRef.current = workspace;

  /** 统计字数：阶段 2 先从 stats.json 读取，阶段 6 再做实时更新。 */
  const loadWordCounts = useCallback(
    async (
      onProgress?: (progress: {
        done: number;
        total: number;
        title?: string;
      }) => void
    ) => {
      const currentWorkspace = workspaceRef.current;
      const currentWorks = worksRef.current;
      if (!root || !currentWorkspace) return;
      const next: Record<string, number> = {};
      const ids = [...currentWorkspace.order, ...currentWorkspace.archived];
      for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index];
        const title = currentWorks[id]?.title ?? id;
        onProgress?.({ done: index, total: ids.length, title });
        try {
          const stats = await loadStats(root, id);
          /*
           * stats.json 只是缓存；以磁盘上的章文件为准全量重算。
           * 早期版本从未写过 stats，或统计早已与正文脱节，
           * 直接信 stats 会让作品库长期显示 0。
           */
          const fromChapters = await countWorkWords(
            root,
            id,
            (chapterProgress) => {
              const fraction =
                chapterProgress.total > 0
                  ? chapterProgress.done / chapterProgress.total
                  : 0;
              onProgress?.({
                done: index + fraction,
                total: ids.length,
                title: chapterProgress.title
                  ? `${title} · ${chapterProgress.title}`
                  : title,
              });
            }
          );
          next[id] = fromChapters || stats.workWords[id] || 0;
          if (fromChapters !== (stats.workWords[id] ?? 0)) {
            /* 回写修正，让下次打开不必重算。 */
            await recordWorkWords(root, id, fromChapters).catch(
              () => undefined
            );
          }
        } catch (err) {
          log.warn("stats unreadable", id, err);
          next[id] = 0;
        }
      }
      onProgress?.({ done: ids.length, total: ids.length });
      setWordCounts(next);
    },
    [root]
  );

  // 作品清单变化时刷新字数。
  const orderKey = workspace
    ? [...workspace.order, ...workspace.archived].join(",")
    : "";
  useEffect(() => {
    void runLongTask(
      {
        title: t("LongTask.library.title"),
        description: t("LongTask.library.description"),
      },
      async (task) => {
        await loadWordCounts((progress) =>
          task.update({
            done: progress.done,
            total: progress.total,
            detail: progress.title,
          })
        );
      }
    ).catch((err) => log.error("word count refresh failed", err));
  }, [loadWordCounts, orderKey, runLongTask, t]);

  useEffect(() => {
    if (!isOpen || !root) {
      go("home", { replace: true, transition: "back" });
    }
  }, [go, isOpen, root]);

  useEffect(() => {
    if (legacyMaterialsView) go("codex", { replace: true });
  }, [go, legacyMaterialsView]);

  /*
   * 设置弹窗可能比 LibraryProvider 更早拿到 workspace 数据。
   * 仅依赖“打开弹窗”那一刻初始化，会让名称一直停在空字符串；
   * 这里跟随加载完成后的显示名补齐。
   */
  useEffect(() => {
    if (settingsOpen) setAliasName(workspaceDisplayName);
  }, [settingsOpen, workspaceDisplayName]);

  useEffect(() => {
    if (!createRequested) return;
    setName("");
    setType("");
    setSynopsis("");
    setAutoParagraph(true);
    setConfirmReparagraph(false);
    setDialog({ kind: "create" });
    /*
     * 消费一次性跳转意图，避免用户关闭新建框后通过浏览器前进/后退
     * 再次打开它；保留来源页和动画方向，返回语义不因此丢失。
     */
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: {
        ...navigationStateOf(location.state),
        intent: undefined,
      },
    });
  }, [
    createRequested,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);

  const active = useMemo<Work[]>(() => {
    if (!workspace) return [];
    const list: Work[] = [];
    for (const id of workspace.order) {
      const w = works[id];
      if (w) list.push(w);
    }
    return list;
  }, [workspace, works]);

  const archived = useMemo<Work[]>(() => {
    if (!workspace) return [];
    return workspace.archived
      .map((id) => works[id])
      .filter((w): w is Work => Boolean(w));
  }, [workspace, works]);

  const totalWords = useMemo(
    () => active.reduce((sum, work) => sum + (wordCounts[work.id] ?? 0), 0),
    [active, wordCounts]
  );

  const lastUpdatedAt = useMemo(
    () => active.reduce((latest, work) => Math.max(latest, work.updatedAt), 0),
    [active]
  );

  const focusWork = useMemo(
    () =>
      active.find((work) => work.id === currentWorkId) ??
      [...active].sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
      null,
    [active, currentWorkId]
  );

  /** 提交新建 / 重命名。 */
  async function submitDialog() {
    if (!dialog) return;
    const title = name.trim();
    if (!title) return;
    try {
      if (dialog.kind === "create") {
        const created = await create(
          title,
          type.trim(),
          synopsis.trim(),
          autoParagraph
        );
        if (!created) {
          toast.error("Library.toast.failed");
          return;
        }
        toast.success("Library.toast.created");
      } else {
        const updated = await updateWork(dialog.workId, {
          title,
          type: type.trim(),
          synopsis: synopsis.trim(),
          autoParagraph,
        });
        if (!updated) {
          toast.error("Library.toast.failed");
          return;
        }
        toast.success("Library.toast.settingsSaved");
      }
      setDialog(null);
    } catch (err) {
      log.error("dialog submit failed", err);
      toast.error("Library.toast.failed");
    }
  }

  /** 打开新建对话框。 */
  function openCreate() {
    setName("");
    setType("");
    setSynopsis("");
    setAutoParagraph(true);
    setConfirmReparagraph(false);
    setDialog({ kind: "create" });
  }

  /** 打开书本设置。 */
  function openWorkSettings(workId: string) {
    const w = works[workId];
    setName(w?.title ?? "");
    setType(w?.type ?? "");
    setSynopsis(w?.synopsis ?? "");
    setAutoParagraph(w?.autoParagraph ?? true);
    setConfirmReparagraph(false);
    setReparagraphProgress(null);
    setDialog({ kind: "settings", workId });
  }

  /** 对当前作品执行一次显式的全书段落整理。 */
  async function runReparagraph() {
    if (dialog?.kind !== "settings" || !root || reparagraping) return;
    setConfirmReparagraph(false);
    setReparagraping(true);
    setReparagraphProgress(null);
    try {
      const report = await runLongTask(
        {
          title: t("LongTask.reparagraph.title"),
          description: t("LongTask.reparagraph.description"),
        },
        async (task) => {
          const next = await reparagraphWork(
            root,
            dialog.workId,
            (progress) => {
              setReparagraphProgress(progress);
              task.update({
                done: progress.done,
                total: progress.total,
                detail: progress.title,
              });
            }
          );
          await loadWordCounts();
          return next;
        }
      );
      bumpDataVersion();
      log.info("work reparagraphed from settings", {
        workId: dialog.workId,
        ...report,
      });
      toast.success("Library.toast.reparagraphed");
    } catch (err) {
      log.error("work reparagraph failed", {
        workId: dialog.workId,
        err,
      });
      toast.error("Library.toast.reparagraphFailed");
    } finally {
      setReparagraping(false);
      setReparagraphProgress(null);
    }
  }

  /**
   * 导入为新作品。
   *
   * 先创建作品和章文件，再把预览中已经确认的卡片一次追加进章，
   * 最后登记结构树。导入标题取自文件名，避免让用户在一个流程里
   * 同时填写标题、类型、章节名等与“先看看正文是否正确”无关的字段。
   */
  async function importWork(preview: ImportPreview) {
    if (!root) throw new Error("workspace is unavailable");
    const title =
      preview.title.trim() ||
      importTitleFromPath(preview.path).trim() ||
      t("Import.untitledWork");
    await runLongTask(
      {
        title: t("LongTask.import.title"),
        description: t("LongTask.import.description"),
      },
      async (task) => {
        const work = await create(
          title,
          "",
          preview.synopsis.trim(),
          preview.autoParagraph
        );
        if (!work) throw new Error("could not create imported work");

        const structured =
          preview.sections.length > 1 ||
          preview.volumes.length > 0 ||
          preview.sections.some(
            (section) => section.title || section.volumeTitle
          );
        if (structured) {
          await saveImportSections(
            root,
            work.id,
            preview.sections,
            {
              front: t("Import.frontMatter"),
              untitled: t("Import.untitledSection"),
            },
            {
              volumes: preview.volumes,
              onProgress: (progress) => {
                task.update({
                  done: progress.done,
                  total: progress.total,
                  detail: `${t(
                    progress.phase === "index"
                      ? "LongTask.import.index"
                      : "LongTask.import.chapters"
                  )}${progress.title ? ` · ${progress.title}` : ""}`,
                });
              },
            }
          );
        } else {
          const chapterTitle = t("Import.defaultChapter");
          const created = await createChapter(root, work.id, chapterTitle);
          const imported = await appendCardsToChapter(
            root,
            work.id,
            created,
            preview.cards
          );
          await addOutlineNode(root, work.id, {
            type: "chapter",
            title: chapterTitle,
            parentId: null,
            id: imported.id,
          });
        }
        await recordWorkWords(
          root,
          work.id,
          await countWorkWords(root, work.id)
        );
        /* 作品库创建作品会立刻切换 currentWorkId，结构树可能已先读过空文件。 */
        bumpDataVersion();
        toast.success("Import.toast.imported");
        go("editor");
      }
    );
  }

  /**
   * 提交工作区别名。
   *
   * 从"无别名"改成"有别名"要确认一次：页面顶部的上下文名称会变化。
   * 作品库自身的标题保持稳定，工作区别名只描述当前打开的是哪个库。
   */
  function requestAliasSave() {
    const from = workspaceDisplayName.trim();
    const to = aliasName.trim();
    if (!to || from === to) return;
    setPendingAlias({ from, to });
  }

  if (!isOpen || !root) return null;

  /* ---------- 已选择工作区 ---------- */
  return (
    <div className="view-library scrollbar-app bg-background h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-9 sm:px-8">
        <header className="border-border/70 border-b pb-7">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="row-label">
                <BookMarked className="icon-sm" />
                {t("Library.title")}
              </div>
              <h1 className="mt-2 min-w-0 truncate text-2xl font-semibold">
                {workspaceDisplayName}
              </h1>
              <div
                className="text-muted-foreground mt-2 flex min-w-0 items-center gap-2 text-xs"
                title={root}
              >
                <Folder className="icon-sm shrink-0 opacity-60" />
                <span className="truncate">{root}</span>
              </div>
            </div>

            <dl className="grid shrink-0 grid-cols-3 gap-5 lg:min-w-[25rem] lg:border-l lg:pl-7">
              <div>
                <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <BookMarked className="icon-sm opacity-60" />
                  {t("Home.activeWorks")}
                </dt>
                <dd className="mt-2 text-xl font-semibold tabular-nums">
                  {active.length}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <FileText className="icon-sm opacity-60" />
                  {t("Library.summary.words")}
                </dt>
                <dd className="mt-2 text-xl font-semibold tabular-nums">
                  {totalWords.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <Clock3 className="icon-sm opacity-60" />
                  {t("Library.summary.updated")}
                </dt>
                <dd className="mt-2 text-sm font-medium tabular-nums">
                  {lastUpdatedAt ? formatDate(lastUpdatedAt) : "-"}
                </dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="border-border/70 flex flex-wrap items-center gap-2 border-b py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="icon-md" />
            {t("Library.action.workspaceSettings")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => go("codex")}>
            <Database className="icon-md" />
            {t("Codex.library.title")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTrashOpen(true)}>
            <Trash2 className="icon-md" />
            {t("Trash.title")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
            <FileUp className="icon-md" />
            {t("Import.action")}
          </Button>
          <Button className="sm:ml-auto" size="sm" onClick={openCreate}>
            <Plus className="icon-md" />
            {t("Library.action.new")}
          </Button>
        </div>

        {focusWork ? (
          <section className="mt-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="row-label">
                <PenLine className="icon-sm" />
                {t("Home.continue")}
              </div>
              <h2 className="mt-3 truncate text-xl font-semibold">
                {focusWork.title}
              </h2>
              <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {focusWork.type ? <span>{focusWork.type}</span> : null}
                {focusWork.type ? <span aria-hidden>·</span> : null}
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="size-3" />
                  {t("Home.updated")} {formatDate(focusWork.updatedAt)}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setCurrentWorkId(focusWork.id);
                  go("editor");
                }}
              >
                <BookOpen className="icon-md" />
                {t("Library.action.continue")}
              </Button>
              <Button variant="outline" onClick={() => go("codex")}>
                <Database className="icon-md" />
                {t("Codex.library.title")}
              </Button>
            </div>
          </section>
        ) : null}

        {active.length ? (
          <section className="mt-8 w-full">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="row-label">{t("Library.section.works")}</h2>
              <span className="text-muted-foreground/60 text-[11px] tabular-nums">
                {active.length}
                {archived.length
                  ? ` / ${archived.length} ${t("Home.archivedWorks")}`
                  : ""}
              </span>
            </div>
            <div className="divide-border/70 border-border/70 flex flex-col divide-y border-y">
              {active.map((work) => (
                <WorkCard
                  key={work.id}
                  work={work}
                  words={wordCounts[work.id] ?? 0}
                  isCurrent={currentWorkId === work.id}
                  onOpen={(id) => {
                    setCurrentWorkId(id);
                    go("editor");
                  }}
                  onSettings={openWorkSettings}
                  onArchive={setPendingArchive}
                  onDelete={setPendingWorkDelete}
                  onUnarchive={(id) => {
                    void unarchive(id)
                      .then(() => toast.success("Library.toast.unarchived"))
                      .catch(() => toast.error("Library.toast.failed"));
                  }}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="border-border/70 mt-8 flex w-full flex-col items-center gap-3 border-y py-12 text-center">
            <BookMarked className="text-muted-foreground/40 h-10 w-10" />
            <p className="text-muted-foreground text-sm">
              {t("Library.empty.noWorksHint")}
            </p>
            <Button size="sm" onClick={openCreate}>
              <Plus className="icon-md" />
              {t("Library.action.new")}
            </Button>
          </section>
        )}

        {archived.length ? (
          <section className="mt-10 w-full">
            <h2 className="row-label mb-3">{t("Library.empty.archived")}</h2>
            <div className="divide-border/70 border-border/70 flex flex-col divide-y border-y">
              {archived.map((work) => (
                <WorkCard
                  key={work.id}
                  work={work}
                  words={wordCounts[work.id] ?? 0}
                  isCurrent={false}
                  onOpen={() => undefined}
                  onSettings={openWorkSettings}
                  onArchive={setPendingArchive}
                  onDelete={setPendingWorkDelete}
                  onUnarchive={(id) => {
                    void unarchive(id)
                      .then(() => toast.success("Library.toast.unarchived"))
                      .catch(() => toast.error("Library.toast.failed"));
                  }}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* 新建 / 书本设置共用一个对话框。 */}
        <ImportDialog
          open={importOpen}
          target="work"
          onOpenChange={setImportOpen}
          onConfirm={importWork}
        />

        <Dialog
          open={dialog !== null}
          onOpenChange={(openState) => {
            if (!openState && !reparagraping) {
              setConfirmReparagraph(false);
              setDialog(null);
            }
          }}
        >
          <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {dialog?.kind === "settings"
                  ? t("Library.dialog.settingsTitle")
                  : t("Library.dialog.newTitle")}
              </DialogTitle>
              <DialogDescription>
                {dialog?.kind === "settings"
                  ? t("Library.dialog.settingsDesc")
                  : t("Library.dialog.newDesc")}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="work-name">
                  {t("Library.dialog.nameLabel")}
                </Label>
                <Input
                  id="work-name"
                  value={name}
                  autoFocus
                  placeholder={t("Library.dialog.namePlaceholder")}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.nativeEvent.isComposing &&
                      !reparagraping
                    ) {
                      void submitDialog();
                    }
                  }}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="work-type">
                  {t("Library.dialog.typeLabel")}
                </Label>
                <Input
                  id="work-type"
                  value={type}
                  placeholder={t("Library.dialog.typePlaceholder")}
                  onChange={(e) => setType(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="work-synopsis">
                  {t("Library.dialog.synopsisLabel")}
                </Label>
                <Textarea
                  id="work-synopsis"
                  value={synopsis}
                  rows={4}
                  placeholder={t("Library.dialog.synopsisPlaceholder")}
                  onChange={(e) => setSynopsis(e.target.value)}
                />
              </div>

              <div className="border-border/70 flex flex-col gap-3 border-t pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <Label htmlFor="work-auto-paragraph">
                      {t("Library.dialog.autoParagraphLabel")}
                    </Label>
                    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                      {t("Library.dialog.autoParagraphHint")}
                    </p>
                  </div>
                  <Switch
                    id="work-auto-paragraph"
                    checked={autoParagraph}
                    disabled={reparagraping}
                    onCheckedChange={setAutoParagraph}
                  />
                </div>

                {dialog?.kind === "settings" ? (
                  <div className="flex flex-col gap-2">
                    {confirmReparagraph ? (
                      <div className="border-border/70 bg-muted/20 flex flex-col gap-3 rounded-md border p-3">
                        <p className="text-xs leading-relaxed">
                          {t("Library.dialog.reparagraphConfirm")}
                        </p>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmReparagraph(false)}
                          >
                            {t("Library.dialog.cancel")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void runReparagraph()}
                          >
                            <Pilcrow className="icon-sm" />
                            {t("Library.dialog.reparagraphStart")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="justify-start"
                        disabled={reparagraping}
                        onClick={() => setConfirmReparagraph(true)}
                      >
                        <Pilcrow className="icon-sm" />
                        {t("Library.dialog.reparagraph")}
                      </Button>
                    )}
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {reparagraping
                        ? reparagraphProgress
                          ? `${t("Library.dialog.reparagraphing")} ${reparagraphProgress.done}/${reparagraphProgress.total}`
                          : t("Library.dialog.reparagraphPreparing")
                        : t("Library.dialog.reparagraphHint")}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                disabled={reparagraping}
                onClick={() => setDialog(null)}
              >
                {t("Library.dialog.cancel")}
              </Button>
              <Button
                onClick={() => void submitDialog()}
                disabled={!name.trim() || reparagraping}
              >
                {reparagraping ? (
                  <Loader2 className="icon-sm animate-spin" />
                ) : null}
                {dialog?.kind === "settings"
                  ? t("Library.dialog.save")
                  : t("Library.dialog.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 归档确认 */}
        <TrashDialog
          open={trashOpen}
          root={root}
          onOpenChange={setTrashOpen}
          onRestored={() => {
            /*
             * 恢复后必须重读清单，不能只刷字数。
             *
             * 原先这里只调 loadWordCounts()，而它是按 workspace.order /
             * workspace.archived 遍历的——恢复一部作品时清单刚变，React 里的
             * workspace 还是旧的，那个 id 根本不在遍历范围里，于是既不显示
             * 也不报错，看上去就是"恢复没反应"。refresh() 会重读
             * novels-yes.json 与各 work.json，字数随后由 orderKey 的 effect 补上。
             */
            void refresh();
            /*
             * refresh() 只更新作品库自己的状态。结构树 provider 挂在另一个
             * context 上，它只在 [root, currentWorkId] 变化时重读 outline.json，
             * 不通知它就继续拿着"已删除"的旧快照——于是恢复完当场看不见，
             * 刷新页面才出现。bump 一下版本号让它跟着重载。
             */
            bumpDataVersion();
          }}
        />

        {/*
         * 工作区设置。
         *
         * 收纳与"这个库本身"有关的事：目录在哪、显示名是什么、
         * 迁移目录、删掉整个库。原先路径挂在标题下方、指向的却是
         * "换工作区"，与用户看到的东西名不副实——路径的信息属于设置。
         */}
        <Dialog
          open={settingsOpen}
          onOpenChange={(openState) => {
            setSettingsOpen(openState);
            if (openState) setAliasName(workspaceDisplayName);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("Library.workspace.settings")}</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label>{t("Library.workspace.dirLabel")}</Label>
                <div className="flex items-center gap-2">
                  <span className="bg-muted/30 text-muted-foreground min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 text-sm">
                    {root}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    onClick={() => void reveal()}
                    title={t("Library.workspace.openDir")}
                    aria-label={t("Library.workspace.openDir")}
                  >
                    <Folder className="icon-md" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="workspace-alias">
                  {t("Library.workspace.aliasLabel")}
                </Label>
                {/*
                 * 保存与取消紧贴输入框，不放到底部 DialogFooter。
                 *
                 * 这个弹窗里还有"迁移工作区""删除工作区"两组按钮，
                 * 它们与改名无关，却会被底部的取消/保存隔开一整屏：
                 * 用户改完名字要往下扫过两个不相干的按钮才找到保存，
                 * 眼睛很自然会把"删除工作区"当成保存路径上的一个选项。
                 * 改名是个就地完成的动作，控件就该贴着它作用的对象。
                 */}
                <div className="flex items-center gap-2">
                  <Input
                    id="workspace-alias"
                    value={aliasName}
                    placeholder={t("Library.workspace.aliasPlaceholder")}
                    onChange={(e) => setAliasName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        requestAliasSave();
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => {
                      setAliasName(workspaceDisplayName);
                      setSettingsOpen(false);
                    }}
                  >
                    {t("Library.dialog.cancel")}
                  </Button>
                  <Button
                    className="shrink-0"
                    disabled={
                      !aliasName.trim() ||
                      aliasName.trim() === workspaceDisplayName.trim()
                    }
                    onClick={requestAliasSave}
                  >
                    {t("Library.dialog.save")}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => {
                    setSettingsOpen(false);
                    void pickMigrationTarget()
                      .then((target) => {
                        if (target) setPendingMigration(target);
                      })
                      .catch((err) => {
                        log.error("workspace migration target pick failed", {
                          root,
                          err,
                        });
                        toast.error("Library.workspace.migrateFailed");
                      });
                  }}
                >
                  <FolderOpen className="icon-md" />
                  {t("Library.workspace.migrate")}
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive justify-start"
                  onClick={() => {
                    setSettingsOpen(false);
                    setPendingWorkspaceDelete(root);
                  }}
                >
                  <Trash2 className="icon-md" />
                  {t("Library.action.deleteWorkspace")}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
                {t("Library.dialog.close")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog
          open={pendingArchive !== null}
          onOpenChange={(openState) => {
            if (!openState) setPendingArchive(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("Library.action.confirmArchive")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("Library.action.archiveDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("Library.dialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (!pendingArchive) return;
                  const id = pendingArchive;
                  setPendingArchive(null);
                  void archive(id)
                    .then(() => toast.success("Library.toast.archived"))
                    .catch(() => toast.error("Library.toast.failed"));
                }}
              >
                {t("Library.action.archive")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/*
         * 作品删除：输入标题确认。
         *
         * 删除按钮就贴在"继续写作"右侧，两者只隔一个手指宽，
         * 普通确认框只能挡住手快，挡不住"没看清在删什么"。
         * 要求打一遍标题等于强迫用户读它一遍。
         */}
        <ConfirmDeleteDialog
          open={pendingWorkDelete !== null}
          title={
            pendingWorkDelete
              ? (works[pendingWorkDelete]?.title ?? pendingWorkDelete)
              : ""
          }
          confirmText={
            pendingWorkDelete
              ? (works[pendingWorkDelete]?.title ?? pendingWorkDelete)
              : ""
          }
          description={t("Library.action.deleteWorkDesc")}
          onOpenChange={(o) => {
            if (!o) setPendingWorkDelete(null);
          }}
          onConfirm={() => {
            if (!pendingWorkDelete) return;
            const id = pendingWorkDelete;
            setPendingWorkDelete(null);
            void remove(id)
              .then(() => toast.success("Library.toast.deleted"))
              .catch(() => toast.error("Library.toast.failed"));
          }}
        />

        {/*
         * 工作区删除。
         *
         * 校验键用目录名而不是别名：目录名是磁盘上的真实地址，
         * 打错一位就通不过，比让用户打一个自己刚起的显示名更可靠。
         */}
        <ConfirmDeleteDialog
          open={pendingWorkspaceDelete !== null}
          title={pendingWorkspaceDelete ?? root ?? ""}
          confirmText={pendingWorkspaceDelete ?? root ?? ""}
          description={t("Library.workspace.deleteDesc")}
          onOpenChange={(o) => {
            if (!o) setPendingWorkspaceDelete(null);
          }}
          onConfirm={() => {
            setPendingWorkspaceDelete(null);
            void runLongTask(
              {
                title: t("LongTask.workspace.delete.title"),
                description: t("LongTask.workspace.delete.description"),
              },
              async () => deleteWorkspace()
            )
              .then(() => toast.success("Library.workspace.deleteDone"))
              .catch(() => toast.error("Library.workspace.deleteFailed"));
          }}
        />

        {/* 工作区迁移：目标目录必须为空，确认后才移动全部数据。 */}
        <AlertDialog
          open={pendingMigration !== null}
          onOpenChange={(openState) => {
            if (!openState) setPendingMigration(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("Library.workspace.migrateTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription className="flex flex-col gap-2">
                <span>{t("Library.workspace.migrateDesc")}</span>
                <span className="text-foreground font-medium break-all">
                  {pendingMigration}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("Library.dialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (!pendingMigration) return;
                  const target = pendingMigration;
                  setPendingMigration(null);
                  void runLongTask(
                    {
                      title: t("LongTask.workspace.migrate.title"),
                      description: t("LongTask.workspace.migrate.description"),
                    },
                    async () => migrate(target)
                  )
                    .then((result) => {
                      if (result.sourceRemoved) {
                        toast.success("Library.workspace.migrateDone");
                      } else {
                        toast.warning("Library.workspace.migrateSourceKept");
                      }
                    })
                    .catch(() =>
                      toast.error("Library.workspace.migrateFailed")
                    );
                }}
              >
                {t("Library.workspace.migrateAction")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 工作区更名确认：标题是页面级变化，值得问一句。 */}
        <AlertDialog
          open={pendingAlias !== null}
          onOpenChange={(o) => {
            if (!o) setPendingAlias(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("Library.workspace.renameTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription className="flex flex-col gap-1">
                <span>{t("Library.workspace.renameDesc")}</span>
                <span className="text-foreground font-medium">
                  {pendingAlias?.from || workspaceDisplayName}
                </span>
                <span>{t("Library.workspace.renameTo")}</span>
                <span className="text-foreground font-medium">
                  {pendingAlias?.to}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("Library.dialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (!pendingAlias) return;
                  const next = pendingAlias.to;
                  setPendingAlias(null);
                  setSettingsOpen(false);
                  void setWorkspaceAlias(next).catch((err) => {
                    log.error("workspace alias save failed", {
                      root,
                      next,
                      err,
                    });
                    toast.error("Library.toast.failed");
                  });
                }}
              >
                {t("Library.dialog.save")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
