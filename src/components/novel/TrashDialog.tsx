import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

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

import { useI18n, useToast } from "@/composables";
import { listTrash, purgeFromTrash, restoreFromTrash, type TrashItem } from "@/services/trash";

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

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => (o ? undefined : onOpenChange(false))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Trash.title")}</DialogTitle>
          </DialogHeader>

          {items.length ? (
            <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
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
