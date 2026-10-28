import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Clock3,
  LoaderCircle,
  ScanSearch,
  ScanText,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/composables";
import { useSettingsDialog } from "@/contexts/settings";
import { cardsToText } from "@/services/chapter";
import {
  detectWithZhuque,
  getZhuqueAiConfig,
  ZhuqueAiClientError,
  type ZhuqueAiConfig,
  type ZhuqueAiDetection,
  type ZhuqueSegmentLabel,
} from "@/services/zhuque-ai";
import {
  fingerprintZhuqueText,
  loadZhuqueDetection,
  saveZhuqueDetection,
} from "@/services/zhuque-history";
import type { Chapter, ZhuqueDetectionRecord } from "@/shared/schema";

const ERROR_KEYS: Record<string, string> = {
  credential_store: "Zhuque.error.credential_store",
  invalid_key: "Zhuque.error.invalid_key",
  not_configured: "Zhuque.error.not_configured",
  auth_failed: "Zhuque.error.auth_failed",
  rate_limited: "Zhuque.error.rate_limited",
  network_error: "Zhuque.error.network_error",
  upstream_error: "Zhuque.error.upstream_error",
  invalid_response: "Zhuque.error.invalid_response",
  invalid_text: "Zhuque.error.invalid_text",
};

function percent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value * 100));
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "--";
  return `${percent(value).toFixed(1)}%`;
}

