import { el } from "./dom-utils.js";
import { createSessionBar, type SessionBarDom } from "./session-bar.js";

export interface WorkspaceViewHandlers {
  /** #35: start a new shared session from the Workspace tab. */
  readonly onNewSession?: () => void;
  /** #35: switch to an existing conversation from the Workspace tab. */
  readonly onPickSession?: (conversationId: string) => void;
}

export interface WorkspaceViewDom {
  readonly root: HTMLElement;
  readonly companionSlot: HTMLElement;
  /** Session control (#35): new session + pick an existing one, shared with the Cowork session. */
  readonly sessionBar: SessionBarDom;
}

export function createWorkspaceView(handlers: WorkspaceViewHandlers = {}): WorkspaceViewDom {
  const root = el("section", "view view--workspace workspace-view");
  root.dataset["view"] = "workspace";
  root.hidden = true;

  // Session control header (#35): the Workspace tab previously had no way to start or pick a
  // session without returning to Cowork. This shares the ONE Cowork conversation.
  const header = el("div", "workspace-view__header");
  const sessionBar = createSessionBar({
    onNew: () => handlers.onNewSession?.(),
    onPick: (id) => handlers.onPickSession?.(id),
  });
  header.append(sessionBar.root);

  const companionSlot = el("div", "workspace-view__companion-slot");
  root.append(header, companionSlot);
  return { root, companionSlot, sessionBar };
}
