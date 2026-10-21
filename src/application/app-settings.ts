import { z } from "zod";

import { getApplicationHost } from "./host";
import { defineAppCommand } from "./types";
import { requireRoot } from "./helpers";
import { loadWork } from "@/services/workspace";
import { loadOutline } from "@/services/outline";

const writingPreferencesSchema = z
  .object({
    indentSpaces: z.union([z.literal(0), z.literal(2), z.literal(4)]).optional(),
    paragraphGap: z.boolean().optional(),
    lineWidth: z.number().int().min(12).max(120).optional(),
    lineHeight: z.number().min(1).max(3).optional(),
    articleFont: z
      .enum(["songti", "source-han-serif", "lxgw-wenkai", "system-sans"])
      .optional(),
    fontSize: z.number().int().min(10).max(48).optional(),
    uiFont: z.enum(["system-sans", "system-serif", "system-mono"]).optional(),
    uiFontSize: z.number().int().min(10).max(32).optional(),
    highlightMentions: z.boolean().optional(),
    searchHotkeyEnabled: z.boolean().optional(),
    chapterTurnEnabled: z.boolean().optional(),
    paragraphSnapEnabled: z.boolean().optional(),
    chapterTurnHintsEnabled: z.boolean().optional(),
    chapterTurnThreshold: z.number().int().min(120).max(600).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "No preference was provided.");

const preferencesGet = defineAppCommand({
  id: "novels_preferences_get",
  title: "Get writing preferences",
  description:
    "Return current typography, paragraph, mention highlighting and chapter-turn preferences.",
  input: z.object({}).strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute() {
    return getApplicationHost().preferences.get();
  },
});

const preferencesUpdate = defineAppCommand({
  id: "novels_preferences_update",
  title: "Update writing preferences",
  description:
    "Update validated writing preferences. Only supplied keys are changed.",
  input: writingPreferencesSchema,
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input) {
    return getApplicationHost().preferences.update(input);
  },
});

const appSettingsGet = defineAppCommand({
  id: "novels_app_settings_get",
  title: "Get application settings",
  description:
    "Return theme, language, writing view mode, application title and writing preferences.",
  input: z.object({}).strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute() {
    const host = getApplicationHost();
    return {
      ...host.settings.get(),
      writing_preferences: host.preferences.get(),
    };
  },
});

const appSettingsUpdate = defineAppCommand({
  id: "novels_app_settings_update",
  title: "Update application settings",
  description:
    "Update validated theme, language, writing view mode or application title.",
  input: z
    .object({
      theme: z.enum(["light", "dark", "system"]).optional(),
      language: z.enum(["zh-CN", "en-US"]).optional(),
      view_mode: z.enum(["off", "focus", "typewriter", "zen"]).optional(),
      app_title: z.string().trim().min(1).max(200).optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.theme !== undefined ||
        value.language !== undefined ||
        value.view_mode !== undefined ||
        value.app_title !== undefined,
      "At least one setting is required."
    ),
  permission: "write",
  risk: "R1",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input) {
    return getApplicationHost().settings.update({
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.view_mode !== undefined ? { viewMode: input.view_mode } : {}),
      ...(input.app_title !== undefined ? { appTitle: input.app_title } : {}),
    });
  },
});

const uiOpen = defineAppCommand({
  id: "novels_ui_open",
  title: "Open application dialog",
  description:
    "Open the settings or about dialog by fixed enum. Arbitrary routes and URLs are rejected.",
  input: z.object({ target: z.enum(["settings", "about"]) }).strict(),
  permission: "read",
  risk: "R0",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async execute(input) {
    await getApplicationHost().openUi(input.target);
    return { opened: input.target };
  },
});

const navigate = defineAppCommand({
  id: "novels_navigate",
  title: "Navigate application",
  description:
    "Navigate to a fixed application page. Arbitrary routes are rejected.",
  input: z
    .object({
      target: z.enum(["home", "library", "codex", "editor", "settings"]),
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
  async execute(input) {
    await getApplicationHost().navigate(input.target);
    return { navigated_to: input.target };
  },
});

const openChapter = defineAppCommand({
  id: "novels_open_chapter",
  title: "Open chapter",
  description:
    "Select a work and chapter in the application after verifying that the chapter belongs to the work.",
  input: z
    .object({
      work_id: z.string().uuid(),
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
    await loadWork(root, input.work_id);
    const outline = await loadOutline(root, input.work_id);
    if (
      !outline.nodes.some(
        (node) => node.id === input.chapter_id && node.type === "chapter"
      )
    ) {
      throw new Error("The chapter does not belong to the requested work.");
    }
    await getApplicationHost().openChapter(input.work_id, input.chapter_id);
    return {
      opened_work_id: input.work_id,
      opened_chapter_id: input.chapter_id,
    };
  },
});

export const APP_SETTINGS_COMMANDS = [
  preferencesGet,
  preferencesUpdate,
  appSettingsGet,
  appSettingsUpdate,
  uiOpen,
  navigate,
  openChapter,
] as const;
