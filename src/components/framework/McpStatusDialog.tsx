import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
} from "lucide-react";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/composables";
import type { Permission } from "@/application/types";
import { useMcpRuntime } from "@/mcp/runtime";

interface McpStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function McpStatusDialog({
  open,
  onOpenChange,
}: McpStatusDialogProps) {
  const { t } = useI18n();
  const runtime = useMcpRuntime();
  const [revealToken, setRevealToken] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setRevealToken(false);
      setCopied(false);
      setBusy(null);
    }
  }, [open]);

  const config = useMemo(() => {
    const endpoint = runtime.status.endpoint ?? "http://127.0.0.1:38471/mcp";
    const token = runtime.status.token ?? "<workspace-token>";
    return JSON.stringify(
      {
        mcpServers: {
          "novels-yes": {
            type: "streamable-http",
            url: endpoint,
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      },
      null,
      2
    );
  }, [runtime.status.endpoint, runtime.status.token]);
  const displayedConfig = useMemo(() => {
    if (revealToken || !runtime.status.token) return config;
    return config.replace(
      `Bearer ${runtime.status.token}`,
      "Bearer <reveal token to copy>"
    );
  }, [config, revealToken, runtime.status.token]);

  const copyConfig = async () => {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const runAction = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const stateLabel =
    runtime.phase === "ready"
      ? t("Mcp.status.ready")
      : runtime.phase === "starting"
        ? t("Mcp.status.starting")
        : runtime.phase === "degraded"
          ? t("Mcp.status.degraded")
          : t("Mcp.status.stopped");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="icon-md" />
            {t("Mcp.title")}
          </DialogTitle>
          <DialogDescription>{t("Mcp.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="border-border/70 flex flex-col gap-3 rounded-md border p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs">
                {t("Mcp.statusLabel")}
              </span>
              <span
                className={
                  runtime.phase === "ready"
                    ? "text-sm font-medium text-emerald-600 dark:text-emerald-400"
                    : runtime.phase === "degraded"
                      ? "text-sm font-medium text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground text-sm font-medium"
                }
              >
                {stateLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs">
                {t("Mcp.endpoint")}
              </span>
              <code className="min-w-0 truncate text-xs">
                {runtime.status.endpoint ?? "-"}
              </code>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs">
                {t("Mcp.activeCalls")}
              </span>
              <span className="text-sm tabular-nums">
                {runtime.status.activeCalls}
              </span>
            </div>
            {runtime.error ? (
              <p className="text-destructive text-xs leading-relaxed">
                {runtime.error}
              </p>
            ) : null}
          </div>

          <div className="border-border/70 flex flex-col gap-2 rounded-md border p-4">
            <span className="flex items-center gap-2 text-xs font-medium">
              <Shield className="icon-sm" />
              {t("Mcp.permission")}
            </span>
            <Select
              value={runtime.accessLevel}
              onValueChange={(value) =>
                void runAction("permission", () =>
                  runtime.setAccessLevel(value as Permission)
                )
              }
              disabled={Boolean(busy)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{t("Mcp.permission.read")}</SelectItem>
                <SelectItem value="write">
                  {t("Mcp.permission.write")}
                </SelectItem>
                <SelectItem value="admin">
                  {t("Mcp.permission.admin")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {t("Mcp.permissionHint")}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("Mcp.token")}</span>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => setRevealToken((value) => !value)}
                aria-label={
                  revealToken ? t("Mcp.hideToken") : t("Mcp.revealToken")
                }
              >
                {revealToken ? (
                  <EyeOff className="icon-sm" />
                ) : (
                  <Eye className="icon-sm" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={Boolean(busy)}
                onClick={() => void runAction("rotate", runtime.rotateToken)}
                aria-label={t("Mcp.rotateToken")}
              >
                {busy === "rotate" ? (
                  <Loader2 className="icon-sm animate-spin" />
                ) : (
                  <RotateCcw className="icon-sm" />
                )}
              </Button>
            </div>
          </div>
          <code className="bg-muted/35 block min-h-9 overflow-hidden rounded-md border px-3 py-2 text-xs break-all">
            {revealToken
              ? (runtime.status.token ?? t("Mcp.tokenUnavailable"))
              : "********************************"}
          </code>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{t("Mcp.clientConfig")}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!revealToken || !runtime.status.token}
              onClick={() => void copyConfig()}
            >
              {copied ? (
                <Check className="icon-sm" />
              ) : (
                <Copy className="icon-sm" />
              )}
              {copied ? t("Mcp.copied") : t("Mcp.copyConfig")}
            </Button>
          </div>
          <pre className="bg-muted/35 max-h-56 overflow-auto rounded-md border p-3 text-[11px] leading-relaxed">
            {displayedConfig}
          </pre>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => void runAction("restart", runtime.restart)}
          >
            {busy === "restart" ? (
              <Loader2 className="icon-sm animate-spin" />
            ) : (
              <RefreshCw className="icon-sm" />
            )}
            {t("Mcp.restart")}
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            {t("Library.dialog.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
