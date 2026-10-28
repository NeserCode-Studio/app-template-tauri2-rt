import { useEffect, useMemo, type ReactNode } from "react";

import { useLibrary } from "@/contexts/library";
import { useNavigatorContext } from "@/contexts/navigator";
import { useOutline } from "@/contexts/outline";
import { usePreferences } from "@/contexts/preferences";
import { useSettingsDialog } from "@/contexts/settings";
import { useViewMode } from "@/contexts/viewmode";
import { useWorkspace } from "@/contexts/workspace";
import { createLogger } from "@/lib/logger";
import { inspectWorkspace } from "@/services/workspace";
import { registerApplicationHost, type ApplicationHost } from "./host";

const log = createLogger("ApplicationHost");

interface ApplicationHostProviderProps {
  children: ReactNode;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  language: string;
  setLanguage: (language: string) => void;
  title: string;
  setTitle: (title: string) => void;
}

async function opaqueId(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function workspaceLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").at(-1) || normalized || "Workspace";
}

function scheduleLifecycle(operation: () => Promise<void>): void {
  window.setTimeout(() => {
    void operation().catch((err) =>
      log.error("deferred lifecycle failed", err)
    );
  }, 80);
}

export function ApplicationHostProvider({
  children,
  theme,
  setTheme,
  language,
  setLanguage,
  title,
  setTitle,
}: ApplicationHostProviderProps) {
  const workspace = useWorkspace();
  const library = useLibrary();
  const outline = useOutline();
  const preferences = usePreferences();
  const viewMode = useViewMode();
  const { navigator } = useNavigatorContext();
  const { openSettings, openAbout } = useSettingsDialog();

  const host = useMemo<ApplicationHost>(
    () => ({
      recentWorkspaces: {
        list: async () => {
          const items = await Promise.all(
            workspace.recent.map(async (path) => ({
              id: await opaqueId(path),
              label: workspaceLabel(path),
              openedAt: workspace.recentOpenedAt[path] ?? null,
            }))
          );
          return items.sort(
            (left, right) => (right.openedAt ?? 0) - (left.openedAt ?? 0)
          );
        },
        remove: async (id) => {
          for (const path of workspace.recent) {
            if ((await opaqueId(path)) === id) {
              workspace.removeRecent(path);
              return;
            }
          }
          throw new Error("The recent workspace record was not found.");
        },
      },
      workspaceLifecycle: {
        create: async () => {
          scheduleLifecycle(async () => {
            const selected = await workspace.pickPath();
            if (!selected) return;
            const status = await inspectWorkspace(selected);
            if (status === "invalid") {
              throw new Error("The selected workspace manifest is unreadable.");
            }
            workspace.open(selected);
            navigator("/library");
          });
          return "awaiting_user";
        },
        open: async () => {
          scheduleLifecycle(async () => {
            const selected = await workspace.pickPath();
            if (!selected) return;
            const status = await inspectWorkspace(selected);
            if (status !== "ready") {
              throw new Error(
                "Open workspace only accepts an existing valid workspace."
              );
            }
            workspace.open(selected);
            navigator("/library");
          });
          return "awaiting_user";
        },
        close: async () => {
          scheduleLifecycle(async () => {
            workspace.close();
            navigator("/");
          });
          return "awaiting_user";
        },
        migrate: async () => {
          scheduleLifecycle(async () => {
            const target = await workspace.pickMigrationTarget();
            if (!target) return;
            await workspace.migrate(target);
            navigator("/library");
          });
          return "awaiting_user";
        },
        delete: async () => {
          scheduleLifecycle(async () => {
            await workspace.deleteWorkspace();
            navigator("/");
          });
          return "awaiting_user";
        },
      },
      selectWork: async (workId) => {
        library.setCurrentWorkId(workId);
      },
      preferences: {
        get: () => preferences.prefs,
        update: async (patch) => preferences.updatePrefs(patch),
      },
      settings: {
        get: () => ({
          theme,
          language,
          viewMode: viewMode.mode,
          appTitle: title,
        }),
        update: async (patch) => {
          if (patch.theme !== undefined) {
            const resolved =
              patch.theme === "system"
                ? window.matchMedia("(prefers-color-scheme: dark)").matches
                  ? "dark"
                  : "light"
                : patch.theme === "dark"
                  ? "dark"
                  : "light";
            setTheme(resolved);
          }
          if (patch.language !== undefined) setLanguage(patch.language);
          if (patch.viewMode !== undefined) viewMode.setMode(patch.viewMode);
          if (patch.appTitle !== undefined) setTitle(patch.appTitle);
          return {
            theme: patch.theme ?? theme,
            language: patch.language ?? language,
            viewMode: patch.viewMode ?? viewMode.mode,
            appTitle: patch.appTitle ?? title,
          };
        },
      },
      navigate: async (target) => {
        if (target === "settings") {
          openSettings();
          return;
        }
        navigator(target === "home" ? "/" : `/${target}`);
      },
      openUi: async (target) => {
        if (target === "settings") openSettings();
        else openAbout();
      },
      openChapter: async (workId, chapterId) => {
        library.setCurrentWorkId(workId);
        outline.openChapter(workId, chapterId);
        navigator("/editor");
      },
    }),
    [
      language,
      library,
      navigator,
      openAbout,
      openSettings,
      outline,
      preferences,
      setLanguage,
      setTheme,
      setTitle,
      theme,
      title,
      viewMode,
      workspace,
    ]
  );

  useEffect(() => {
    registerApplicationHost(host);
    return () => registerApplicationHost(null);
  }, [host]);

  return children;
}
