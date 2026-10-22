import {
  MCP_MAX_RESULT_CHARS,
  type McpBridgeError,
  type McpBridgeResponse,
} from "./contracts";

const RECOVERY: Record<string, string> = {
  workspace_not_ready: "Open a workspace in the application and retry.",
  no_current_work: "Select a work or pass a valid work_id.",
  not_found: "Refresh the relevant resource and verify the ID.",
  invalid_argument: "Correct the highlighted argument and retry.",
  permission_denied:
    "Ask the user to raise the MCP access level or approve this operation.",
  confirmation_required:
    "The user must approve this operation in the application.",
  revision_conflict:
    "Read the latest resource, merge deliberately and retry with its revision.",
  chapter_busy:
    "Ask the user to save or close the chapter in the editor before retrying.",
  navigation_required:
    "Open the target work and chapter with novels_open_chapter, wait for the editor to finish loading, then retry.",
  bridge_unavailable:
    "Reload the application WebView, wait for MCP readiness and retry.",
  cancelled: "Retry only if the operation is still needed.",
  rate_limited: "Wait for the rate-limit window and retry.",
  operation_failed: "Inspect the application logs and retry the operation.",
};

function truncateText(data: unknown): {
  value: unknown;
  truncated: boolean;
  returnedChars: number;
  totalChars: number;
} {
  if (
    !data ||
    typeof data !== "object" ||
    !("text" in data) ||
    typeof (data as { text?: unknown }).text !== "string"
  ) {
    const serialized = JSON.stringify(data ?? null);
    return {
      value: data,
      truncated: serialized.length > MCP_MAX_RESULT_CHARS,
      returnedChars: Math.min(serialized.length, MCP_MAX_RESULT_CHARS),
      totalChars: serialized.length,
    };
  }
  const text = (data as { text: string }).text;
  if (text.length <= MCP_MAX_RESULT_CHARS) {
    return {
      value: data,
      truncated: false,
      returnedChars: text.length,
      totalChars: text.length,
    };
  }
  return {
    value: {
      ...(data as Record<string, unknown>),
      text: text.slice(0, MCP_MAX_RESULT_CHARS),
      truncated: true,
      returned_chars: MCP_MAX_RESULT_CHARS,
      total_chars: text.length,
      next_cursor: MCP_MAX_RESULT_CHARS,
    },
    truncated: true,
    returnedChars: MCP_MAX_RESULT_CHARS,
    totalChars: text.length,
  };
}

export function toMarkdown(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data ?? "");
  const record = data as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.items)) {
    const lines = [`# ${String(record.title ?? "Results")}`];
    for (const item of record.items) {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        lines.push(
          `- **${String(row.title ?? row.name ?? row.id ?? "Item")}**${
            row.snippet ? `: ${String(row.snippet)}` : ""
          }`
        );
      } else {
        lines.push(`- ${String(item)}`);
      }
    }
    if (record.has_more) lines.push("\n_More results are available._");
    return lines.join("\n");
  }
  return `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

export function successResponse(
  requestId: string,
  data: unknown,
  responseFormat: "json" | "markdown" = "json"
): McpBridgeResponse {
  const truncated = truncateText(data);
  const structured =
    truncated.value && typeof truncated.value === "object"
      ? (truncated.value as Record<string, unknown>)
      : { value: truncated.value };
  const text =
    responseFormat === "markdown"
      ? toMarkdown(truncated.value)
      : JSON.stringify(truncated.value, null, 2);
  return {
    request_id: requestId,
    ok: true,
    data: truncated.value,
    structured_content: structured,
    content: [{ type: "text", text }],
    is_error: false,
  };
}

export function errorResponse(
  requestId: string,
  error: Omit<McpBridgeError, "recovery"> & { recovery?: string }
): McpBridgeResponse {
  const recovery =
    error.recovery ?? RECOVERY[error.code] ?? RECOVERY.operation_failed;
  const structured = {
    ok: false,
    error: {
      ...error,
      recovery,
    },
  };
  return {
    request_id: requestId,
    ok: false,
    error: { ...error, recovery },
    structured_content: structured,
    content: [
      {
        type: "text",
        text: `Error [${error.code}]: ${error.message}\nNext step: ${recovery}`,
      },
    ],
    is_error: true,
  };
}
