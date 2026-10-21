import { z } from "zod";

import { AppError } from "./errors";
import type { AppCommandContext } from "./types";

export const responseFormatSchema = z.enum(["json", "markdown"]).default("json");

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  response_format: responseFormatSchema.optional(),
});

export function requireRoot(context: AppCommandContext): string {
  if (!context.root) {
    throw new AppError(
      "workspace_not_ready",
      "Open a workspace before calling this tool."
    );
  }
  return context.root;
}

export function requireWorkId(
  context: AppCommandContext,
  requested?: string | null
): string {
  const workId = requested ?? context.workId;
  if (!workId) {
    throw new AppError(
      "no_current_work",
      "Select a work or provide work_id before calling this tool."
    );
  }
  return workId;
}

export function pageItems<T>(
  items: T[],
  limit: number,
  offset: number
): {
  items: T[];
  total_count: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
} {
  const page = items.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    items: page,
    total_count: items.length,
    count: page.length,
    offset,
    has_more: next < items.length,
    next_offset: next < items.length ? next : null,
  };
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AppError("cancelled", "The operation was cancelled.");
  }
}
