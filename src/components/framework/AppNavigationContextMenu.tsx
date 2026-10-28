import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  BookOpen,
  Home,
  Library,
  PenLine,
  Server,
  Settings2,
  Trash2,
} from "lucide-react";

import { useI18n } from "@/composables";
import { useSettingsDialog } from "@/contexts/settings";
import { useAppNavigation, type AppPage } from "@/lib/navigation";

const PRESERVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='textbox']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='option']",
  "[data-preserve-context-menu]",
  "[data-slot='dialog-content']",
  "[data-slot='alert-dialog-content']",
  "[data-slot='popover-content']",
  "[data-slot='select-content']",
  "[data-slot='context-menu-content']",
].join(",");

interface MenuPosition {
  x: number;
  y: number;
}

const MENU_WIDTH = 208;
const MENU_HEIGHT = 322;

function clampPosition(x: number, y: number): MenuPosition {
  const margin = 8;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - MENU_WIDTH - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - MENU_HEIGHT - margin)),
  };
}

export function AppNavigationContextMenu({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { currentPage, backPage, back, go } = useAppNavigation();
  const { openSettings } = useSettingsDialog();
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = () => setPosition(null);

  useEffect(() => {
    if (!position) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      ) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onViewportChange = () => close();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onViewportChange);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onViewportChange);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [position]);

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    setPosition(null);
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(PRESERVE_SELECTOR)) return;
    event.preventDefault();
    setPosition(clampPosition(event.clientX, event.clientY));
  }

  function navigate(page: AppPage) {
    close();
    go(page);
  }

  const itemClass =
    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

  return (
    <div className="h-full w-full" onContextMenu={handleContextMenu}>
      {children}
      {position
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={t("Navigation.contextMenu")}
              className="bg-popover text-popover-foreground fixed z-[100] w-52 rounded-md border p-1 shadow-lg"
              style={{ left: position.x, top: position.y }}
            >
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                disabled={!backPage}
                onClick={() => {
                  close();
                  back();
                }}
              >
                <ArrowLeft />
                {t("Navigation.context.back")}
              </button>
              <div className="bg-border my-1 h-px" role="separator" />
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                disabled={currentPage === "home"}
                onClick={() => navigate("home")}
              >
                <Home />
                {t("Navigation.context.home")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                disabled={currentPage === "library"}
                onClick={() => navigate("library")}
              >
                <Library />
                {t("Navigation.context.library")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                disabled={currentPage === "editor"}
                onClick={() => navigate("editor")}
              >
                <PenLine />
                {t("Navigation.context.editor")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                disabled={currentPage === "codex"}
                onClick={() => navigate("codex")}
              >
                <BookOpen />
                {t("Navigation.context.codex")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                disabled={currentPage === "trash"}
                onClick={() => navigate("trash")}
              >
                <Trash2 />
                {t("Trash.title")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                disabled={currentPage === "mcp"}
                onClick={() => navigate("mcp")}
              >
                <Server />
                {t("Navigation.context.mcp")}
              </button>
              <div className="bg-border my-1 h-px" role="separator" />
              <button
                type="button"
                role="menuitem"
                className={itemClass}
                onClick={() => {
                  close();
                  openSettings();
                }}
              >
                <Settings2 />
                {t("Navigation.context.settings")}
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
