import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";

import TitlebarOperations, {
  ThemeIcon,
} from "@/components/framework/TitlebarOperations";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  Home,
} from "lucide-react";
import { useContext } from "react";
import { ThemeContext } from "@/contexts/theme";
import { useLibrary } from "@/contexts/library";
import { useWorkspace } from "@/contexts/workspace";
import TitlebarTitle from "./TitlebarTitle";
import { useI18n } from "@/composables";
import { useSettingsDialog } from "@/contexts/settings";
import * as editorActions from "@/lib/editor.actions";
import {
  APP_PAGE_LABEL_KEYS,
  useAppNavigation,
  type AppPage,
} from "@/lib/navigation";

export default function Titlebar() {
  /* I18n */
  const { t } = useI18n();
  /* Theme */
  const { theme, setThemeMode } = useContext(ThemeContext);
  /* Navigation */
  const { currentPage, backPage, back, go } = useAppNavigation();
  const { currentWorkId } = useLibrary();
  const { root } = useWorkspace();
  const { openSettings, openAbout } = useSettingsDialog();

  const canOpenPage = (page: AppPage) => {
    if (page === "home") return true;
    if (page === "editor") return Boolean(root && currentWorkId);
    return Boolean(root);
  };

  const destinations: Array<{
    page: AppPage;
    labelKey: string;
    icon: typeof Home;
    enabled: boolean;
  }> = [
    {
      page: "home",
      labelKey: APP_PAGE_LABEL_KEYS.home,
      icon: Home,
      enabled: true,
    },
    ...(root
      ? [
          {
            page: "library" as const,
            labelKey: APP_PAGE_LABEL_KEYS.library,
            icon: BookOpen,
            enabled: true,
          },
        ]
      : []),
  ];

  function toggleTheme() {
    if (theme === "dark") {
      setThemeMode("light");
    } else {
      setThemeMode("dark");
    }
  }

  return (
    <div
      className="fixed top-0 z-50 flex h-8 w-screen flex-row items-center justify-between border-b border-neutral-400 bg-white pl-2 shadow-sm transition-colors duration-100 ease-in-out dark:border-neutral-600 dark:bg-black"
      data-tauri-drag-region
    >
      <Menubar className="h-6 w-fit gap-1 rounded-none border-0 bg-transparent p-0 text-neutral-600 shadow-none transition-colors duration-100 ease-in-out dark:text-neutral-200">
        <MenubarMenu>
          <MenubarTrigger className="h-full w-fit gap-1.5 px-2 text-sm">
            <ArrowLeft className="icon-sm" />
            {t("Titlebar.navigation.menu")}
            <ChevronDown className="size-3 opacity-60" />
          </MenubarTrigger>
          <MenubarContent className="w-56">
            {backPage && canOpenPage(backPage) ? (
              <>
                <MenubarItem onSelect={back}>
                  <ArrowLeft className="icon-sm" />
                  <span>{t("Titlebar.navigation.back")}</span>
                  <span className="text-muted-foreground ml-auto truncate text-xs">
                    {t(APP_PAGE_LABEL_KEYS[backPage])}
                  </span>
                </MenubarItem>
                <MenubarSeparator />
              </>
            ) : null}
            {destinations.map((item) => {
              const current = item.page === currentPage;
              const Icon = item.icon;
              return (
                <MenubarItem
                  key={item.page}
                  disabled={current || !item.enabled}
                  onSelect={() => go(item.page)}
                >
                  <Icon className="icon-sm" />
                  <span>{t(item.labelKey)}</span>
                  {current ? <Check className="ml-auto size-3.5 opacity-60" /> : null}
                </MenubarItem>
              );
            })}
            <MenubarSeparator />
            <MenubarItem
              onSelect={() => {
                openSettings();
              }}
            >
              {t("Titlebar.menu.turnto.settings")}
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={toggleTheme}>
              {t("Titlebar.menu.turnto.theme")}
              <ThemeIcon />
            </MenubarItem>
            <MenubarItem>{t("Titlebar.menu.turnto.exit")}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full w-fit px-2 text-sm">
            {t("Titlebar.menu.edit")}
          </MenubarTrigger>
          <MenubarContent className="w-fit transition-all duration-100 ease-in-out">
            <MenubarItem onSelect={editorActions.undo}>
              {t("Titlebar.menu.edit.undo")}
              <MenubarShortcut>Ctrl+Z</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={editorActions.redo}>
              {t("Titlebar.menu.edit.redo")}
              <MenubarShortcut>Ctrl+Shift+Z</MenubarShortcut>
            </MenubarItem>

            <MenubarSeparator />

            <MenubarItem onSelect={editorActions.cut}>
              {t("Titlebar.menu.edit.cut")}
              <MenubarShortcut>Ctrl+X</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={editorActions.copy}>
              {t("Titlebar.menu.edit.copy")}
              <MenubarShortcut>Ctrl+C</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={() => void editorActions.paste()}>
              {t("Titlebar.menu.edit.paste")}
              <MenubarShortcut>Ctrl+V</MenubarShortcut>
            </MenubarItem>

            <MenubarSeparator />

            <MenubarItem onSelect={editorActions.selectAll}>
              {t("Titlebar.menu.edit.selectAll")}
              <MenubarShortcut>Ctrl+A</MenubarShortcut>
            </MenubarItem>
            <MenubarItem onSelect={editorActions.find}>
              {t("Titlebar.menu.edit.find")}
              <MenubarShortcut>Ctrl+K</MenubarShortcut>
            </MenubarItem>
            <MenubarItem
              onSelect={() =>
                window.dispatchEvent(new CustomEvent("app:open-search"))
              }
            >
              {t("Search.title")}
              <MenubarShortcut>Ctrl+Shift+F</MenubarShortcut>
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className="h-full w-fit px-2 text-sm">
            {t("Titlebar.menu.help")}
          </MenubarTrigger>
          <MenubarContent className="w-fit transition-all duration-100 ease-in-out">
            <MenubarItem onSelect={openAbout}>
              {t("Titlebar.menu.about")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <TitlebarTitle data-tauri-drag-region />

      <TitlebarOperations />
    </div>
  );
}
