export const WORKSPACE_OPEN_INTERCEPT_EVENT =
  "novels-yes:workspace-open-intercept";

export type WorkspaceOpenAction =
  | { kind: "navigate"; path: string }
  | { kind: "dialog"; dialog: "settings" | "about" };

function requestIntercept(action: WorkspaceOpenAction): boolean {
  if (typeof window === "undefined") return false;
  const event = new CustomEvent<WorkspaceOpenAction>(
    WORKSPACE_OPEN_INTERCEPT_EVENT,
    {
      cancelable: true,
      detail: action,
    }
  );
  return !window.dispatchEvent(event);
}

export function interceptWorkspaceNavigation(path: string): boolean {
  return requestIntercept({ kind: "navigate", path });
}

export function interceptWorkspaceDialog(
  dialog: "settings" | "about"
): boolean {
  return requestIntercept({ kind: "dialog", dialog });
}
