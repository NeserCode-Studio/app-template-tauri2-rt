import { z } from "zod";

import { pageItems, requireRoot } from "./helpers";
import { defineAppCommand } from "./types";
import {
  listTrash,
  purgeFromTrash,
  restoreFromTrash,
} from "@/services/trash";

const trashList = defineAppCommand({
  id: "novels_trash_list",
  title: "List trash",
  description:
    "List workspace trash items with deterministic pagination and deletion timestamps.",
  input: z
    .object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
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
    return pageItems(await listTrash(root), input.limit, input.offset);
  },
});

const trashRestore = defineAppCommand({
  id: "novels_trash_restore",
  title: "Restore trash item",
  description:
    "Restore a work, volume or chapter from workspace trash. Existing target paths are never overwritten.",
  input: z.object({ item_id: z.string().uuid() }).strict(),
  permission: "write",
  risk: "R2",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    const restored = await restoreFromTrash(root, input.item_id);
    return { item_id: input.item_id, restored };
  },
});

const trashPurge = defineAppCommand({
  id: "novels_trash_purge",
  title: "Purge trash item",
  description:
    "Permanently delete one trash item and its stored files. This cannot be undone.",
  input: z.object({ item_id: z.string().uuid() }).strict(),
  permission: "admin",
  risk: "R3",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input, context) {
    const root = requireRoot(context);
    await purgeFromTrash(root, input.item_id);
    return { item_id: input.item_id, purged: true };
  },
});

const trashPurgeAll = defineAppCommand({
  id: "novels_trash_purge_all",
  title: "Purge all trash",
  description:
    "Permanently delete every item in the current workspace trash. This cannot be undone.",
  input: z.object({}).strict(),
  permission: "admin",
  risk: "R3",
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(_input, context) {
    const root = requireRoot(context);
    const items = await listTrash(root);
    for (let index = 0; index < items.length; index += 1) {
      await purgeFromTrash(root, items[index].itemId);
      context.progress.report({
        progress: index + 1,
        total: items.length,
        message: items[index].title,
      });
    }
    return { purged_count: items.length };
  },
});

export const TRASH_COMMANDS = [
  trashList,
  trashRestore,
  trashPurge,
  trashPurgeAll,
] as const;
