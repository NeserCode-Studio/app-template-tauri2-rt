import manifest from "./coverage.manifest.json";
import { APP_COMMANDS } from "./registry";

export type CoverageClass =
  | "mcp_tool"
  | "session_boundary"
  | "ui_only"
  | "unsupported";

export interface CoverageEntry {
  action: string;
  classification: CoverageClass;
  reason?: string;
}

export function getCoverageEntries(): CoverageEntry[] {
  const sessionBoundary = new Set(manifest.session_boundary);
  const tools = APP_COMMANDS.map<CoverageEntry>((command) => ({
    action: command.id,
    classification: sessionBoundary.has(command.id)
      ? "session_boundary"
      : "mcp_tool",
  }));
  return [
    ...tools,
    ...manifest.ui_only.map<CoverageEntry>((entry) => ({
      action: entry.action,
      classification: "ui_only",
      reason: entry.reason,
    })),
    ...manifest.unsupported.map<CoverageEntry>((entry) => ({
      action: entry.action,
      classification: "unsupported",
      reason: entry.reason,
    })),
  ];
}

export function validateCoverage(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of getCoverageEntries()) {
    const key = `${entry.classification}:${entry.action}`;
    if (seen.has(key)) errors.push(`Duplicate coverage entry: ${key}`);
    seen.add(key);
    if (!entry.classification) {
      errors.push(`Unclassified action: ${entry.action}`);
    }
  }
  return errors;
}