function formatCheckedAt(value: number, lang: string): string {
  return new Date(value).toLocaleString(
    lang.startsWith("zh") ? "zh-CN" : "en-US",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function segmentTone(label: ZhuqueSegmentLabel["label"]): string {
  if (label === 1) return "border-destructive/35 text-destructive";
  if (label === 2) return "border-amber-500/40 text-amber-600";
  return "border-primary/30 text-primary";
}

function segmentLabelKey(label: ZhuqueSegmentLabel["label"]): string {
  if (label === 1) return "Zhuque.result.ai";
  if (label === 2) return "Zhuque.result.suspectedAi";
  return "Zhuque.result.human";
}

function DetectionResult({ result }: { result: ZhuqueAiDetection }) {
  const { t } = useI18n();
  const ratios = [
    {
      key: "human",
      label: t("Zhuque.result.human"),
      value: result.labelsRatio.human,
      bar: "bg-primary",
    },
    {
      key: "ai",
      label: t("Zhuque.result.ai"),
      value: result.labelsRatio.ai,
      bar: "bg-destructive",
    },
    {
      key: "suspected",
      label: t("Zhuque.result.suspectedAi"),
      value: result.labelsRatio.suspectedAi,
      bar: "bg-amber-500",
    },
  ];
  const makersTokens =
    result.makersModelsUsage?.totalTokens ?? result.usage?.totalTokens;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="row-icon text-sm font-semibold">
          <ShieldCheck className="text-primary size-4" />
          {t("Zhuque.result.title")}
        </div>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {result.status}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {ratios.map((item) => (
          <div
            key={item.key}
            className="border-border/60 bg-muted/20 min-w-0 rounded-md border px-3 py-2"
          >
            <div className="text-muted-xs truncate">{item.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">
              {formatPercent(item.value)}
            </div>
          </div>
        ))}
      </div>

      <div className="stack-3">
        {ratios.map((item) => (
          <div key={item.key} className="stack-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span>{item.label}</span>
              <span className="text-muted-foreground tabular-nums">
                {formatPercent(item.value)}
              </span>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                className={`h-full rounded-full ${item.bar}`}
                style={{ width: `${percent(item.value)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-2 border-y py-3 text-xs sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            {t("Zhuque.result.risk")}
          </span>
          <span className="font-medium tabular-nums">
            {formatPercent(result.ratioConfidence)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            {t("Zhuque.result.confidence")}
          </span>
          <span className="font-medium tabular-nums">
            {formatPercent(result.softmaxConfidence)}
          </span>
        </div>
        {makersTokens !== undefined ? (
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <span className="text-muted-foreground">
              {t("Zhuque.result.tokens")}
            </span>
            <span className="font-medium tabular-nums">{makersTokens}</span>
          </div>
        ) : null}
      </div>

      <div className="stack-2">
        <div className="row-label">{t("Zhuque.result.segments")}</div>
        {result.segmentLabels.length ? (
          <div className="scrollbar-app border-border/60 max-h-56 divide-y overflow-y-auto rounded-md border">
            {result.segmentLabels.map((segment, index) => (
              <div
                key={`${segment.order}-${index}`}
                className="flex items-start gap-3 px-3 py-2"
              >
                <Badge
                  variant="outline"
                  className={`mt-0.5 shrink-0 ${segmentTone(segment.label)}`}
                >
                  {t(segmentLabelKey(segment.label))}
                </Badge>
                <p className="min-w-0 flex-1 text-xs leading-relaxed whitespace-pre-wrap">
                  {segment.text}
                </p>
                <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
                  {formatPercent(segment.conf)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-xs">{t("Zhuque.result.noSegments")}</p>
        )}
      </div>
    </div>
  );
}

export interface ZhuqueAiDialogProps {
  open: boolean;
  root: string | null;
  workId: string | null;
  chapter: Chapter | null;
  onOpenChange: (open: boolean) => void;
}

export default function ZhuqueAiDialog({
  open,
  root,
  workId,
  chapter,
  onOpenChange,
}: ZhuqueAiDialogProps) {
  const { lang, t } = useI18n();
  const { openSettings } = useSettingsDialog();
  const [config, setConfig] = useState<ZhuqueAiConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [isMerge, setIsMerge] = useState(true);
  const [record, setRecord] = useState<ZhuqueDetectionRecord | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [historySaveFailed, setHistorySaveFailed] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [confirmDetectOpen, setConfirmDetectOpen] = useState(false);
  const activeChapterIdRef = useRef(chapter?.id ?? null);
  activeChapterIdRef.current = chapter?.id ?? null;

  const chapterText = useMemo(
    () => (chapter ? cardsToText(chapter.cards).trim() : ""),
    [chapter]
  );
  const canDetect =
    Boolean(chapterText) &&
    Boolean(config?.configured) &&
    Boolean(root && workId && chapter?.id) &&
    !detecting;
  const result = record?.result ?? null;
  const isStale = Boolean(
    record &&
    fingerprint &&
    (record.textFingerprint !== fingerprint || record.isMerge !== isMerge)
  );
  const fingerprintPending = Boolean(record && !fingerprint);
  const showConfigRequired =
    !loadingConfig &&
    !loadingHistory &&
    config?.configured === false &&
    !record;

  const refreshConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      setConfig(await getZhuqueAiConfig());
    } catch (error) {
      setConfig(null);
      setErrorCode(
        error instanceof ZhuqueAiClientError ? error.code : "generic"
      );
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setConfirmDetectOpen(false);
      return;
    }
    setConfirmDetectOpen(false);
    let alive = true;
    setRecord(null);
    setFingerprint(null);
    setErrorCode(null);
    setHistoryLoadFailed(false);
    setHistorySaveFailed(false);
    setIsMerge(true);
    void refreshConfig();

    if (!root || !workId || !chapter?.id) {
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);
    void loadZhuqueDetection(root, workId, chapter.id)
      .then((saved) => {
        if (!alive || !saved) return;
        setRecord(saved);
        setIsMerge(saved.isMerge);
      })
      .catch(() => {
        if (alive) setHistoryLoadFailed(true);
      })
      .finally(() => {
        if (alive) setLoadingHistory(false);
      });

    return () => {
      alive = false;
    };
  }, [open, root, workId, chapter?.id, refreshConfig]);

  useEffect(() => {
    if (!open || !chapter?.id) {
      setFingerprint(null);
      return;
    }
    let alive = true;
    setFingerprint(null);
    void fingerprintZhuqueText(chapterText)
      .then((next) => {
        if (alive) setFingerprint(next);
      })
      .catch(() => {
        if (alive) setFingerprint(null);
      });
    return () => {
      alive = false;
    };
  }, [open, chapter?.id, chapterText]);

  async function detect() {
    if (!canDetect || !root || !workId || !chapter?.id) return;
    const checkedChapterId = chapter.id;
    const checkedChapterTitle = chapter.title;
    const checkedText = chapterText;
    const checkedMerge = isMerge;
    setDetecting(true);
    setErrorCode(null);
    setHistorySaveFailed(false);
    try {
      const textFingerprint = await fingerprintZhuqueText(checkedText);
      const detection = await detectWithZhuque(checkedText, checkedMerge);
      const nextRecord: ZhuqueDetectionRecord = {
        version: 1,
        workId,
        chapterId: checkedChapterId,
        chapterTitle: checkedChapterTitle,
        checkedAt: Date.now(),
        isMerge: checkedMerge,
        characterCount: checkedText.length,
        textFingerprint,
        result: detection,
      };
      try {
        const saved = await saveZhuqueDetection(root, nextRecord);
        if (activeChapterIdRef.current === checkedChapterId) {
          setRecord(saved);
          setFingerprint(textFingerprint);
        }
      } catch {
        if (activeChapterIdRef.current === checkedChapterId) {
          setRecord(nextRecord);
          setFingerprint(textFingerprint);
          setHistorySaveFailed(true);
        }
      }
    } catch (error) {
      setErrorCode(
        error instanceof ZhuqueAiClientError ? error.code : "generic"
      );
    } finally {
      setDetecting(false);
    }
  }

  async function retrySave() {
    if (!root || !record || savingHistory) return;
    setSavingHistory(true);
    setHistorySaveFailed(false);
    try {
      setRecord(await saveZhuqueDetection(root, record));
    } catch {
      setHistorySaveFailed(true);
    } finally {
      setSavingHistory(false);
    }
  }

  const errorKey = errorCode
    ? (ERROR_KEYS[errorCode] ?? "Zhuque.error.generic")
    : null;
  const checkedAt = record ? formatCheckedAt(record.checkedAt, lang) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanSearch className="text-primary size-5" />
            {t("Zhuque.title")}
          </DialogTitle>
          <DialogDescription>{t("Zhuque.description")}</DialogDescription>
        </DialogHeader>

        {loadingConfig || loadingHistory ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            {t(
              loadingHistory ? "Zhuque.history.loading" : "Zhuque.configLoading"
            )}
          </div>
        ) : showConfigRequired ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
            <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
              <Settings2 className="size-5" />
            </span>
            <div className="stack-1">
              <h3 className="text-sm font-semibold">
                {t("Zhuque.configRequiredTitle")}
              </h3>
              <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
                {t("Zhuque.configRequiredDesc")}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => {
                openSettings("ai");
                onOpenChange(false);
              }}
            >
              <Settings2 className="size-4" />
              {t("Zhuque.openSettings")}
            </Button>
          </div>
        ) : (
          <>
            {config?.configured === false ? (
              <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1">
                  {t("Zhuque.configRequiredSaved")}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0"
                  onClick={() => {
                    openSettings("ai");
                    onOpenChange(false);
                  }}
                >
                  <Settings2 className="size-3.5" />
                  {t("Zhuque.openSettings")}
                </Button>
              </div>
            ) : null}

            <div className="bg-muted/20 flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <ScanText className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {chapter?.title || t("Zhuque.noChapter")}
                  </div>
                  <div className="text-muted-xs tabular-nums">
                    {chapterText.length.toLocaleString()}{" "}
                    {t("Zhuque.characters")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="zhuque-merge" className="text-xs font-normal">
                  {t("Zhuque.merge")}
                </Label>
                <Switch
                  id="zhuque-merge"
                  checked={isMerge}
                  onCheckedChange={setIsMerge}
                />
              </div>
            </div>

            {!chapterText ? (
              <p className="text-muted-foreground text-sm">
                {t("Zhuque.empty")}
              </p>
            ) : null}

            {historyLoadFailed ? (
              <p className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {t("Zhuque.history.loadFailed")}
              </p>
            ) : null}

            {errorKey ? (
              <p className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {t(errorKey)}
              </p>
            ) : null}

            {record ? (
              <div className="border-border/70 bg-muted/15 flex flex-col gap-2 rounded-md border px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                    <Clock3 className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {t("Zhuque.history.checkedAt").replace(
                        "{time}",
                        checkedAt
                      )}
                    </span>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="shrink-0 tabular-nums">
                      {record.characterCount.toLocaleString()}{" "}
                      {t("Zhuque.characters")}
                    </span>
                  </div>
                  <Badge
                    variant={isStale ? "outline" : "secondary"}
                    className={
                      isStale ? "border-amber-500/40 text-amber-700" : undefined
                    }
                  >
                    {fingerprintPending
                      ? t("Zhuque.history.checking")
                      : isStale
                        ? t("Zhuque.history.stale")
                        : t("Zhuque.history.current")}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {isStale
                    ? t("Zhuque.history.staleHint")
                    : t("Zhuque.history.savedHint")}
                </p>
                {historySaveFailed ? (
                  <div className="border-destructive/30 bg-destructive/5 text-destructive flex flex-wrap items-center gap-2 rounded border px-2.5 py-2 text-xs">
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      {t("Zhuque.history.saveFailed")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7"
                      disabled={savingHistory}
                      onClick={() => void retrySave()}
                    >
                      {savingHistory ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {t("Zhuque.history.retrySave")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {result ? (
              <DetectionResult result={result} />
            ) : !errorKey && !detecting ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center">
                <ScanText className="text-muted-foreground/60 size-6" />
                <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
                  {t("Zhuque.readyHint")}
                </p>
              </div>
            ) : null}

            <p className="text-muted-foreground/70 text-[11px] leading-relaxed">
              {t("Zhuque.billingHint")}
            </p>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("Zhuque.close")}
          </Button>
          {config?.configured ? (
            <Button
              type="button"
              disabled={!canDetect}
              onClick={() => setConfirmDetectOpen(true)}
            >
              {detecting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ScanSearch className="size-4" />
              )}
              {detecting
                ? t("Zhuque.detecting")
                : record
                  ? isStale
                    ? t("Zhuque.redetect")
                    : t("Zhuque.detectAgain")
                  : t("Zhuque.detect")}
            </Button>
          ) : null}
        </DialogFooter>

        <AlertDialog
          open={confirmDetectOpen}
          onOpenChange={setConfirmDetectOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Zhuque.confirm.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("Zhuque.confirm.description").replace(
                  "{count}",
                  chapterText.length.toLocaleString()
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("Zhuque.confirm.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => void detect()}>
                {t("Zhuque.confirm.action")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
