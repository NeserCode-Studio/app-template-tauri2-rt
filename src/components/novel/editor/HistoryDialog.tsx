import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";

import { useI18n } from "@/composables";
import { historyText, listHistory, type HistoryEntry } from "@/services/chapter";
import type { Chapter } from "@/shared/schema";

import HistoryPreviewDialog from "./HistoryPreviewDialog";

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
  /** 点某一版本时打开全文预览。 */
  const [preview, setPreview] = useState<number | null>(null);
  /**
   * 待删除的版本下标。
   *
   * 删除快照不可撤销——不像回滚会把原正文存回去，删掉就是彻底没了。
   * 所以必须先看内容、再确认，而不是给一个一次点击就能生效的垃圾桶图标。
   * null 表示没有待删除项。
   */
  const [pendingDrop, setPendingDrop] = useState<number | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Editor.history.title")}</DialogTitle>
          <DialogDescription>{t("Editor.history.confirm")}</DialogDescription>
        </DialogHeader>

        {/*
         * 只剩当前版本时仍然显示这一行，而不是切成"暂无快照"空态——
         * 否则用户删掉最后一个旧版本后，看到的是"没有历史"，
         * 会误以为整章的历史被清空了。
         */}
        {entries.length ? (
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
                  {/*
                   * 整块可点开看全文。两段预览只能让人认出"是这一版"，
                   * 不足以判断内容是不是要的——真正的确认在预览弹窗里做。
                   */}
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setPreview(h.index)}
                    title={t("Editor.history.preview")}
                  >
                    <span className="flex items-center gap-1.5">
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
                  </button>
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
                          className="h-7 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingDrop(h.index)}
                        >
                          {t("Editor.history.drop")}
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("Editor.history.empty")}
          </p>
        )}

        <HistoryPreviewDialog
          open={preview !== null}
          chapter={chapter}
          index={preview}
          onOpenChange={(o) => {
            if (!o) setPreview(null);
          }}
          onRollback={(i) => {
            setPreview(null);
            onRollback(i);
          }}
        />

        {/* 删除确认：先看清内容再决定，不可撤销。 */}
        <AlertDialog open={pendingDrop !== null} onOpenChange={(o) => {
          if (!o) setPendingDrop(null);
        }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Editor.history.dropConfirm")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("Editor.history.dropHint")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="max-h-48 overflow-y-auto rounded-md border p-3 text-xs leading-relaxed">
              {pendingDrop === null
                ? ""
                : (historyText(chapter, pendingDrop).join("\n") ||
                  t("Editor.chapter.new"))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Editor.split.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (pendingDrop !== null) onDelete(pendingDrop);
                  setPendingDrop(null);
                }}
              >
                {t("Editor.history.drop")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Titlebar.operations.close.tooltip")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
