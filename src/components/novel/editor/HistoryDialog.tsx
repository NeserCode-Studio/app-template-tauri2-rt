import { History } from "lucide-react";

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
}

export default function HistoryDialog({
  open,
  chapter,
  onOpenChange,
  onRollback,
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

        {entries.length ? (
          <ScrollArea className="max-h-80">
            <ul className="flex flex-col gap-1 pr-3">
              {entries.map((h) => (
                <li key={h.index} className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatAt(h.at, now)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {h.preview || t("Editor.chapter.new")}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {h.words} {t("Editor.history.words")}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0"
                    onClick={() => onRollback(h.index)}
                  >
                    {t("Editor.history.rollback")}
                  </Button>
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
