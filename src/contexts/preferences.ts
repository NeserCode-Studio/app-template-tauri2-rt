import { createContext, useContext } from "react";

/**
 * 写作偏好：计划书 §3.2 的段落约定 + 字体等排版设置。
 *
 * 与普通 UI 设置（标题、语言）分开，因为它同时作用于界面字体与正文排版。
 */

/** 界面字体（软件 UI）。 */
export type UiFont = "system-sans" | "system-serif" | "system-mono";

/** 正文字体（文章排版）。 */
export type ArticleFont = "songti" | "source-han-serif" | "lxgw-wenkai" | "system-sans";

/** 贴边翻章所需累计滚动距离（像素）。 */
export const CHAPTER_TURN_THRESHOLD_MIN = 120;
export const CHAPTER_TURN_THRESHOLD_MAX = 600;
export const CHAPTER_TURN_THRESHOLD_STEP = 24;
export const DEFAULT_CHAPTER_TURN_THRESHOLD = 240;

export interface WritingPreferences {
  /* ---- 段落约定（计划书 §3.2）---- */
  /** 首行缩进：0 / 2 / 4 个全角空格。 */
  indentSpaces: 0 | 2 | 4;
  /** 段间是否插入空行。 */
  paragraphGap: boolean;

  /* ---- 排版 ---- */
  /** 正文行宽上限（汉字数）。 */
  lineWidth: number;
  /** 行高倍数。 */
  lineHeight: number;
  /** 正文字体。 */
  articleFont: ArticleFont;
  /** 正文字号（px）。 */
  fontSize: number;

  /* ---- 界面 ---- */
  /** 软件界面字体。 */
  uiFont: UiFont;
  /** 界面字号（px）。 */
  uiFontSize: number;
  /** 正文中高亮素材条目的提及。 */
  highlightMentions: boolean;
  /** 搜索是否独占 Ctrl+Shift+F（开关在命令面板里）。 */
  searchHotkeyEnabled: boolean;
  /** 是否允许在章节边缘继续滚动时翻章。 */
  chapterTurnEnabled: boolean;
  /** 是否在章节顶部或底部持续显示翻章提示。 */
  chapterTurnHintsEnabled: boolean;
  /** 贴边继续滚动多少距离后翻章。 */
  chapterTurnThreshold: number;
}

export const DEFAULT_PREFERENCES: WritingPreferences = {
  indentSpaces: 2,
  paragraphGap: false,
  lineWidth: 40,
  lineHeight: 1.8,
  articleFont: "songti",
  fontSize: 18,
  uiFont: "system-sans",
  uiFontSize: 14,
  highlightMentions: true,
  searchHotkeyEnabled: true,
  chapterTurnEnabled: true,
  chapterTurnHintsEnabled: true,
  chapterTurnThreshold: DEFAULT_CHAPTER_TURN_THRESHOLD,
};

export interface PreferencesContextValue {
  prefs: WritingPreferences;
  setPref: <K extends keyof WritingPreferences>(
    key: K,
    value: WritingPreferences[K]
  ) => void;
}

export const PreferencesContext = createContext<PreferencesContextValue>({
  prefs: DEFAULT_PREFERENCES,
  setPref: () => {},
});

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
