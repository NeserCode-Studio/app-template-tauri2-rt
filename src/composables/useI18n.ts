import { useState, useContext, useCallback } from "react";
import { I18nTexts } from "../lib/i18n.resource";
import { I18nContext } from "@/contexts/i18n";

// 自定义 Hook：封装语言逻辑
export function useI18nLogic() {
  const [lang, setLang] = useState<string>(
    localStorage.getItem("app-language") || "zh-CN"
  );

  const t = useCallback(
    (meaning: string) => {
      const texts =
        I18nTexts[lang as keyof typeof I18nTexts] || I18nTexts["zh-CN"];
      return texts[meaning as keyof typeof texts] || meaning;
    },
    [lang]
  );

  const setLanguage = useCallback((newLang: string) => {
    if (!Object.keys(I18nTexts).includes(newLang)) return;
    setLang(newLang);
    localStorage.setItem("app-language", newLang);
  }, []);

  return { lang, t, setLanguage };
}

// 自定义 Hook 获取语言上下文
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
