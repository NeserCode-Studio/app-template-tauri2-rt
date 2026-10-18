import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useLocalStorageState } from "ahooks";

import { PreferencesContext, DEFAULT_PREFERENCES, type PreferencesContextValue, type WritingPreferences } from "./preferences";
import type { ArticleFont, UiFont } from "./preferences";

const PREFS_KEY = "novels-yes:preferences";

/** 界面字体栈：仅声明字体栈，由系统回退，不打包字体文件。 */
export const UI_FONT_STACKS: Record<UiFont, string> = {
  "system-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  "system-serif":
    'Georgia, "Times New Roman", "Songti SC", SimSun, "Noto Serif CJK SC", serif',
  "system-mono":
    '"Cascadia Code", Consolas, "SF Mono", Menlo, "Noto Sans Mono CJK SC", monospace',
};

/** 正文字体栈：优先用户手选的中文衬线字体。 */
export const ARTICLE_FONT_STACKS: Record<ArticleFont, string> = {
  songti:
    '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "SimSun", "STSong", serif',
  "source-han-serif":
    '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", serif',
  "lxgw-wenkai":
    '"LXGW WenKai", "霞鹜文楷", "Kaiti SC", KaiTi, STKaiti, cursive',
  "system-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
};

/** 字体选项的中英文标签（设置项下拉用）。 */
export const UI_FONT_LABELS: Record<UiFont, { zh: string; en: string }> = {
  "system-sans": { zh: "系统无衬线", en: "System Sans" },
  "system-serif": { zh: "系统衬线", en: "System Serif" },
  "system-mono": { zh: "等宽", en: "Monospace" },
};

export const ARTICLE_FONT_LABELS: Record<ArticleFont, { zh: string; en: string }> = {
  songti: { zh: "宋体（系统）", en: "Songti (system)" },
  "source-han-serif": { zh: "思源宋体", en: "Source Han Serif" },
  "lxgw-wenkai": { zh: "霞鹜文楷", en: "LXGW WenKai" },
  "system-sans": { zh: "无衬线", en: "Sans Serif" },
};

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useLocalStorageState<WritingPreferences>(PREFS_KEY, {
    defaultValue: DEFAULT_PREFERENCES,
  });

  const prefs = useMemo<WritingPreferences>(() => {
    return { ...DEFAULT_PREFERENCES, ...(stored ?? {}) };
  }, [stored]);

  /* 把排版偏好同步到 DOM 变量，正文与界面各用各的变量，互不干扰。 */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-font-ui", UI_FONT_STACKS[prefs.uiFont]);
    root.style.setProperty("--app-font-ui-size", `${prefs.uiFontSize}px`);
    root.style.setProperty("--app-font-article", ARTICLE_FONT_STACKS[prefs.articleFont]);
    root.style.setProperty("--app-font-article-size", `${prefs.fontSize}px`);
    root.style.setProperty("--app-line-height", String(prefs.lineHeight));
    root.style.setProperty("--app-line-width", `${prefs.lineWidth}em`);
    root.style.setProperty("--app-indent", `${prefs.indentSpaces}em`);
    root.style.setProperty("--app-paragraph-gap", prefs.paragraphGap ? "0.9em" : "0");
  }, [prefs]);

  const setPref = useCallback(
    <K extends keyof WritingPreferences>(key: K, value: WritingPreferences[K]) => {
      setStored({ ...prefs, [key]: value });
    },
    [prefs, setStored]
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({ prefs, setPref }),
    [prefs, setPref]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
