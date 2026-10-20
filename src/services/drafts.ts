/**
 * 暂存草稿：跨会话保留的"没写完的那一段"。
 *
 * 为什么只存 localStorage 不落工作区：正文是有版本意义的创作成果，
 * 草稿是没完成的半成品。混进 works/<id>/ 会污染用户导出的文本，
 * 应用崩了也只该丢一次半成品，不该丢一章正文。
 *
 * 为什么集中成一个键而不是每章一个键：按章分键会产生几十上百个零散条目，
 * 既没法在界面上列出"我还有哪些草稿"，清理时也难以确认覆盖范围。
 * 集中成一个 JSON 对象后，草稿箱可以直接遍历它。
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("Drafts");

const STORAGE_KEY = "novels-yes:drafts";

/**
 * 草稿变更广播。
 *
 * localStorage 不是响应式数据源：编辑器写入草稿后，草稿箱不会自己重渲染。
 * 用一个自定义事件把"变了"这件事广播出去，订阅方再重读列表。
 */
export const DRAFTS_CHANGED_EVENT = "novels-yes:drafts-changed";

/**
 * 显式删除广播。
 *
 * 草稿箱只负责删持久化记录，但当前章节的输入框仍持有同一段文字。
 * 若不把“删除的是哪一章”通知编辑器，切章时卸载逻辑会把输入框内容
 * 重新写成草稿，形成删不掉的循环。
 */
export const DRAFT_REMOVED_EVENT = "novels-yes:draft-removed";

export interface DraftRemovedDetail {
  workId: string;
  chapterId: string;
}

function broadcast(): void {
  window.dispatchEvent(new Event(DRAFTS_CHANGED_EVENT));
}

/** 单条草稿。 */
export interface Draft {
  /** 草稿文本（输入框里还没提交的内容）。 */
  text: string;
  /** 草稿所属作品。 */
  workId: string;
  /** 草稿所属章，用于草稿箱里显示"哪一章的半成品"。 */
  chapterId: string;
  chapterTitle: string;
  /**
   * 正在编辑的已有段落 id。
   *
   * 只存下标会在切章重挂后失效；id 能在重新读取章节卡片时找回目标，
   * 避免把“编辑旧段落”误恢复成“新建段落”。
   */
  editingCardId?: string;
  /** 点开旧段落前暂存的新段落；与 text 分开保存，避免互相覆盖。 */
  stashedText?: string;
  /** 最近更新时间（毫秒）。 */
  updatedAt: number;
}

/** 全部草稿：`"<workId>:<chapterId>" → 草稿`。 */
export type DraftStore = Record<string, Draft>;

export function draftKey(workId: string, chapterId: string): string {
  return `${workId}:${chapterId}`;
}

/**
 * 读取全部草稿。
 *
 * localStorage 可能被浏览器策略禁用、或存了旧格式的脏数据，
 * 任何异常都退化成空草稿箱——草稿丢失不该让整个编辑器打不开。
 */
export function readDrafts(): DraftStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    /* 逐条校验，坏条目单独剔除而不是整份丢弃。 */
    const out: DraftStore = {};
    for (const [key, value] of Object.entries(parsed)) {
      const d = value as Draft;
      if (d && typeof d.text === "string" && typeof d.chapterId === "string") {
        out[key] = {
          text: d.text,
          workId: typeof d.workId === "string" ? d.workId : "",
          chapterId: d.chapterId,
          chapterTitle:
            typeof d.chapterTitle === "string" ? d.chapterTitle : d.chapterId,
          ...(typeof d.editingCardId === "string" && d.editingCardId
            ? { editingCardId: d.editingCardId }
            : {}),
          ...(typeof d.stashedText === "string" && d.stashedText
            ? { stashedText: d.stashedText }
            : {}),
          updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.now(),
        };
      }
    }
    return out;
  } catch (err) {
    log.warn("drafts read failed", err);
    return {};
  }
}

function writeDrafts(store: DraftStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    /* 配额超限或隐私模式禁写：草稿丢失不该中断写作。 */
    log.warn("drafts write failed", err);
  }
}

/** 读取某一章的草稿。 */
export function readDraft(workId: string, chapterId: string): string | null {
  return readDraftEntry(workId, chapterId)?.text ?? null;
}

/** 读取完整草稿，包括编辑目标与暂存段落。 */
export function readDraftEntry(
  workId: string,
  chapterId: string
): Draft | null {
  return readDrafts()[draftKey(workId, chapterId)] ?? null;
}

/** 写入草稿；正文与暂存段落都为空时清空（提交后自动消失）。 */
export function writeDraft(draft: Omit<Draft, "updatedAt">): void {
  const store = readDrafts();
  const key = draftKey(draft.workId, draft.chapterId);
  if (!draft.text && !draft.stashedText) {
    if (key in store) {
      delete store[key];
      writeDrafts(store);
      broadcast();
    }
    return;
  }
  store[key] = { ...draft, updatedAt: Date.now() };
  writeDrafts(store);
  broadcast();
}

/** 删除单条草稿。 */
export function removeDraft(workId: string, chapterId: string): void {
  const store = readDrafts();
  delete store[draftKey(workId, chapterId)];
  writeDrafts(store);
  broadcast();
  window.dispatchEvent(
    new CustomEvent<DraftRemovedDetail>(DRAFT_REMOVED_EVENT, {
      detail: { workId, chapterId },
    })
  );
}

/** 草稿列表，按最近更新倒序（草稿箱展示用）。 */
export function listDrafts(): (Draft & { key: string })[] {
  return Object.entries(readDrafts())
    .map(([key, d]) => ({ ...d, key }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 一次性迁移：旧版本按 `novels-yes:draft:<workId>:<chapterId>` 分键存储，
 * 新版本集中成一个 JSON。迁移后清掉旧键，否则草稿会在两个地方同时存在，
 * 且旧键永远不会被清理。
 *
 * 只在集中存储为空时执行——若集中存储已有内容，说明用户已经在用了，
 * 这时不该拿旧数据覆盖。
 */
export function migrateLegacyDrafts(): void {
  try {
    const store = readDrafts();
    if (Object.keys(store).length) return;
    const legacy: { key: string; value: string }[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("novels-yes:draft:")) continue;
      const value = localStorage.getItem(key);
      if (value) legacy.push({ key, value });
    }
    if (!legacy.length) return;
    for (const { key, value } of legacy) {
      /* 键名形如 novels-yes:draft:<workId>:<chapterId>，id 本身不含冒号。 */
      const rest = key.slice("novels-yes:draft:".length);
      const sep = rest.indexOf(":");
      if (sep < 0) continue;
      const storeKey = draftKey(rest.slice(0, sep), rest.slice(sep + 1));
      if (storeKey in store) continue;
      store[storeKey] = {
        text: value,
        workId: rest.slice(0, sep),
        chapterId: rest.slice(sep + 1),
        chapterTitle: rest.slice(sep + 1),
        updatedAt: Date.now(),
      };
    }
    writeDrafts(store);
    for (const { key } of legacy) localStorage.removeItem(key);
    log.info("legacy drafts migrated", { count: legacy.length });
  } catch (err) {
    log.warn("legacy drafts migration failed", err);
  }
}
