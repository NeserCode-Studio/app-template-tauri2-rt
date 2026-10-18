import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/composables";
import { historyText } from "@/services/chapter";
import type { Chapter } from "@/shared/schema";

/** 快照时间显示，与历史列表保持一致。 */
function formatAt(at: number, now: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export interface HistoryPreviewDialogProps {
  open: boolean;
  chapter: Chapter;
  /** 要预览的版本下标；-1 表示当前正文。null 表示未选择。 */
  index: number | null;
  onOpenChange: (open: boolean) => void;
  /** 确认回滚（index 为 -1 时无意义，界面不提供该按钮）。 */
  onRollback?: (index: number) => void;
}

/**
 * 版本全文预览。
 *
 * 列表里那两段预览只能让人大致认出"是这一版"，但真正决定要不要回滚
 * 的是内容对不对——"大概像第三段开头"不足以让人放心点回滚。
 * 所以给出全文，让用户在落盘之前真正确认一次。
 *
 * 排版沿用正文的文章样式（缩进、行距、字体），否则读起来是"另一种文字"，
 * 判断起来多一层无谓的心智负担。
 */
export default function HistoryPreviewDialog({
  open,
  chapter,
  index,
  onOpenChange,
  onRollback,
}: HistoryPreviewDialogProps) {
  const { t } = useI18n();
  const now = Date.now();
  const paragraphs = index === null ? [] : historyText(chapter, index);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("Editor.history.preview")}</DialogTitle>
          <DialogDescription>
            {index === null
              ? ""
              : index < 0
                ? t("Editor.history.current")
                : formatAt(chapter.history?.[index]?.at ?? now, now)}
          </DialogDescription>
        </DialogHeader>

        {paragraphs.length ? (
          <ScrollArea className="min-h-0 flex-1 rounded-md border">
            {/* 段落序号帮助对照：回滚后要能按位置核对改对了没有。 */}
            <div className="article-body prose-article mx-auto flex flex-col gap-2 px-6 py-4">
              {paragraphs.map((p, i) => (
                <p key={i} className="flex gap-3">
                  <span className="w-6 shrink-0 pt-1 text-right text-[10px] tabular-nums text-muted-foreground/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">{p}</span>
                </p>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("Editor.chapter.new")}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Titlebar.operations.close.tooltip")}
          </Button>
          {index !== null && index >= 0 && onRollback ? (
            <Button onClick={() => onRollback(index)}>
              {t("Editor.history.rollback")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
