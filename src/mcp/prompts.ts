import { z } from "zod";

import { AppError } from "@/application/errors";
import { getAppCommand } from "@/application/registry";
import type { AppCommandContext } from "@/application/types";
import { MCP_MAX_RESULT_CHARS } from "./contracts";
import { describeImportPreview } from "@/application/import-export";

export interface McpPromptContent {
  description: string;
  messages: Array<{ text: string }>;
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
      `Prompt dependency ${commandId} is unavailable.`
    );
  }
  const parsed = command.input.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "invalid_argument",
      "The prompt arguments are invalid.",
      parsed.error.flatten()
    );
  }
  return (await command.execute(parsed.data, context)) as T;
}

function bounded(value: string): string {
  return value.length <= MCP_MAX_RESULT_CHARS
    ? value
    : `${value.slice(0, MCP_MAX_RESULT_CHARS)}\n[Truncated]`;
}

function prompt(description: string, text: string): McpPromptContent {
  return { description, messages: [{ text: bounded(text) }] };
}

const chapterPromptArguments = z
  .object({
    work_id: z.string().uuid(),
    chapter_id: z.string().uuid(),
  })
  .strict();

export async function getMcpPrompt(
  promptName: string,
  rawArguments: Record<string, unknown>,
  context: AppCommandContext
): Promise<McpPromptContent> {
  if (promptName === "novels_continue_chapter") {
    const args = chapterPromptArguments
      .extend({ direction: z.string().max(2_000).optional() })
      .parse(rawArguments);
    const [work, chapter] = await Promise.all([
      executeRead<{ work: { title: string }; counts: unknown }>(
        "novels_work_get",
        { work_id: args.work_id },
        context
      ),
      executeRead<{ chapter: unknown; text: string; has_more: boolean }>(
        "novels_chapter_get",
        {
          work_id: args.work_id,
          chapter_id: args.chapter_id,
          card_start: 0,
        },
        context
      ),
    ]);
    return prompt(
      `Continue ${work.work.title} from the supplied chapter context.`,
      [
        "You are helping the author continue a Chinese novel.",
        "Preserve the established point of view, voice, character names and continuity.",
        args.direction
          ? `Direction: ${args.direction}`
          : "Continue naturally from the ending.",
        `Work: ${work.work.title}`,
        `Chapter metadata: ${JSON.stringify(chapter.chapter)}`,
        `Current chapter text${chapter.has_more ? " (partial)" : ""}:`,
        chapter.text,
      ].join("\n\n")
    );
  }

  if (promptName === "novels_review_chapter") {
    const args = chapterPromptArguments.parse(rawArguments);
    const [work, chapter] = await Promise.all([
      executeRead<{ work: { title: string } }>(
        "novels_work_get",
        { work_id: args.work_id },
        context
      ),
      executeRead<{ text: string; has_more: boolean }>(
        "novels_chapter_get",
        {
          work_id: args.work_id,
          chapter_id: args.chapter_id,
          card_start: 0,
        },
        context
      ),
    ]);
    return prompt(
      `Review ${work.work.title} for continuity and prose issues.`,
      [
        "Review the chapter without rewriting it.",
        "Report concrete continuity, pacing, character-voice and prose problems.",
        "Order findings by severity and cite the relevant passage.",
        `Chapter text${chapter.has_more ? " (partial)" : ""}:`,
        chapter.text,
      ].join("\n\n")
    );
  }

  if (promptName === "novels_outline_plan") {
    const args = z
      .object({
        work_id: z.string().uuid(),
        goal: z.string().min(1).max(10_000),
      })
      .strict()
      .parse(rawArguments);
    const [work, outline] = await Promise.all([
      executeRead("novels_work_get", { work_id: args.work_id }, context),
      executeRead("novels_outline_get", { work_id: args.work_id }, context),
    ]);
    return prompt(
      "Plan or revise the work's volume, chapter and scene structure.",
      [
        `Planning goal: ${args.goal}`,
        `Current work: ${JSON.stringify(work)}`,
        `Current outline: ${JSON.stringify(outline)}`,
        "Propose a concrete structure. Do not claim that changes were written.",
      ].join("\n\n")
    );
  }

  if (promptName === "novels_consistency_audit") {
    const args = z
      .object({ work_id: z.string().uuid() })
      .strict()
      .parse(rawArguments);
    const [work, outline, entries] = await Promise.all([
      executeRead("novels_work_get", { work_id: args.work_id }, context),
      executeRead("novels_outline_get", { work_id: args.work_id }, context),
      executeRead(
        "novels_codex_entry_list",
        { limit: 100, offset: 0 },
        context
      ),
    ]);
    return prompt(
      "Audit the work against Codex entries and relations.",
      [
        "Compare the work metadata, outline and Codex snapshot for contradictions.",
        "Separate confirmed conflicts from uncertain gaps.",
        `Work: ${JSON.stringify(work)}`,
        `Outline: ${JSON.stringify(outline)}`,
        `Codex entries: ${JSON.stringify(entries)}`,
      ].join("\n\n")
    );
  }

  if (promptName === "novels_import_normalize") {
    const args = z
      .object({ preview_id: z.string().uuid() })
      .strict()
      .parse(rawArguments);
    const preview = describeImportPreview(args.preview_id);
    if (!preview) {
      throw new AppError(
        "not_found",
        "The import preview expired. Create a new preview and retry."
      );
    }
    return prompt(
      "Inspect an import preview and propose safe cleanup.",
      [
        "Review the parsed import structure before it is committed.",
        "Identify volume, chapter, preface and paragraph-boundary problems.",
        "Return proposed changes and risks. Do not commit the import.",
        JSON.stringify(preview, null, 2),
      ].join("\n\n")
    );
  }

  throw new AppError("not_found", "The requested prompt does not exist.");
}
