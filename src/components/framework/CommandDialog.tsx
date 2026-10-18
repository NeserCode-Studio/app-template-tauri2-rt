import * as React from "react";
import { Home, Settings, RefreshCcw, Search, Sparkles } from "lucide-react";
import { useMemoizedFn } from "ahooks";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

import { NavigatorContext } from "@/contexts/navigator";
import { useI18n, useSuperCommand, type SuperCommandItem } from "@/composables";
import { I18nContext } from "@/contexts/i18n";
import { ViewModeContext, type ViewMode } from "@/contexts/viewmode";
import { ThemeContext } from "@/contexts/theme";
import { useSettingsDialog } from "@/contexts/settings";
import { usePreferences } from "@/contexts/preferences";
import SearchDialog from "./SearchDialog";

const SUPER_PREFIX = "@super";
const SUPER_CMD = "super";

interface CommonItem {
  value: string;
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  keywords: string[];
}

export default function CommandMenu() {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const { navigator } = React.useContext(NavigatorContext);
  const { openSettings } = useSettingsDialog();
  const { prefs, setPref } = usePreferences();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const i18nCtx = React.useContext(I18nContext);
  const setLang = i18nCtx?.setLang ?? (() => {});
  const { setThemeMode } = React.useContext(ThemeContext) ?? {};
  const setTheme = setThemeMode ?? (() => {});
  const viewModeCtx = React.useContext(ViewModeContext);

  // cmdk 搜索值
  const [cmdkSearch, setCmdkSearch] = React.useState("");

  /*
   * 小说专属命令。
   *
   * 用 extraCommands 传入而非改 useSuperCommand 的内置表：内置命令表
   * 是模板层（窗口 / 主题 / 语言）的公共设施，掺进业务命令会让模板
   * 无法独立复用。extraCommands 正是为此预留的注入口。
   */
  const novelCommands = React.useMemo<SuperCommandItem[]>(() => {
    if (!viewModeCtx) return [];
    const setMode = viewModeCtx.setMode;
    /* 四个模式各一条；message 即 id，够面板显示。 */
    const mk = (id: string, mode: ViewMode, keywords: string[]): SuperCommandItem => ({
      id,
      keywords,
      action: () => {
        setMode(mode);
        return { success: true, message: id };
      },
    });
    return [
      mk("view.focus", "focus", ["focus", "\u4e13\u6ce8", "\u805a\u7126", "\u6a21\u5f0f"]),
      mk("view.typewriter", "typewriter", ["typewriter", "\u6253\u5b57\u673a", "\u6a21\u5f0f"]),
      mk("view.zen", "zen", ["zen", "\u7985", "\u9690\u85cf", "\u6a21\u5f0f"]),
      mk("view.normal", "off", ["normal", "\u666e\u901a", "\u9000\u51fa", "\u6a21\u5f0f"]),
    ];
  }, [viewModeCtx]);

  const superCmd = useSuperCommand(
    { navigate: navigator, setLang, setTheme, openSettings },
    novelCommands
  );

  // ── Super 模式判定 ────────────────────────────────────────
  const isSuperMode = cmdkSearch.startsWith(SUPER_PREFIX + " ");
  const superQuery = isSuperMode
    ? cmdkSearch
        .slice(SUPER_PREFIX.length + 1)
        .trim()
        .toLowerCase()
    : "";
  const superResults = isSuperMode
    ? superQuery
      ? superCmd.commands.filter(
          (cmd) =>
            cmd.id.toLowerCase().includes(superQuery) ||
            cmd.keywords.some((k) => k.toLowerCase().includes(superQuery)),
        )
      : superCmd.commands
    : [];

  // ── 普通命令 ──────────────────────────────────────────────
  const commonItems: CommonItem[] = [
    {
      value: "search::open",
      icon: Search,
      label: t("Search.title"),
      shortcut: "Ctrl+Shift+F",
      keywords: ["search", "搜索", "全站", "查找", "全文"],
    },
    {
      /*
       * 常驻开关：搜索是否独占 Ctrl+Shift+F。
       *
       * 放常驻项而不是设置面板，是因为它是每天都要碰到的东西——
       * 埋进设置等于让人自己猜开关在哪。
       */
      value: "search::toggle",
      icon: Search,
      label: prefs.searchHotkeyEnabled ? t("Search.hotkeyOn") : t("Search.hotkeyOff"),
      keywords: ["search hotkey", "搜索快捷键", "常驻"],
    },
    {
      value: "navigate::/",
      icon: Home,
      label: t("Command.turnto.home"),
      shortcut: "⌘H",
      keywords: ["home", "index", "首页", "主页"],
    },
    {
      value: "settings::open",
      icon: Settings,
      label: t("Command.turnto.settings"),
      shortcut: "⌘S",
      keywords: ["settings", "设置", "配置", "选项", "preferences"],
    },
    {
      value: "reload",
      icon: RefreshCcw,
      label: t("Command.suggestions.reload"),
      keywords: ["reload", "refresh", "重新加载", "刷新"],
    },
  ];

  // ── 命令选择 ──────────────────────────────────────────────
  function handleSelect(command: string) {
    if (isSuperMode) {
      // Super 模式：根据 superQuery 匹配执行，不依赖 command 参数
      if (superResults.length === 1) {
        superCmd.execute(superResults[0].id);
      }
      // 0 或多条匹配：不执行（秘密命令，无提示）
      setOpen(false);
      setCmdkSearch("");
      return;
    }

    const [symbol, value] = command.split("::");

    if (symbol === "navigate") {
      navigator(value);
    } else if (symbol === "search") {
      if (value === "toggle") {
        setPref("searchHotkeyEnabled", !prefs.searchHotkeyEnabled);
      } else {
        setSearchOpen(true);
        setOpen(false);
        setCmdkSearch("");
        return;
      }
    } else if (symbol === "settings") {
      openSettings();
    } else if (symbol === "reload") {
      navigator("/");
      window.location.reload();
    } else if (symbol === SUPER_CMD) {
      const item = superCmd.commands.find((c) => c.id === value);
      if (!item) return;
      superCmd.execute(item.id);
    }

    setOpen(false);
    setCmdkSearch("");
  }

  const handleInputChange = useMemoizedFn((val: string) => setCmdkSearch(val));

  const openShortcut = useMemoizedFn((e: KeyboardEvent) => {
    if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setOpen((prev) => !prev);
      setCmdkSearch("");
    }
  });

  React.useEffect(() => {
    document.addEventListener("keydown", openShortcut);
    return () => document.removeEventListener("keydown", openShortcut);
  }, [openShortcut]);

  /* 标题栏「编辑 > 查找」通过自定义事件打开命令面板 */
  React.useEffect(() => {
    const handler = () => {
      setOpen(true);
      setCmdkSearch("");
    };
    window.addEventListener("app:open-command-palette", handler);
    return () =>
      window.removeEventListener("app:open-command-palette", handler);
  }, []);

  /* 标题栏「搜索 > 全站搜索」通过自定义事件打开搜索框 */
  React.useEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener("app:open-search", handler);
    return () => window.removeEventListener("app:open-search", handler);
  }, []);

  /*
   * Ctrl+Shift+F 直开搜索。
   *
   * 是否抢占由命令面板里的常驻开关决定：关掉时按键回落到 Ctrl+K，
   * 与模板原有的键盘行为一致，不抢用户已有的肌肉记忆。
   */
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!prefs.searchHotkeyEnabled) return;
      if (e.key === "F" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSearchOpen((v) => !v);
        setOpen(false);
        setCmdkSearch("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [prefs.searchHotkeyEnabled]);

  return (
    <>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={cmdkSearch}
        onValueChange={handleInputChange}
        placeholder={t("Command.placeholder")}
      />
      <CommandList>
        {isSuperMode ? (
          // ── Super 模式：只显示一条占位符，不暴露具体命令 ──
          <>
            <CommandEmpty>{t("Command.super.empty")}</CommandEmpty>
            <CommandGroup heading={t("Command.super.heading")}>
              <CommandItem
                // value 设为 cmdkSearch，确保 cmdk 默认 filter 永远匹配
                value={cmdkSearch}
                onSelect={handleSelect}
              >
                <Sparkles className="icon-md mr-2" />
                <span>{SUPER_PREFIX}</span>
              </CommandItem>
            </CommandGroup>
          </>
        ) : (
          // ── 普通模式：正常展示 ──────────────────────────────
          <>
            <CommandEmpty>{t("Command.notFound")}</CommandEmpty>
            <CommandGroup heading={t("Command.suggestions")}>
              {commonItems.map((item) => (
                <CommandItem
                  key={item.value}
                  value={item.value}
                  onSelect={handleSelect}
                  keywords={item.keywords}
                >
                  <item.icon className="icon-md mr-2" />
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <CommandShortcut>{item.shortcut}</CommandShortcut>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
      </CommandDialog>
    </>
  );
}
