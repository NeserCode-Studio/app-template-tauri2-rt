import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

import ChapterEditor from "@/components/novel/editor/ChapterEditor";
import NewChapterDialog from "@/components/novel/editor/NewChapterDialog";
import OutlinePane from "@/components/novel/editor/OutlinePane";

import { useI18n } from "@/composables";
import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import { useWorkspace } from "@/contexts/workspace";
import { addNode as addOutlineNode, removeNode, updateNode } from "@/services/outline";
import {
  createChapter as createChapterFile,
  countWorkWords,
  deleteChapter as deleteChapterFile,
  loadChapter,
  renameChapter as renameChapterFile,
} from "@/services/chapter";
import { recordWrite } from "@/services/stats";
import { createLogger } from "@/lib/logger";
import type { Chapter } from "@/shared/schema";

const log = createLogger("Editor");

/**
 * 编辑器主视图：三栏布局（结构树 / 卡片区 / 右栏）。
 *
 * 宽度：左栏 240px（180~360 可拖），右栏 300px（240~480 可拖），
 * 分隔沿用模板已依赖的 react-resizable-panels。
 */
export default function Editor() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { root } = useWorkspace();
  const { currentWorkId, works } = useLibrary();
  const { chapters, currentChapterId, setCurrentChapterId, setOutline } = useOutline();

  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [words, setWords] = useState(0);
  const [loading, setLoading] = useState(false);
  /** 新建章节对话框：打开时只做命名，命名后才真正建章。 */
  const [newChapterFor, setNewChapterFor] = useState<string | null | undefined>(undefined);
  /** 章节重命名：行内输入态。 */
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  /** 待确认删除的章节。 */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  /* 作品切换后回到作品库，避免空编辑器。 */
  useEffect(() => {
    if (!currentWorkId) navigate("/");
  }, [currentWorkId, navigate]);

  /* 打开作品时若尚未选中章节，选第一张；后续切换由 OutlineContext 驱动。 */
  const chapterIdsKey = chapters.map((c) => c.id).join(",");
  useEffect(() => {
    if (!root || !currentWorkId) return;
    if (chapters.length === 0) {
      setChapter(null);
      return;
    }
    if (!chapters.some((c) => c.id === currentChapterId)) {
      setCurrentChapterId(chapters[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, currentWorkId, chapterIdsKey]);

  /* 打开章节：懒加载正文（避免打开大作品时一次性读全部章）。 */
  const activeChapterId = currentChapterId;
  useEffect(() => {
    if (!root || !currentWorkId || !activeChapterId) return;
    let alive = true;
    setLoading(true);
    loadChapter(root, currentWorkId, activeChapterId)
      .then((next) => {
        if (alive && next) setChapter(next);
      })
      .catch((err) => log.error("chapter load failed", err))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [root, currentWorkId, activeChapterId]);

  /* ---------- 新建卷 / 章 ---------- */

  const createVolume = useCallback(
    async (title: string) => {
      if (!root || !currentWorkId) return;
      const next = await addOutlineNode(root, currentWorkId, {
        type: "volume",
        title,
        parentId: null,
      });
      setOutline(next);
    },
    [root, currentWorkId, setOutline]
  );

  const createChapter = useCallback(
    async (title: string, parentVolumeId: string | null) => {
      if (!root || !currentWorkId) return;
      /*
       * 先建章文件拿到 id，再以同一个 id 登记进结构树。
       *
       * 结构树 id 决定打开哪一章（currentChapterId 来自 outline），章文件
       * 路径是 chapters/<id>.json。两者必须是同一个 id，否则保存虽然成功，
       * 打开时却按另一个 id 去找文件，读到的自然是空章。
       */
      const created = await createChapterFile(root, currentWorkId, title);
      const next = await addOutlineNode(root, currentWorkId, {
        type: "chapter",
        title,
        parentId: parentVolumeId,
        id: created.id,
      });
      setOutline(next);
      setChapter(created);
      setCurrentChapterId(created.id);
    },
    [root, currentWorkId, setOutline, setCurrentChapterId]
  );

  /* ---------- 章节跳转 ---------- */

  const chapterIndex = chapters.findIndex((c) => c.id === chapter?.id);
  const prevId = chapterIndex > 0 ? chapters[chapterIndex - 1]?.id : null;
  const nextId =
    chapterIndex >= 0 && chapterIndex < chapters.length - 1
      ? chapters[chapterIndex + 1]?.id
      : null;

  const work = currentWorkId ? works[currentWorkId] : null;

  /* ---------- 章节操作（右侧栏） ---------- */

  /** 重命名：章文件与结构树节点必须同步改，否则两处标题会不一致。 */
  const renameChapter = useCallback(async () => {
    if (!root || !currentWorkId || !chapter) return;
    const title = renameDraft.trim();
    if (!title || title === chapter.title) {
      setRenaming(false);
      return;
    }
    const updated = await renameChapterFile(root, currentWorkId, chapter, title);
    setChapter(updated);
    setOutline(await updateNode(root, currentWorkId, updated.id, { title }));
    setRenameDraft("");
    setRenaming(false);
  }, [root, currentWorkId, chapter, renameDraft, setOutline]);

  /** 删除当前章：先删正文文件，再从结构树上摘掉节点。 */
  const deleteCurrentChapter = useCallback(async () => {
    if (!root || !currentWorkId || !chapter) return;
    const index = chapters.findIndex((c) => c.id === chapter.id);
    await deleteChapterFile(root, currentWorkId, chapter.id);
    const next = await removeNode(root, currentWorkId, chapter.id);
    setOutline(next);
    /* 选中相邻的章；没有别的章就回到空态。 */
    setCurrentChapterId(next.nodes.some((n) => n.id === chapter.id)
      ? null
      : (chapters[index - 1]?.id ?? chapters[index + 1]?.id ?? null));
    setChapter(null);
    setPendingDelete(null);
  }, [root, currentWorkId, chapter, chapters, setOutline, setCurrentChapterId]);

  /**
   * 章落盘后更新作品库字数。
   *
   * 作品总字数是全书各章之和，且作品库可能已经打开了别的章，
   * 因此按磁盘全量重算最可靠——靠累加增量只会在多章轮流编辑时算错。
   */
  const commitWords = useCallback(
    async () => {
      if (!root || !currentWorkId) return;
      const total = await countWorkWords(root, currentWorkId);
      /* delta 只影响"今日新增字数"这一项，不影响作品总字数。 */
      await recordWrite(root, currentWorkId, total, 0);
    },
    [root, currentWorkId]
  );

  if (!currentWorkId || !root) return null;

  return (
    <div className="flex h-full w-full flex-col">
      <NewChapterDialog
        open={newChapterFor !== undefined}
        onOpenChange={(o) => {
          if (!o) setNewChapterFor(undefined);
        }}
        onConfirm={(title) => createChapter(title, newChapterFor ?? null)}
      />

      {/* 顶部作品条 */}
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
          <ArrowLeft className="icon-md" />
          {t("Command.turnto.home")}
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <span className="truncate text-sm font-medium">{work?.title ?? ""}</span>
      </div>

      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        {/* 左栏：结构树 */}
        <ResizablePanel defaultSize={18} minSize={12} maxSize={24}>
          <div className="h-full border-r">
            <OutlinePane onCreateChapter={createChapter} onCreateVolume={createVolume} />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="w-1" />

        {/* 中栏：卡片区 */}
        <ResizablePanel defaultSize={58} minSize={40}>
          {/*
           * 必须包一层「flex + h-full」。
           *
           * ResizablePanel 本身是普通块级 div，而 ChapterEditor 靠 flex-1
           * 撑满剩余高度——flex-1 只在父级是 flex 容器时生效。若父级只是
           * h-full 的块级 div，ChapterEditor 高度就退化成内容高度，
           * 卡片区随正文长短伸缩，底部输入框被顶在正文后面而非贴底。
           */}
          <div className="flex h-full min-h-0 flex-col">
            {chapter ? (
              <ChapterEditor
                key={chapter.id}
                chapter={chapter}
                root={root}
                workId={currentWorkId}
                onWordsChange={setWords}
                onSaved={setChapter}
                onWordsCommitted={() => void commitWords()}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <p className="text-sm text-muted-foreground">{t("Editor.side.emptyWork")}</p>
                <Button size="sm" onClick={() => setNewChapterFor(null)}>
                  <Plus className="icon-md" />
                  {t("Editor.side.addChapter")}
                </Button>
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle className="w-1" />

        {/* 右栏：翻章 + 摘要 */}
        <ResizablePanel defaultSize={24} minSize={16} maxSize={30}>
          <div className="flex h-full flex-col gap-4 border-l p-4">
            <section className="flex flex-col gap-2">
              <h2 className="row-label">{t("Editor.side.jump")}</h2>
              <p className="text-sm text-muted-foreground">
                {chapterIndex >= 0 ? chapterIndex + 1 : 0} / {chapters.length}
              </p>
              <p className="text-xs text-muted-foreground/70 tabular-nums">
                {words} {t("Editor.chapter.words")}
              </p>
            </section>

            <Separator />

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={!prevId}
                  onClick={() => prevId && setCurrentChapterId(prevId)}
                >
                  <ChevronLeft className="icon-md" />
                  {t("Editor.nav.prev")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={!nextId}
                  onClick={() => nextId && setCurrentChapterId(nextId)}
                >
                  {t("Editor.nav.next")}
                  <ChevronRight className="icon-md" />
                </Button>
              </div>

              {!nextId ? (
                <Button size="sm" onClick={() => setNewChapterFor(null)}>
                  <Plus className="icon-md" />
                  {t("Editor.chapter.new")}
                </Button>
              ) : null}
            </section>

            {/*
             * 当前章操作。
             *
             * 放右侧而非卡片悬浮菜单：这些是"章级"动作（改名、删除），
             * 与单张卡片的编辑动作是两回事，混在一起会让轻操作和重操作
             * 挤在同一个几像素的悬浮条里。
             */}
            {chapter ? (
              <>
                <Separator />
                <section className="flex flex-col gap-2">
                  <h2 className="row-label">{t("Editor.side.actions")}</h2>

                  {renaming ? (
                    <Input
                      autoFocus
                      value={renameDraft}
                      className="h-7 text-sm"
                      aria-label={t("Editor.chapter.renameTitle")}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === "Enter") void renameChapter();
                        if (e.key === "Escape") setRenaming(false);
                      }}
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => {
                        setRenameDraft(chapter.title);
                        setRenaming(true);
                      }}
                    >
                      <Pencil className="icon-md" />
                      {t("Editor.chapter.rename")}
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full justify-start text-destructive hover:text-destructive"
                    onClick={() => setPendingDelete(chapter.id)}
                  >
                    <Trash2 className="icon-md" />
                    {t("Editor.chapter.delete")}
                  </Button>
                </section>
              </>
            ) : null}

            {loading ? (
              <p className="text-xs text-muted-foreground">{t("Editor.status.saving")}</p>
            ) : null}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* 删除确认：删章会连正文一起清掉，必须二次确认。 */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Editor.chapter.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Editor.chapter.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Editor.split.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteCurrentChapter()}>
              {t("Editor.chapter.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
