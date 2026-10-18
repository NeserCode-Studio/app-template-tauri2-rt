import { useState } from "react";

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
  /** 是否正等着用户确认回滚。 */
  const [confirming, setConfirming] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
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

        {/*
         * 预览框用原生滚动，不用 ScrollArea。
         *
         * ScrollArea 的 Root 不裁剪（overflow 都在内层 viewport），长文的
         * 40em 行宽会直接画到 DialogFooter 上去；而补了 overflow-hidden 之后
         * Radix 又不再让根节点滚动，于是内容卡住滚不动——两条路都不对。
         *
         * 原生 overflow-y-auto 一行就同时解决高度上限与裁剪，也符合本项目
         * 的既定做法：ScrollArea 只留给模板容器，普通滚动一律原生 + scrollbar-app。
         * min-h-0 必需，否则 flex 子项的默认 min-height:auto 不肯收缩到 max-h 以内。
         */}
        {paragraphs.length ? (
          <div className="scrollbar-app min-h-0 flex-1 overflow-y-auto rounded-md border">
            {/* 段落序号帮助对照：回滚后要能按位置核对改对了没有。 */}
            <div className="prose-article mx-auto flex max-w-[var(--app-line-width)] flex-col gap-2 px-6 py-4">
              {paragraphs.map((p, i) => (
                <p key={i} className="flex gap-3">
                  <span className="w-6 shrink-0 pt-1 text-right text-[10px] tabular-nums text-muted-foreground/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">{p}</span>
                </p>
              ))}
            </div>
          </div>
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
            <Button onClick={() => setConfirming(true)}>
              {t("Editor.history.rollback")}
            </Button>
          ) : null}
        </DialogFooter>

        {/*
         * 回滚确认。
         *
         * 回滚不像删除那样不可逆——当前正文会被存回历史，滚错了还能再滚回来。
         * 但它确实会整体替换正文、并把目标版本从历史里移走，属于重写级的
         * 动作，值得停一下让用户看清"现在写的内容会被换成这一版"。
         */}
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Editor.history.rollbackConfirm")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("Editor.history.rollbackHint")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Editor.split.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (index !== null && index >= 0) onRollback?.(index);
                  setConfirming(false);
                }}
              >
                {t("Editor.history.rollback")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
