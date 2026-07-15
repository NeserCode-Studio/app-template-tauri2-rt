import { useContext, useEffect, useCallback, useRef } from "react";
import { getCurrentWindow, PhysicalSize } from "@tauri-apps/api/window";

import { useI18n } from "@/composables";
import { ThemeContext } from "@/App";
import { WindowUtils } from "@/lib/window.utils";

import { Monitor, EyeOff, Settings, LogOut } from "lucide-react";

type MenuAction = "show" | "hide" | "settings" | "quit";

const menuItems: { action: MenuAction; icon: typeof Monitor; labelKey: string }[] = [
  { action: "show", icon: Monitor, labelKey: "Tray.menu.showWindow" },
  { action: "hide", icon: EyeOff, labelKey: "Tray.menu.hideWindow" },
  { action: "settings", icon: Settings, labelKey: "Tray.menu.settings" },
  { action: "quit", icon: LogOut, labelKey: "Tray.menu.quit" },
];

export default function TrayMenu() {
  const { t } = useI18n();
  const { theme } = useContext(ThemeContext);
  const trayWin = useRef(getCurrentWindow());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const win = trayWin.current;
    win.hide();

    if (menuRef.current) {
      const h = menuRef.current.scrollHeight;
      if (h > 0) win.setSize(new PhysicalSize(220, h));
    }

    const onBlur = () => { win.hide(); };
    window.addEventListener("blur", onBlur);

    const unlisten = win.onFocusChanged((focused) => {
      if (!focused) onBlur();
    });
    return () => {
      window.removeEventListener("blur", onBlur);
      unlisten.then((fn) => fn?.());
    };
  }, []);

  const handleAction = useCallback(async (action: MenuAction) => {
    const win = trayWin.current;
    switch (action) {
      case "show": {
        const mainWin = await WindowUtils.getWindowByLabel("main");
        if (mainWin) {
          await mainWin.show();
          await mainWin.setFocus();
        }
        break;
      }
      case "hide": {
        const mainWin = await WindowUtils.getWindowByLabel("main");
        if (mainWin) await mainWin.hide();
        break;
      }
      case "settings": {
        const mainWin = await WindowUtils.getWindowByLabel("main");
        if (mainWin) {
          await mainWin.show();
          await mainWin.setFocus();
          await mainWin.emit("navigate", "/settings");
        }
        break;
      }
      case "quit": {
        await WindowUtils.windowsQuit();
        break;
      }
    }
    await win.hide();
  }, []);

  return (
    <div
      ref={menuRef}
      className={`w-full select-none ${
        theme === "dark" ? "bg-[#1e1e1e] text-[#cccccc]" : "bg-white text-[#333333]"
      }`}
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
    >
      <div className="py-1">
        {menuItems.map((item, index) => {
          const Icon = item.icon;
          const isLast = index === menuItems.length - 1;
          return (
            <div key={item.action}>
              <button
                onClick={() => handleAction(item.action)}
                className={`flex items-center gap-3 w-full px-3 py-2 text-sm transition-colors ${
                  theme === "dark"
                    ? "hover:bg-[#264f78] hover:text-white"
                    : "hover:bg-[#e8f0fe] hover:text-[#1a73e8]"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{t(item.labelKey)}</span>
              </button>
              {index === 1 && !isLast && (
                <div
                  className={`mx-3 my-1 h-px ${
                    theme === "dark" ? "bg-[#333333]" : "bg-[#e0e0e0]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
