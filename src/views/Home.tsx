import { useEffect, useRef, useState } from "react";
import {
  BookMarked,
  BookOpen,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
} from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { useI18n, useToast } from "@/composables";
import { useSettingsDialog } from "@/contexts/settings";
import { useWorkspace } from "@/contexts/workspace";
import { pageFromPath, useAppNavigation } from "@/lib/navigation";
import { inspectWorkspace } from "@/services/workspace";
import {
  WORKSPACE_OPEN_INTERCEPT_EVENT,
  type WorkspaceOpenAction,
} from "@/lib/workspace-open";

const OPEN_DELAY_MS = 2500;

type WorkspaceOpenIntent = "create" | "change" | "menu" | "recent";

interface PendingWorkspaceOpen {
  path: string;
  intent: WorkspaceOpenIntent;
  targetPath: string | null;
}

interface BadRecentWorkspace {
  path: string;
}

interface ProgressPoint {
  time: number;
  value: number;
}

function createRandomProgressCurve(): ProgressPoint[] {
  const segmentCount = 7 + Math.floor(Math.random() * 3);
  const timeWeights = Array.from(
    { length: segmentCount },
    () => 0.65 + Math.random() * 0.7
  );
  const valueWeights = Array.from(
    { length: segmentCount },
    () => 0.45 + Math.random() * 1.1
  );
  const totalTime = timeWeights.reduce((sum, weight) => sum + weight, 0);
  const totalValue = valueWeights.reduce((sum, weight) => sum + weight, 0);
  const points: ProgressPoint[] = [{ time: 0, value: 0 }];
  let time = 0;
  let value = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    time += timeWeights[index] / totalTime;
    value += valueWeights[index] / totalValue;
    points.push({ time, value });
  }

  points[points.length - 1] = { time: 1, value: 1 };
  return points;
}

function sampleProgressCurve(
  points: ProgressPoint[],
  currentTime: number
): number {
  for (let index = 1; index < points.length; index += 1) {
    const next = points[index];
    if (currentTime > next.time) continue;
    const previous = points[index - 1];
    const span = Math.max(Number.EPSILON, next.time - previous.time);
    const localTime = Math.min(
      1,
      Math.max(0, (currentTime - previous.time) / span)
    );
    const eased = localTime * localTime * (3 - 2 * localTime);
    return previous.value + (next.value - previous.value) * eased;
  }
  return 1;
}

function workspaceName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).pop() || path;
}

