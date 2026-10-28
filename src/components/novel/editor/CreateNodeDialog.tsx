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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/composables";
import type { OutlineNode } from "@/shared/schema";

export interface CreateNodeInput {
  title: string;
  parentId: string | null;
  /** 章状态：建章时顺手定，省得建完再去详情里改。 */
  status: "draft" | "revising" | "final";
  /** 一句话摘要。 */
  synopsis: string;
}

export interface CreateNodeDialogProps {
  open: boolean;
  title: string;
  placeholder: string;
  /** 可选父级（卷）；为空表示不显示父级选择。 */
  volumes?: OutlineNode[];
  /** 父级默认值。 */
  defaultParentId?: string | null;
  /** 显示状态与摘要字段（建章时有用，建卷时不需要）。 */
  withMeta?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: CreateNodeInput) => Promise<void> | void;
}

/** 「不放入任何卷」这个选项的哨兵值——不能用 null 本身，选中项需要字符串。 */
const ROOT_VALUE = "__root__";

/**
 * 新建卷 / 新建章节的对话框。
 *
 * 早前是在结构树里插一行行内输入框，但那样没有"取消"的位置：
 * 用户要么填完提交，要么点别处让输入框一直挂在树上。点击"新建"
 * 本身就是明确意图，用对话框承接更符合语义。
 *
 * 建章时把"放哪个卷"和"初始状态"一并在这里定完：这两个都是
 * 结构性选择，放到建完之后的详情里改，等于让用户先做一半再回来补。
 */
export default function CreateNodeDialog({
  open,
  title,
  placeholder,
  volumes,
  defaultParentId = null,
  withMeta = false,
  onOpenChange,
  onConfirm,
}: CreateNodeDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>(defaultParentId ?? ROOT_VALUE);
  const [status, setStatus] = useState<"draft" | "revising" | "final">("draft");
  const [synopsis, setSynopsis] = useState("");

  /* 每次打开重置：沿用上次的残留值会让人以为已经填好了。 */
  useEffect(() => {
    if (!open) return;
    setName("");
    setParentId(defaultParentId ?? ROOT_VALUE);
    setStatus("draft");
    setSynopsis("");
  }, [open, defaultParentId]);

  async function submit() {
    const value = name.trim();
    if (!value) return;
    await onConfirm({
      title: value,
      parentId: parentId === ROOT_VALUE ? null : parentId,
      status,
      synopsis,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">{t("Codex.name")}</Label>
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
          </div>

          {volumes ? (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t("Editor.side.volume")}</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger className="h-8" aria-label={t("Editor.side.volume")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_VALUE}>{t("Editor.node.noVolume")}</SelectItem>
                  {volumes.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {withMeta ? (
            <>
              <div className="flex items-center justify-between gap-4">
                <Label className="text-xs text-muted-foreground">
                  {t("Editor.node.status")}
                </Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as typeof status)}
                >
                  <SelectTrigger className="h-8 w-36" aria-label={t("Editor.node.status")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">{t("Editor.node.status.draft")}</SelectItem>
                    <SelectItem value="revising">
                      {t("Editor.node.status.revising")}
                    </SelectItem>
                    <SelectItem value="final">{t("Editor.node.status.final")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  {t("Editor.node.synopsis")}
                </Label>
                <Input
                  value={synopsis}
                  placeholder={t("Editor.node.synopsisPlaceholder")}
                  aria-label={t("Editor.node.synopsis")}
                  onChange={(e) => setSynopsis(e.target.value)}
                />
              </div>
            </>
          ) : null}
        </div>

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
