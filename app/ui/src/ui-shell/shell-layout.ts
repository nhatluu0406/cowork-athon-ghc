/** Work mode within the Cowork rail surface. */
export type WorkMode = "cowork" | "workspace";

export type ShellLayoutMode = "work" | "knowledge" | "integration";

export function shellLayoutModeForSurface(surfaceId: string): ShellLayoutMode {
  if (surfaceId === "cowork") return "work";
  if (surfaceId === "knowledge") return "knowledge";
  return "integration";
}

export function shellHasSidebar(layout: ShellLayoutMode): boolean {
  return layout === "work";
}

export function applyShellLayoutClasses(
  frame: HTMLElement,
  layout: ShellLayoutMode,
  inspectorOpen: boolean,
): void {
  frame.classList.toggle("shell-frame--no-sidebar", !shellHasSidebar(layout));
  frame.classList.toggle("shell-frame--inspector-open", inspectorOpen && shellHasSidebar(layout));
  frame.dataset["layout"] = layout;
}

export function applyWorkMode(
  root: HTMLElement,
  sidebar: HTMLElement,
  coworkView: HTMLElement,
  workspaceView: HTMLElement,
  coworkPanel: HTMLElement,
  workspacePanel: HTMLElement,
  mode: WorkMode,
): void {
  root.dataset["workMode"] = mode;
  for (const btn of sidebar.querySelectorAll<HTMLButtonElement>("[data-work-mode]")) {
    const active = btn.dataset["workMode"] === mode;
    btn.classList.toggle("work-mode-tab--active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  }
  coworkPanel.hidden = mode !== "cowork";
  workspacePanel.hidden = mode !== "workspace";
  // Workspace Companion keeps the Cowork conversation/composer visible beside the editor.
  // This function is only called while the top-level Cowork surface is active.
  coworkView.hidden = false;
  workspaceView.hidden = mode !== "workspace";
}
