import "./App.css";

import Titlebar from "@/components/framework/Titlebar";
import CommandDialog from "@/components/framework/CommandDialog";
import PageTransition from "@/components/framework/PageTransition";
import { Toaster } from "@/components/ui/sonner";
import { Navigate, Routes, Route, useLocation, useNavigate } from "react-router";

import { useTheme, useI18nLogic } from "@/composables";
import { lazy, Suspense, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useLocalStorageState } from "ahooks";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { WindowUtils } from "@/lib/window.utils";

import { ThemeContext } from "@/contexts/theme";
import { NavigatorContext } from "@/contexts/navigator";
import { TitleContext } from "@/contexts/title";
import { I18nContext } from "@/contexts/i18n";
import { lifecycle } from "@/lifecycle";
import SettingsDialog from "@/components/framework/SettingsDialog";
import { AppNavigationContextMenu } from "@/components/framework/AppNavigationContextMenu";
import AboutDialog from "@/components/framework/AboutDialog";
import { SettingsDialogContext } from "@/contexts/settings";
import { createLogger } from "@/lib/logger";
import { WorkspaceProvider } from "@/contexts/workspace.provider";
import { LibraryProvider } from "@/contexts/library.provider";
import { PreferencesProvider } from "@/contexts/preferences.provider";
import { OutlineProvider } from "@/contexts/outline.provider";
import { CodexProvider } from "@/contexts/codex.provider";
import { SearchProvider } from "@/contexts/search.provider";
import { ViewModeProvider } from "@/contexts/viewmode.provider";
import {
  defaultPageTransition,
  pageFromPath,
  type NavigationLocationState,
} from "@/lib/navigation";
import {
  interceptWorkspaceDialog,
  interceptWorkspaceNavigation,
  requestWorkspaceEntry,
} from "@/lib/workspace-open";

const log = createLogger("App");

const Home = lazy(() => import("@/views/Home"));
const Library = lazy(() => import("@/views/Library"));
const Editor = lazy(() => import("@/views/Editor"));
const CodexLibrary = lazy(() => import("@/views/CodexLibrary"));
const TrayMenu = lazy(() => import("@/views/TrayMenu"));

/**
 * 应用就绪钩子：主窗口显示并聚焦。
 *
 * 注册在模块作用域而非 useEffect —— effect 的清理函数会在 fire 完成前
 * 被 React 调用（async 函数体在第一个 await 前是同步的），导致钩子被提前
 * 卸载、从未执行。托盘窗口跳过逻辑放在 run 内部。
 */
const $windowMain = new WindowUtils("main");
lifecycle.register({
  id: "window.render-focus",
  stage: "ready",
  once: true,
  run: () => {
    if (getCurrentWindow().label === "tray") return;
    return $windowMain.renderFocus();
  },
});

