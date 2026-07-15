import "./App.css";

import Titlebar from "@/components/framework/Titlebar";
import CommandDialog from "@/components/framework/CommandDialog";
import { Toaster } from "@/components/ui/sonner";
import { Routes, Route } from "react-router";

import { useNavigate } from "react-router";
import { useTheme, I18nContext, useI18nLogic } from "@/composables";
import { createContext, lazy, Suspense, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocalStorageState } from "ahooks";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { WindowUtils } from "@/lib/window.utils";
import TrayMenu from "@/views/TrayMenu";

const Home = lazy(() => import("@/views/Home"));
const Settings = lazy(() => import("@/views/Settings"));
const Software = lazy(() => import("@/views/Software"));
const Framework = lazy(() => import("@/views/Framework"));

import type { UseThemeFnReturn } from "@/shared";

/* Context Provide */
const ThemeContext = createContext<{
  theme: UseThemeFnReturn[0];
  setThemeMode: UseThemeFnReturn[1];
}>({
  theme: "light",
  setThemeMode: () => {},
});
const NavigatorContext = createContext<{
  navigator: (path: string) => void;
}>({
  navigator: (_path: string) => {},
});
const TitleContext = createContext<{
  title?: string;
  setTitle: (newTitle: string) => void;
}>({
  title: "App template",
  setTitle: () => {},
});

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
      navigate(event.payload);
    });
  }, []);

  if (currentLabel === "tray") {
    return (
      <I18nContext.Provider value={{ lang, t, setLang: setLanguage }}>
        <ThemeContext.Provider value={{ theme, setThemeMode }}>
          <TrayMenu />
        </ThemeContext.Provider>
      </I18nContext.Provider>
    );
  }

  return (
    <>
      <I18nContext.Provider value={{ lang, t, setLang: setLanguage }}>
        <ThemeContext.Provider value={{ theme, setThemeMode }}>
          <TitleContext.Provider value={{ title, setTitle }}>
            <NavigatorContext.Provider value={{ navigator: navigate }}>
              <main id="app-main">
                <Titlebar />
                <CommandDialog />

                <div id="container">
                  <ScrollArea className="container-scroller">
                    <Suspense fallback={null}>
                      <Routes>
                        <Route path="/" index element={<Home />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/software" element={<Software />} />
                        <Route path="/framework" element={<Framework />} />
                      </Routes>
                    </Suspense>
                  </ScrollArea>
                </div>
              </main>
              <Toaster richColors theme={theme} position="bottom-right" />
            </NavigatorContext.Provider>
          </TitleContext.Provider>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    </>
  );
}

export { App, ThemeContext, TitleContext, NavigatorContext };
