import type { ReactNode } from "react";
import { useLocation, useNavigationType } from "react-router";

import { navigationStateOf } from "@/lib/navigation";

/**
 * 只负责新页面入场。旧页面在路由切换时立即卸载，避免交叉淡出期间
 * 两个编辑器或两套可拖拽面板同时存在。
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const state = navigationStateOf(location.state);
  const direction =
    state.transition ??
    (navigationType === "POP" && location.key !== "default" ? "back" : "forward");

  return (
    <div
      key={location.key}
      className="page-transition h-full min-h-0 w-full"
      data-direction={direction}
    >
      {children}
    </div>
  );
}
