import { Tooltip } from "./Tooltip";

import { Minus, X, Sun, Moon, Paperclip } from "lucide-react";
import { ThemeContext } from "@/contexts/theme";
import { Separator } from "../ui/separator";
import { useContext, useEffect } from "react";
import { useLocalStorageState } from "ahooks";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useI18n } from "@/composables";
import { WindowUtils } from "@/lib/window.utils";

const currentWindow = getCurrentWindow();

export function ThemeIcon() {
  const { theme } = useContext(ThemeContext);

  if (theme === "dark") {
    return <Sun className="icon" />;
  } else {
    return <Moon className="icon" />;
  }
}

async function handleOperation(operation: "minimize" | "close") {
  switch (operation) {
    case "minimize":
      await currentWindow.minimize();
      break;
    case "close":
      await WindowUtils.windowsQuit();
      break;
  }
}

export default function TitlebarOperations() {
  const { t } = useI18n();
  const { theme, setThemeMode } = useContext(ThemeContext);
  const [alwaysOnTop, setAlwaysOnTop] = useLocalStorageState(
    "app-always-on-top",
    {
      defaultValue: false,
    }
  );

  useEffect(() => {
    currentWindow.setAlwaysOnTop(alwaysOnTop ?? false);
  }, [alwaysOnTop]);

  return (
    <>
      <div className="title-bar-operations">
        <Separator orientation="vertical" className="separator" />
        <Tooltip content={t("Titlebar.operations.always-on-top.tooltip")}>
          <span
            className={[alwaysOnTop ? "pinned" : "", "operation"].join(" ")}
            onMouseUp={() => {
              const next = !alwaysOnTop;
              setAlwaysOnTop(next);
              void currentWindow.setAlwaysOnTop(next);
            }}
          >
            <Paperclip className="icon" />
          </span>
        </Tooltip>
        <Tooltip content={t("Titlebar.operations.theme.tooltip")}>
          <span
            className="operation"
            onMouseUp={() => {
              setThemeMode(theme === "dark" ? "light" : "dark");
            }}
          >
            <ThemeIcon />
          </span>
        </Tooltip>
        <Tooltip content={t("Titlebar.operations.minimize.tooltip")}>
          <span
            className="operation"
            onMouseUp={() => {
              handleOperation("minimize");
            }}
          >
            <Minus className="icon" />
          </span>
        </Tooltip>
        <Tooltip content={t("Titlebar.operations.close.tooltip")}>
          <span
            className="operation"
            onMouseUp={() => {
              handleOperation("close");
            }}
          >
            <X className="icon" />
          </span>
        </Tooltip>
      </div>
    </>
  );
}
