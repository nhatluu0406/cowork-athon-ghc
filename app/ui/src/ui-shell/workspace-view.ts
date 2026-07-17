import { el } from "./dom-utils.js";

export interface WorkspaceViewDom {
  readonly root: HTMLElement;
  readonly companionSlot: HTMLElement;
}

export function createWorkspaceView(): WorkspaceViewDom {
  const root = el("section", "view view--workspace workspace-view");
  root.dataset["view"] = "workspace";
  root.hidden = true;

  const companionSlot = el("div", "workspace-view__companion-slot");
  root.append(companionSlot);
  return { root, companionSlot };
}
