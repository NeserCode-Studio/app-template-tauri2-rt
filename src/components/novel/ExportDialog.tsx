import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useI18n, useToast } from "@/composables";
import { useLibrary } from "@/contexts/library";
import {
  DEFAULT_EXPORT_OPTIONS,
  buildExportText,
  exportToFile,
  type ExportOptions,
} from "@/services/export";
import type { Chapter } from "@/shared/schema";

export interface ExportDialogProps {
  open: boolean;
  root: string;
  workId: string;
  /** 当前章，用于"仅导出本章"。 */
  chapter: Chapter | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * 导出对话框。
 *
 * 内置预览：导出格式的坑几乎全在排版上（换行、缩进、标题格式），
 * 而这些只有看见结果才能判断。预览与实际导出走**同一个**组装函数，
 * 避免"预览好看、导出的不对"这种最难排查的偏差。
 */
export default function ExportDialog({
  open,
  root,
  workId,
  chapter,
  onOpenChange,
}: ExportDialogProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { works } = useLibrary();

  const [scope, setScope] = useState<"chapter" | "work">("chapter");
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);

  const onlyChapterId =
    scope === "chapter" ? (chapter?.id ?? undefined) : undefined;
  const workTitle = works[workId]?.title ?? "";

  /* 打开即生成预览：选项改动后就地重算。 */
  const refresh = useCallback(async () => {
    try {
      setPreview(await buildExportText(root, workId, opts, onlyChapterId));
    } catch {
      setPreview("");
    }
  }, [root, workId, opts, onlyChapterId]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  const fileName = useMemo(() => {
    if (scope === "chapter" && chapter) return chapter.title || "chapter";
    return workTitle || "novel";
  }, [scope, chapter, workTitle]);

  async function doExport() {
    if (busy) return;
    setBusy(true);
    try {
      const path = await exportToFile(
        root,
        workId,
        fileName,
        opts,
        onlyChapterId
      );
      if (path) {
        toast.success("Export.done");
        onOpenChange(false);
      }
    } catch {
      toast.error("Library.toast.failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? undefined : onOpenChange(false))}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Export.action")}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* 左：选项 */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t("Export.format")}</Label>
              <Select
                value={opts.format}
                onValueChange={(value) =>
                  setOpts({ ...opts, format: value as ExportOptions["format"] })
                }
              >
                <SelectTrigger
                  className="h-8 text-sm"
                  aria-label={t("Export.format")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="txt">{t("Export.format.txt")}</SelectItem>
                  <SelectItem value="md">{t("Export.format.md")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t("Export.scope")}</Label>
              <Select
                value={scope}
                onValueChange={(v) => setScope(v as "chapter" | "work")}
              >
                <SelectTrigger
                  className="h-8 text-sm"
                  aria-label={t("Export.scope")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chapter" disabled={!chapter}>
                    {t("Export.chapter")}
                  </SelectItem>
                  <SelectItem value="work">{t("Export.work")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">
                {t("Export.includeChapterTitle")}
              </Label>
              <Switch
                checked={opts.includeChapterTitle}
                disabled={opts.format === "md"}
                onCheckedChange={(v) =>
                  setOpts({ ...opts, includeChapterTitle: v })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">
                {t("Export.includeVolumeTitle")}
              </Label>
              <Switch
                checked={opts.includeVolumeTitle}
                disabled={opts.format === "md"}
                onCheckedChange={(v) =>
                  setOpts({ ...opts, includeVolumeTitle: v })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">{t("Export.indent")}</Label>
              <Switch
                checked={opts.indentParagraph}
                disabled={opts.format === "md"}
                onCheckedChange={(v) =>
                  setOpts({ ...opts, indentParagraph: v })
                }
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("Export.titleFormat")}</Label>
              <Select
                value={opts.titleFormat}
                disabled={opts.format === "md"}
                onValueChange={(v) =>
                  setOpts({
                    ...opts,
                    titleFormat: v as ExportOptions["titleFormat"],
                  })
                }
              >
                <SelectTrigger
                  className="h-8 text-sm"
                  aria-label={t("Export.titleFormat")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plain">
                    {t("Export.titleFormat.plain")}
                  </SelectItem>
                  <SelectItem value="bracket">
                    {t("Export.titleFormat.bracket")}
                  </SelectItem>
                  <SelectItem value="hash">
                    {t("Export.titleFormat.hash")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {opts.format === "md" ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("Export.markdownFixed")}
              </p>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("Export.newline")}</Label>
              <Select
                value={opts.newline}
                onValueChange={(v) =>
                  setOpts({ ...opts, newline: v as "lf" | "crlf" })
                }
              >
                <SelectTrigger
                  className="h-8 text-sm"
                  aria-label={t("Export.newline")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="crlf">
                    {t("Export.newline.crlf")}
                  </SelectItem>
                  <SelectItem value="lf">{t("Export.newline.lf")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 右：预览 */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t("Export.preview")}</Label>
            <pre className="prose-article bg-muted/20 max-h-80 min-h-40 flex-1 overflow-auto rounded-md border p-2 text-xs whitespace-pre-wrap">
              {preview || "—"}
            </pre>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Editor.chapter.cancelRename")}
          </Button>
          <Button onClick={() => void doExport()} disabled={busy}>
            {t("Export.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
