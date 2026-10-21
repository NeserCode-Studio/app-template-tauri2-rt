import type { z } from "zod";

import type { Permission, RiskLevel } from "@/application/types";

export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_COMPATIBLE_VERSIONS = ["2026-07-28", "2025-11-25"] as const;
export const MCP_DEFAULT_PORT = 38471;
export const MCP_MAX_RESULT_CHARS = 25_000;

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: McpToolAnnotations;
  permission: Permission;
  risk: RiskLevel;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  permission: Permission;
  risk: RiskLevel;
}

export interface McpPromptArgument {
  name: string;
  description: string;
  required: boolean;
  schema?: z.ZodType<unknown>;
}

export interface McpPromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: McpPromptArgument[];
}

export interface McpManifest {
  protocolVersion: typeof MCP_PROTOCOL_VERSION;
  compatibleVersions: readonly string[];
  accessLevel: Permission;
  tools: readonly McpToolDefinition[];
  resources: readonly McpResourceDefinition[];
  prompts: readonly McpPromptDefinition[];
}

export interface McpClientInfo {
  name?: string;
  version?: string;
  title?: string;
}

export interface McpBridgeRequest {
  request_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  client_info: McpClientInfo;
  deadline_ms: number;
  workspace_session_id: string;
}

export interface McpBridgeError {
  code: string;
  message: string;
  details?: unknown;
  recovery?: string;
}

export interface McpBridgeResponse {
  request_id: string;
  ok: boolean;
  data?: unknown;
  error?: McpBridgeError;
  structured_content?: Record<string, unknown>;
  content?: Array<{ type: "text"; text: string }>;
  is_error?: boolean;
}
