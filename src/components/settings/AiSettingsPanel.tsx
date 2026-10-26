import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useI18n, useToast } from "@/composables";
import {
  clearZhuqueAiApiKey,
  getZhuqueAiConfig,
  setZhuqueAiApiKey,
  type ZhuqueAiConfig,
} from "@/services/zhuque-ai";

const ZHUQUE_CONSOLE_URL =
  "https://console.cloud.tencent.com/edgeone/makers?tab=models&subTab=apikey";

interface AiSettingsPanelProps {
  onChanged?: () => void;
}

export default function AiSettingsPanel({ onChanged }: AiSettingsPanelProps) {
  const { t } = useI18n();
  const { success, error } = useToast({ duration: 2500 });
  const [config, setConfig] = useState<ZhuqueAiConfig | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setConfig(await getZhuqueAiConfig());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  async function saveKey() {
    const value = apiKey.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      const next = await setZhuqueAiApiKey(value);
      setConfig(next);
      setApiKey("");
      setShowKey(false);
      onChanged?.();
      success("Settings.ai.apiKey.saved");
    } catch {
      error("Settings.ai.apiKey.saveFailed");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    if (clearing) return;
    setClearing(true);
    try {
      const next = await clearZhuqueAiApiKey();
      setConfig(next);
      setApiKey("");
      setShowKey(false);
      onChanged?.();
      success("Settings.ai.apiKey.cleared");
    } catch {
      error("Settings.ai.apiKey.clearFailed");
    } finally {
      setClearing(false);
      setConfirmClear(false);
    }
  }

  return (
    <div className="stack-5">
      <p className="text-muted-sm">{t("Settings.ai.description")}</p>

      <section className="border-border/60 bg-card rounded-xl border p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                <KeyRound className="size-4" />
              </span>
              <div className="stack-1">
                <h3 className="text-sm font-semibold">
                  {t("Settings.ai.apiKey.title")}
                </h3>
                <p className="text-muted-xs">
                  {t("Settings.ai.apiKey.description")}
                </p>
              </div>
            </div>
            {loading ? (
              <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
            ) : loadFailed ? (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="size-3" />
                {t("Settings.ai.apiKey.unavailable")}
              </Badge>
            ) : (
              <Badge
                variant={config?.configured ? "secondary" : "outline"}
                className="gap-1"
              >
                {config?.configured ? (
                  <CheckCircle2 className="text-primary size-3" />
                ) : (
                  <AlertCircle className="size-3" />
                )}
                {config?.configured
                  ? t("Settings.ai.apiKey.configured")
                  : t("Settings.ai.apiKey.notConfigured")}
              </Badge>
            )}
          </div>

          {config?.configured && config.maskedKey ? (
            <div className="border-border/60 bg-muted/30 flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <span className="text-muted-xs">
                {t("Settings.ai.apiKey.stored")}
              </span>
              <code className="text-xs font-medium tracking-wide">
                {config.maskedKey}
              </code>
            </div>
          ) : null}

          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void saveKey();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t("Settings.ai.apiKey.placeholder")}
                autoComplete="off"
                spellCheck={false}
                className="pr-10 font-mono"
                aria-label={t("Settings.ai.apiKey.title")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground absolute top-0 right-0 size-9"
                onClick={() => setShowKey((visible) => !visible)}
                aria-label={
                  showKey
                    ? t("Settings.ai.apiKey.hide")
                    : t("Settings.ai.apiKey.show")
                }
                title={
                  showKey
                    ? t("Settings.ai.apiKey.hide")
                    : t("Settings.ai.apiKey.show")
                }
              >
                {showKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
            <Button
              type="submit"
              disabled={!apiKey.trim() || saving || loading}
              className="sm:w-28"
            >
              {saving ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              {saving
                ? t("Settings.ai.apiKey.saving")
                : t("Settings.ai.apiKey.save")}
            </Button>
          </form>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-xs">
              {t("Settings.ai.security.description")}
            </p>
            {config?.configured ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                disabled={clearing}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 className="size-4" />
                {t("Settings.ai.apiKey.clear")}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="border-border rounded-lg border border-dashed px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="stack-1">
            <span className="row-icon text-sm font-medium">
              <ExternalLink className="text-muted-foreground size-4" />
              {t("Settings.ai.console")}
            </span>
            <p className="text-muted-xs">{t("Settings.ai.consoleHint")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openUrl(ZHUQUE_CONSOLE_URL).catch(() => {})}
          >
            <ExternalLink className="size-4" />
            {t("Settings.ai.openConsole")}
          </Button>
        </div>
      </section>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Settings.ai.clearConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("Settings.ai.clearConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Settings.ai.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={clearing}
              onClick={(event) => {
                event.preventDefault();
                void clearKey();
              }}
            >
              {clearing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t("Settings.ai.clearConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
