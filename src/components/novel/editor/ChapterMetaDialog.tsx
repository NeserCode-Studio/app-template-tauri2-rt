import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/composables";
import type { OutlineNode } from "@/shared/schema";
/** 章状态：与 schema 的 status 枚举一致。 */
export type NodeStatus = "draft" | "revising" | "final";

export interface ChapterMetaDialogProps {
  open: boolean;
  node: OutlineNode | null;
  onOpenChange: (open: boolean) => void;
  onSave: (nodeId: string, patch: ChapterMetaPatch) => Promise<void>;
  /** 章字数与最近更新时间，只读展示。 */
  stats?: { words: string; updated: string };
}

export interface ChapterMetaPatch {
  status?: NodeStatus;
  synopsis?: string;
  plotSummary?: string;
}

/**
 * 章节详情对话框。
 *
 * 结构树上的内联编辑只留"状态 + 一句话摘要"两个高频字段，
 * 其余（情节小结等较长的内容）放这里：侧栏卡片只有两行高，
 * 塞不下需要回忆的段落，硬塞会让树变成一堵字墙。
 *
 * 后续新增的章节属性都往这里加，不动侧栏。
 */
export default function ChapterMetaDialog({
  open,
  node,
  onOpenChange,
  onSave,
  stats,
}: ChapterMetaDialogProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<NodeStatus>("draft");
  const [synopsis, setSynopsis] = useState("");
  const [plotSummary, setPlotSummary] = useState("");

  /* 打开时载入；关闭时不回写，避免脏数据被下一次打开静默覆盖。 */
  useEffect(() => {
    if (!open || !node) return;
    setStatus(node.status);
    setSynopsis(node.synopsis);
    setPlotSummary(node.plotSummary);
  }, [open, node]);

  const dirty =
    node !== null &&
    (status !== node.status ||
      synopsis !== node.synopsis ||
      plotSummary !== node.plotSummary);

  async function submit() {
    if (!node) return;
    await onSave(node.id, { status, synopsis, plotSummary });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">
            {node?.title ?? t("Editor.node.details")}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-4 pr-3">
            {stats ? (
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="tabular-nums">{stats.words}</span>
                {stats.updated ? <span>{stats.updated}</span> : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4">
              <Label>{t("Editor.node.status")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as NodeStatus)}>
                <SelectTrigger className="h-8 w-40" aria-label={t("Editor.node.status")}>
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
              <InputLike
                value={synopsis}
                placeholder={t("Editor.node.synopsisPlaceholder")}
                onChange={setSynopsis}
              />
              <p className="text-[10px] text-muted-foreground/60">
                {t("Editor.node.synopsisHint")}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("Editor.node.plotSummary")}
              </Label>
              <textarea
                value={plotSummary}
                rows={7}
                placeholder={t("Editor.node.plotSummaryPlaceholder")}
                aria-label={t("Editor.node.plotSummary")}
                className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed outline-none focus-visible:border-ring"
                onChange={(e) => setPlotSummary(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground/60">
                {t("Editor.node.plotSummaryHint")}
              </p>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Editor.chapter.cancelRename")}
          </Button>
          <Button disabled={!dirty} onClick={() => void submit()}>
            {t("Codex.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InputLike({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:border-ring"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
