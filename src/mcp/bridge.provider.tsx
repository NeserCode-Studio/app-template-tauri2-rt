import { useEffect, useRef, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { AppError, toCommandError } from "@/application/errors";
import { getAppCommand } from "@/application/registry";
import type { AppCommandContext } from "@/application/types";
import { useLibrary } from "@/contexts/library";
import { useOutline } from "@/contexts/outline";
import { useWorkspace } from "@/contexts/workspace";
import { createLogger } from "@/lib/logger";
import { beginActivity, endActivity } from "./activity";
import { requestApproval } from "./approval";
import {
  type McpBridgeRequest,
  type McpBridgeResponse,
  type McpCancelEvent,
  type McpPromptBridgeRequest,
  type McpResourceBridgeRequest,
} from "./contracts";
import { canUsePermission } from "./permissions";
import { getMcpPrompt } from "./prompts";
import { readMcpResource } from "./resources";
import { errorResponse, successResponse } from "./result";
import { useMcpRuntime } from "./runtime";
import { McpTaskReporter } from "./task-reporter";

const log = createLogger("McpBridge");
const SENSITIVE_ARGUMENTS = new Set([
  "body",
  "cards",
  "preface",
  "plot_summary",
  "stashed_text",
  "synopsis",
  "text",
]);

interface BridgeState {
  root: string | null;
  workId: string | null;
  accessLevel: ReturnType<typeof useMcpRuntime>["accessLevel"];
  workspaceSessionId: string | null;
}

function summarizeArguments(argumentsValue: Record<string, unknown>): string {
  const entries = Object.entries(argumentsValue)
    .filter(([, value]) => value !== undefined)
    .slice(0, 8)
    .map(([key, value]) => {
      if (SENSITIVE_ARGUMENTS.has(key)) return `${key}=[content omitted]`;
      if (typeof value === "string") {
        return `${key}=${value.length > 120 ? `${value.slice(0, 120)}...` : value}`;
      }
      if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        return `${key}=${String(value)}`;
      }
      return `${key}=[structured value]`;
    });
  return entries.length ? entries.join(", ") : "No arguments";
}

function approvalTarget(
  argumentsValue: Record<string, unknown>,
  workId: string | null
): string {
  for (const key of [
    "work_id",
    "chapter_id",
    "item_id",
    "entry_id",
    "node_id",
    "type_id",
    "id",
  ]) {
    const value = argumentsValue[key];
    if (typeof value === "string" && value) return `${key}: ${value}`;
  }
  return workId ? `work: ${workId}` : "Current workspace";
}

function errorFromValidation(error: {
  flatten: () => unknown;
  issues: Array<{ path: Array<string | number>; message: string }>;
}): AppError {
  const first = error.issues[0];
  const path = first?.path.length ? `${first.path.join(".")}: ` : "";
  return new AppError(
    "invalid_argument",
    `${path}${first?.message ?? "Invalid arguments."}`,
    error.flatten()
  );
}

function normalizeError(error: unknown): McpBridgeResponse["error"] {
  return toCommandError(error);
}

function responseFormatOf(argumentsValue: Record<string, unknown>) {
  return argumentsValue.response_format === "markdown" ? "markdown" : "json";
}

function commandArguments(
  command: NonNullable<ReturnType<typeof getAppCommand>>,
  argumentsValue: Record<string, unknown>
): Record<string, unknown> {
  if (
    !command.annotations?.readOnlyHint ||
    !("response_format" in argumentsValue)
  ) {
    return argumentsValue;
  }
  const next = { ...argumentsValue };
  delete next.response_format;
  return next;
}

