import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar";

import TitlebarOperations, {
  ThemeIcon,
} from "@/components/framework/TitlebarOperations";
import { useContext } from "react";
import { ThemeContext, NavigatorContext } from "@/App";
import TitlebarTitle from "./TitlebarTitle";
import { useI18n } from "@/composables";

export default function Titlebar() {
  /* I18n */
  const { t } = useI18n();
  /* Theme */
  const { theme, setThemeMode } = useContext(ThemeContext);
  /* Navigator */
  const { navigator } = useContext(NavigatorContext);

  function toggleTheme() {
    if (theme === "dark") {
      setThemeMode("light");
    } else {
      setThemeMode("dark");
    }
  }

  return (
    <div className="title-bar-main" data-tauri-drag-region>
      <Menubar className="menu-bar-main">
        <MenubarMenu>
          <MenubarTrigger className="menu-bar-menu">
            {t("Titlebar.menu.turnto")}
          </MenubarTrigger>
          <MenubarContent className="menu-bar-content">
            <MenubarItem
              className="menu-bar-item"
              onSelect={() => {
                navigator("/");
              }}
            >
              {t("Titlebar.menu.turnto.home")}
            </MenubarItem>
            <MenubarItem
              className="menu-bar-item"
              onSelect={() => {
                navigator("/settings");
              }}
            >
              {t("Titlebar.menu.turnto.settings")}
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem className="menu-bar-item" onSelect={toggleTheme}>
              <span className="text">{t("Titlebar.menu.turnto.theme")}</span>
              <ThemeIcon />
            </MenubarItem>
            <MenubarItem className="menu-bar-item">
              {t("Titlebar.menu.turnto.exit")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className="menu-bar-menu">
            {t("Titlebar.menu.about")}
          </MenubarTrigger>
          <MenubarContent className="menu-bar-content">
            <MenubarItem
              className="menu-bar-item"
              onSelect={() => {
                navigator("/software");
              }}
            >
              {t("Titlebar.menu.about.software")}
            </MenubarItem>
            <MenubarItem
              className="menu-bar-item"
              onSelect={() => {
                navigator("/framework");
              }}
            >
              {t("Titlebar.menu.about.framework")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <TitlebarTitle data-tauri-drag-region />

      <TitlebarOperations />
    </div>
  );
}
