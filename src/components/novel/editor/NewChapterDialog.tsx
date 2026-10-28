import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/composables";

export interface NewChapterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 确认创建：标题为空时视为取消。 */
  onConfirm: (title: string) => void | Promise<void>;
}

/**
 * 章节命名对话框。
 *
 * 用户反馈：原先「添加章节」直接落一个名为「新建章节」的条目，
 * 既污染结构树也让用户跳过命名。这里强制先命名再建章。
 */
export default function NewChapterDialog({
  open,
  onOpenChange,
  onConfirm,
}: NewChapterDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  /* 每次打开都重置，避免上一次的残留标题。 */
  useEffect(() => {
    if (open) setTitle("");
  }, [open]);

  async function confirm() {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onConfirm(name);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onOpenChange(false))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Editor.chapter.nameTitle")}</DialogTitle>
          <DialogDescription>{t("Editor.chapter.nameHint")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <Input
            autoFocus
            value={title}
            placeholder={t("Editor.chapter.namePlaceholder")}
            aria-label={t("Editor.chapter.namePlaceholder")}
            onChange={(e) => setTitle(e.target.value)}
          />
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              {t("Editor.split.cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              {t("Editor.chapter.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
