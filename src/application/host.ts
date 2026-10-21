import type { WritingPreferences } from "@/contexts/preferences";
import type { ViewMode } from "@/contexts/viewmode";
import type { WorkspaceMigrationResult } from "@/services/workspace";

export interface RecentWorkspaceSummary {
  id: string;
  label: string;
  openedAt: number | null;
}

export interface AppSettingsSnapshot {
  theme: string;
  language: string;
  viewMode: ViewMode;
  appTitle: string;
}

export interface ApplicationHost {
  recentWorkspaces: {
    list: () => Promise<RecentWorkspaceSummary[]>;
    remove: (id: string) => Promise<void>;
  };
  workspaceLifecycle: {
    create: () => Promise<"awaiting_user">;
    open: () => Promise<"awaiting_user">;
    close: () => Promise<"awaiting_user">;
    migrate: () => Promise<WorkspaceMigrationResult | "awaiting_user">;
    delete: () => Promise<"awaiting_user">;
  };
  selectWork: (workId: string | null) => Promise<void>;
  preferences: {
    get: () => WritingPreferences;
    update: (patch: Partial<WritingPreferences>) => Promise<WritingPreferences>;
  };
  settings: {
    get: () => AppSettingsSnapshot;
    update: (patch: Partial<AppSettingsSnapshot>) => Promise<AppSettingsSnapshot>;
  };
  navigate: (target: "home" | "library" | "codex" | "editor" | "settings") => Promise<void>;
  openUi: (target: "settings" | "about") => Promise<void>;
  openChapter: (workId: string, chapterId: string) => Promise<void>;
}

let host: ApplicationHost | null = null;

export function registerApplicationHost(next: ApplicationHost | null): void {
  host = next;
}

export function getApplicationHost(): ApplicationHost {
  if (!host) {
    throw new Error("Application host is unavailable.");
  }
  return host;
}
