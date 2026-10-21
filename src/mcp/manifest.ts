import { zodToJsonSchema } from "zod-to-json-schema";

import { APP_COMMANDS } from "@/application/registry";
import type { Permission } from "@/application/types";
import {
  MCP_COMPATIBLE_VERSIONS,
  MCP_PROTOCOL_VERSION,
  type McpManifest,
  type McpPromptDefinition,
  type McpResourceDefinition,
  type McpToolDefinition,
} from "./contracts";
import { canUsePermission } from "./permissions";

const RESOURCE_DEFINITIONS: McpResourceDefinition[] = [
  {
    uri: "novels://workspace",
    name: "workspace",
    title: "Current workspace",
    description: "Current workspace summary and readiness without absolute paths.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://workspace/recent",
    name: "recent-workspaces",
    title: "Recent workspaces",
    description: "Recent workspace display names and opaque IDs.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://works",
    name: "works",
    title: "Works",
    description: "Paginated work list for the current workspace.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://works/{workId}",
    name: "work",
    title: "Work",
    description: "Work metadata and counts.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://works/{workId}/outline",
    name: "outline",
    title: "Work outline",
    description: "Flat outline nodes with parent relationships and order.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://works/{workId}/chapters",
    name: "chapters",
    title: "Chapter list",
    description: "Chapter metadata from the chapter index.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://works/{workId}/chapters/{chapterId}",
    name: "chapter",
    title: "Chapter",
    description: "Chapter JSON with cards and revision.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://works/{workId}/chapters/{chapterId}/text",
    name: "chapter-text",
    title: "Chapter text",
    description: "Plain chapter text.",
    mimeType: "text/plain",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://works/{workId}/stats",
    name: "work-stats",
    title: "Work statistics",
    description: "Writing statistics and per-work word counts.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://codex/types",
    name: "codex-types",
    title: "Codex types",
    description: "Codex type configurations and field templates.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://codex/entries/{entryId}",
    name: "codex-entry",
    title: "Codex entry",
    description: "Codex entry with relations and mentions.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://trash",
    name: "trash",
    title: "Trash",
    description: "Workspace trash index.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://settings",
    name: "settings",
    title: "Application settings",
    description: "Writing preferences and application appearance settings.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
  {
    uri: "novels://schema/{domain}",
    name: "schema",
    title: "Domain schema",
    description: "Tool contract and JSON schema for a domain.",
    mimeType: "application/json",
    permission: "read",
    risk: "R0",
  },
];

const PROMPT_DEFINITIONS: McpPromptDefinition[] = [
  {
    name: "novels_continue_chapter",
    title: "Continue chapter",
    description:
      "Continue a selected chapter using its plot summary, nearby text and style constraints.",
    arguments: [
      {
        name: "work_id",
        description: "Work UUID.",
        required: true,
      },
      {
        name: "chapter_id",
        description: "Chapter UUID.",
        required: true,
      },
      {
        name: "direction",
        description: "Optional direction for the continuation.",
        required: false,
      },
    ],
  },
  {
    name: "novels_review_chapter",
    title: "Review chapter",
    description:
      "Review continuity, pacing, character voice and prose issues without writing changes.",
    arguments: [
      {
        name: "work_id",
        description: "Work UUID.",
        required: true,
      },
      {
        name: "chapter_id",
        description: "Chapter UUID.",
        required: true,
      },
    ],
  },
  {
    name: "novels_outline_plan",
    title: "Plan outline",
    description:
      "Produce or revise a volume, chapter and scene structure.",
    arguments: [
      {
        name: "work_id",
        description: "Work UUID.",
        required: true,
      },
      {
        name: "goal",
        description: "Planning goal.",
        required: true,
      },
    ],
  },
  {
    name: "novels_consistency_audit",
    title: "Audit consistency",
    description:
      "Compare chapters against Codex entries, relations and declared scopes.",
    arguments: [
      {
        name: "work_id",
        description: "Work UUID.",
        required: true,
      },
    ],
  },
  {
    name: "novels_import_normalize",
    title: "Normalize import",
    description:
      "Inspect an import preview and propose chapter and volume cleanup.",
    arguments: [
      {
        name: "preview_id",
        description: "Import preview UUID.",
        required: true,
      },
    ],
  },
];

function schemaFor(schema: unknown): Record<string, unknown> {
  return zodToJsonSchema(schema as never, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}

export function buildToolDefinitions(accessLevel: Permission): McpToolDefinition[] {
  return APP_COMMANDS.filter((command) =>
    canUsePermission(accessLevel, command.permission)
  ).map((command) => ({
    name: command.id,
    title: command.title,
    description: command.description,
    inputSchema: schemaFor(command.input),
    ...(command.output ? { outputSchema: schemaFor(command.output) } : {}),
    annotations: command.annotations ?? {},
    permission: command.permission,
    risk: command.risk,
  }));
}

export function buildMcpManifest(accessLevel: Permission): McpManifest {
  return Object.freeze({
    protocolVersion: MCP_PROTOCOL_VERSION,
    compatibleVersions: MCP_COMPATIBLE_VERSIONS,
    accessLevel,
    tools: Object.freeze(buildToolDefinitions(accessLevel)),
    resources: Object.freeze(
      RESOURCE_DEFINITIONS.filter((resource) =>
        canUsePermission(accessLevel, resource.permission)
      )
    ),
    prompts: Object.freeze(PROMPT_DEFINITIONS),
  }) as McpManifest;
}
