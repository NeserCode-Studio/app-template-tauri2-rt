import { defaultBuiltinTypes } from "./builtin";
import type { FieldTemplate, TypeConfig } from "./types";

const FIELD_LABELS_EN: Record<string, Record<string, string>> = {
  character: {
    role: "Role",
    appearance: "Appearance",
    personality: "Personality",
    goal: "Goal",
    motivation: "Motivation",
    arc: "Character arc",
    background: "Background",
    realm: "Realm / rank",
    speech: "Speech style",
    faction: "Faction",
    mentor: "Mentor",
    weapon: "Weapon",
  },
  place: {
    parent: "Parent location",
    region: "Region",
    atmosphere: "Atmosphere",
    faction: "Faction",
    rules: "Local rules / wards",
    plotRole: "Story role",
    residents: "Residents",
  },
  item: {
    grade: "Grade / rarity",
    owner: "Owner",
    ability: "Ability / effect",
    origin: "Origin",
    material: "Material / specifications",
    state: "Current state",
  },
  faction: {
    leader: "Leader",
    seat: "Headquarters",
    agenda: "Agenda",
    methods: "Methods",
    scale: "Scale",
    creed: "Creed",
    members: "Members",
  },
  event: {
    time: "Time",
    order: "Sort order",
    place: "Location",
    participants: "Participants",
    cause: "Cause",
    process: "Events",
    result: "Outcome",
    impact: "Impact",
  },
  system: {
    rules: "Rules",
    levels: "Ranking",
    cost: "Costs and limits",
    exceptions: "Exceptions",
  },
  culture: {
    customs: "Customs",
    taboos: "Taboos",
    festivals: "Festivals",
    belief: "Beliefs",
  },
  term: {
    meaning: "Meaning",
    category: "Category",
    usage: "Usage",
    source: "Origin",
  },
  timeline: {
    era: "Era",
    order: "Sort order",
    span: "Span",
    significance: "Historical significance",
  },
};

const FIELD_HINTS_EN: Record<string, Record<string, string>> = {
  event: {
    order: "Used for timeline ordering; lower numbers appear earlier.",
  },
  timeline: {
    order: "Used for era ordering; lower numbers appear earlier.",
  },
};

const RELATION_LABELS_EN: Record<string, string> = {
  亲属: "kin",
  师承: "mentor",
  弟子: "disciple",
  挚友: "close friend",
  敌对: "hostile",
  仇敌: "rival",
  主仆: "master and servant",
  主人: "master",
  恋慕: "in love with",
  同僚: "colleague",
  效忠: "loyal to",
  效忠者: "loyalist",
  创建: "founded",
  创建者: "founder",
  成员: "member",
  背叛自: "defected from",
  叛徒: "traitor",
  居住: "resides in",
  居民: "resident",
  出身: "hails from",
  出身地: "birthplace",
  藏身: "hides in",
  藏身地: "hiding place",
  驻守: "guards",
  守卫: "guard",
  持有: "holds",
  持有者: "holder",
  追求: "seeks",
  追求者: "seeker",
  制造: "created",
  制造者: "creator",
  使用: "uses",
  使用者: "user",
  参与: "participates in",
  参与者: "participant",
  主导: "leads",
  主导者: "leader",
  见证: "witnesses",
  见证者: "witness",
  受害: "victim of",
  受害者: "victim",
  关联: "related to",
  相关者: "related entry",
  信奉: "believes in",
  信奉者: "believer",
  修炼: "practices",
  修行者: "practitioner",
  隶属: "belongs to",
  下属: "subordinate",
  相邻: "borders",
  邻接: "adjacent",
  通往: "leads to",
  通道: "passage",
  势力范围: "territory of",
  势力: "faction",
  驻地: "based at",
  驻扎: "stationed",
  诞生地: "birthplace",
  发源地: "origin",
  出产: "produced in",
  产地: "source",
  镇馆之宝: "signature treasure",
  收藏: "collection",
  发生地: "takes place in",
  发生于: "takes place at",
  环境法则: "environmental law",
  约束: "constraint",
  风俗: "custom",
  盛行: "practiced",
  组成: "composed of",
  部件: "component",
  克制: "counters",
  被克制: "countered by",
  配套: "pairs with",
  归属: "belongs to",
  归属方: "owner",
  敌对方: "opponent",
  联盟: "allied with",
  盟友: "ally",
  从属: "subordinate to",
  上级: "superior",
  竞争: "competes with",
  竞争者: "competitor",
  首领: "leader",
  客卿: "retainer",
  控制范围: "controlled area",
  奉行: "follows",
  涉及: "involves",
  相关: "related",
  前因: "caused by",
  导致: "leads to",
  后续: "follows",
  "由…引发": "triggered by",
  同时: "concurrent with",
  同时发生: "simultaneous",
  时期: "period",
  依赖: "depends on",
  被依赖: "depended on by",
  矛盾: "conflicts with",
  冲突: "conflict",
  细化: "refines",
  相关事件: "related event",
  前于: "precedes",
  后于: "follows",
  包含: "contains",
  被包含: "contained by",
};

