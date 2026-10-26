import { createLogger } from "@/lib/logger";
import {
  zhuqueDetectionRecordSchema,
  type ZhuqueDetectionRecord,
} from "@/shared/schema";

import { createFs } from "./fs";
import { zhuqueDetectionFile } from "./paths";

const log = createLogger("ZhuqueHistory");

/** 为待检测正文生成稳定指纹，仅用于识别检测后是否发生修改。 */
export async function fingerprintZhuqueText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function loadZhuqueDetection(
  root: string,
  workId: string,
  chapterId: string
): Promise<ZhuqueDetectionRecord | null> {
  const fs = createFs(root);
  const file = zhuqueDetectionFile(workId, chapterId);
  if (!(await fs.exists(file))) return null;

  const parsed = zhuqueDetectionRecordSchema.safeParse(
    JSON.parse(await fs.readText(file))
  );
  if (!parsed.success) {
    log.warn("saved detection result is invalid", {
      workId,
      chapterId,
      issues: parsed.error.issues,
    });
    throw new Error("Saved Zhuque detection result is invalid.");
  }
  if (parsed.data.workId !== workId || parsed.data.chapterId !== chapterId) {
    log.warn("saved detection result belongs to another chapter", {
      workId,
      chapterId,
    });
    throw new Error(
      "Saved Zhuque detection result belongs to another chapter."
    );
  }
  return parsed.data;
}

export async function saveZhuqueDetection(
  root: string,
  record: ZhuqueDetectionRecord
): Promise<ZhuqueDetectionRecord> {
  const parsed = zhuqueDetectionRecordSchema.parse(record);
  const fs = createFs(root);
  await fs.writeText(
    zhuqueDetectionFile(parsed.workId, parsed.chapterId),
    JSON.stringify(parsed, null, 2)
  );
  return parsed;
}
