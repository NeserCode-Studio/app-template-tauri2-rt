/**
 * 内置类型模板（计划书 codex-v2.md §3.9 / §3.10）。
 *
 * 九类内置类型：人物、地点、物品、势力、事件、体系、文化、术语、时间线。
 *
 * 前八类取自计划书 §3.9 的表。第九类是「时间线」——V1 里它是独立类型，
 * 而 §3.6 把时间线改成了「事件按时间排序的视图」。若就此删掉 timeline 类型，
 * 旧工作区里已建的 timeline 条目迁移时将无处可去；保留它既符合「九类」的
 * 要求，也让旧数据有落点。事件类型负责承载真正的时间线内容，
 * timeline 类型保留为「年代 / 纪元」这类粗粒度标记。
 *
 * 这份模板是**种子**：用户在类型管理面板里可增删改字段与关系词表，
 * 改的是 types.json 里的副本，代码常量始终是出厂值。
 */

import type { FieldTemplate, RelationKindDef, TypeConfig } from "./types";

/** 内置类型 id。类型 id 是字符串而非枚举，用户可自建类型。 */
export const BUILTIN_TYPE_IDS = [
  "character",
  "place",
  "item",
  "faction",
  "event",
  "system",
  "culture",
  "term",
  "timeline",
] as const;

export type BuiltinTypeId = (typeof BUILTIN_TYPE_IDS)[number];

/** 内置类型的显示名走 i18n，自定义类型没有 labelKey。 */
const BUILTIN_LABEL_KEYS: Record<BuiltinTypeId, string> = {
  character: "Codex.type.character",
  place: "Codex.type.place",
  item: "Codex.type.item",
  faction: "Codex.type.faction",
  event: "Codex.type.event",
  system: "Codex.type.system",
  culture: "Codex.type.culture",
  term: "Codex.type.term",
  timeline: "Codex.type.timeline",
};

/**
 * 默认色板：低饱和协调组，亮暗各一份。
 *
 * V1 用单一 hex（#7c3aed 等），在暗色主题下偏糊。这里给每类两套值，
 * 用户可在类型管理面板覆写。色相拉开但饱和度压低——
 * 类型色是安静信号，界面里出现的是色点与 3px 竖条，不是大面积填色。
 */
const DEFAULT_COLORS: Record<BuiltinTypeId, { light: string; dark: string }> = {
  character: { light: "#74628f", dark: "#b9a8d2" },
  place: { light: "#52707b", dark: "#9fbec7" },
  item: { light: "#866a47", dark: "#d0b58b" },
  faction: { light: "#865764", dark: "#cfa1ab" },
  event: { light: "#55766c", dark: "#9bc2b4" },
  system: { light: "#626c86", dark: "#aeb8d0" },
  culture: { light: "#775e76", dark: "#c4a7c1" },
  term: { light: "#666b70", dark: "#c1c5c9" },
  timeline: { light: "#70764f", dark: "#c2c89e" },
};

/** V2 首版的出厂色：只用于自动升级，不覆盖用户自定义颜色。 */
const LEGACY_DEFAULT_COLORS: Record<
  BuiltinTypeId,
  { light: string; dark: string }
> = {
  character: { light: "#8b5cf6", dark: "#a78bfa" },
  place: { light: "#0284c7", dark: "#38bdf8" },
  item: { light: "#b45309", dark: "#fbbf24" },
  faction: { light: "#be123c", dark: "#fb7185" },
  event: { light: "#0d9488", dark: "#2dd4bf" },
  system: { light: "#4f46e5", dark: "#818cf8" },
  culture: { light: "#9d174d", dark: "#f9a8d4" },
  term: { light: "#475569", dark: "#cbd5e1" },
  timeline: { light: "#65a30d", dark: "#bef264" },
};

/** 识别仍停留在旧出厂色板的内置类型，避免升级时覆盖用户自选色。 */
export function usesLegacyDefaultColor(
  typeId: string,
  color: { light: string; dark: string }
): boolean {
  const legacy = LEGACY_DEFAULT_COLORS[typeId as BuiltinTypeId];
  return Boolean(
    legacy && color.light === legacy.light && color.dark === legacy.dark
  );
}

