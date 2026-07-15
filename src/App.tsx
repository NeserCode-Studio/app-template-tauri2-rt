import "./App.css";

import Titlebar from "@/components/framework/Titlebar";
import CommandDialog from "@/components/framework/CommandDialog";
import { Toaster } from "@/components/ui/sonner";
import { Routes, Route } from "react-router";

import { useNavigate } from "react-router";
import { useTheme, I18nContext, useI18nLogic } from "@/composables";
import { createContext, lazy, Suspense } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAsyncEffect, useLocalStorageState } from "ahooks";
import { AppTray } from "@/lib/tray";

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

  useAsyncEffect(async () => {
    /* App Tray */
    const $tray = new AppTray({
      tooltip: t("Tray.tooltip.default"),
    });
    await $tray.init();
    console.log($tray);
    const handleBeforeUnload = async () => {
      window.removeEventListener("unload", handleBeforeUnload);
      await $tray.quit();
    };

    window.addEventListener("unload", handleBeforeUnload);
  }, []);
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
