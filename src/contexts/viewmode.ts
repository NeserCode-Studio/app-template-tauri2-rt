import { createContext, useContext } from "react";

/**
 * 写作视图模式。
 *
 * 三种模式共用一个字段而非各自独立开关，是因为它们会互相干扰：
 * 「禅」隐藏侧栏、「专注」压暗非当前段——同时开着时用户无法判断
 * 某个视觉变化来自哪一档。用互斥枚举让行为可预测。
 */
export type ViewMode = "off" | "focus" | "typewriter" | "zen";

export interface ViewModeContextValue {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
}

export const ViewModeContext = createContext<ViewModeContextValue>({
  mode: "off",
  setMode: () => {},
});

export function useViewMode(): ViewModeContextValue {
  const ctx = useContext(ViewModeContext);
  if (!ctx) throw new Error("useViewMode must be used within ViewModeProvider");
  return ctx;
}