/** lucide 图标名：类型栏与详情标题前的识别符。 */
const DEFAULT_ICONS: Record<BuiltinTypeId, string> = {
  character: "user",
  place: "map-pin",
  item: "package",
  faction: "flag",
  event: "clock",
  system: "layers",
  culture: "landmark",
  term: "book-open",
  timeline: "calendar-clock",
};

/* ---------- 字段模板 ---------- */

function f(
  key: string,
  label: string,
  kind: FieldTemplate["kind"],
  order: number,
  extra?: Partial<FieldTemplate>
): FieldTemplate {
  return { key, label, kind, order, options: [], ...extra };
}

const FIELDS: Record<BuiltinTypeId, FieldTemplate[]> = {
  /* 人物：中文长篇的身份/门派/师承/兵器/性格/志向 + 网文的修为与机缘。 */
  character: [
    f("role", "角色定位", "text", 0),
    f("appearance", "外貌", "longtext", 1),
    f("personality", "性格", "longtext", 2),
    f("goal", "目标", "text", 3),
    f("motivation", "动机", "longtext", 4),
    f("arc", "成长弧线", "longtext", 5),
    f("background", "出身背景", "longtext", 6),
    f("realm", "修为 / 等级", "text", 7),
    f("speech", "口头禅 / 语言风格", "text", 8),
    f("faction", "阵营", "refs", 9, { targetTypeId: "faction" }),
    f("mentor", "师承", "ref", 10, { targetTypeId: "character" }),
    f("weapon", "兵器", "ref", 11, { targetTypeId: "item" }),
  ],
  /* 地点：大陆—州—城—秘境—洞府的层层隶属，加上地方性规则。 */
  place: [
    f("parent", "上级地点", "ref", 0, { targetTypeId: "place" }),
    f("region", "所属地域", "text", 1),
    f("atmosphere", "环境氛围", "longtext", 2),
    f("faction", "势力范围", "ref", 3, { targetTypeId: "faction" }),
    f("rules", "本地规则 / 禁制", "longtext", 4),
    f("plotRole", "剧情作用", "longtext", 5),
    f("residents", "常驻人物", "refs", 6, { targetTypeId: "character" }),
  ],
  /* 物品：品阶、持有者、来历、能力、当前状态。 */
  item: [
    f("grade", "品阶 / 稀有度", "text", 0),
    f("owner", "持有者", "ref", 1, { targetTypeId: "character" }),
    f("ability", "能力 / 效果", "longtext", 2),
    f("origin", "来历", "longtext", 3),
    f("material", "材质规格", "text", 4),
    f("state", "当前状态", "text", 5),
  ],
  /* 势力：agenda 与 methods 是写群像最关键的两栏，中文设定里少有对应项。 */
  faction: [
    f("leader", "首领", "ref", 0, { targetTypeId: "character" }),
    f("seat", "驻地", "ref", 1, { targetTypeId: "place" }),
    f("agenda", "组织目标", "longtext", 2),
    f("methods", "行事方式", "longtext", 3),
    f("scale", "势力规模", "text", 4),
    f("creed", "门规 / 信条", "longtext", 5),
    f("members", "成员", "refs", 6, { targetTypeId: "character" }),
  ],
  /* 事件：因果链（前因 → 后果），带地点与参与者。 */
  event: [
    f("time", "时间点", "date", 0),
    f("order", "排序值", "number", 1, { hint: "时间线排序用，数字越小越早" }),
    f("place", "发生地", "ref", 2, { targetTypeId: "place" }),
    f("participants", "参与者", "refs", 3, { targetTypeId: "character" }),
    f("cause", "起因", "longtext", 4),
    f("process", "经过", "longtext", 5),
    f("result", "结果", "longtext", 6),
    f("impact", "影响", "longtext", 7),
  ],
  /* 体系：规则条目、等级表、代价与限制、例外情形。 */
  system: [
    f("rules", "规则条目", "longtext", 0),
    f("levels", "等级表", "longtext", 1),
    f("cost", "代价与限制", "longtext", 2),
    f("exceptions", "例外情形", "longtext", 3),
  ],
  /* 文化：习俗、禁忌、节庆、信仰。 */
  culture: [
    f("customs", "习俗", "longtext", 0),
    f("taboos", "禁忌", "longtext", 1),
    f("festivals", "节庆", "longtext", 2),
    f("belief", "信仰", "longtext", 3),
  ],
  /* 术语：功法名、丹药名、境界名——高频术语需要独立可查、可被正文提及。 */
  term: [
    f("meaning", "含义", "longtext", 0),
    f("category", "类别", "text", 1),
    f("usage", "使用场合", "text", 2),
    f("source", "来源", "text", 3),
  ],
  /* 时间线：粗粒度的年代 / 纪元标记（如「末法」「开元」）。 */
  timeline: [
    f("era", "纪元 / 年代", "text", 0),
    f("order", "排序值", "number", 1, { hint: "年代排序用，数字越小越早" }),
    f("span", "起讫", "text", 2),
    f("significance", "历史意义", "longtext", 3),
  ],
};

