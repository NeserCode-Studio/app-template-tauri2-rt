import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
} from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  type ImperativePanelHandle,
} from "@/components/ui/resizable";

import ChapterStream, {
  type ChapterStreamHandle,
} from "@/components/novel/editor/ChapterStream";
import CodexPane from "@/components/novel/CodexPane";
import DraftBox, { DraftFlashOverlay } from "@/components/novel/DraftBox";
import ProgressPane from "@/components/novel/ProgressPane";
import ExportDialog from "@/components/novel/ExportDialog";
import NewChapterDialog from "@/components/novel/editor/NewChapterDialog";
import OutlinePane from "@/components/novel/editor/OutlinePane";
import SubtreePreview from "@/components/novel/SubtreePreview";

import { useI18n } from "@/composables";
import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import { useWorkspace } from "@/contexts/workspace";
import { useViewMode, type ViewMode } from "@/contexts/viewmode";
import {
  addNode as addOutlineNode,
  moveNode as moveOutlineNode,
  removeNode,
  updateNode,
} from "@/services/outline";
import {
  createChapter as createChapterFile,
  countWorkWords,
  loadChapter,
  renameChapter as renameChapterFile,
} from "@/services/chapter";
import { chapterFile, chapterTextFile } from "@/services/paths";
import { moveToTrash } from "@/services/trash";
import { useCodex } from "@/contexts/codex";
import { recordWorkWords } from "@/services/stats";
import { createLogger } from "@/lib/logger";
import type { Chapter, OutlineNode } from "@/shared/schema";

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
  const { setCurrentEntryId } = useCodex();
  const { currentWorkId, works } = useLibrary();
  const {
    chapters,
    volumes,
    currentChapterId,
    setCurrentChapterId,
    setOutline,
    reloadChapterMetas,
  } = useOutline();

  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [words, setWords] = useState(0);
  const [loading, setLoading] = useState(false);
  /** 新建章节对话框：打开时只做命名，命名后才真正建章。 */
  const [newChapterFor, setNewChapterFor] = useState<string | null | undefined>(undefined);
  const [draftOpen, setDraftOpen] = useState(false);
  /** 章节重命名：行内输入态。 */
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  /** 待确认删除的章节。 */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  /** 待确认删除的卷 id（连同其下所有章进回收站）。 */
  const [pendingVolumeDelete, setPendingVolumeDelete] = useState<string | null>(null);
  /** 右栏页签：章节信息 / 素材库。 */
  const [sideTab, setSideTab] = useState<"chapter" | "codex" | "progress">("chapter");
  const [exportOpen, setExportOpen] = useState(false);
  /** 视图模式（普通 / 专注 / 打字机 / 禅）。 */
  const { mode: viewMode, setMode: setViewMode } = useViewMode();
  /** 禅模式隐藏两侧栏，把整幅宽度让给正文。 */
  const zen = viewMode === "zen";

  /*
   * 左右栏的收起/展开。
   *
   * 控件放在顶栏而不是面板内部：面板一旦收起就没法点到里面的按钮，
   * 用户会困在收起的布局里。顶栏常驻，两侧各一个开关。
   *
   * 用 ref 调 ImperativePanelHandle 的 collapse/expand，而不是把宽度设成 0——
   * 后者会让 react-resizable-panels 把空间重新分给别的面板，出现跳动。
   */
  const outlinePanelRef = useRef<ImperativePanelHandle | null>(null);
  const sidePanelRef = useRef<ImperativePanelHandle | null>(null);
  const chapterStreamRef = useRef<ChapterStreamHandle | null>(null);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);

  const toggleOutline = useCallback(() => {
    const panel = outlinePanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand(12);
      setOutlineCollapsed(false);
    } else {
      panel.collapse();
      setOutlineCollapsed(true);
    }
  }, []);

  const toggleSide = useCallback(() => {
    const panel = sidePanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      panel.expand(16);
      setSideCollapsed(false);
    } else {
      panel.collapse();
      setSideCollapsed(true);
    }
  }, []);

  const appendCodexName = useCallback((text: string) => {
    chapterStreamRef.current?.appendText(text);
  }, []);

  /* 禅模式会移除两侧面板，切回来时要恢复控件显示的"已收起"状态。 */
  useEffect(() => {
    if (!zen) return;
    outlinePanelRef.current?.expand();
    sidePanelRef.current?.expand();
    setOutlineCollapsed(false);
    setSideCollapsed(false);
  }, [zen]);

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
        /*
         * 读不到正文时必须说出来。返回 null 说明章文件不存在或解析失败，
         * 此时若静默不 setChapter，正文区会是一片空白——
         * 用户看到的是"我的字没了"，而不是"这个文件读不出来"。
         */
        if (!next) {
          log.error("chapter file missing or unreadable", {
            workId: currentWorkId,
            chapterId: activeChapterId,
          });
          if (alive) setChapter(null);
          return;
        }
        if (alive) setChapter(next);
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
    async (
      title: string,
      parentVolumeId: string | null,
      meta?: { status?: "draft" | "revising" | "final"; synopsis?: string }
    ) => {
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
        status: meta?.status,
        synopsis: meta?.synopsis,
      });
      setOutline(next);
      setChapter(created);
      setCurrentChapterId(created.id);
    },
    [root, currentWorkId, setOutline, setCurrentChapterId]
  );

  /* ---------- 章节跳转 ---------- */

  /** 结构树拖放：排序与升降级。 */
  const moveOutline = useCallback(
    async (nodeId: string, targetParentId: string | null, targetIndex: number) => {
      if (!root || !currentWorkId) return;
      setOutline(await moveOutlineNode(root, currentWorkId, nodeId, targetParentId, targetIndex));
    },
    [root, currentWorkId, setOutline]
  );

  /** 结构树内联编辑：章状态与摘要。 */
  const updateOutlineMeta = useCallback(
    async (
      nodeId: string,
      patch: {
        status?: "draft" | "revising" | "final";
        synopsis?: string;
        plotSummary?: string;
      }
    ) => {
      if (!root || !currentWorkId) return;
      setOutline(await updateNode(root, currentWorkId, nodeId, patch));
    },
    [root, currentWorkId, setOutline]
  );

  /*
   * 翻章用的章节序列：按结构树的视觉顺序排，即
   * 「顶层的游离章 → 各卷，卷按 order、卷内章按 order」。
   *
   * 不能直接用 context 里的 chapters：那是把所有章拍平后只按 order 排的，
   * 同一卷内的章 order 是 0,1,2…，不同卷又是另一组 0,1,2…，
   * 拍平排序的结果与树上看到的顺序无关。于是"首卷第一章"点下一章会
   * 跳到某个游离章（截图里的 bug），而不是首卷第二章。
   */
  const chapterSequence = useMemo(() => {
    const byParent = new Map<string | null, OutlineNode[]>();
    for (const c of chapters) {
      const list = byParent.get(c.parentId);
      if (list) list.push(c);
      else byParent.set(c.parentId, [c]);
    }
    /* 游离章排在所有卷之前，与结构树的渲染顺序一致。 */
    return [
      ...(byParent.get(null) ?? []),
      ...volumes.flatMap((v) => byParent.get(v.id) ?? []),
    ];
  }, [chapters, volumes]);

  const chapterIndex = chapterSequence.findIndex((c) => c.id === chapter?.id);
  const prevId = chapterIndex > 0 ? chapterSequence[chapterIndex - 1]?.id : null;
  const nextId =
    chapterIndex >= 0 && chapterIndex < chapterSequence.length - 1
      ? chapterSequence[chapterIndex + 1]?.id
      : null;

  const work = currentWorkId ? works[currentWorkId] : null;
  /** 当前章在结构树里的节点：右栏读状态与小结用。 */
  const currentChapterNode = useMemo(
    () => chapters.find((c) => c.id === chapter?.id) ?? null,
    [chapters, chapter?.id]
  );

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
    /*
     * 先入回收站再摘节点。
     *
     * 顺序很关键：若先删文件再入回收站，清单里记的会是"不存在"的路径，
     * 恢复时拿不到任何数据。反过来则先有备份，后摘引用。
     */
    const node = chapters[index];
    await moveToTrash(root, {
      kind: "chapter",
      originId: chapter.id,
      /* 恢复时要靠它找回收该章的作品，缺了就挂不回结构树。 */
      workId: currentWorkId,
      paths: [
        chapterFile(currentWorkId, chapter.id),
        chapterTextFile(currentWorkId, chapter.id),
      ],
      title: chapter.title,
      parentId: node?.parentId ?? null,
      order: node?.order ?? 0,
      node: node
        ? {
            id: node.id,
            type: node.type,
            title: node.title,
            parentId: node.parentId,
            order: node.order,
            status: node.status,
            synopsis: node.synopsis,
            plotSummary: node.plotSummary,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
          }
        : null,
    });
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
   * 删除整卷：连同其下所有章一起进回收站。
   *
   * 「刚写一两章就想推翻重写」是这个操作的主要场景，所以它必须是可恢复的
   * ——章正文、结构树节点都要完整带走。摘节点时删卷即可，removeNode 级联
   * 会带走下面的章节点；但章文件要先入回收站，否则恢复时正文找不回来。
   */
  const deleteVolume = useCallback(
    async (volumeId: string) => {
      if (!root || !currentWorkId) return;
      const volume = volumes.find((v) => v.id === volumeId);
      if (!volume) return;
      const kids = chapters.filter((c) => c.parentId === volumeId);

      const paths = kids.flatMap((c) => [
        chapterFile(currentWorkId, c.id),
        chapterTextFile(currentWorkId, c.id),
      ]);
      await moveToTrash(root, {
        kind: "volume",
        originId: volumeId,
        workId: currentWorkId,
        paths,
        title: volume.title,
        parentId: volume.parentId,
        order: volume.order,
        subtree: [volume, ...kids].map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          parentId: n.parentId,
          order: n.order,
          status: n.status,
          synopsis: n.synopsis,
          plotSummary: n.plotSummary,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        })),
      });
      /* removeNode 级联删除卷与其下所有章节点。 */
      const next = await removeNode(root, currentWorkId, volumeId);
      setOutline(next);
      /* 正在编辑的章若随卷被删，切到别的章或回到空态。 */
      if (chapter && kids.some((c) => c.id === chapter.id)) {
        const fallback = next.nodes.find(
          (n) => n.type === "chapter"
        );
        setCurrentChapterId(fallback?.id ?? null);
        setChapter(null);
      }
      setPendingVolumeDelete(null);
    },
    [root, currentWorkId, volumes, chapters, chapter, setOutline, setCurrentChapterId]
  );

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
      /* delta 由服务内部按上一版作品字数求差，调用点不参与。 */
      await recordWorkWords(root, currentWorkId, total);
      /* 侧栏卡片上的字数与"多久之前"跟着正文走。 */
      await reloadChapterMetas();
    },
    [root, currentWorkId, reloadChapterMetas]
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
        {!zen ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={toggleOutline}
            aria-label={
              outlineCollapsed
                ? t("Editor.side.expandOutline")
                : t("Editor.side.collapseOutline")
            }
            title={
              outlineCollapsed
                ? t("Editor.side.expandOutline")
                : t("Editor.side.collapseOutline")
            }
          >
            {outlineCollapsed ? (
              <PanelLeftOpen className="icon-md" />
            ) : (
              <PanelLeftClose className="icon-md" />
            )}
          </Button>
        ) : null}
        <Separator orientation="vertical" className="h-4" />
        <span className="truncate text-sm font-medium">{work?.title ?? ""}</span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="h-7 w-28 text-xs" aria-label={t("Focus.mode")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("Focus.off")}</SelectItem>
              <SelectItem value="focus">{t("Focus.focus")}</SelectItem>
              <SelectItem value="typewriter">{t("Focus.typewriter")}</SelectItem>
              <SelectItem value="zen">{t("Focus.zen")}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => setExportOpen(true)}>
            <Download className="icon-md" />
            {t("Export.action")}
          </Button>
          {!zen ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={toggleSide}
              aria-label={
                sideCollapsed
                  ? t("Editor.side.expandSide")
                  : t("Editor.side.collapseSide")
              }
              title={
                sideCollapsed
                  ? t("Editor.side.expandSide")
                  : t("Editor.side.collapseSide")
              }
            >
              {sideCollapsed ? (
                <PanelRightOpen className="icon-md" />
              ) : (
                <PanelRightClose className="icon-md" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
        {/*
         * 禅模式下只留中栏。
         *
         * 用条件渲染而非把两侧宽度设为 0：react-resizable-panels 会把
         * defaultSize 归一化到可见面板，留着两个宽度为 0 的面板会
         * 让正文只拿到 1/3 而非满宽。
         */}
        {!zen ? (
        <>
        {/* 左栏：结构树 */}
        <ResizablePanel
          ref={outlinePanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={18}
          minSize={12}
          maxSize={24}
          onCollapse={() => setOutlineCollapsed(true)}
          onExpand={() => setOutlineCollapsed(false)}
        >
          {/*
           * 面板自身不再画边框：ResizableHandle 就是那道分隔线。
           * 两者都画会露出两条线，中间还夹着 handle 的宽度形成空隙。
           */}
          <div className="h-full">
            <OutlinePane
              onCreateChapter={createChapter}
              onCreateVolume={createVolume}
              onMoveNode={moveOutline}
              onUpdateNode={updateOutlineMeta}
              onDeleteVolume={(id) => setPendingVolumeDelete(id)}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />
        </>
        ) : null}

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
              /*
               * Continuous chapter stream: the active chapter still runs on
               * ChapterEditor (save, history, undo, drafts all unchanged), while
               * the two chapters before and after are read-only context.
               *
               * The scroll container belongs to ChapterStream, so no extra
               * flex-1 wrapper here: two nested scrollers would break the
               * bottom composer staying pinned.
               */
              <ChapterStream
                ref={chapterStreamRef}
                onSelectChapter={setCurrentChapterId}
                key={chapter.id}
                chapter={chapter}
                root={root}
                workId={currentWorkId}
                onWordsChange={setWords}
                onSaved={setChapter}
                onWordsCommitted={() => void commitWords()}
                onRename={() => {
                  setRenameDraft(chapter.title);
                  setRenaming(true);
                }}
                onDelete={() => setPendingDelete(chapter.id)}
                onOpenCodexEntry={(entryId) => {
                  setCurrentEntryId(entryId);
                  navigate("/codex");
                }}
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

        {!zen ? <ResizableHandle withHandle /> : null}

        {!zen ? (
        <>
        {/* 右栏：翻章 + 摘要 */}
        <ResizablePanel
          ref={sidePanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={24}
          minSize={16}
          maxSize={30}
          onCollapse={() => setSideCollapsed(true)}
          onExpand={() => setSideCollapsed(false)}
        >
          {/* 同左栏：分隔线由 ResizableHandle 负责，这里不再重复画。 */}
          <div className="flex h-full min-h-0 flex-col gap-3 p-4">
            {/*
             * 右栏三个页签：章节 / 素材 / 进度。
             *
             * 页签都承载"写作时的旁查资料"，同处一栏避免开第四栏。
             * 草稿箱独立于页签，固定在右栏底部，需要时再用 Popover 展开。
             */}
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className={[
                  "h-7 flex-1 border text-xs",
                  sideTab === "chapter"
                    ? "border-primary/25 bg-accent text-accent-foreground"
                    : "border-transparent",
                ].join(" ")}
                aria-pressed={sideTab === "chapter"}
                onClick={() => setSideTab("chapter")}
              >
                {t("Editor.side.jump")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={[
                  "h-7 flex-1 border text-xs",
                  sideTab === "codex"
                    ? "border-primary/25 bg-accent text-accent-foreground"
                    : "border-transparent",
                ].join(" ")}
                aria-pressed={sideTab === "codex"}
                onClick={() => setSideTab("codex")}
              >
                {t("Editor.side.codex")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={[
                  "h-7 flex-1 border text-xs",
                  sideTab === "progress"
                    ? "border-primary/25 bg-accent text-accent-foreground"
                    : "border-transparent",
                ].join(" ")}
                aria-pressed={sideTab === "progress"}
                onClick={() => setSideTab("progress")}
              >
                {t("Editor.side.progress")}
              </Button>
            </div>

            {sideTab === "chapter" ? (
              <div className="scrollbar-app flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
                <section className="flex flex-col gap-2">
                  <h2 className="row-label">{t("Editor.side.jump")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {chapterIndex >= 0 ? chapterIndex + 1 : 0} /{" "}
                    {chapterSequence.length}
                  </p>
                  <p className="text-xs text-muted-foreground/70 tabular-nums">
                    {words} {t("Editor.chapter.words")}
                  </p>
                </section>

                <Separator />

                {/*
                 * 章节内容：状态、一句话摘要、情节小结。
                 *
                 * 这些属性在详情 Dialog 里编辑，右栏只做只读展示——
                 * 右栏是"这一章现在什么状况"的仪表盘，不该和左栏的
                 * 结构树争同一个编辑入口。
                 */}
                {currentChapterNode ? (
                  <section className="flex flex-col gap-2">
                    <h2 className="row-label">
                      {t("Editor.side.chapterInfo")}
                    </h2>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={[
                          "size-1.5 shrink-0 rounded-full",
                          currentChapterNode.status === "final"
                            ? "bg-emerald-500"
                            : currentChapterNode.status === "revising"
                              ? "bg-amber-500"
                              : "bg-muted-foreground/40",
                        ].join(" ")}
                      />
                      <span className="text-xs text-muted-foreground">
                        {t(`Editor.node.status.${currentChapterNode.status}`)}
                      </span>
                    </div>
                    {currentChapterNode.synopsis ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {currentChapterNode.synopsis}
                      </p>
                    ) : null}
                    {currentChapterNode.plotSummary ? (
                      <p className="max-h-40 overflow-y-auto text-xs leading-relaxed text-muted-foreground/80">
                        {currentChapterNode.plotSummary}
                      </p>
                    ) : null}
                    {!currentChapterNode.synopsis &&
                    !currentChapterNode.plotSummary ? (
                      <p className="text-[11px] text-muted-foreground/60">
                        {t("Editor.node.plotSummaryHint")}
                      </p>
                    ) : null}
                  </section>
                ) : null}

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
              </div>
            ) : (
              <div className="min-h-0 flex-1">
                {sideTab === "codex" ? (
                  <CodexPane
                    onAppendToText={chapter ? appendCodexName : undefined}
                  />
                ) : null}
                {sideTab === "progress" ? (
                  <ProgressPane chapterWords={words} />
                ) : null}
              </div>
            )}

            {loading ? (
              <p className="text-xs text-muted-foreground">{t("Editor.status.saving")}</p>
            ) : null}

            <div className="shrink-0 border-t pt-3">
              <Popover open={draftOpen} onOpenChange={setDraftOpen}>
                <div className="relative overflow-hidden rounded-md">
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full justify-start gap-2 text-xs"
                    >
                      <FileText className="icon-sm" />
                      {t("Editor.draft.title")}
                      <ChevronUp className="text-muted-foreground ml-auto size-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <DraftFlashOverlay />
                </div>
                <PopoverContent
                  side="top"
                  align="end"
                  sideOffset={8}
                  className="w-[min(22rem,calc(100vw-2rem))] max-h-[min(24rem,55vh)] overflow-y-auto p-0"
                >
                  <div className="bg-popover sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-2">
                    <FileText className="text-muted-foreground icon-sm" />
                    <h2 className="text-sm font-semibold">
                      {t("Editor.draft.title")}
                    </h2>
                  </div>
                  <DraftBox
                    onOpenChapter={(chapterId) => {
                      setCurrentChapterId(chapterId);
                      setDraftOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </ResizablePanel>
        </>
        ) : null}
      </ResizablePanelGroup>

      {/* 删除确认：删章会连正文一起清掉，必须二次确认。 */}
      {/*
       * 重命名对话框：按钮在标题栏，表单也不该留在右栏——
       * 原先右栏里的行内输入会被结构树上的选择变化吞掉焦点。
       */}
      <Dialog
        open={renaming}
        onOpenChange={(o) => {
          if (!o) {
            setRenaming(false);
            setRenameDraft("");
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Editor.chapter.renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameDraft}
            aria-label={t("Editor.chapter.renameTitle")}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter") void renameChapter();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {t("Editor.chapter.cancelRename")}
            </Button>
            <Button disabled={!renameDraft.trim()} onClick={() => void renameChapter()}>
              {t("Editor.chapter.confirmRename")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExportDialog
        open={exportOpen}
        root={root}
        workId={currentWorkId}
        chapter={chapter}
        onOpenChange={setExportOpen}
      />

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

      {/* 卷删除：文案里带上章数，避免用户以为只删一个空卷。 */}
      <AlertDialog
        open={pendingVolumeDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingVolumeDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Editor.volume.delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("Editor.volume.deleteConfirm").replace(
                "{count}",
                String(chapters.filter((c) => c.parentId === pendingVolumeDelete).length)
              )}
            </AlertDialogDescription>

            {/*
             * 章标题预览：级联删除要能看清"到底连带了哪几章"。
             *
             * 与回收站里的恢复预览是同一个组件——两处要回答的是同一个问题，
             * 分两套实现必然会长歪。只列标题不列正文，正文在编辑器里随时可看。
             */}
            {pendingVolumeDelete ? (
              <div className="scrollbar-app mt-2 max-h-48 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2">
                <SubtreePreview
                  volume={volumes.find((v) => v.id === pendingVolumeDelete) ?? null}
                  chapters={chapters
                    .filter((c) => c.parentId === pendingVolumeDelete)
                    .sort((a, b) => a.order - b.order)}
                />
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Editor.split.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingVolumeDelete) void deleteVolume(pendingVolumeDelete);
              }}
            >
              {t("Editor.chapter.confirmDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
