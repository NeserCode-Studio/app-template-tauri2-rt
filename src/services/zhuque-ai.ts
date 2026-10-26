import { invoke } from "@tauri-apps/api/core";

import type { ZhuqueAiDetection } from "@/shared/schema";

export type {
  ZhuqueAiDetection,
  ZhuqueAiUsage,
  ZhuqueSegmentLabel,
} from "@/shared/schema";

export interface ZhuqueAiConfig {
  configured: boolean;
  maskedKey: string | null;
}

export class ZhuqueAiClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ZhuqueAiClientError";
    this.code = code;
  }
}

function normalizeError(error: unknown): ZhuqueAiClientError {
  if (error instanceof ZhuqueAiClientError) return error;
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; message?: unknown };
    if (typeof value.code === "string") {
      return new ZhuqueAiClientError(
        value.code,
        typeof value.message === "string" ? value.message : value.code
      );
    }
  }
  if (typeof error === "string") {
    try {
      return normalizeError(JSON.parse(error));
    } catch {
      return new ZhuqueAiClientError("generic", error);
    }
  }
  return new ZhuqueAiClientError("generic", "Zhuque AI request failed.");
}

async function invokeZhuque<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

export function getZhuqueAiConfig(): Promise<ZhuqueAiConfig> {
  return invokeZhuque("zhuque_ai_config_get");
}

export function setZhuqueAiApiKey(apiKey: string): Promise<ZhuqueAiConfig> {
  return invokeZhuque("zhuque_ai_config_set", { apiKey });
}

export function clearZhuqueAiApiKey(): Promise<ZhuqueAiConfig> {
  return invokeZhuque("zhuque_ai_config_clear");
}

export function detectWithZhuque(
  text: string,
  isMerge = true
): Promise<ZhuqueAiDetection> {
  return invokeZhuque("zhuque_ai_detect", { text, isMerge });
}
