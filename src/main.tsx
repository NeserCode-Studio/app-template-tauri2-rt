import ReactDOM from "react-dom/client";
import { App } from "./App";
import React from "react";
import { BrowserRouter } from "react-router";

import { WindowUtils } from "@/lib/window.utils";
import { lifecycle } from "@/lifecycle";

const $windowMain = new WindowUtils("main");

// 应用就绪钩子：主窗口显示并聚焦（ready 阶段触发一次）
lifecycle.register({
  id: "window.render-focus",
  stage: "ready",
  once: true,
  run: () => $windowMain.renderFocus(),
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// React 挂载后触发 ready 阶段，执行窗口聚焦等就绪动作
void lifecycle.fire("ready");
