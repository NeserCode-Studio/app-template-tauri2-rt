import type { AppPage } from "@/lib/navigation";

export interface McpOperationPresentation {
  toolName: string;
  operationKey: string;
  page: AppPage | null;
  interruptible: boolean;
  workId?: string | null;
  chapterId?: string | null;
  targetLabel?: string | null;
}

const LONG_OPERATION_PATTERNS = [
  /^novels_workspace_(scan|scan_preview|migrate|delete)$/,
  /^novels_work_(delete|reparagraph)$/,
  /^novels_outline_reconcile$/,
  /^novels_chapter_(replace|split_card|merge_cards|history_restore|history_delete)$/,
  /^novels_codex_mentions_scan$/,
  /^novels_import_(preview|commit)$/,
  /^novels_export_(text|file)$/,
  /^novels_trash_(restore|purge|purge_all)$/,
  /^novels_stats_recalculate$/,
  /^novels_search$/,
];

function argumentString(
  argumentsValue: Record<string, unknown>,
  key: string
): string | null {
  const value = argumentsValue[key];
  return typeof value === "string" && value ? value : null;
}

const WORK_SCOPED_PREFIXES = [
  "novels_outline_",
  "novels_volume_",
  "novels_chapter_",
  "novels_scene_",
  "novels_node_",
  "novels_draft_",
  "novels_stats_",
  "novels_export_",
];

function usesCurrentWork(toolName: string): boolean {
  if (WORK_SCOPED_PREFIXES.some((prefix) => toolName.startsWith(prefix))) {
    return true;
  }
  return /^novels_work_(get|update|archive|unarchive|delete|reparagraph)$/.test(
    toolName
  );
}

function targetLabelForTool(
  toolName: string,
  argumentsValue: Record<string, unknown>
): string | null {
  if (toolName === "novels_navigate") return null;
  for (const key of [
    "chapter_title",
    "title",
    "name",
    "entry_name",
    "type_name",
    "alias",
    "query",
    "goal",
  ]) {
    const value = argumentString(argumentsValue, key)?.trim();
    if (value) return value.length > 120 ? `${value.slice(0, 120)}...` : value;
  }
  return null;
}

function pageForTool(toolName: string): AppPage | null {
  if (toolName === "novels_open_chapter") return "editor";
  if (toolName.startsWith("novels_codex_")) return "codex";
  if (
    toolName.startsWith("novels_chapter_") ||
    toolName.startsWith("novels_outline_") ||
    toolName.startsWith("novels_volume_") ||
    toolName.startsWith("novels_scene_") ||
    toolName.startsWith("novels_node_") ||
    toolName.startsWith("novels_draft_")
  ) {
    return "editor";
  }
  if (
    toolName.startsWith("novels_work_") ||
    toolName.startsWith("novels_import_") ||
    toolName.startsWith("novels_export_") ||
    toolName.startsWith("novels_stats_") ||
    toolName.startsWith("novels_workspace_")
  ) {
    return "library";
  }
  if (toolName.startsWith("novels_trash_")) return "trash";
  return null;
}

function operationKeyForTool(toolName: string): string {
  if (toolName === "novels_navigate" || toolName === "novels_open_chapter") {
    return "Mcp.task.operation.navigation";
  }
  if (toolName.startsWith("novels_workspace_")) {
    return "Mcp.task.operation.workspace";
  }
  if (toolName.startsWith("novels_work_")) {
    return "Mcp.task.operation.work";
  }
  if (
    toolName.startsWith("novels_chapter_") ||
    toolName.startsWith("novels_outline_") ||
    toolName.startsWith("novels_volume_") ||
    toolName.startsWith("novels_scene_") ||
    toolName.startsWith("novels_node_")
  ) {
    return "Mcp.task.operation.structure";
  }
  if (toolName.startsWith("novels_codex_")) {
    return toolName.includes("mentions")
      ? "Mcp.task.operation.codexScan"
      : "Mcp.task.operation.codex";
  }
  if (toolName.startsWith("novels_import_")) {
    return "Mcp.task.operation.import";
  }
  if (toolName.startsWith("novels_export_")) {
    return "Mcp.task.operation.export";
  }
  if (toolName.startsWith("novels_trash_")) {
    return "Mcp.task.operation.trash";
  }
  if (toolName.startsWith("novels_stats_")) {
    return "Mcp.task.operation.stats";
  }
  if (toolName.startsWith("novels_draft_")) {
    return "Mcp.task.operation.draft";
  }
  if (
    toolName.startsWith("novels_preferences_") ||
    toolName.startsWith("novels_app_settings_")
  ) {
    return "Mcp.task.operation.settings";
  }
  if (toolName === "novels_search") {
    return "Mcp.task.operation.search";
  }
  return "Mcp.task.operation.generic";
}