function openedAtLabel(
  timestamp: number | undefined,
  lang: string,
  fallback: string
): string {
  if (!timestamp) return fallback;
  const formatter = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const elapsed = timestamp - Date.now();
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (Math.abs(elapsed) < hour) {
    return formatter.format(Math.round(elapsed / minute), "minute");
  }
  if (Math.abs(elapsed) < day) {
    return formatter.format(Math.round(elapsed / hour), "hour");
  }
  if (Math.abs(elapsed) < day * 30) {
    return formatter.format(Math.round(elapsed / day), "day");
  }
  return new Intl.DateTimeFormat(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(timestamp);
}

function WorkspaceRow({
  path,
  current,
  busy,
  progress,
  openedAt,
  disabled,
  onClick,
}: {
  path: string;
  current: boolean;
  busy: boolean;
  progress: number;
  openedAt?: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const { lang, t } = useI18n();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group hover:bg-accent/55 relative flex w-full items-start gap-3 overflow-hidden rounded-md border border-transparent px-2.5 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-55 aria-busy:border-primary/25"
      aria-busy={busy}
    >
      {busy ? (
        <span
          aria-hidden="true"
          className="bg-primary/10 absolute inset-y-0 left-0 w-full origin-left"
          style={{ transform: `scaleX(${progress / 100})` }}
        />
      ) : null}
      <FolderOpen className="text-muted-foreground/60 relative z-10 mt-0.5 size-4 shrink-0" />
      <span className="relative z-10 min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="group-hover:text-foreground truncate text-sm font-medium">
            {workspaceName(path)}
          </span>
          {current ? (
            <span className="bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 shrink-0 rounded border border-emerald-600/20 px-1.5 py-0.5 text-[10px] font-medium">
              {t("Home.currentWorkspace")}
            </span>
          ) : null}
        </span>
        <span
          className="text-muted-foreground/70 mt-0.5 block truncate text-[11px]"
          title={path}
        >
          {path}
        </span>
        <span className="text-muted-foreground/55 mt-1 block text-[11px]">
          {t("Home.openedAt").replace(
            "{time}",
            busy
              ? t("Home.openedJustNow")
              : openedAtLabel(openedAt, lang, t("Home.openedUnknown"))
          )}
        </span>
      </span>
      {busy ? (
        <span className="text-muted-foreground relative z-10 mt-1 flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
          <span>{Math.round(progress)}%</span>
          <LoaderCircle className="size-3.5 animate-spin" />
        </span>
      ) : (
        <ChevronRight className="text-muted-foreground/40 relative z-10 mt-1 size-3.5 shrink-0" />
      )}
    </button>
  );
}

export default function Home() {
  const { t } = useI18n();
  const toast = useToast();
  const { navigateDirect } = useAppNavigation();
  const { openSettings, openAbout } = useSettingsDialog();
  const {
    root,
    recent,
    recentOpenedAt,
    pickPath,
    open,
    removeRecent,
  } = useWorkspace();
  const [pendingOpen, setPendingOpen] =
    useState<PendingWorkspaceOpen | null>(null);
  const [badRecentWorkspace, setBadRecentWorkspace] =
    useState<BadRecentWorkspace | null>(null);
  const [progress, setProgress] = useState(0);
  const openingRef = useRef(false);
  const rootRef = useRef(root);
  const queuedNavigationRef = useRef<string | null>(null);
  const queuedDialogRef = useRef<"settings" | "about" | null>(null);
  rootRef.current = root;
  const selectedRoot = pendingOpen?.path ?? root;
  const hasSelection = Boolean(selectedRoot);
  const otherRecent = recent.filter((path) => path !== selectedRoot);

  function queueWorkspaceOpen(
    path: string,
    intent: WorkspaceOpenIntent,
    targetPath: string | null = null
  ) {
    if (openingRef.current) return;
    openingRef.current = true;
    queuedNavigationRef.current = null;
    queuedDialogRef.current = null;
    setProgress(0);
    setPendingOpen({ path, intent, targetPath });
  }

  async function openExistingWorkspace(
    path: string,
    intent: Exclude<WorkspaceOpenIntent, "create">
  ) {
    if (openingRef.current) return;
    const status = await inspectWorkspace(path);
    if (status !== "ready") {
      if (intent === "recent") {
        setBadRecentWorkspace({ path });
        return;
      }
      toast.error(
        status === "missing" ? "Home.workspaceMissing" : "Home.workspaceInvalid"
      );
      return;
    }
    queueWorkspaceOpen(path, intent);
  }

  async function chooseWorkspace(
    intent: Exclude<WorkspaceOpenIntent, "menu" | "recent">
  ) {
    const selected = await pickPath();
    if (!selected) return;
    if (intent === "create") {
      queueWorkspaceOpen(selected, intent);
      return;
    }
    await openExistingWorkspace(selected, intent);
  }

  useEffect(() => {
    const onIntercept = (event: Event) => {
      const action = (event as CustomEvent<WorkspaceOpenAction>).detail;

      if (openingRef.current && action.kind !== "entry") {
        event.preventDefault();
        if (action.kind === "navigate") {
          queuedNavigationRef.current = action.path;
        } else {
          queuedDialogRef.current = action.dialog;
        }
        return;
      }

      if (
        action.kind === "entry" &&
        !openingRef.current &&
        rootRef.current &&
        pageFromPath(action.path) !== "home"
      ) {
        /* 菜单直接进入工作区时，也复用首页的进度效果作为唯一入口。 */
        event.preventDefault();
        queueWorkspaceOpen(rootRef.current, "menu", action.path);
      }
    };

    window.addEventListener(WORKSPACE_OPEN_INTERCEPT_EVENT, onIntercept);
    return () => {
      window.removeEventListener(WORKSPACE_OPEN_INTERCEPT_EVENT, onIntercept);
    };
  }, []);

  useEffect(() => {
    if (!pendingOpen) return;
    openingRef.current = true;
    const startedAt = performance.now();
    const progressCurve = createRandomProgressCurve();
    let frame = 0;
    let cancelled = false;

    const finish = () => {
      if (cancelled) return;
      const navigation =
        queuedNavigationRef.current ??
        pendingOpen.targetPath ??
        "/library";
      const dialog = queuedDialogRef.current;
      openingRef.current = false;
      setPendingOpen(null);
      open(pendingOpen.path);
      navigateDirect(navigation);
      if (dialog === "settings") openSettings();
      if (dialog === "about") openAbout();
    };

    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / OPEN_DELAY_MS);
      setProgress(
        elapsed >= 1 ? 100 : sampleProgressCurve(progressCurve, elapsed) * 100
      );
      if (elapsed < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      setProgress(100);
      frame = requestAnimationFrame(finish);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      openingRef.current = false;
    };
  }, [navigateDirect, open, openAbout, openSettings, pendingOpen]);

  return (
    <div className="view scrollbar-app bg-background h-full w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-6 py-12 sm:px-8">
        <div className="row-label">
          <BookMarked className="icon-sm" />
          {t("Home.title")}
        </div>
        <h1 className="mt-3 text-2xl font-semibold">
          {hasSelection
            ? t("Home.workspacePicker")
            : t("Library.empty.noWorkspace")}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-lg text-sm leading-relaxed">
          {hasSelection
            ? t("Home.workspacePickerHint")
            : t("Library.workspace.hint")}
        </p>

        {selectedRoot ? (
          <div className="mt-4">
            <WorkspaceRow
              path={selectedRoot}
              current
              busy={pendingOpen?.path === selectedRoot}
              progress={progress}
              openedAt={recentOpenedAt[selectedRoot]}
              disabled={Boolean(pendingOpen)}
              onClick={() => void openExistingWorkspace(selectedRoot, "recent")}
            />
          </div>
        ) : null}

        <div className="mt-6">
          <div className="flex flex-wrap gap-2">
            {hasSelection ? (
              <Button
                size="lg"
                disabled={Boolean(pendingOpen)}
                onClick={() => {
                  if (root) void openExistingWorkspace(root, "recent");
                }}
              >
                <BookOpen className="icon-md" />
                {t("Home.openLibrary")}
              </Button>
            ) : null}
            <Button
              size="lg"
              variant={hasSelection ? "outline" : "default"}
              disabled={Boolean(pendingOpen)}
              onClick={() => void chooseWorkspace("create")}
            >
              <FolderPlus className="icon-md" />
              {t("Library.workspace.pick")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={Boolean(pendingOpen)}
              onClick={() => void chooseWorkspace("change")}
            >
              <FolderOpen className="icon-md" />
              {hasSelection
                ? t("Library.workspace.change")
                : t("Library.workspace.open")}
            </Button>
          </div>

          {pendingOpen ? (
            <span className="sr-only" role="status" aria-live="polite">
              {t("Home.openingWorkspace")} {Math.round(progress)}%
            </span>
          ) : null}

          {otherRecent.length ? (
            <section className="mt-7 border-t pt-5">
              <h2 className="row-label">{t("Home.otherRecentWorkspaces")}</h2>
              <div className="mt-3 flex flex-col gap-1">
                {otherRecent.map((path) => (
                  <WorkspaceRow
                    key={path}
                    path={path}
                    current={false}
                    busy={false}
                    progress={0}
                    openedAt={recentOpenedAt[path]}
                    disabled={Boolean(pendingOpen)}
                    onClick={() => void openExistingWorkspace(path, "recent")}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <AlertDialog
        open={badRecentWorkspace !== null}
        onOpenChange={(openState) => {
          if (!openState) setBadRecentWorkspace(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Home.badWorkspaceTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-2">
              <span>{t("Home.badWorkspaceDesc")}</span>
              <span className="break-all font-medium text-foreground">
                {badRecentWorkspace?.path}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Library.dialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!badRecentWorkspace) return;
                removeRecent(badRecentWorkspace.path);
                setBadRecentWorkspace(null);
              }}
            >
              {t("Home.badWorkspaceRemove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
