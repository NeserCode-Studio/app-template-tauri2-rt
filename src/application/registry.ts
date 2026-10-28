import type { AppCommandDefinition } from "./types";
import { APP_SETTINGS_COMMANDS } from "./app-settings";
import { CHAPTER_COMMANDS } from "./chapter-commands";
import { CODEX_COMMANDS } from "./codex";
import { DRAFT_COMMANDS } from "./drafts";
import { IMPORT_EXPORT_COMMANDS } from "./import-export";
import { LIBRARY_COMMANDS } from "./library";
import { OUTLINE_COMMANDS } from "./outline";
import { SEARCH_COMMANDS } from "./search";
import { STATS_COMMANDS } from "./stats";
import { TRASH_COMMANDS } from "./trash";
import { WORKSPACE_COMMANDS } from "./workspace";
import { WORKSPACE_LIFECYCLE_COMMANDS } from "./workspace-lifecycle";

// The registry intentionally erases input types at the collection boundary.
// Each entry validates its own input before execute is called.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegisteredAppCommand = AppCommandDefinition<any, any>;

export const APP_COMMANDS: readonly RegisteredAppCommand[] = [
  ...WORKSPACE_COMMANDS,
  ...WORKSPACE_LIFECYCLE_COMMANDS,
  ...LIBRARY_COMMANDS,
  ...OUTLINE_COMMANDS,
  ...CHAPTER_COMMANDS,
  ...CODEX_COMMANDS,
  ...SEARCH_COMMANDS,
  ...STATS_COMMANDS,
  ...DRAFT_COMMANDS,
  ...TRASH_COMMANDS,
  ...IMPORT_EXPORT_COMMANDS,
  ...APP_SETTINGS_COMMANDS,
].sort((left, right) => left.id.localeCompare(right.id));

const commandMap = new Map<string, RegisteredAppCommand>();
for (const command of APP_COMMANDS) {
  if (commandMap.has(command.id)) {
    throw new Error(`Duplicate application command ID: ${command.id}`);
  }
  commandMap.set(command.id, command);
}

export const APP_COMMAND_REGISTRY = commandMap;

export function getAppCommand(id: string): RegisteredAppCommand | undefined {
  return APP_COMMAND_REGISTRY.get(id);
}