/* ---------- 关系词表 ---------- */

/** 关系词速记：`正向（反向）`。 */
type KindPair = [string, string];

/**
 * 关系词表按**目标类型**分组（计划书 §3.10）。
 *
 * 选关系时 UI 只显示该类型对允许的标签，而不是把五个全局词倒给用户。
 * 词表是种子，用户可在类型管理面板里增删改。
 */
const RELATIONS: Record<
  BuiltinTypeId,
  Partial<Record<BuiltinTypeId, KindPair[]>>
> = {
  character: {
    character: [
      ["亲属", "亲属"],
      ["师承", "弟子"],
      ["挚友", "挚友"],
      ["敌对", "仇敌"],
      ["主仆", "主人"],
      ["恋慕", "恋慕"],
      ["同僚", "同僚"],
    ],
    faction: [
      ["效忠", "效忠者"],
      ["创建", "创建者"],
      ["成员", "成员"],
      ["背叛自", "叛徒"],
    ],
    place: [
      ["居住", "居民"],
      ["出身", "出身地"],
      ["藏身", "藏身地"],
      ["驻守", "守卫"],
    ],
    item: [
      ["持有", "持有者"],
      ["追求", "追求者"],
      ["制造", "制造者"],
      ["使用", "使用者"],
    ],
    event: [
      ["参与", "参与者"],
      ["主导", "主导者"],
      ["见证", "见证者"],
      ["受害", "受害者"],
    ],
    system: [
      ["关联", "相关者"],
      ["信奉", "信奉者"],
      ["修炼", "修行者"],
    ],
    culture: [
      ["关联", "相关者"],
      ["信奉", "信奉者"],
    ],
    term: [
      ["关联", "相关者"],
      ["使用", "使用者"],
    ],
    timeline: [["关联", "相关者"]],
  },
  place: {
    place: [
      ["隶属", "下属"],
      ["相邻", "邻接"],
      ["通往", "通道"],
    ],
    faction: [
      ["势力范围", "势力"],
      ["驻地", "驻扎"],
      ["诞生地", "发源地"],
    ],
    item: [
      ["出产", "产地"],
      ["镇馆之宝", "收藏"],
    ],
    event: [["发生地", "发生于"]],
    system: [["环境法则", "约束"]],
    culture: [["风俗", "盛行"]],
    term: [["关联", "相关者"]],
    timeline: [["关联", "相关者"]],
  },
  item: {
    item: [
      ["组成", "部件"],
      ["克制", "被克制"],
      ["配套", "配套"],
    ],
    faction: [["归属", "归属方"]],
    system: [["关联", "关联"]],
  },
  faction: {
    faction: [
      ["敌对", "敌对方"],
      ["联盟", "盟友"],
      ["从属", "上级"],
      ["竞争", "竞争者"],
    ],
    character: [
      ["首领", "首领"],
      ["成员", "成员"],
      ["客卿", "客卿"],
    ],
    place: [
      ["驻地", "驻地"],
      ["势力范围", "控制范围"],
    ],
    item: [["持有", "持有者"]],
    system: [["奉行", "奉行"]],
    event: [["涉及", "相关"]],
    timeline: [["关联", "相关者"]],
  },
  event: {
    event: [
      ["前因", "导致"],
      ["后续", "由…引发"],
      ["同时", "同时发生"],
    ],
    character: [["涉及", "相关"]],
    place: [["涉及", "相关"]],
    faction: [["涉及", "相关"]],
    item: [["涉及", "相关"]],
    timeline: [["发生于", "时期"]],
  },
  system: {
    system: [
      ["依赖", "被依赖"],
      ["矛盾", "冲突"],
      ["细化", "细化"],
    ],
    culture: [["关联", "相关者"]],
    term: [["关联", "相关者"]],
  },
  culture: {
    culture: [
      ["依赖", "被依赖"],
      ["矛盾", "冲突"],
      ["细化", "细化"],
    ],
    system: [["关联", "相关者"]],
    term: [["关联", "相关者"]],
  },
  term: {
    term: [
      ["依赖", "被依赖"],
      ["矛盾", "冲突"],
      ["细化", "细化"],
    ],
    system: [["关联", "相关者"]],
    culture: [["关联", "相关者"]],
  },
  timeline: {
    event: [["时期", "相关事件"]],
    timeline: [
      ["前于", "后于"],
      ["包含", "被包含"],
    ],
  },
};

