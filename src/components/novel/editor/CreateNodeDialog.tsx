import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/composables";

export interface CreateNodeDialogProps {
  open: boolean;
  /** 对话框标题（新建章节 / 新建卷）。 */
  title: string;
  /** 输入框占位符。 */
  placeholder: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => Promise<void> | void;
}

/**
 * 新建卷 / 新建章节的对话框。
 *
 * 早前是在结构树里插一行行内输入框，但那样没有"取消"的位置：
 * 用户要么填完提交，要么点别处让输入框一直挂在树上。已经点了
 * "新建"就是明确意图，用对话框承接并给出取消/确认更符合语义。
 */
export default function CreateNodeDialog({
  open,
  title,
  placeholder,
  onOpenChange,
  onConfirm,
}: CreateNodeDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");

  /* 每次打开都清空：沿用上次残留的名字会让人以为已经填好了。 */
  useEffect(() => {
    if (open) setName("");
  }, [open]);

  async function submit() {
    const value = name.trim();
    if (!value) return;
    await onConfirm(value);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            /* 回车判定必须排除输入法组合期，否则候选词确认会被当成提交。 */
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onOpenChange(false);
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Editor.chapter.cancelRename")}
          </Button>
          <Button disabled={!name.trim()} onClick={() => void submit()}>
            {t("Codex.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
