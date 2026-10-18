import { Clock, History, Trash2 } from "lucide-react";

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
import { listHistory, type HistoryEntry } from "@/services/chapter";
import type { Chapter } from "@/shared/schema";

/** 快照时间显示：今天只显示时刻，更早的补上日期。 */
function formatAt(at: number, now: number): string {
  const d = new Date(at);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export interface HistoryDialogProps {
  open: boolean;
  chapter: Chapter;
  onOpenChange: (open: boolean) => void;
  /** 回滚到指定历史下标，由父级负责落盘与刷新。 */
  onRollback: (index: number) => void;
  /** 删除指定历史快照，由父级负责落盘与刷新。 */
  onDelete: (index: number) => void;
}

export default function HistoryDialog({
  open,
  chapter,
  onOpenChange,
  onRollback,
  onDelete,
}: HistoryDialogProps) {
  const { t } = useI18n();
  const now = Date.now();
  const entries: HistoryEntry[] = listHistory(chapter);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="icon-sm" />
            {t("Editor.history.title")}
          </DialogTitle>
          <DialogDescription>{t("Editor.history.confirm")}</DialogDescription>
        </DialogHeader>

        {entries.length > 1 ? (
          <ScrollArea className="max-h-96">
            <ul className="flex flex-col gap-1 pr-3">
              {entries.map((h) => (
                <li
                  key={h.index}
                  className={[
                    "flex items-start gap-3 rounded-md border px-3 py-2",
                    /* 当前正文固定在首项并高亮，与历史快照区分开。 */
                    h.index < 0 ? "border-primary/40 bg-accent/40" : "",
                  ].join(" ")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {h.index < 0 ? (
                        <Clock className="icon-sm shrink-0 text-primary" />
                      ) : null}
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {formatAt(h.at, now)}
                      </span>
                      {h.index < 0 ? (
                        <span className="rounded-sm bg-primary/15 px-1 text-[10px] text-primary">
                          {t("Editor.history.current")}
                        </span>
                      ) : null}
                    </span>
                    {/*
                     * 预览给两段而不是一行前缀：长章的前 40 字常常全挤在
                     * 第一段里，单行看不出这一版到底写了什么。折行展示也
                     * 让"这一版比上一版长/短"看得出来。
                     */}
                    <span className="mt-1 block space-y-0.5">
                      {h.paragraphs.length ? (
                        h.paragraphs.map((p, i) => (
                          <span
                            key={i}
                            className="line-clamp-2 block text-xs leading-snug text-foreground/90"
                          >
                            {p}
                          </span>
                        ))
                      ) : (
                        <span className="block text-xs text-muted-foreground">
                          {t("Editor.chapter.new")}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground/70">
                      {h.words} {t("Editor.history.words")} · {h.cardCount}{" "}
                      {t("Editor.history.cards")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col gap-1">
                    {h.index < 0 ? null : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={() => onRollback(h.index)}
                        >
                          {t("Editor.history.rollback")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-muted-foreground hover:text-destructive"
                          aria-label={t("Editor.history.drop")}
                          title={t("Editor.history.drop")}
                          onClick={() => onDelete(h.index)}
                        >
                          <Trash2 className="icon-sm" />
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("Editor.history.empty")}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Titlebar.operations.close.tooltip")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