/** 把速记展开成 RelationKindDef 列表。 */
function toKindDefs(pairs: KindPair[]): RelationKindDef[] {
  return pairs.map(([kind, inverseKind]) => ({ kind, inverseKind }));
}

/**
 * 出厂内置类型配置。
 *
 * 注意这是**函数**而不是常量：字段与关系词表都是对象，
 * 直接导出会被调用方就地改掉，污染出厂值。
 */
export function defaultBuiltinTypes(): TypeConfig[] {
  return BUILTIN_TYPE_IDS.map((id, index) => ({
    id,
    label: "",
    labelKey: BUILTIN_LABEL_KEYS[id],
    color: { ...DEFAULT_COLORS[id] },
    icon: DEFAULT_ICONS[id],
    fields: FIELDS[id].map((x) => ({ ...x, options: [...x.options] })),
    relationVocab: Object.entries(RELATIONS[id] ?? {}).map(
      ([targetTypeId, pairs]) => ({
        targetTypeId,
        kinds: toKindDefs(pairs ?? []),
      })
    ),
    builtin: true,
    order: index,
  }));
}

/** 内置类型 id 集合。 */
export const BUILTIN_TYPE_SET: ReadonlySet<string> = new Set(BUILTIN_TYPE_IDS);

/**
 * V1 枚举类型 → V2 内置类型 id 的映射（迁移用）。
 *
 * V1 的六类：character / place / item / faction / timeline / concept。
 * V2 把 concept 拆成「体系 / 文化 / 术语」——原来一个 catch-all 装不下，
 * 把体系规则和文化习俗混在一起，写作时查「灵力体系」会捞到一堆节庆风俗。
 * 旧 concept 条目按字段线索落到最接近的一类：无法判断的归「术语」。
 */
export const LEGACY_TYPE_MAP: Record<string, BuiltinTypeId> = {
  character: "character",
  place: "place",
  item: "item",
  faction: "faction",
  timeline: "timeline",
  concept: "term",
};

/**
 * V1 关系词 → V2 正反标签对。
 *
 * V1 的 `syncRelations` 给对端补的反向边 kind 恒为 "mentions"，
 * 于是「林风属于青云宗」在宗门条目里显示成「提及」。迁移时按下表补上
 * 真正的反向标签。
 */
export const LEGACY_RELATION_MAP: Record<string, KindPair> = {
  belongs: ["属于", "属于"],
  holds: ["持有", "持有者"],
  opposes: ["敌对", "敌对"],
  kin: ["亲属", "亲属"],
  mentions: ["关联", "关联"],
};
