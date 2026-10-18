import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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
import { addNode as addOutlineNode } from "@/services/outline";
import { createChapter as createChapterFile, loadChapter } from "@/services/chapter";
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
      // 先建章文件，再登记进结构树，保证树里不会出现空条目。
      const created = await createChapterFile(root, currentWorkId, title);
      const next = await addOutlineNode(root, currentWorkId, {
        type: "chapter",
        title,
        parentId: parentVolumeId,
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
          {chapter ? (
            <ChapterEditor
              key={chapter.id}
              chapter={chapter}
              root={root}
              workId={currentWorkId}
              onWordsChange={setWords}
              onSaved={setChapter}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-muted-foreground">{t("Editor.side.emptyWork")}</p>
              <Button
                size="sm"
                onClick={() => setNewChapterFor(null)}
              >
                <Plus className="icon-md" />
                {t("Editor.side.addChapter")}
              </Button>
            </div>
          )}
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

            {loading ? (
              <p className="text-xs text-muted-foreground">{t("Editor.status.saving")}</p>
            ) : null}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
