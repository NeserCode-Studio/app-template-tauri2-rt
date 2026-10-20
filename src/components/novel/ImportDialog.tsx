import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileText, FileUp, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/composables";
import { createLogger } from "@/lib/logger";
import {
  ImportFileError,
  importFileName,
  parseImportText,
  readTextAuto,
  type ParsedImport,
} from "@/services/import";

const log = createLogger("ImportDialog");

const PREVIEW_LIMIT = 5;

export interface ImportPreview extends ParsedImport {
  path: string;
  fileName: string;
  encoding: string;
  hadBom: boolean;
}

export interface ImportDialogProps {
  open: boolean;
  target: "work" | "chapter";
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: ImportPreview) => void | Promise<void>;
}

function encodingLabel(encoding: string): string {
  if (encoding === "utf-8-bom") return "Import.encoding.utf8Bom";
  if (encoding === "gb18030") return "Import.encoding.gb18030";
  return "Import.encoding.utf8";
}

/**
 * 导入预览对话框。
 *
 * 文件在选择后立即解码并按扩展名拆分，但不会写盘。用户必须看过文件名、
 * 编码、段数和前几段正文后主动确认；确认动作由作品库或编辑器提供，
 * 因而同一个预览入口可以服务于“新建作品”和“追加到当前章”两种目标。
 */
export default function ImportDialog({
  open,
  target,
  onOpenChange,
  onConfirm,
}: ImportDialogProps) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPreview(null);
    setReading(false);
    setConfirming(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  function reportImportError(err: unknown) {
    if (err instanceof ImportFileError) {
      setError(
        t(
          err.code === "unsupported"
            ? "Import.error.unsupported"
            : "Import.error.empty"
        )
      );
      return;
    }
    log.error("read or parse failed", err);
    setError(t("Import.error.read"));
  }

  async function chooseFile() {
    if (reading || confirming) return;
    setError(null);
    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        title: t("Import.chooseTitle"),
        filters: [
          {
            name: t("Import.filter"),
            extensions: ["txt", "md"],
          },
        ],
      });
      if (!selected || Array.isArray(selected)) return;

      setReading(true);
      setPreview(null);
      const decoded = await readTextAuto(selected);
      const parsed = parseImportText(selected, decoded.content);
      setPreview({
        ...parsed,
        path: selected,
        fileName: importFileName(selected),
        encoding: decoded.encoding,
        hadBom: decoded.hadBom,
      });
    } catch (err) {
      reportImportError(err);
    } finally {
      setReading(false);
    }
  }

  async function submitImport() {
    if (!preview || confirming || reading) return;
    setConfirming(true);
    setError(null);
    try {
      await onConfirm(preview);
      onOpenChange(false);
    } catch (err) {
      log.error("commit failed", err);
      setError(t("Import.error.confirm"));
    } finally {
      setConfirming(false);
    }
  }

  const visibleCards = preview?.cards.slice(0, PREVIEW_LIMIT) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (reading || confirming)) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t(target === "work" ? "Import.workTitle" : "Import.chapterTitle")}
          </DialogTitle>
          <DialogDescription>
            {t(target === "work" ? "Import.workDesc" : "Import.chapterDesc")}
          </DialogDescription>
        </DialogHeader>

        {preview ? (
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
                <FileText className="icon-md text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={preview.fileName}>
                  {preview.fileName}
                </p>
                <p
                  className="mt-0.5 truncate text-xs text-muted-foreground"
                  title={preview.path}
                >
                  {preview.path}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void chooseFile()}
                disabled={reading || confirming}
              >
                <RotateCcw className="icon-sm" />
                {t("Import.changeFile")}
              </Button>
            </div>

            <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground">{t("Import.format")}</dt>
                <dd className="mt-0.5 font-medium">
                  {preview.format === "md" ? "Markdown" : "TXT"}
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground">{t("Import.encoding")}</dt>
                <dd className="mt-0.5 font-medium">
                  {t(encodingLabel(preview.encoding))}
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground">
                  {t("Import.paragraphs")}
                </dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {preview.cards.length}
                </dd>
              </div>
            </dl>

            <section className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{t("Import.preview")}</h3>
                <span className="text-xs text-muted-foreground">
                  {t("Import.previewLimit")}
                </span>
              </div>
              <div className="scrollbar-app max-h-[min(24rem,44vh)] overflow-y-auto rounded-md border bg-muted/15">
                {visibleCards.map((card, index) => (
                  <div
                    key={card.id}
                    className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 border-b px-3 py-2.5 last:border-b-0"
                  >
                    <span className="pt-0.5 text-right text-xs text-muted-foreground/70 tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {card.text}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/15 px-6 py-8 text-center">
            {reading ? (
              <>
                <Loader2 className="icon-lg animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t("Import.reading")}
                </p>
              </>
            ) : (
              <>
                <div className="flex size-10 items-center justify-center rounded-full border bg-background">
                  <FileUp className="icon-md text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t("Import.noFile")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("Import.noFileHint")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void chooseFile()}
                >
                  <FileUp className="icon-sm" />
                  {t("Import.choose")}
                </Button>
              </>
            )}
          </div>
        )}

        {error ? (
          <p className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={reading || confirming}
          >
            {t("Library.dialog.cancel")}
          </Button>
          <Button
            onClick={() => void submitImport()}
            disabled={!preview || reading || confirming}
          >
            {confirming ? <Loader2 className="icon-sm animate-spin" /> : null}
            {t("Import.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
