/**
 * 输入确认式删除对话框。
 *
 * 为什么删除要"打一字才放行"，而普通确认只需点一下：
 * 删除按钮就摆在卡片右上角，与"继续写作"隔着不到两指宽，
 * 一次误点就会丢掉一部作品。普通 AlertDialog 只能防住"手快"，
 * 防不住"根本没看清在删什么"——而后者才是真事故。
 *
 * 要求用户输入被删对象的名称，等于强迫他读一遍那个名字。
 */

import { useEffect, useState } from "react";

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
import { Input } from "@/components/ui/input";

import { useI18n } from "@/composables";

export interface ConfirmDeleteDialogProps {
  open: boolean;
  /** 待删对象的展示名，用于确认文案。 */
  title: string;
  /** 必须输入的字符串（通常是标题或标题的一部分）。 */
  confirmText: string;
  /** 补充说明这一删的后果。 */
  description: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export default function ConfirmDeleteDialog({
  open,
  title,
  confirmText,
  description,
  onOpenChange,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");

  /*
   * 每次打开都清空输入：否则上次删 A 时打过一半的字，
   * 这次删 B 会"莫名其妙直接可确认"或反过来一直对不上。
   */
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const matched = typed.trim() === confirmText;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped("");
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="text-muted-foreground">{t("ConfirmDelete.prompt")} </span>
            <span className="font-medium">{confirmText}</span>
          </p>
          <label htmlFor="confirm-delete-input" className="sr-only">
            {t("ConfirmDelete.prompt")}
          </label>
          <Input
            id="confirm-delete-input"
            value={typed}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matched) {
                e.preventDefault();
                onConfirm();
              }
            }}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("Library.dialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matched}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              if (!matched) return;
              setTyped("");
              onConfirm();
            }}
          >
            {t("Library.action.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
