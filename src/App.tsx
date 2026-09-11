import "./App.css";

import Titlebar from "@/components/framework/Titlebar";
import CommandDialog from "@/components/framework/CommandDialog";
import { Toaster } from "@/components/ui/sonner";
import { Routes, Route, useNavigate } from "react-router";

import { useTheme, useI18nLogic } from "@/composables";
import { lazy, Suspense, useEffect, useMemo, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { SettingsDialogContext } from "@/contexts/settings";

const Home = lazy(() => import("@/views/Home"));
const Software = lazy(() => import("@/views/Software"));
const Framework = lazy(() => import("@/views/Framework"));
const TrayMenu = lazy(() => import("@/views/TrayMenu"));

function App() {
  /* I18n */
  const { lang, t, setLanguage } = useI18nLogic();
  /* Navigator */
  const navigate = useNavigate();
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

  /* 设置弹窗状态 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  /* 触发 mount 生命周期阶段（应用已挂载） */
  useEffect(() => {
    void lifecycle.fire("mount");
  }, []);

  useEffect(() => {
    if (currentLabel === "tray") return;

    listen<{ x: number; y: number }>("tray-popup", async (event) => {
      const trayWindow = await WindowUtils.getWindowByLabel("tray");
      if (!trayWindow) return;
      const size = await trayWindow.outerSize();
      const x = Math.round(event.payload.x - size.width / 2);
      const y = Math.max(0, Math.round(event.payload.y - size.height));
      await trayWindow.setPosition(new PhysicalPosition(x, y));
      await trayWindow.show();
      await trayWindow.setFocus();
    });

    listen<string>("navigate", (event) => {
      if (event.payload === "/settings") {
        openSettings();
      } else {
        navigate(event.payload);
      }
    });
  }, [navigate, currentLabel, openSettings]);

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
  const navigatorValue = useMemo(() => ({ navigator: navigate }), [navigate]);
  const settingsValue = useMemo(() => ({ openSettings }), [openSettings]);

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
    <>
      <SettingsDialogContext.Provider value={settingsValue}>
        <I18nContext.Provider value={i18nValue}>
          <ThemeContext.Provider value={themeValue}>
            <TitleContext.Provider value={titleValue}>
              <NavigatorContext.Provider value={navigatorValue}>
                <main id="app-main">
                  <Titlebar />
                  <CommandDialog />

                  <div id="container">
                    <ScrollArea className="container-scroller">
                      <Suspense fallback={null}>
                        <Routes>
                          <Route path="/" index element={<Home />} />
                          <Route path="/software" element={<Software />} />
                          <Route path="/framework" element={<Framework />} />
                        </Routes>
                      </Suspense>
                    </ScrollArea>
                  </div>
                </main>
                <SettingsDialog
                  open={settingsOpen}
                  onOpenChange={setSettingsOpen}
                />
                <Toaster richColors theme={theme} position="bottom-right" />
              </NavigatorContext.Provider>
            </TitleContext.Provider>
          </ThemeContext.Provider>
        </I18nContext.Provider>
      </SettingsDialogContext.Provider>
    </>
  );
}

export { App };