function App() {
  /* I18n */
  const { lang, t, setLanguage } = useI18nLogic();
  /* Navigator */
  const navigate = useNavigate();
  const location = useLocation();
  const navigator = useCallback(
    (path: string) => {
      if (interceptWorkspaceNavigation(path)) return;
      if (requestWorkspaceEntry(path)) return;
      const from = pageFromPath(location.pathname);
      const to = pageFromPath(path);
      navigate(path, {
        state: {
          from,
          transition: defaultPageTransition(from, to),
        } satisfies NavigationLocationState,
      });
    },
    [location.pathname, navigate]
  );
  /* Theme */
  const [theme, setThemeMode] = useTheme({
    localStorageKey: "theme-mode",
  });
  /* Title */
  const [title, setTitle] = useLocalStorageState("app-title", {
    defaultValue: t("Titlebar.default.title"),
  });

  /* Detect current window */
  const currentLabel = getCurrentWindow().label;

  /* 弹窗状态 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => {
    if (interceptWorkspaceDialog("settings")) return;
    setSettingsOpen(true);
  }, []);
  const [aboutOpen, setAboutOpen] = useState(false);
  const openAbout = useCallback(() => {
    if (interceptWorkspaceDialog("about")) return;
    setAboutOpen(true);
  }, []);

  /* 生命周期阶段只触发一次（StrictMode 下 effect 会 double-invoke）
     注册在模块作用域，此处只负责按序触发。 */
  const firedRef = useRef(false);

  /* 挂载完成后依次触发 mount → ready
     两者放在同一个 effect 内按序 fire，保证阶段顺序；
     ready 触发的窗口聚焦等动作此时 React 已挂载完成。 */
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;

    void lifecycle.fire("mount").then(() => lifecycle.fire("ready"));
  }, []);

  useEffect(() => {
    if (currentLabel === "tray") return;

    const unlistenPopup = listen<{ x: number; y: number }>(
      "tray-popup",
      async (event) => {
        const trayWindow = await WindowUtils.getWindowByLabel("tray");
        if (!trayWindow) {
          log.warn("tray-popup: tray window not found");
          return;
        }
        const size = await trayWindow.outerSize();
        const x = Math.round(event.payload.x - size.width / 2);
        const y = Math.max(0, Math.round(event.payload.y - size.height));
        await trayWindow.setPosition(new PhysicalPosition(x, y));
        await trayWindow.show();
        await trayWindow.setFocus();
        log.info("tray menu popped", { x, y });
      }
    );

    const unlistenNavigate = listen<string>("navigate", (event) => {
      const target = event.payload;
      log.info("navigate event", target);
      if (target === "/settings") {
        openSettings();
      } else if (target === "/about") {
        openAbout();
      } else {
        navigator(target);
      }
    });

    return () => {
      void unlistenPopup.then((fn) => fn());
      void unlistenNavigate.then((fn) => fn());
    };
  }, [navigator, currentLabel, openSettings, openAbout]);

  /* 固定 Context value 引用，避免任意状态变化导致所有消费者全量重渲染 */
  const i18nValue = useMemo(
    () => ({ lang, t, setLang: setLanguage }),
    [lang, t, setLanguage]
  );
  const themeValue = useMemo(
    () => ({ theme, setThemeMode }),
    [theme, setThemeMode]
  );
  const titleValue = useMemo(() => ({ title, setTitle }), [title, setTitle]);
  const navigatorValue = useMemo(() => ({ navigator }), [navigator]);
  const settingsValue = useMemo(
    () => ({ openSettings, openAbout }),
    [openSettings, openAbout]
  );

  if (currentLabel === "tray") {
    return (
      <I18nContext.Provider value={i18nValue}>
        <ThemeContext.Provider value={themeValue}>
          <Suspense fallback={null}>
            <TrayMenu />
          </Suspense>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    );
  }

  return (
    <PreferencesProvider>
      <ViewModeProvider>
      <WorkspaceProvider>
        <LibraryProvider>
          <OutlineProvider>
          <ThemeContext.Provider value={themeValue}>
          <CodexProvider>
          <SearchProvider>
        <SettingsDialogContext.Provider value={settingsValue}>
        <I18nContext.Provider value={i18nValue}>
            <TitleContext.Provider value={titleValue}>
              <NavigatorContext.Provider value={navigatorValue}>
                <main id="app-main" className="app-shell">
                  <Titlebar />
                  <CommandDialog />

                  <AppNavigationContextMenu>
                  <div id="container" className="app-body">
                    <Suspense fallback={null}>
                      <PageTransition>
                        <Routes>
                          <Route path="/" index element={<Home />} />
                          <Route path="/library" element={<Library />} />
                          <Route
                            path="/codex"
                            element={
                              <div className="h-full w-full">
                                <CodexLibrary />
                              </div>
                            }
                          />
                          <Route
                            path="/editor"
                            element={
                              // 编辑器自带三栏可拖拽布局，需要确定高度，
                              // 不能套在 ScrollArea 里（radix 滚动视口会让
                              // react-resizable-panels 读到 0 高度而崩溃）。
                              <div className="h-full w-full">
                                <Editor />
                              </div>
                            }
                          />
                          <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                      </PageTransition>
                    </Suspense>
                  </div>
                  </AppNavigationContextMenu>
                </main>
                <SettingsDialog
                  open={settingsOpen}
                  onOpenChange={setSettingsOpen}
                />
                <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
                <Toaster richColors theme={theme} position="bottom-right" />
              </NavigatorContext.Provider>
            </TitleContext.Provider>
        </I18nContext.Provider>
        </SettingsDialogContext.Provider>
          </SearchProvider>
          </CodexProvider>
          </ThemeContext.Provider>
          </OutlineProvider>
        </LibraryProvider>
      </WorkspaceProvider>
      </ViewModeProvider>
    </PreferencesProvider>
  );
}

export { App };