export function McpBridgeProvider({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const library = useLibrary();
  const outline = useOutline();
  const runtime = useMcpRuntime();
  const controllers = useRef(new Map<string, AbortController>());
  const libraryRef = useRef(library);
  const outlineRef = useRef(outline);
  libraryRef.current = library;
  outlineRef.current = outline;
  const state = useRef<BridgeState>({
    root: workspace.root,
    workId: library.currentWorkId,
    accessLevel: runtime.accessLevel,
    workspaceSessionId: runtime.status.workspaceSessionId,
  });
  state.current = {
    root: workspace.root,
    workId: library.currentWorkId,
    accessLevel: runtime.accessLevel,
    workspaceSessionId: runtime.status.workspaceSessionId,
  };

  useEffect(() => {
    const activeControllers = controllers.current;
    const sendResponse = async (response: McpBridgeResponse) => {
      try {
        await invoke("mcp_bridge_respond", { response });
      } catch (err) {
        log.warn("MCP bridge response was not delivered", {
          requestId: response.request_id,
          err,
        });
      }
    };

    const sendError = async (
      requestId: string,
      error: unknown,
      fallbackCode: "invalid_argument" | "operation_failed" = "operation_failed"
    ) => {
      const normalized =
        normalizeError(error) ??
        ({
          code: fallbackCode,
          message: "The MCP request could not be completed.",
        } satisfies NonNullable<McpBridgeResponse["error"]>);
      await sendResponse(errorResponse(requestId, normalized));
    };

    const buildContext = (
      requestId: string,
      controller: AbortController
    ): AppCommandContext => {
      const reporter = new McpTaskReporter((progress) => {
        void invoke("mcp_bridge_progress", {
          request: {
            request_id: requestId,
            progress: progress.progress,
            total: progress.total,
            message: progress.message,
          },
        }).catch((err) => log.warn("MCP progress was not delivered", err));
      });
      return {
        root: state.current.root,
        workId: state.current.workId,
        permission: state.current.accessLevel,
        signal: controller.signal,
        progress: reporter,
      };
    };

    const refreshAfterWrite = async (toolName: string) => {
      const lifecycle = [
        "novels_workspace_create",
        "novels_workspace_open",
        "novels_workspace_close",
        "novels_workspace_migrate",
        "novels_workspace_delete",
      ].includes(toolName);
      if (!lifecycle) {
        const currentLibrary = libraryRef.current;
        const currentOutline = outlineRef.current;
        await Promise.allSettled([
          currentLibrary.refresh(),
          currentOutline.reload(),
          currentOutline.reloadChapterMetas(),
        ]);
        currentLibrary.bumpDataVersion();
      }
      const uris = [
        "novels://workspace",
        "novels://workspace/recent",
        "novels://works",
        "novels://codex/types",
        "novels://trash",
        "novels://drafts",
        "novels://settings",
      ];
      if (state.current.workId) {
        const workId = state.current.workId;
        uris.push(
          `novels://works/${workId}`,
          `novels://works/${workId}/outline`,
          `novels://works/${workId}/chapters`,
          `novels://works/${workId}/stats`
        );
      }
      await invoke("mcp_notify_resources_changed", {
        request: { uris },
      }).catch((err) => log.warn("MCP resource notification failed", err));
    };

    const handleToolCall = async (payload: McpBridgeRequest) => {
      const current = state.current;
      if (
        !current.workspaceSessionId ||
        payload.workspace_session_id !== current.workspaceSessionId
      ) {
        await sendError(
          payload.request_id,
          new AppError(
            "workspace_not_ready",
            "The MCP request belongs to a different workspace session."
          )
        );
        return;
      }
      if (!current.root) {
        await sendError(
          payload.request_id,
          new AppError("workspace_not_ready", "No workspace is open.")
        );
        return;
      }

      const command = getAppCommand(payload.tool_name);
      if (!command) {
        await sendError(
          payload.request_id,
          new AppError("not_found", "The requested MCP tool is not registered.")
        );
        return;
      }
      if (!canUsePermission(current.accessLevel, command.permission)) {
        await sendError(
          payload.request_id,
          new AppError(
            "permission_denied",
            `${command.title} requires ${command.permission} access.`
          )
        );
        return;
      }

      const parsed = command.input.safeParse(
        commandArguments(command, payload.arguments)
      );
      if (!parsed.success) {
        await sendError(payload.request_id, errorFromValidation(parsed.error));
        return;
      }

      const controller = new AbortController();
      activeControllers.set(payload.request_id, controller);
      const clientName = payload.client_info.name || "Unknown MCP client";
      beginActivity(payload.request_id, clientName, command.title);
      try {
        if (command.risk === "R2" || command.risk === "R3") {
          const approved = await requestApproval(
            {
              toolName: command.id,
              title: command.title,
              target: approvalTarget(payload.arguments, current.workId),
              summary: summarizeArguments(payload.arguments),
              risk: command.risk,
            },
            { signal: controller.signal }
          );
          if (!approved) {
            throw new AppError(
              "confirmation_required",
              "The user denied the operation or the approval request expired."
            );
          }
        }
        if (controller.signal.aborted) {
          throw new AppError("cancelled", "The MCP request was cancelled.");
        }

        const context = buildContext(payload.request_id, controller);
        const data = await command.execute(parsed.data, context);
        if (controller.signal.aborted) {
          throw new AppError("cancelled", "The MCP request was cancelled.");
        }
        await sendResponse(
          successResponse(
            payload.request_id,
            data,
            responseFormatOf(payload.arguments)
          )
        );
        if (!command.annotations?.readOnlyHint) {
          void refreshAfterWrite(command.id);
        }
      } catch (error) {
        await sendError(payload.request_id, error);
      } finally {
        activeControllers.delete(payload.request_id);
        endActivity(payload.request_id);
      }
    };

    const handleResourceRead = async (payload: McpResourceBridgeRequest) => {
      const current = state.current;
      if (
        !current.root ||
        !current.workspaceSessionId ||
        payload.workspace_session_id !== current.workspaceSessionId
      ) {
        await sendError(
          payload.request_id,
          new AppError("workspace_not_ready", "No matching workspace is open.")
        );
        return;
      }
      const controller = new AbortController();
      activeControllers.set(payload.request_id, controller);
      beginActivity(
        payload.request_id,
        payload.client_info.name || "Unknown MCP client",
        "Read resource"
      );
      try {
        const data = await readMcpResource(
          payload.uri,
          buildContext(payload.request_id, controller)
        );
        await sendResponse({
          request_id: payload.request_id,
          ok: true,
          data,
          structured_content: { ...data },
          content: [{ type: "text", text: data.text }],
          is_error: false,
        });
      } catch (error) {
        await sendError(payload.request_id, error);
      } finally {
        activeControllers.delete(payload.request_id);
        endActivity(payload.request_id);
      }
    };

    const handlePromptGet = async (payload: McpPromptBridgeRequest) => {
      const current = state.current;
      if (
        !current.root ||
        !current.workspaceSessionId ||
        payload.workspace_session_id !== current.workspaceSessionId
      ) {
        await sendError(
          payload.request_id,
          new AppError("workspace_not_ready", "No matching workspace is open.")
        );
        return;
      }
      const controller = new AbortController();
      activeControllers.set(payload.request_id, controller);
      beginActivity(
        payload.request_id,
        payload.client_info.name || "Unknown MCP client",
        "Expand prompt"
      );
      try {
        const data = await getMcpPrompt(
          payload.prompt_name,
          payload.arguments,
          buildContext(payload.request_id, controller)
        );
        await sendResponse({
          request_id: payload.request_id,
          ok: true,
          data,
          structured_content: { ...data },
          content: [{ type: "text", text: data.messages[0]?.text ?? "" }],
          is_error: false,
        });
      } catch (error) {
        await sendError(payload.request_id, error);
      } finally {
        activeControllers.delete(payload.request_id);
        endActivity(payload.request_id);
      }
    };

    const handleCancel = (payload: McpCancelEvent) => {
      activeControllers.get(payload.request_id)?.abort();
    };

    let disposed = false;
    let unlisteners: UnlistenFn[] = [];
    void Promise.all([
      listen<McpBridgeRequest>(
        "mcp:tool-call",
        (event) => void handleToolCall(event.payload)
      ),
      listen<McpResourceBridgeRequest>(
        "mcp:resource-read",
        (event) => void handleResourceRead(event.payload)
      ),
      listen<McpPromptBridgeRequest>(
        "mcp:prompt-get",
        (event) => void handlePromptGet(event.payload)
      ),
      listen<McpCancelEvent>("mcp:cancel", (event) =>
        handleCancel(event.payload)
      ),
    ])
      .then((items) => {
        if (disposed) {
          for (const unlisten of items) unlisten();
          return;
        }
        unlisteners = items;
      })
      .catch((err) => log.error("MCP bridge listeners failed", err));

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
      for (const controller of activeControllers.values()) controller.abort();
      activeControllers.clear();
    };
  }, []);

  return children;
}
