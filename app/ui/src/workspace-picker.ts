/**
 * Workspace picker (CGHC-008, W1/W2/W3) — renderer side.
 *
 * A thin CLIENT of the shell + loopback service, with NO business logic:
 *  - W1: the native OS folder dialog is opened through the narrow preload bridge
 *    (`bridge.pickWorkspaceFolder()`), never raw `ipcRenderer` and never `nodeIntegration`.
 *  - W3: the chosen path is handed to the service (`client.grantWorkspace`) which VALIDATES and
 *    grants at the boundary. The UI only renders the outcome; a rejected pick shows a clear reason
 *    and does NOT become the active workspace — no session is started here.
 *  - W2: the recent list is fetched from the service (single source of truth) with a per-entry
 *    `available` flag; an unavailable (removed/renamed) entry renders disabled, not hidden.
 *
 * DOM is built with `textContent` only (no HTML parsing), controls are keyboard-reachable and
 * labelled, and no secret is ever written into the DOM.
 */

import type { CoworkShellBridge } from "@cowork-ghc/contracts";
import type {
  RecentWorkspaceView,
  ServiceClient,
  WorkspaceGrantResult,
} from "./service-client.js";

export interface WorkspacePickerDeps {
  readonly bridge: Pick<CoworkShellBridge, "pickWorkspaceFolder">;
  readonly client: Pick<ServiceClient, "grantWorkspace" | "recentWorkspaces">;
  /** Notified when a folder is validated + granted (becomes the active workspace). */
  readonly onActivated?: (rootPath: string) => void;
}

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "active"; readonly rootPath: string }
  | { readonly kind: "rejected"; readonly message: string };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Mount the workspace picker into `container` and load the recent list. */
export function mountWorkspacePicker(container: HTMLElement, deps: WorkspacePickerDeps): void {
  const section = el("section", "workspace-picker");
  section.setAttribute("aria-label", "Workspace");

  const chooseBtn = el("button", "workspace-choose", "Chọn thư mục workspace…");
  chooseBtn.type = "button";

  const status = el("p", "workspace-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const recentHeading = el("h2", "workspace-recent-heading", "Gần đây");
  const recentList = el("ul", "workspace-recent");
  recentList.setAttribute("aria-label", "Recent workspaces");

  section.append(chooseBtn, status, recentHeading, recentList);
  container.append(section);

  const renderStatus = (s: Status): void => {
    chooseBtn.disabled = s.kind === "busy";
    section.classList.toggle("is-rejected", s.kind === "rejected");
    if (s.kind === "idle") status.textContent = "Chưa chọn workspace.";
    else if (s.kind === "busy") status.textContent = "Đang xác thực thư mục…";
    else if (s.kind === "active") status.textContent = `Workspace: ${s.rootPath}`;
    else status.textContent = s.message;
  };

  const applyResult = (result: WorkspaceGrantResult): void => {
    if (result.granted) {
      renderStatus({ kind: "active", rootPath: result.grant.rootPath });
      deps.onActivated?.(result.grant.rootPath);
      void refreshRecent();
    } else {
      // Honest failure: no active workspace, no session.
      renderStatus({ kind: "rejected", message: result.message });
    }
  };

  const grant = async (rootPath: string): Promise<void> => {
    renderStatus({ kind: "busy" });
    try {
      applyResult(await deps.client.grantWorkspace(rootPath));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể xác thực workspace.";
      renderStatus({ kind: "rejected", message });
    }
  };

  const choose = async (): Promise<void> => {
    let picked;
    try {
      picked = await deps.bridge.pickWorkspaceFolder();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không mở được hộp thoại.";
      renderStatus({ kind: "rejected", message });
      return;
    }
    if (picked.canceled || picked.rootPath === undefined) return; // user canceled: no change
    await grant(picked.rootPath);
  };

  const renderRecent = (entries: readonly RecentWorkspaceView[]): void => {
    recentList.replaceChildren();
    recentHeading.hidden = entries.length === 0;
    for (const entry of entries) {
      const item = el("li", "workspace-recent-item");
      const btn = el("button", "workspace-recent-open", entry.rootPath);
      btn.type = "button";
      if (entry.available) {
        btn.addEventListener("click", () => void grant(entry.rootPath));
      } else {
        // A removed/renamed folder is shown, disabled, and labelled — never silently dropped.
        btn.disabled = true;
        btn.append(el("span", "workspace-recent-unavailable", " (không khả dụng)"));
        btn.setAttribute("aria-disabled", "true");
      }
      item.append(btn);
      recentList.append(item);
    }
  };

  async function refreshRecent(): Promise<void> {
    try {
      renderRecent(await deps.client.recentWorkspaces());
    } catch {
      // Recent is a convenience surface; a failure must not break the picker.
      renderRecent([]);
    }
  }

  chooseBtn.addEventListener("click", () => void choose());
  renderStatus({ kind: "idle" });
  void refreshRecent();
}
