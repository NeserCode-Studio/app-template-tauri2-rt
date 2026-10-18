import { useCallback, useEffect, useState } from "react";
import { RotateCcw, ScanSearch, Trash2 } from "lucide-react";
import { toast as sonnerToast } from "sonner";

import {
  Dialog,
  DialogContent,
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
import { cn } from "@/lib/utils";

import { useI18n, useToast } from "@/composables";
import { listTrash, purgeFromTrash, restoreFromTrash, type TrashItem } from "@/services/trash";
import { scanAndRepair } from "@/services/workspace";

export interface TrashDialogProps {
  open: boolean;
  root: string | null;
  onOpenChange: (open: boolean) => void;
  /** 恢复后通知父级重载（作品/结构树可能变化）。 */
  onRestored?: () => void;
}

/** 回收站：列出已删项，可恢复或彻底删除。 */
export default function TrashDialog({ open, root, onOpenChange, onRestored }: TrashDialogProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [pendingPurge, setPendingPurge] = useState<TrashItem | null>(null);
  const [scanning, setScanning] = useState(false);

  /**
   * 带数量的扫描报告 toast。
   *
   * 绕开了 useToast：它只收 i18n 符号并自行翻译，而这里需要先做
   * {count} 插值再送出。硬塞一个已翻译的字符串进去会被 t() 当成 key
   * 再翻一次，日志里留下 "missing i18n key" 的假警报。改 useToast 的
   * 签名去兼容两种用法会波及全站几十个调用点，不值得。
   */
  const countToast = (
    symbol: string,
    count: number,
    level: "success" | "error"
  ): void => {
    sonnerToast[level](t(symbol).replace("{count}", String(count)));
  };

  const reload = useCallback(async () => {
    if (!root) return;
    setItems(await listTrash(root));
  }, [root]);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  async function restore(item: TrashItem) {
    if (!root) return;
    const ok = await restoreFromTrash(root, item.itemId);
    if (ok) {
      toast.success("Trash.restored");
      onRestored?.();
    } else {
      toast.error("Trash.restoreFailed");
    }
    void reload();
  }

  /**
   * 深度扫描：对账磁盘与清单，并把报告逐条 toast 出来。
   *
   * 报告要分条而不是合并成一句"已修复"：三类结果的用户含义完全不同——
   * 补回孤儿是救回了数据，标记对齐是修好了状态，而"清单有、磁盘无"
   * 是发现了一个用户多半还没注意到的问题，值得单独一条。
   *
   * 文案里的 {count} 走 t().replace()，与卷删除确认用的插值方式一致，
   * 不为此给 useToast 再开一个 params 口径。
   */
  async function runScan() {
    if (!root || scanning) return;
    setScanning(true);
    try {
      const report = await scanAndRepair(root);
      toast.success("Trash.scanDone");
      if (report.orphans.length) {
        countToast("Trash.scanOrphans", report.orphans.length, "success");
      }
      if (report.flagsFixed.length) {
        countToast("Trash.scanFlags", report.flagsFixed.length, "success");
      }
      if (report.missing.length) {
        countToast("Trash.scanMissing", report.missing.length, "error");
      }
      const recovered = report.recoveredChapters.reduce((sum, w) => sum + w.count, 0);
      if (recovered) countToast("Trash.scanRecovered", recovered, "success");
      const dangling = report.danglingChapters.reduce((sum, w) => sum + w.count, 0);
      if (dangling) countToast("Trash.scanDangling", dangling, "error");
      if (
        !report.orphans.length &&
        !report.flagsFixed.length &&
        !report.missing.length &&
        !recovered &&
        !dangling
      ) {
        toast.success("Trash.scanClean");
      }
      /* 孤儿作品可能刚被补进清单，作品库要重读才能看见。 */
      onRestored?.();
    } catch {
      toast.error("Library.toast.failed");
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? undefined : onOpenChange(false))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Trash.title")}</DialogTitle>
          </DialogHeader>

          <div className="flex items-start justify-between gap-3 rounded-md border border-dashed px-3 py-2">
            <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
              {t("Trash.scanHint")}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0"
              disabled={!root || scanning}
              onClick={() => void runScan()}
            >
              <ScanSearch className={cn("icon-sm", scanning && "animate-pulse")} />
              {t("Trash.scan")}
            </Button>
          </div>

          {items.length ? (
            <ScrollArea className="max-h-96">
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <li
                  key={item.itemId}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{item.title}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {t(`Trash.kind.${item.kind}`)} ·{" "}
                      {new Date(item.deletedAt).toLocaleString()}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => void restore(item)}
                  >
                    <RotateCcw className="icon-sm" />
                    {t("Trash.restore")}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive hover:text-destructive"
                    aria-label={t("Trash.purge")}
                    title={t("Trash.purge")}
                    onClick={() => setPendingPurge(item)}
                  >
                    <Trash2 className="icon-sm" />
                  </Button>
                </li>
              ))}
            </ul>
            </ScrollArea>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("Trash.empty")}</p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingPurge !== null}
        onOpenChange={(o) => {
          if (!o) setPendingPurge(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Trash.purge")}</AlertDialogTitle>
            <AlertDialogDescription>{t("Trash.purgeConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Editor.chapter.cancelRename")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!root || !pendingPurge) return;
                void purgeFromTrash(root, pendingPurge.itemId).then(() => {
                  setPendingPurge(null);
                  void reload();
                });
              }}
            >
              {t("Trash.purge")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
