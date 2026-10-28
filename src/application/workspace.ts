import { z } from "zod";

import { requireRoot } from "./helpers";
import { getApplicationHost } from "./host";
import { defineAppCommand } from "./types";
import {
  loadWorkspace,
  revealWorkspaceDir,
  saveWorkspace,
  scanAndRepair,
  scanWorkspaceReadOnly,
} from "@/services/workspace";

const workspaceGet = defineAppCommand({
  id: "novels_workspace_get",
  title: "Get workspace",
  description:
    "Return the current workspace alias, work counts, active work and MCP readiness. No absolute path is returned.",
  input: z.object({}).strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(_input, context) {
    const root = requireRoot(context);
    const workspace = await loadWorkspace(root);
    return {
      alias: workspace.alias,
      active_count: workspace.order.length,
      archived_count: workspace.archived.length,
      current_work_id: context.workId,
      ready: true,
    };
  },
});

const workspaceSetAlias = defineAppCommand({
  id: "novels_workspace_set_alias",
  title: "Set workspace alias",
  description:
    "Set or clear the current workspace display alias. The directory path is never changed.",
  input: z.object({ alias: z.string().max(200) }).strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const current = await loadWorkspace(root);
    const alias = input.alias.trim();
    await saveWorkspace(root, { ...current, alias });
    return { alias };
  },
});

const workspaceRecentList = defineAppCommand({
  id: "novels_workspace_recent_list",
  title: "List recent workspaces",
  description:
    "List recent workspace display names and opaque IDs. Absolute paths are never returned.",
  input: z.object({}).strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute() {
    const items = await getApplicationHost().recentWorkspaces.list();
    return { items, count: items.length };
  },
});

const workspaceRecentRemove = defineAppCommand({
  id: "novels_workspace_recent_remove",
  title: "Remove recent workspace record",
  description:
    "Remove one recent workspace record by opaque ID. This never deletes workspace files.",
  input: z.object({ id: z.string().min(1).max(200) }).strict(),
  permission: "write",
  risk: "R2",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input) {
    await getApplicationHost().recentWorkspaces.remove(input.id);
    return { removed: true, id: input.id };
  },
});

const workspaceReveal = defineAppCommand({
  id: "novels_workspace_reveal",
  title: "Reveal workspace folder",
  description:
    "Open the current workspace in the operating system file manager. No path is returned to the caller.",
  input: z.object({}).strict(),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async execute(_input, context) {
    const root = requireRoot(context);
    await revealWorkspaceDir(root);
    return { revealed: true };
  },
});

const workspaceScan = defineAppCommand({
  id: "novels_workspace_scan",
  title: "Scan and repair workspace",
  description:
    "Reconcile the workspace manifest, work metadata, outlines and chapter files. Use apply=false for a report-only scan.",
  input: z
    .object({
      apply: z.boolean().default(true),
    })
    .strict(),
  permission: "write",
  risk: "R2",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    if (!input.apply) {
      return scanWorkspaceReadOnly(root);
    }
    return scanAndRepair(root);
  },
});

const workspaceScanPreview = defineAppCommand({
  id: "novels_workspace_scan_preview",
  title: "Preview workspace scan",
  description:
    "Inspect workspace manifest, work flags and chapter-file consistency without writing anything.",
  input: z.object({}).strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(_input, context) {
    return scanWorkspaceReadOnly(requireRoot(context));
  },
});

export const WORKSPACE_COMMANDS = [
  workspaceGet,
  workspaceSetAlias,
  workspaceRecentList,
  workspaceRecentRemove,
  workspaceReveal,
  workspaceScan,
  workspaceScanPreview,
] as const;
