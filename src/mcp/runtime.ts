import { createContext, useContext } from "react";

import type { Permission } from "@/application/types";
import type { McpServerStatus } from "./contracts";

export type { McpServerStatus } from "./contracts";

export type McpRuntimePhase =
  "idle" | "starting" | "ready" | "degraded" | "stopped" | "failed";

export interface McpRuntimeContextValue {
  status: McpServerStatus;
  phase: McpRuntimePhase;
  error: string | null;
  accessLevel: Permission;
  start: (options?: {
    rotateToken?: boolean;
    accessLevel?: Permission;
  }) => Promise<McpServerStatus | null>;
  stop: () => Promise<void>;
  restart: () => Promise<McpServerStatus | null>;
  setAccessLevel: (permission: Permission) => Promise<void>;
  rotateToken: () => Promise<McpServerStatus | null>;
}

export const EMPTY_MCP_STATUS: McpServerStatus = {
  running: false,
  endpoint: null,
  port: null,
  token: null,
  accessLevel: "read",
  protocolVersion: "2026-07-28",
  compatibleVersions: ["2026-07-28", "2025-11-25"],
  startedAt: null,
  workspaceSessionId: null,
  toolCount: 0,
  resourceCount: 0,
  promptCount: 0,
  activeCalls: 0,
  connectedClients: 0,
  clients: [],
};

export const McpRuntimeContext = createContext<McpRuntimeContextValue | null>(
  null
);

export function useMcpRuntime(): McpRuntimeContextValue {
  const context = useContext(McpRuntimeContext);
  if (!context) {
    throw new Error("useMcpRuntime must be used within McpRuntimeProvider");
  }
  return context;
}
