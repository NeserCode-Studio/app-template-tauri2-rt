import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/composables";

export interface SplitDialogProps {
  open: boolean;
  /** 待拆分卡片的下标；-1 表示未打开。 */
  cardIndex: number;
  /** 卡片原文。 */
  text: string;
  onOpenChange: (open: boolean) => void;
  /** 确认拆分：在 offset 处切开，返回 [前半, 后半]。 */
  onConfirm: (offset: number) => void;
}

/**
 * 按标点拆分对话框。
 *
 * 设计约束：只在中文标点之后提供切分点，不提供字与字之间的切分。
 * 若用户确实需要在词语中间断开（例如分段排版），更合适的操作是
 * 直接编辑该卡片并手动回车分成两张——那属于内容修改而非结构操作。
 */

/** 可作为切分点的中文标点（取该标点之后的偏移）。 */
const SPLIT_MARKS = new Set([
  "。", "！", "？", "；", "：",
  "，", "、",
  "”", "’", "」", "』",
  "）", "】", "》", "〉",
  "…", "—", "·",
]);

export default function SplitDialog({
  open,
  cardIndex,
  text,
  onOpenChange,
  onConfirm,
}: SplitDialogProps) {
  const { t } = useI18n();
  const [offset, setOffset] = useState<number | null>(null);

  /**
   * 把原文切成若干片段：普通文本片段与"标点"片段交替。
   * 每个标点片段的 endPos 就是"在此标点之后"的切分偏移。
   */
  const segments = useMemo(() => {
    const chars = Array.from(text);
    const out: Array<{ text: string; endPos: number; splittable: boolean }> = [];
    let plain = "";
    let pos = 0;

    for (const ch of chars) {
      const isMark = SPLIT_MARKS.has(ch);
      if (!isMark) {
        plain += ch;
        pos += ch.length;
        continue;
      }
      // 遇到标点：先吐出累积的普通文本（若有），再吐标点本身。
      if (plain) {
        out.push({ text: plain, endPos: pos, splittable: false });
        plain = "";
      }
      pos += ch.length;
      const endPos = pos;
      const headOk = text.slice(0, endPos).trim().length > 0;
      const tailOk = text.slice(endPos).trim().length > 0;
      out.push({ text: ch, endPos, splittable: headOk && tailOk });
    }
    if (plain) out.push({ text: plain, endPos: pos, splittable: false });
    return out;
  }, [text]);

  const head = offset === null ? "" : text.slice(0, offset);
  const tail = offset === null ? "" : text.slice(offset);

  function close() {
    setOffset(null);
    onOpenChange(false);
  }

  function confirm() {
    if (offset === null) return;
    onConfirm(offset);
    close();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Editor.split.title")}</DialogTitle>
          <DialogDescription>{t("Editor.split.hint")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* 原文，标点位置可点击 */}
          <div className="prose-article max-h-40 overflow-y-auto rounded-md border bg-muted/20 px-3 py-2 text-sm">
            {segments.some((s) => s.splittable) ? (
              segments.map((seg, i) =>
                seg.splittable ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setOffset(seg.endPos)}
                    title={t("Editor.split.after")}
                    className={[
                      "rounded px-0.5 font-semibold transition-colors",
                      offset === seg.endPos
                        ? "bg-primary text-primary-foreground"
                        : "text-primary underline decoration-dotted underline-offset-4 hover:bg-accent",
                    ].join(" ")}
                  >
                    {seg.text}
                  </button>
                ) : (
                  <span key={i}>{seg.text}</span>
                )
              )
            ) : (
              <p className="text-muted-foreground">{t("Editor.split.noPunctuation")}</p>
            )}
          </div>

          {/* 预览 */}
          {offset !== null ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border p-2">
                <p className="mb-1 text-xs text-muted-foreground">1</p>
                <p className="article-paragraph prose-article">{head}</p>
              </div>
              <div className="rounded-md border p-2">
                <p className="mb-1 text-xs text-muted-foreground">2</p>
                <p className="article-paragraph prose-article">{tail}</p>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t("Editor.split.cancel")}
          </Button>
          <Button onClick={confirm} disabled={offset === null || cardIndex < 0}>
            {t("Editor.split.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