const DEFAULT_FIELD_LABELS = new Map<string, string>();
const DEFAULT_FIELD_HINTS = new Map<string, string>();
for (const type of defaultBuiltinTypes()) {
  for (const field of type.fields) {
    const key = `${type.id}.${field.key}`;
    DEFAULT_FIELD_LABELS.set(key, field.label.trim());
    if (field.hint) DEFAULT_FIELD_HINTS.set(key, field.hint.trim());
  }
}

/**
 * 类型显示名的唯一口径。
 *
 * 内置类型默认留空 label 并走 i18n；用户一旦填写自由 label，
 * 就以用户文本优先。自定义类型没有 labelKey，直接显示 label。
 */
export function typeLabel(
  type: TypeConfig | null | undefined,
  translate: (key: string) => string
): string {
  if (!type) return "";
  const custom = type.label.trim();
  if (custom) return custom;
  return type.labelKey ? translate(type.labelKey) : type.id;
}

export function typeLabelById(
  types: TypeConfig[],
  typeId: string,
  translate: (key: string) => string
): string {
  return (
    typeLabel(
      types.find((type) => type.id === typeId),
      translate
    ) || typeId
  );
}

/**
 * 字段名显示口径。
 *
 * 内置字段的种子标签是中文，直接存进 types.json 后会绕过界面语言。
 * 只有当前标签仍与出厂模板一致时才翻译，用户改写的字段名保持不变。
 */
export function fieldLabel(
  typeId: string,
  field: Pick<FieldTemplate, "key" | "label">,
  lang: string
): string {
  const current = field.label.trim() || field.key;
  if (lang !== "en-US") return current;

  const key = `${typeId}.${field.key}`;
  const defaultLabel = DEFAULT_FIELD_LABELS.get(key);
  if (
    !defaultLabel ||
    (field.label.trim() && field.label.trim() !== defaultLabel)
  ) {
    return current;
  }
  return FIELD_LABELS_EN[typeId]?.[field.key] ?? current;
}

/**
 * 字段提示的显示口径。
 *
 * builtin.ts 里的 hint 会写进 types.json，因此同样需要区分出厂提示与
 * 用户自定义提示；后者不参与翻译。
 */
export function fieldHint(
  typeId: string,
  field: Pick<FieldTemplate, "key" | "hint">,
  lang: string
): string {
  const current = field.hint?.trim() ?? "";
  if (!current || lang !== "en-US") return current;

  const key = `${typeId}.${field.key}`;
  const defaultHint = DEFAULT_FIELD_HINTS.get(key);
  if (current !== defaultHint) return current;
  return FIELD_HINTS_EN[typeId]?.[field.key] ?? current;
}

/** 内置关系词的英文映射；自定义关系文本原样返回。 */
export function relationLabel(label: string, lang: string): string {
  const current = label.trim();
  if (lang !== "en-US") return current;
  const translated = RELATION_LABELS_EN[current];
  if (!translated) return current;
  return translated.charAt(0).toUpperCase() + translated.slice(1);
}
