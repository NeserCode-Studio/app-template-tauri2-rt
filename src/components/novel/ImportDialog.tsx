import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileText, FileUp, Loader2, RotateCcw, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/composables";
import { createLogger } from "@/lib/logger";
import {
  ImportFileError,
  importFileName,
  importTitleFromPath,
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
  title: string;
  autoParagraph: boolean;
}

export interface ImportDialogProps {
  open: boolean;
  target: "work" | "chapter";
  /** 当前作品保存的导入偏好。 */
  defaultAutoParagraph?: boolean;
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
  defaultAutoParagraph = true,
  onOpenChange,
  onConfirm,
}: ImportDialogProps) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stripSectionNumbers, setStripSectionNumbers] = useState(false);
  const [autoParagraph, setAutoParagraph] = useState(true);

  const reset = useCallback(() => {
    setPreview(null);
    setRawText(null);
    setReading(false);
    setConfirming(false);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (open) setAutoParagraph(defaultAutoParagraph);
  }, [open, defaultAutoParagraph]);

  /* 编号清理与自动分段只影响解析；切换后用原始文本重新拆分。 */
  useEffect(() => {
    if (!preview || rawText === null) return;
    try {
      const parsed = parseImportText(preview.path, rawText, {
        stripSectionNumbers,
        autoParagraph,
      });
      setPreview((previous) =>
        previous
          ? {
              ...previous,
              cards: parsed.cards,
              sections: parsed.sections,
              volumes: parsed.volumes,
              title: previous.title,
              autoParagraph,
            }
          : previous
      );
    } catch (err) {
      reportImportError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.path, rawText, stripSectionNumbers, autoParagraph]);

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
      const parsed = parseImportText(selected, decoded.content, {
        stripSectionNumbers,
        autoParagraph,
      });
      setRawText(decoded.content);
      setPreview({
        ...parsed,
        path: selected,
        fileName: importFileName(selected),
        encoding: decoded.encoding,
        hadBom: decoded.hadBom,
        title: importTitleFromPath(selected),
        autoParagraph,
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

  const structured =
    (preview?.sections.length ?? 0) > 1 ||
    (preview?.volumes.length ?? 0) > 0 ||
    Boolean(
      preview?.sections.some((section) => section.title || section.volumeTitle)
    );
  const visibleSections = preview?.sections.slice(0, PREVIEW_LIMIT) ?? [];
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
            <div className="bg-muted/20 flex items-center gap-3 rounded-md border px-3 py-2.5">
              <div className="bg-background flex size-9 shrink-0 items-center justify-center rounded-md border">
                <FileText className="icon-md text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-medium"
                  title={preview.fileName}
                >
                  {preview.fileName}
                </p>
                <p
                  className="text-muted-foreground mt-0.5 truncate text-xs"
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

            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground">{t("Import.format")}</dt>
                <dd className="mt-0.5 font-medium">
                  {preview.format === "md" ? "Markdown" : "TXT"}
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground">
                  {t("Import.encoding")}
                </dt>
                <dd className="mt-0.5 font-medium">
                  {t(encodingLabel(preview.encoding))}
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground">
                  {t("Import.sections")}
                </dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {preview.sections.length}
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

            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                >
                  <Settings2 className="icon-sm" />
                  {t("Import.options")}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="bg-background mt-2 flex flex-col gap-3 rounded-md border p-3">
                  {target === "work" ? (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="import-title">
                          {t("Library.dialog.nameLabel")}
                        </Label>
                        <Input
                          id="import-title"
                          value={preview.title}
                          onChange={(e) =>
                            setPreview((prev) =>
                              prev ? { ...prev, title: e.target.value } : prev
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="import-synopsis">
                          {t("Library.dialog.synopsisLabel")}
                        </Label>
                        <Textarea
                          id="import-synopsis"
                          value={preview.synopsis}
                          rows={3}
                          onChange={(e) =>
                            setPreview((prev) =>
                              prev
                                ? { ...prev, synopsis: e.target.value }
                                : prev
                            )
                          }
                        />
                      </div>
                    </>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-xs">
                      {t("Import.stripSectionNumbers")}
                    </Label>
                    <Switch
                      checked={stripSectionNumbers}
                      onCheckedChange={setStripSectionNumbers}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-xs">
                      {t("Import.autoParagraph")}
                    </Label>
                    <Switch
                      checked={autoParagraph}
                      onCheckedChange={setAutoParagraph}
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <section className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{t("Import.preview")}</h3>
                <span className="text-muted-foreground text-xs">
                  {t("Import.previewLimit")}
                </span>
              </div>
              <div className="scrollbar-app bg-muted/15 max-h-[min(24rem,44vh)] overflow-y-auto rounded-md border">
                {structured
                  ? visibleSections.map((section, index) => (
                      <div
                        key={`${section.volumeTitle ?? ""}-${section.title}-${index}`}
                        className="border-b px-3 py-2.5 last:border-b-0"
                      >
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            {section.volumeTitle ? (
                              <p className="text-muted-foreground truncate text-xs">
                                {section.volumeTitle}
                              </p>
                            ) : null}
                            <p className="truncate text-sm font-medium">
                              {section.title ||
                                t(
                                  section.volumeTitle
                                    ? "Import.untitledSection"
                                    : "Import.frontMatter"
                                )}
                            </p>
                          </div>
                          <span className="text-muted-foreground/70 shrink-0 text-xs tabular-nums">
                            {section.cards.length}
                          </span>
                        </div>
                        {section.cards[0] ? (
                          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm leading-relaxed break-words whitespace-pre-wrap">
                            {section.cards[0].text}
                          </p>
                        ) : null}
                      </div>
                    ))
                  : visibleCards.map((card, index) => (
                      <div
                        key={card.id}
                        className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 border-b px-3 py-2.5 last:border-b-0"
                      >
                        <span className="text-muted-foreground/70 pt-0.5 text-right text-xs tabular-nums">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <p className="line-clamp-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
                          {card.text}
                        </p>
                      </div>
                    ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="bg-muted/15 flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed px-6 py-8 text-center">
            {reading ? (
              <>
                <Loader2 className="icon-lg text-muted-foreground animate-spin" />
                <p className="text-muted-foreground text-sm">
                  {t("Import.reading")}
                </p>
              </>
            ) : (
              <>
                <div className="bg-background flex size-10 items-center justify-center rounded-full border">
                  <FileUp className="icon-md text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t("Import.noFile")}</p>
                  <p className="text-muted-foreground mt-1 text-xs">
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
          <p className="border-destructive/25 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
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
