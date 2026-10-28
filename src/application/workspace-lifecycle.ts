import { z } from "zod";

import { getApplicationHost } from "./host";
import { defineAppCommand } from "./types";

function lifecycleCommand(
  id:
    | "novels_workspace_create"
    | "novels_workspace_open"
    | "novels_workspace_close"
    | "novels_workspace_delete",
  title: string,
  description: string,
  execute: () => Promise<"awaiting_user">
) {
  return defineAppCommand({
    id,
    title,
    description,
    input: z.object({}).strict(),
    permission: "admin" as const,
    risk: "R3" as const,
    annotations: {
      readOnlyHint: false,
      destructiveHint: id === "novels_workspace_delete",
      idempotentHint: false,
      openWorldHint: false,
    },
    execute,
  });
}

const workspaceCreate = lifecycleCommand(
  "novels_workspace_create",
  "Create workspace",
  "Open the application directory picker and create a workspace after explicit approval. The current connection may close.",
  () => getApplicationHost().workspaceLifecycle.create()
);

const workspaceOpen = lifecycleCommand(
  "novels_workspace_open",
  "Open workspace",
  "Request a workspace switch after explicit approval. The current MCP connection is expected to close.",
  () => getApplicationHost().workspaceLifecycle.open()
);

const workspaceClose = lifecycleCommand(
  "novels_workspace_close",
  "Close workspace",
  "Request closing the current workspace after explicit approval. The current MCP connection is expected to close.",
  () => getApplicationHost().workspaceLifecycle.close()
);

const workspaceDelete = lifecycleCommand(
  "novels_workspace_delete",
  "Delete workspace permanently",
  "Permanently delete the current workspace after explicit approval. This cannot be undone and closes the connection.",
  () => getApplicationHost().workspaceLifecycle.delete()
);

const workspaceMigrate = defineAppCommand({
  id: "novels_workspace_migrate",
  title: "Migrate workspace",
  description:
    "Move the current workspace to a user-selected empty directory after explicit approval. The connection is expected to restart.",
  input: z.object({}).strict(),
  permission: "admin",
  risk: "R3",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async execute() {
    const result = await getApplicationHost().workspaceLifecycle.migrate();
    return result === "awaiting_user"
      ? { status: result }
      : { status: "completed", source_removed: result.sourceRemoved };
  },
});

export const WORKSPACE_LIFECYCLE_COMMANDS = [
  workspaceCreate,
  workspaceOpen,
  workspaceClose,
  workspaceMigrate,
  workspaceDelete,
] as const;
