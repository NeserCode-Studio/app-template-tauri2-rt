import { useViewMode } from "@/contexts/viewmode";
import { useMcpEditorOperation } from "@/mcp/editor-operation";
import type { Chapter } from "@/shared/schema";
import ChapterBody from "./ChapterBody";
import ChapterHeader from "./ChapterHeader";
import ComposerInput from "./ComposerInput";
import HistoryDialog from "./HistoryDialog";
import SplitDialog from "./SplitDialog";
import { useChapterController } from "./useChapterController";

export interface ChapterEditorProps {
  chapter: Chapter;
  /** 工作区根与作品 id，落盘时需要。 */
  root: string;
  workId: string;
  /** 章内容变化后通知父级（用于更新字数统计）。 */
  onWordsChange?: (words: number) => void;
  /** 章保存后通知父级（用于同步 outline 状态）。 */
  onSaved?: (chapter: Chapter) => void;
  /**
   * 章保存后上报本章字数（用于作品库的字数统计）。
   * 传全量而非增量，避免重载 / 修数据后统计越漂越远。
   */
  onWordsCommitted?: (
    chapterWords: number,
    previousChapterWords?: number
  ) => void | Promise<void>;
  /**
   * 章级操作入口：重命名与删除。
   *
   * 由父级（Editor）实现并传入，因此标题栏只负责呈现，
   * 章文件与结构树的双写逻辑仍留在 Editor 一处。
   */
  onRename?: () => void;
  onDelete?: () => void;
  /** 打开素材库并选中条目（正文 hover 卡点击）。 */
  onOpenCodexEntry?: (entryId: string) => void;
}

/**
 * 章内容编辑器：卡片列表 + 底部唯一输入框。
 *
 * 界面已拆成三块（ChapterHeader / ChapterBody / ComposerInput），
 * 状态与副作用全在 useChapterController 里。这样连续章节流可以把三块
 * 分别摆到屏幕上、中、下，而不必每章各渲染一整套 chrome。
 *
 * 本组件保留给"单章使用"的场景（如没有流的回退路径）；
 * 流内请直接用拆分后的三块 + 同一个 controller。
 */
export default function ChapterEditor({
  chapter,
  root,
  workId,
  onWordsChange,
  onSaved,
  onWordsCommitted,
  onRename,
  onDelete,
  onOpenCodexEntry,
}: ChapterEditorProps) {
  const { mode } = useViewMode();
  const operationLock = useMcpEditorOperation(workId, chapter.id);
  const editorLocked = Boolean(operationLock);
  const c = useChapterController({
    chapter,
    root,
    workId,
    locked: editorLocked,
    onWordsChange,
    onSaved,
    onWordsCommitted,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SplitDialog
        open={c.splitTarget !== null}
        cardIndex={c.splitTarget ?? -1}
        text={
          c.splitTarget !== null ? (c.cards[c.splitTarget]?.text ?? "") : ""
        }
        onOpenChange={(o) => {
          if (!o) c.setSplitTarget(null);
        }}
        onConfirm={c.confirmSplit}
      />
      <HistoryDialog
        open={c.historyOpen}
        chapter={c.chapterWithHistory}
        onOpenChange={c.setHistoryOpen}
        onRollback={(i) => void c.rollback(i)}
        onDelete={(i) => void c.dropVersion(i)}
      />

      <ChapterHeader
        title={chapter.title}
        words={c.words}
        saveState={c.saveState}
        hasLastMerge={Boolean(c.lastMerge)}
        onRename={onRename}
        onDelete={onDelete}
        onSave={c.saveNow}
        onOpenHistory={() => c.setHistoryOpen(true)}
        onUndoMerge={c.undoMerge}
        locked={editorLocked}
      />

      <ChapterBody
        cards={c.cards}
        editingIndex={c.editingIndex}
        dimOthers={mode === "focus" && c.editingIndex >= 0}
        onEdit={c.handleCardClick}
        onMoveUp={c.moveUp}
        onMoveDown={c.moveDown}
        onSplit={c.splitCard}
        onMergeDown={c.mergeDown}
        onDelete={c.deleteCard}
        onOpenCodexEntry={onOpenCodexEntry}
        listRef={c.listRef}
        locked={editorLocked}
      />

      <div className="shrink-0">
        <ComposerInput
          ref={c.composerRef}
          editingIndex={c.editingIndex}
          onSubmit={c.handleSubmit}
          onReturnToNew={c.returnToNew}
          pendingDraft={c.draft}
          onRestoreDraft={c.restoreDraft}
          onDiscardDraft={c.discardDraft}
          operationLock={operationLock}
        />
      </div>
    </div>
  );
}
