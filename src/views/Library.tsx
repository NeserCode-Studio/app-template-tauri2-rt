import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookMarked,
  Database,
  Folder,
  FolderOpen,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router";

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
import ConfirmDeleteDialog from "@/components/framework/ConfirmDeleteDialog";
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
  | null;

export default function Library() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const { root, recent, isOpen, pick, open, reveal, deleteWorkspace } = useWorkspace();
  const {
    workspace,
    works,
    currentWorkId,
    create,
    rename,
    archive,
    unarchive,
    remove,
    setWorkspaceAlias,
    setCurrentWorkId,
  } = useLibrary();

  const [dialog, setDialog] = useState<DialogMode>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [pendingArchive, setPendingArchive] = useState<string | null>(null);
  /** 待输入确认删除的作品 / 工作区。 */
  const [pendingWorkDelete, setPendingWorkDelete] = useState<string | null>(null);
  const [pendingWorkspaceDelete, setPendingWorkspaceDelete] = useState<string | null>(null);
  /** 工作区别名的待确认新值：改名与"保存设置"不是一回事。 */
  const [pendingAlias, setPendingAlias] = useState<{ from: string; to: string } | null>(
    null
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aliasName, setAliasName] = useState("");
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
    if (!title) return;
    try {
      if (dialog.kind === "create") {
        const created = await create(title, type.trim());
        if (!created) {
          toast.error("Library.toast.failed");
          return;
        }
        toast.success("Library.toast.created");
      } else {
        await rename(dialog.workId, title);
        toast.success("Library.toast.renamed");
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
    setDialog({ kind: "create" });
  }

  /** 打开重命名对话框。 */
  function openRename(workId: string) {
    const w = works[workId];
    setName(w?.title ?? "");
    setType(w?.type ?? "");
    setDialog({ kind: "rename", workId });
  }

  /**
   * 提交工作区别名。
   *
   * 从"无别名"改成"有别名"要确认一次：作品库的大标题就是它，
   * 而 H1 之前一直是固定的"作品库"。用户可能以为改的是某个字段，
   * 没想到整个页面的标题都换掉了。反向（清空别名）同理，
   * 那是让标题退回默认文案的可见变化。
   */
  function requestAliasSave() {
    const from = (workspace?.alias ?? "").trim();
    const to = aliasName.trim();
    if (from === to) return;
    setPendingAlias({ from, to });
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
          {/*
           * 标题优先用工作区别名。目录名常是随手起的（"wirting"、
           * "新建文件夹"），而用户心里这个库有个正式称呼；别名留空时
           * 退回通用标题，不拿路径当标题——一整条盘符路径当 H1 太吵。
           */}
          <h1 className="text-xl font-semibold">
            {workspace?.alias?.trim() || t("Library.title")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/*
           * 操作区四个：工作区设置、素材库、回收站、新建作品。
           *
           * "更换工作区"收进设置——它是低频动作，且换工作区意味着
           * 离开当前上下文（当前作品、草稿都在里面），不该和"新建作品"
           * 并列成同级按钮，那会让人误以为随时可以无损切换。
           * 回收站留在外面：它是"东西在哪还能捞回来"的查证入口，
           * 删了东西之后第一反应就是去找它，埋进设置等于找不到。
           */}
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="icon-md" />
            {t("Library.action.workspaceSettings")}
          </Button>
          {/* 素材库属于工作区，不是某一部作品，所以入口在作品库这一层。 */}
          <Button variant="outline" size="sm" onClick={() => navigate("/codex")}>
            <Database className="icon-md" />
            {t("Codex.library.title")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTrashOpen(true)}>
            <Trash2 className="icon-md" />
            {t("Trash.title")}
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
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              {t("Library.dialog.cancel")}
            </Button>
            <Button onClick={() => void submitDialog()} disabled={!name.trim()}>
              {dialog?.kind === "rename" ? t("Library.dialog.save") : t("Library.dialog.create")}
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

      {/*
       * 工作区设置。
       *
       * 收纳与"这个库本身"有关的事：目录在哪、显示名是什么、
       * 换目录、删掉整个库。原先路径挂在标题下方、指向的却是
       * "换工作区"，与用户看到的东西名不副实——路径的信息属于设置。
       */}
      <Dialog
        open={settingsOpen}
        onOpenChange={(openState) => {
          setSettingsOpen(openState);
          /* 每次打开时重置，避免显示上次没提交完的输入。 */
          if (openState) setAliasName(workspace?.alias ?? "");
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
                <span className="min-w-0 flex-1 truncate rounded-md border bg-muted/30 px-2 py-1.5 text-sm text-muted-foreground">
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
              <Label htmlFor="workspace-alias">{t("Library.workspace.aliasLabel")}</Label>
              {/*
               * 保存与取消紧贴输入框，不放到底部 DialogFooter。
               *
               * 这个弹窗里还有"更换工作区""删除工作区"两组按钮，
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
                    setAliasName(workspace?.alias ?? "");
                    setSettingsOpen(false);
                  }}
                >
                  {t("Library.dialog.cancel")}
                </Button>
                <Button
                  className="shrink-0"
                  disabled={aliasName.trim() === (workspace?.alias ?? "").trim()}
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
                  void pick();
                }}
              >
                <FolderOpen className="icon-md" />
                {t("Library.workspace.change")}
              </Button>
              <Button
                variant="outline"
                className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
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

      {/*
       * 作品删除：输入标题确认。
       *
       * 删除按钮就贴在"继续写作"右侧，两者只隔一个手指宽，
       * 普通确认框只能挡住手快，挡不住"没看清在删什么"。
       * 要求打一遍标题等于强迫用户读它一遍。
       */}
      <ConfirmDeleteDialog
        open={pendingWorkDelete !== null}
        title={pendingWorkDelete ? works[pendingWorkDelete]?.title ?? pendingWorkDelete : ""}
        confirmText={pendingWorkDelete ? works[pendingWorkDelete]?.title ?? pendingWorkDelete : ""}
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
          void deleteWorkspace().catch(() => toast.error("Library.toast.failed"));
        }}
      />

      {/* 工作区更名确认：标题是页面级变化，值得问一句。 */}
      <AlertDialog
        open={pendingAlias !== null}
        onOpenChange={(o) => {
          if (!o) setPendingAlias(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Library.workspace.renameTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-1">
              <span>{t("Library.workspace.renameDesc")}</span>
              <span className="font-medium text-foreground">
                {pendingAlias?.from || t("Library.title")}
              </span>
              <span>{t("Library.workspace.renameTo")}</span>
              <span className="font-medium text-foreground">{pendingAlias?.to}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Library.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingAlias) return;
                const next = pendingAlias.to;
                setPendingAlias(null);
                setSettingsOpen(false);
                void setWorkspaceAlias(next).catch(() => toast.error("Library.toast.failed"));
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
