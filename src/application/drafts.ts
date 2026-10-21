import { z } from "zod";

import { AppError } from "./errors";
import { requireRoot, requireWorkId } from "./helpers";
import { defineAppCommand } from "./types";
import {
  listDrafts,
  readDraftEntry,
  removeDraft,
  writeDraft,
} from "@/services/drafts";
import { loadWorkspace } from "@/services/workspace";

async function workspaceWorkIds(root: string): Promise<Set<string>> {
  const workspace = await loadWorkspace(root);
  return new Set([...workspace.order, ...workspace.archived]);
}

const draftList = defineAppCommand({
  id: "novels_draft_list",
  title: "List drafts",
  description:
    "List drafts belonging only to the current workspace, newest first.",
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
    const ids = await workspaceWorkIds(root);
    const items = listDrafts().filter((draft) => ids.has(draft.workId));
    return { items, count: items.length };
  },
});

const draftGet = defineAppCommand({
  id: "novels_draft_get",
  title: "Get draft",
  description:
    "Return one draft for a chapter in the current workspace.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
    })
    .strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const workId = requireWorkId(context, input.work_id);
    const ids = await workspaceWorkIds(root);
    if (!ids.has(workId)) {
      throw new AppError(
        "not_found",
        "The requested work is not in the current workspace."
      );
    }
    return {
      draft: readDraftEntry(workId, input.chapter_id),
    };
  },
});

const draftSave = defineAppCommand({
  id: "novels_draft_save",
  title: "Save draft",
  description:
    "Save a chapter draft in the current workspace, including editing target and stashed paragraph.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
      chapter_title: z.string().trim().min(1).max(200),
      text: z.string().max(500_000),
      editing_card_id: z.string().uuid().optional(),
      stashed_text: z.string().max(500_000).optional(),
    })
    .strict(),
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
    const workId = requireWorkId(context, input.work_id);
    const ids = await workspaceWorkIds(root);
    if (!ids.has(workId)) {
      throw new AppError(
        "not_found",
        "The requested work is not in the current workspace."
      );
    }
    writeDraft({
      workId,
      chapterId: input.chapter_id,
      chapterTitle: input.chapter_title,
      text: input.text,
      ...(input.editing_card_id
        ? { editingCardId: input.editing_card_id }
        : {}),
      ...(input.stashed_text ? { stashedText: input.stashed_text } : {}),
    });
    return {
      saved: true,
      draft: readDraftEntry(workId, input.chapter_id),
    };
  },
});

const draftDelete = defineAppCommand({
  id: "novels_draft_delete",
  title: "Delete draft",
  description:
    "Delete one draft in the current workspace and notify the editor.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      chapter_id: z.string().uuid(),
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
    const workId = requireWorkId(context, input.work_id);
    const ids = await workspaceWorkIds(root);
    if (!ids.has(workId)) {
      throw new AppError(
        "not_found",
        "The requested work is not in the current workspace."
      );
    }
    removeDraft(workId, input.chapter_id);
    return { deleted: true, work_id: workId, chapter_id: input.chapter_id };
  },
});

export const DRAFT_COMMANDS = [
  draftList,
  draftGet,
  draftSave,
  draftDelete,
] as const;
