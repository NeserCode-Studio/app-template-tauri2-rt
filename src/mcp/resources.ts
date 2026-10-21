import { z } from "zod";

import { AppError } from "@/application/errors";
import { getAppCommand } from "@/application/registry";
import type { AppCommandContext } from "@/application/types";
import { MCP_MAX_RESULT_CHARS } from "./contracts";
import { buildToolDefinitions } from "./manifest";

export interface McpResourceContent {
  uri: string;
  text: string;
  mimeType: string;
}

const uuid = z.string().uuid();

function parseUri(uri: string): {
  host: string;
  segments: string[];
} {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new AppError("invalid_argument", "The resource URI is malformed.");
  }
  if (parsed.protocol !== "novels:") {
    throw new AppError("not_found", "Only novels:// resources are supported.");
  }
  return {
    host: parsed.hostname,
    segments: parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment)),
  };
}

async function executeRead<T>(
  commandId: string,
  input: unknown,
  context: AppCommandContext
): Promise<T> {
  const command = getAppCommand(commandId);
  if (!command) {
    throw new AppError(
      "not_found",
      `Resource command ${commandId} is unavailable.`
    );
  }
  const parsed = command.input.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "invalid_argument",
      "The resource parameters are invalid.",
      parsed.error.flatten()
    );
  }
  return (await command.execute(parsed.data, context)) as T;
}

function jsonResource(uri: string, value: unknown): McpResourceContent {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= MCP_MAX_RESULT_CHARS) {
    return { uri, text: serialized, mimeType: "application/json" };
  }
  return {
    uri,
    text: JSON.stringify(
      {
        truncated: true,
        returned_chars: MCP_MAX_RESULT_CHARS,
        total_chars: serialized.length,
        preview: serialized.slice(0, MCP_MAX_RESULT_CHARS),
      },
      null,
      2
    ),
    mimeType: "application/json",
  };
}

function textResource(uri: string, text: string): McpResourceContent {
  if (text.length <= MCP_MAX_RESULT_CHARS) {
    return { uri, text, mimeType: "text/plain" };
  }
  return {
    uri,
    text: `${text.slice(0, MCP_MAX_RESULT_CHARS)}\n\n[Truncated: ${text.length} total characters]`,
    mimeType: "text/plain",
  };
}

function requireWorkId(value: string | undefined): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw new AppError("invalid_argument", "A valid work ID is required.");
  }
  return parsed.data;
}

function requireChapterId(value: string | undefined): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw new AppError("invalid_argument", "A valid chapter ID is required.");
  }
  return parsed.data;
}

export async function readMcpResource(
  uri: string,
  context: AppCommandContext
): Promise<McpResourceContent> {
  const { host, segments } = parseUri(uri);

  if (host === "workspace") {
    if (!segments.length) {
      return jsonResource(
        uri,
        await executeRead("novels_workspace_get", {}, context)
      );
    }
    if (segments.length === 1 && segments[0] === "recent") {
      return jsonResource(
        uri,
        await executeRead("novels_workspace_recent_list", {}, context)
      );
    }
  }

  if (host === "works") {
    if (!segments.length) {
      return jsonResource(
        uri,
        await executeRead(
          "novels_work_list",
          { limit: 100, offset: 0 },
          context
        )
      );
    }
    const workId = requireWorkId(segments[0]);
    if (segments.length === 1) {
      return jsonResource(
        uri,
        await executeRead("novels_work_get", { work_id: workId }, context)
      );
    }
    if (segments[1] === "outline" && segments.length === 2) {
      return jsonResource(
        uri,
        await executeRead("novels_outline_get", { work_id: workId }, context)
      );
    }
    if (segments[1] === "chapters") {
      if (segments.length === 2) {
        return jsonResource(
          uri,
          await executeRead(
            "novels_chapter_list",
            { work_id: workId, limit: 100, offset: 0 },
            context
          )
        );
      }
      const chapterId = requireChapterId(segments[2]);
      if (segments.length === 3) {
        return jsonResource(
          uri,
          await executeRead(
            "novels_chapter_get",
            { work_id: workId, chapter_id: chapterId, card_start: 0 },
            context
          )
        );
      }
      if (segments.length === 4 && segments[3] === "text") {
        const result = await executeRead<{ text: string }>(
          "novels_chapter_history_read",
          { work_id: workId, chapter_id: chapterId, index: -1 },
          context
        );
        return textResource(uri, result.text);
      }
    }
    if (segments[1] === "stats" && segments.length === 2) {
      return jsonResource(
        uri,
        await executeRead("novels_stats_get", { work_id: workId }, context)
      );
    }
  }

  if (host === "codex") {
    if (segments.length === 1 && segments[0] === "types") {
      return jsonResource(
        uri,
        await executeRead("novels_codex_type_list", {}, context)
      );
    }
    if (segments.length === 2 && segments[0] === "entries") {
      return jsonResource(
        uri,
        await executeRead(
          "novels_codex_entry_get",
          { entry_id: requireWorkId(segments[1]) },
          context
        )
      );
    }
  }

  if (host === "trash" && !segments.length) {
    return jsonResource(
      uri,
      await executeRead("novels_trash_list", { limit: 100, offset: 0 }, context)
    );
  }

  if (host === "drafts" && !segments.length) {
    return jsonResource(
      uri,
      await executeRead("novels_draft_list", {}, context)
    );
  }

  if (host === "settings" && !segments.length) {
    return jsonResource(
      uri,
      await executeRead("novels_app_settings_get", {}, context)
    );
  }

  if (host === "schema" && segments.length === 1) {
    const domain = segments[0];
    const tools = buildToolDefinitions("admin").filter(
      (tool) =>
        tool.name.includes(domain) ||
        tool.title.toLowerCase().includes(domain.toLowerCase())
    );
    return jsonResource(uri, { domain, tools });
  }

  throw new AppError("not_found", "The requested resource does not exist.");
}
