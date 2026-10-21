import { z } from "zod";

import { requireRoot, requireWorkId } from "./helpers";
import { defineAppCommand } from "./types";
import { loadStats, recordWorkWords, saveStats } from "@/services/stats";
import { countWorkWords } from "@/services/chapter";
import { loadWorkspace } from "@/services/workspace";

const statsGet = defineAppCommand({
  id: "novels_stats_get",
  title: "Get writing statistics",
  description:
    "Return total words, daily values, streak, goals, curve mode and per-work word counts.",
  input: z.object({ work_id: z.string().uuid().optional() }).strict(),
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
    return loadStats(root, workId);
  },
});

const statsUpdate = defineAppCommand({
  id: "novels_stats_update",
  title: "Update writing statistics settings",
  description:
    "Update the daily word goal or curve mode without changing recorded word counts.",
  input: z
    .object({
      work_id: z.string().uuid().optional(),
      daily_goal: z.number().int().min(0).max(10_000_000).optional(),
      curve_mode: z.enum(["net", "total"]).optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.daily_goal !== undefined || value.curve_mode !== undefined,
      "At least one update field is required."
    ),
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
    const current = await loadStats(root, workId);
    const next = {
      ...current,
      ...(input.daily_goal !== undefined
        ? { dailyGoal: input.daily_goal }
        : {}),
      ...(input.curve_mode !== undefined ? { curveMode: input.curve_mode } : {}),
    };
    await saveStats(root, workId, next);
    return next;
  },
});

const statsRecalculate = defineAppCommand({
  id: "novels_stats_recalculate",
  title: "Recalculate writing statistics",
  description:
    "Recalculate word counts from chapter indexes for one work or every work in the workspace.",
  input: z.object({ work_id: z.string().uuid().optional() }).strict(),
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
    const workspace = await loadWorkspace(root);
    const workIds = input.work_id
      ? [requireWorkId(context, input.work_id)]
      : [...workspace.order, ...workspace.archived];
    const results = [];
    for (let index = 0; index < workIds.length; index += 1) {
      const workId = workIds[index];
      const words = await countWorkWords(root, workId, (progress) => {
        context.progress.report({
          progress: index + progress.done,
          total: workIds.length * Math.max(1, progress.total),
          message: progress.title ?? workId,
        });
      });
      const stats = await recordWorkWords(root, workId, words);
      results.push({ work_id: workId, words, stats });
    }
    return { items: results, count: results.length };
  },
});

export const STATS_COMMANDS = [
  statsGet,
  statsUpdate,
  statsRecalculate,
] as const;
