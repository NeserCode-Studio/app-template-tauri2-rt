/**
 * CodexContext：工作区级素材条目（人物 / 地点 / 物品…）与类型配置。
 *
 * 条目全部读进内存：条目数量是几百级别，远小于正文，逐条按需读
 * 会让正文提及高亮在输入时不可用。
 */

import { createContext, useContext } from "react";
import type {
  Entry,
  MentionIndex,
  Relation,
  TypeConfig,
} from "@/services/codex";

export interface TypeCreateInput {
  label: string;
  icon?: string;
  color?: TypeConfig["color"];
}

export interface CodexContextValue {
  entries: Entry[];
  relations: Relation[];
  mentions: MentionIndex;
  typeConfigs: TypeConfig[];
  currentEntryId: string | null;
  byType: (typeId: string) => Entry[];
  typeOf: (typeId: string) => TypeConfig | null;
  labelOf: (typeId: string) => string;
  /** 当前主题下的类型色。 */
  colorOf: (typeId: string) => string;
  setCurrentEntryId: (id: string | null) => void;
  reload: () => Promise<void>;
  create: (typeId: string, name: string) => Promise<Entry | null>;
  save: (entry: Entry) => Promise<Entry | null>;
  remove: (entryId: string) => Promise<void>;
  saveType: (type: TypeConfig) => Promise<TypeConfig | null>;
  createType: (input: TypeCreateInput) => Promise<TypeConfig | null>;
  removeType: (typeId: string) => Promise<void>;
  addRelation: (
    fromId: string,
    toId: string,
    kind: string,
    inverseKind: string,
    note?: string
  ) => Promise<Relation | null>;
  removeRelation: (relationId: string) => Promise<void>;
  syncChapterMentions: (
    workId: string,
    chapterId: string,
    text: string
  ) => Promise<void>;
}

export const CodexContext = createContext<CodexContextValue | null>(null);

export function useCodex(): CodexContextValue {
  const ctx = useContext(CodexContext);
  if (!ctx) throw new Error("useCodex must be used within CodexProvider");
  return ctx;
}
