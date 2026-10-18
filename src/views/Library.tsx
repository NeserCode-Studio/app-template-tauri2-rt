import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookMarked,
  Database,
  FileUp,
  FolderOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";
/* 别名：避免与 useWorkspace() 的 open（打开工作区）混淆。 */
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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

import WorkCard from "@/components/novel/WorkCard";
import TrashDialog from "@/components/novel/TrashDialog";
import { useI18n, useToast } from "@/composables";
import { useLibrary } from "@/contexts/library";
import { useWorkspace } from "@/contexts/workspace";
import { loadStats, recordWorkWords } from "@/services/stats";
import { countWorkWords } from "@/services/chapter";
import { createLogger } from "@/lib/logger";
import type { Work } from "@/shared/schema";

const log = createLogger("Library");

/** 新建 / 重命名对话框的两种模式。 */
type DialogMode =
  | { kind: "create" }
  | { kind: "rename"; workId: string }
  | { kind: "alias"; workId: string }
  | { kind: "import"; path: string; suggestedTitle: string }
  | null;

export default function Library() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { root, recent, isOpen, pick, open } = useWorkspace();
  const {
    workspace,
    works,
    currentWorkId,
    create,
    rename,
    setAlias,
    archive,
    unarchive,
    remove,
    importFromFile,
    setCurrentWorkId,
  } = useLibrary();

  const [dialog, setDialog] = useState<DialogMode>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  /** 导入时的卷名 / 章节名：外部 txt 是扁平文本，骨架名让用户自己定。 */
  const [volumeName, setVolumeName] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [pendingArchive, setPendingArchive] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [wordCounts, setWordCounts] = useState<Record<string, number>>({});
  const [trashOpen, setTrashOpen] = useState(false);

  /** 统计字数：阶段 2 先从 stats.json 读取，阶段 6 再做实时更新。 */
  const loadWordCounts = useCallback(async () => {
    if (!root || !workspace) return;
    const next: Record<string, number> = {};
    for (const id of [...workspace.order, ...workspace.archived]) {
      try {
        const stats = await loadStats(root, id);
        /*
         * stats.json 只是缓存；以磁盘上的章文件为准全量重算。
         * 早期版本从未写过 stats，或统计早已与正文脱节，
         * 直接信 stats 会让作品库长期显示 0。
         */
        const fromChapters = await countWorkWords(root, id);
        next[id] = fromChapters || stats.workWords[id] || 0;
        if (fromChapters !== (stats.workWords[id] ?? 0)) {
          /* 回写修正，让下次打开不必重算。 */
          await recordWorkWords(root, id, fromChapters).catch(() => undefined);
        }
      } catch (err) {
        log.warn("stats unreadable", id, err);
        next[id] = 0;
      }
    }
    setWordCounts(next);
  }, [root, workspace]);

  // 作品清单变化时刷新字数。
  const orderKey = workspace ? [...workspace.order, ...workspace.archived].join(",") : "";
  useEffect(() => {
    void loadWordCounts();
  }, [loadWordCounts, orderKey]);

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

  /** 提交新建 / 重命名。 */
  async function submitDialog() {
    if (!dialog) return;
    const title = name.trim();
    try {
      if (dialog.kind === "create") {
        if (!title) return;
        const created = await create(title, type.trim());
        if (!created) {
          toast.error("Library.toast.failed");
          return;
        }
        toast.success("Library.toast.created");
      } else if (dialog.kind === "rename") {
        if (!title) return;
        await rename(dialog.workId, title);
        toast.success("Library.toast.renamed");
      } else if (dialog.kind === "alias") {
        /* 别名允许清空：这就是"去掉这个代号"的意思。 */
        await setAlias(dialog.workId, name);
        toast.success("Library.toast.aliased");
      } else if (dialog.kind === "import") {
        if (!title) return;
        const created = await importFromFile(dialog.path, {
          title,
          volumeTitle: volumeName.trim() || t("Library.dialog.importVolumeDefault"),
          chapterTitle: chapterName.trim() || t("Library.dialog.importChapterDefault"),
        });
        if (!created) {
          toast.error("Library.toast.failed");
          return;
        }
        toast.success("Library.toast.imported");
        await loadWordCounts();
        void navigate("/editor");
      }
      setDialog(null);
      setVolumeName("");
      setChapterName("");
    } catch (err) {
      log.error("dialog submit failed", err);
      toast.error("Library.toast.failed");
    }
  }

  /** 打开新建对话框。 */
  function openCreate() {
    setName("");
    setType("");
    setDialog({ kind: "create" });
  }

  /** 打开重命名对话框。 */
  function openRename(workId: string) {
    const w = works[workId];
    setName(w?.title ?? "");
    setType(w?.type ?? "");
    setDialog({ kind: "rename", workId });
  }

  /** 打开别名对话框。 */
  function openAlias(workId: string) {
    setName(works[workId]?.alias ?? "");
    setType("");
    setDialog({ kind: "alias", workId });
  }

  /**
   * 选一个本地 txt 导入成新作品。
   *
   * 先让用户挑文件、再问作品名与骨架名，而不是选完直接落盘：
   * 文件名只当默认值，真正要写进 work.json 的是用户确认过的标题。
   */
  async function openLocalFile() {
    try {
      const selected = await openFileDialog({
        directory: false,
        multiple: false,
        title: t("Library.action.openFile"),
        filters: [{ name: "Text", extensions: ["txt", "md", "text"] }],
      });
      if (Array.isArray(selected)) {
        if (!selected[0]) return;
        return openImportFor(selected[0]);
      }
      if (selected) return openImportFor(selected);
      return undefined;
    } catch (err) {
      log.error("file picker failed", err);
      toast.error("Library.toast.failed");
      return undefined;
    }
  }

  function openImportFor(path: string) {
    const base = path.split(/[\\/]/).pop() ?? path;
    /* 去掉扩展名，别把 "第三卷.txt" 整个当标题。 */
    const suggested = base.replace(/\.[^.]+$/, "") || t("Library.dialog.namePlaceholder");
    setName(suggested);
    setVolumeName("");
    setChapterName("");
    setDialog({ kind: "import", path, suggestedTitle: suggested });
  }

  /* ---------- 未选择工作区：引导选择 ---------- */
  if (!isOpen || !root) {
    return (
      <div className="view-library scrollbar-app h-full overflow-y-auto">
      <div className="px-6 py-8">
        <header className="mx-auto w-full max-w-3xl">
          <div className="flex items-start gap-3">
            <BookMarked className="icon-md mt-1 shrink-0 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold">{t("Library.empty.noWorkspace")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Library.workspace.hint")}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={() => void pick()}>
              <FolderOpen className="icon-md" />
              {t("Library.workspace.pick")}
            </Button>
          </div>

          {recent.length ? (
            <section className="mt-8">
              <h2 className="row-label">{t("Library.workspace.recent")}</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {recent.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      onClick={() => open(path)}
                      className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      {path}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </header>
      </div>
      </div>
    );
  }

  /* ---------- 已选择工作区：作品网格 ---------- */
  return (
    <div className="view-library scrollbar-app h-full overflow-y-auto">
    <div className="px-6 py-8">
      <header className="mx-auto flex w-full max-w-3xl flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("Library.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => void pick()}
              className="underline-offset-2 hover:underline"
            >
              {root}
            </button>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void pick()}>
            <FolderOpen className="icon-md" />
            {t("Library.workspace.change")}
          </Button>
          {/* 素材库属于工作区，不是某一部作品，所以入口在作品库这一层。 */}
          <Button variant="outline" size="sm" onClick={() => navigate("/codex")}>
            <Database className="icon-md" />
            {t("Codex.library.title")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setTrashOpen(true)}>
            <Trash2 className="icon-md" />
            {t("Trash.title")}
          </Button>
          {/*
           * 导入本地文稿。
           *
           * 与"新建作品"并列而不是藏进作品卡菜单：这是作品库里
           * 唯一一个能凭空增加内容的入口，用户手上已有稿子时
           * 第一反应就是找它，埋进二级菜单等于没有。
           */}
          <Button variant="outline" size="sm" onClick={() => void openLocalFile()}>
            <FileUp className="icon-md" />
            {t("Library.action.openFile")}
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="icon-md" />
            {t("Library.action.new")}
          </Button>
        </div>
      </header>

      {active.length ? (
        <section className="mx-auto mt-8 w-full max-w-3xl">
          <div className="flex flex-col gap-2">
            {active.map((work) => (
              <WorkCard
                key={work.id}
                work={work}
                words={wordCounts[work.id] ?? 0}
                isCurrent={currentWorkId === work.id}
                onOpen={(id) => {
                  setCurrentWorkId(id);
                  void navigate("/editor");
                }}
                onRename={openRename}
                onAlias={openAlias}
                onArchive={setPendingArchive}
                onDelete={setPendingDelete}
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
        <section className="mx-auto mt-16 flex w-full max-w-3xl flex-col items-center gap-3 text-center">
          <BookMarked className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t("Library.empty.noWorksHint")}</p>
          <Button size="sm" onClick={openCreate}>
            <Plus className="icon-md" />
            {t("Library.action.new")}
          </Button>
        </section>
      )}

      {archived.length ? (
        <section className="mx-auto mt-12 w-full max-w-3xl">
          <h2 className="row-label mb-3">{t("Library.empty.archived")}</h2>
          <div className="flex flex-col gap-2">
            {archived.map((work) => (
              <WorkCard
                key={work.id}
                work={work}
                words={wordCounts[work.id] ?? 0}
                isCurrent={false}
                onOpen={() => undefined}
                onRename={openRename}
                onAlias={openAlias}
                onArchive={setPendingArchive}
                onDelete={setPendingDelete}
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

      {/* 新建 / 重命名对话框 */}
      <Dialog
        open={dialog !== null}
        onOpenChange={(openState) => {
          if (!openState) setDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.kind === "rename"
                ? t("Library.dialog.renameTitle")
                : dialog?.kind === "alias"
                  ? t("Library.dialog.aliasTitle")
                  : dialog?.kind === "import"
                    ? t("Library.dialog.importTitle")
                    : t("Library.dialog.newTitle")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="work-name">{t("Library.dialog.nameLabel")}</Label>
              <Input
                id="work-name"
                value={name}
                autoFocus
                placeholder={t("Library.dialog.namePlaceholder")}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    void submitDialog();
                  }
                }}
              />
            </div>

            {dialog?.kind === "create" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="work-type">{t("Library.dialog.typeLabel")}</Label>
                <Input
                  id="work-type"
                  value={type}
                  placeholder={t("Library.dialog.typePlaceholder")}
                  onChange={(e) => setType(e.target.value)}
                />
              </div>
            ) : null}

            {dialog?.kind === "import" ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="import-volume">{t("Library.dialog.importVolume")}</Label>
                  <Input
                    id="import-volume"
                    value={volumeName}
                    placeholder={t("Library.dialog.importVolumeDefault")}
                    onChange={(e) => setVolumeName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="import-chapter">{t("Library.dialog.importChapter")}</Label>
                  <Input
                    id="import-chapter"
                    value={chapterName}
                    placeholder={t("Library.dialog.importChapterDefault")}
                    onChange={(e) => setChapterName(e.target.value)}
                  />
                </div>
              </>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t("Library.dialog.cancel")}
            </Button>
            <Button onClick={() => void submitDialog()} disabled={!name.trim()}>
              {dialog?.kind === "create"
                ? t("Library.dialog.create")
                : dialog?.kind === "import"
                  ? t("Library.dialog.importButton")
                  : t("Library.dialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 归档确认 */}
      <TrashDialog
        open={trashOpen}
        root={root}
        onOpenChange={setTrashOpen}
        onRestored={() => void loadWordCounts()}
      />

      <AlertDialog
        open={pendingArchive !== null}
        onOpenChange={(openState) => {
          if (!openState) setPendingArchive(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Library.action.confirmArchive")}</AlertDialogTitle>
            <AlertDialogDescription>{t("Library.action.archiveDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Library.dialog.cancel")}</AlertDialogCancel>
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(openState) => {
          if (!openState) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Library.action.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("Library.action.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Library.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingDelete) return;
                const id = pendingDelete;
                setPendingDelete(null);
                void remove(id)
                  .then(() => toast.success("Library.toast.deleted"))
                  .catch(() => toast.error("Library.toast.failed"));
              }}
            >
              {t("Library.action.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}
