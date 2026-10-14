import { createContext } from "react";

export interface I18nContextValue {
  lang: string;
  setLang: (lang: string) => void;
  t: (meaning: string) => string;
}

export const I18nContext = createContext<I18nContextValue | undefined>(
  undefined
);