export function describeMcpTool(
  toolName: string,
  argumentsValue: Record<string, unknown>,
  fallbackWorkId?: string | null
): McpOperationPresentation {
  const interruptible = !LONG_OPERATION_PATTERNS.some((pattern) =>
    pattern.test(toolName)
  );
  const workId =
    argumentString(argumentsValue, "work_id") ??
    argumentString(argumentsValue, "workId") ??
    (usesCurrentWork(toolName) ? fallbackWorkId : null);
  const chapterId =
    argumentString(argumentsValue, "chapter_id") ??
    argumentString(argumentsValue, "chapterId") ??
    argumentString(argumentsValue, "node_id") ??
    argumentString(argumentsValue, "nodeId");
  const targetLabel = targetLabelForTool(toolName, argumentsValue);

  if (toolName === "novels_navigate") {
    const target = argumentString(argumentsValue, "target");
    const page =
      target === "home" ||
      target === "library" ||
      target === "editor" ||
      target === "codex" ||
      target === "mcp" ||
      target === "trash"
        ? target
        : null;
    return {
      toolName,
      operationKey: operationKeyForTool(toolName),
      page,
      interruptible,
      workId,
      chapterId,
      targetLabel,
    };
  }

  return {
    toolName,
    operationKey: operationKeyForTool(toolName),
    page: pageForTool(toolName),
    interruptible,
    workId,
    chapterId,
    targetLabel,
  };
}

export function describeMcpResource(uri: string): McpOperationPresentation {
  const match = uri.match(/^novels:\/\/works\/([^/]+)(?:\/chapters\/([^/]+))?/);
  const workId = match?.[1] ? decodeURIComponent(match[1]) : null;
  const chapterId = match?.[2] ? decodeURIComponent(match[2]) : null;
  let page: AppPage | null = null;
  if (uri.startsWith("novels://codex")) page = "codex";
  else if (uri.startsWith("novels://trash")) page = "trash";
  else if (uri.includes("/outline") || uri.includes("/chapters/")) {
    page = "editor";
  } else if (uri.startsWith("novels://works")) page = "library";

  return {
    toolName: `resource:${uri}`,
    operationKey: "Mcp.task.operation.resource",
    page,
    interruptible: true,
    workId,
    chapterId,
  };
}

export function describeMcpPrompt(
  promptName: string,
  argumentsValue: Record<string, unknown>
): McpOperationPresentation {
  return {
    toolName: `prompt:${promptName}`,
    operationKey: "Mcp.task.operation.prompt",
    page: "editor",
    interruptible: true,
    workId: argumentString(argumentsValue, "work_id"),
    chapterId: argumentString(argumentsValue, "chapter_id"),
  };
}

function numericResult(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function countActivityResult(toolName: string, data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return 1;

  const record = data as Record<string, unknown>;
  for (const key of [
    "count",
    "sections",
    "cards",
    "chapters",
    "items",
    "entriesMatched",
    "entries_matched",
  ]) {
    const value = numericResult(record[key]);
    if (value !== null) return value;
  }

  const totals = ["created", "updated", "deleted", "restored", "purged"]
    .map((key) => numericResult(record[key]) ?? 0)
    .reduce((sum, value) => sum + value, 0);
  if (totals > 0) return totals;

  if (toolName.startsWith("novels_export_")) return 1;
  return 1;
}
