import { Check, History, Loader2, Pencil, Save, Trash2, Undo2 } from "lucide-react";

import { useI18n } from "@/composables";
import { Button } from "@/components/ui/button";

/**
 * 章标题栏：标题 + 章级操作 + 保存状态与入口。
 *
 * 从 ChapterEditor 里拆出来，是为了让连续章节流把它固定在屏幕顶部：
 * 整个应用只有一份标题栏，它永远描述"当前正在写的那一章"。
 * 若每章各带一份，用户会以为自己在同时看好几章。
 */
export default function ChapterHeader({
  title,
  words,
  saveState,
  hasLastMerge,
  onRename,
  onDelete,
  onSave,
  onOpenHistory,
  onUndoMerge,
}: {
  title: string;
  words: number;
  saveState: "saved" | "dirty" | "saving";
  hasLastMerge: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onSave: () => void;
  onOpenHistory: () => void;
  onUndoMerge: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="flex items-center justify-between gap-3 border-b px-6 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-base font-semibold">
          {title || t("Editor.title.placeholder")}
        </h2>
        {/*
         * 章级操作放在标题栏而不是右栏：改名与删除作用于"当前这一章"，
         * 标题栏就是它的位置指示器。放在右栏里，用户得先理解
         * "右栏的按钮为什么改的是中间这章"。
         */}
        {onRename ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            aria-label={t("Editor.chapter.rename")}
            title={t("Editor.chapter.rename")}
            onClick={onRename}
          >
            <Pencil className="icon-sm" />
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0 text-destructive hover:text-destructive"
            aria-label={t("Editor.chapter.delete")}
            title={t("Editor.chapter.delete")}
            onClick={onDelete}
          >
            <Trash2 className="icon-sm" />
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {words} {t("Editor.chapter.words")}
        </span>
        <span className="flex items-center gap-1">
          {saveState === "saving" ? (
            <>
              <Loader2 className="icon-sm animate-spin" />
              {t("Editor.status.saving")}
            </>
          ) : saveState === "dirty" ? (
            t("Editor.status.dirty")
          ) : (
            <>
              <Check className="icon-sm" />
              {t("Editor.status.saved")}
            </>
          )}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={saveState === "saving"}
          onClick={onSave}
        >
          <Save className="icon-sm" />
          {t("Editor.save.manual")}
        </Button>
        {/* 历史版本：编辑器撤销栈退出即失效，这里是跨会话的唯一退路。 */}
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={onOpenHistory}
        >
          <History className="icon-sm" />
          {t("Editor.history.open")}
        </Button>
        {/*
         * 撤回合并：合并是"破坏性"的（少了一张卡），
         * 因此在保存按钮旁给一个显式出口，而不只依赖 Ctrl+Z。
         */}
        {hasLastMerge ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={onUndoMerge}
          >
            <Undo2 className="icon-sm" />
            {t("Editor.card.undoMerge")}
          </Button>
        ) : null}
      </div>
    </header>
  );
}
