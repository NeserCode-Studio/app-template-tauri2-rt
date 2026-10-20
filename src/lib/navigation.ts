import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";

export type AppPage = "home" | "library" | "editor" | "codex";
export type PageTransitionDirection = "forward" | "back";

export interface NavigationLocationState {
  from?: AppPage;
  transition?: PageTransitionDirection;
  intent?: "create-work";
}

export const APP_PAGE_PATHS: Record<AppPage, string> = {
  home: "/",
  library: "/library",
  editor: "/editor",
  codex: "/codex",
};

export const APP_PAGE_LABEL_KEYS: Record<AppPage, string> = {
  home: "Command.turnto.home",
  library: "Library.title",
  editor: "Editor.page.title",
  codex: "Codex.library.title",
};

export function pageFromPath(pathname: string): AppPage {
  if (pathname.startsWith("/library")) return "library";
  if (pathname.startsWith("/editor")) return "editor";
  if (pathname.startsWith("/codex")) return "codex";
  return "home";
}

export function defaultBackPage(page: AppPage): AppPage | null {
  switch (page) {
    case "library":
      return "home";
    case "editor":
      return "library";
    case "codex":
      return "library";
    case "home":
      return null;
  }
}

/**
 * 页面层级只定义视觉方向，不限制用户实际可达的页面。
 * 编辑 -> 素材视为继续深入；任何回到上层页面的动作都从左侧进入。
 */
export function defaultPageTransition(
  from: AppPage,
  to: AppPage
): PageTransitionDirection {
  if (to === "home") return from === "home" ? "forward" : "back";
  if (to === "library" && (from === "editor" || from === "codex")) return "back";
  if (to === "editor" && from === "codex") return "back";
  return "forward";
}

export function navigationStateOf(value: unknown): NavigationLocationState {
  if (!value || typeof value !== "object") return {};
  const state = value as NavigationLocationState;
  return {
    from:
      state.from === "home" ||
      state.from === "library" ||
      state.from === "editor" ||
      state.from === "codex"
        ? state.from
        : undefined,
    transition:
      state.transition === "forward" || state.transition === "back"
        ? state.transition
        : undefined,
    intent: state.intent === "create-work" ? state.intent : undefined,
  };
}

export interface NavigatePageOptions {
  replace?: boolean;
  transition?: PageTransitionDirection;
  intent?: NavigationLocationState["intent"];
}

export function useAppNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPage = pageFromPath(location.pathname);
  const locationState = navigationStateOf(location.state);
  const priorPage =
    locationState.from && locationState.from !== currentPage
      ? locationState.from
      : null;
  const backPage = priorPage ?? defaultBackPage(currentPage);

  const go = useCallback(
    (page: AppPage, options: NavigatePageOptions = {}) => {
      if (page === currentPage && !options.replace) return;
      navigate(APP_PAGE_PATHS[page], {
        replace: options.replace,
        state: {
          from: currentPage,
          transition:
            options.transition ?? defaultPageTransition(currentPage, page),
          intent: options.intent,
        } satisfies NavigationLocationState,
      });
    },
    [currentPage, navigate]
  );

  const back = useCallback(() => {
    if (!backPage) return;
    if (priorPage) {
      navigate(-1);
      return;
    }
    go(backPage, { replace: true, transition: "back" });
  }, [backPage, go, navigate, priorPage]);

  return useMemo(
    () => ({
      currentPage,
      backPage,
      go,
      back,
    }),
    [back, backPage, currentPage, go]
  );
}
