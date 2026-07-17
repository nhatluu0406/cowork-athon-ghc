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
 *  - Persistence: on mount the last saved `settings.activeWorkspace` is revalidated through the
 *    service before the UI shows an active state. Activation persists via `setActiveWorkspace`.
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
  readonly client: Pick<
    ServiceClient,
    "grantWorkspace" | "recentWorkspaces" | "setActiveWorkspace" | "getSettings"
  >;
  /** Notified when a folder is validated + granted (becomes the active workspace). */
  readonly onActivated?: (rootPath: string) => void;
  /** Notified when no valid workspace is active (idle, failed restore, or first launch). */
  readonly onDeactivated?: () => void;
}

export interface WorkspacePickerHandle {
  choose(): Promise<void>;
}

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "active"; readonly rootPath: string }
  | { readonly kind: "rejected"; readonly message: string; readonly preservePath?: string }
  | { readonly kind: "restore_lost"; readonly savedPath: string; readonly message: string };

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
export function mountWorkspacePicker(container: HTMLElement, deps: WorkspacePickerDeps): WorkspacePickerHandle {
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

  let activePath: string | null = null;

  const syncActivation = (rootPath: string | null): void => {
    activePath = rootPath;
    if (rootPath === null) deps.onDeactivated?.();
    else deps.onActivated?.(rootPath);
  };

  const renderStatus = (s: Status): void => {
    chooseBtn.disabled = s.kind === "busy";
    const hasActive =
      s.kind === "active" || (s.kind === "rejected" && s.preservePath !== undefined);
    section.classList.toggle("is-active", hasActive);
    section.classList.toggle("is-rejected", s.kind === "rejected" || s.kind === "restore_lost");
    chooseBtn.textContent = hasActive
      ? "Đổi thư mục workspace…"
      : "Chọn thư mục workspace…";

    if (s.kind === "idle") status.textContent = "Chưa chọn workspace.";
    else if (s.kind === "busy") status.textContent = "Đang xác thực thư mục…";
    else if (s.kind === "active") status.textContent = `Đang hoạt động: ${s.rootPath}`;
    else if (s.kind === "restore_lost") {
      status.textContent = `Workspace đã lưu không còn khả dụng (${s.savedPath}). ${s.message}`;
    } else if (s.preservePath !== undefined) {
      status.textContent = `Đang hoạt động: ${s.preservePath} — ${s.message}`;
    } else status.textContent = s.message;
  };

  const applyGranted = async (rootPath: string, persist: boolean): Promise<void> => {
    if (persist) await deps.client.setActiveWorkspace(rootPath);
    syncActivation(rootPath);
    renderStatus({ kind: "active", rootPath });
    void refreshRecent();
  };

  const applyResult = async (
    result: WorkspaceGrantResult,
    options?: { readonly persist?: boolean },
  ): Promise<void> => {
    const persist = options?.persist ?? true;
    if (result.granted) {
      await applyGranted(result.grant.rootPath, persist);
      return;
    }
    // Honest failure: preserve the previous valid workspace when possible.
    if (activePath !== null) {
      renderStatus({
        kind: "rejected",
        message: result.message,
        preservePath: activePath,
      });
    } else {
      renderStatus({ kind: "rejected", message: result.message });
    }
  };

  const grant = async (
    rootPath: string,
    options?: { readonly persist?: boolean },
  ): Promise<void> => {
    renderStatus({ kind: "busy" });
    try {
      await applyResult(await deps.client.grantWorkspace(rootPath), options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể xác thực workspace.";
      if (activePath !== null) {
        renderStatus({ kind: "rejected", message, preservePath: activePath });
      } else {
        renderStatus({ kind: "rejected", message });
      }
    }
  };

  const choose = async (): Promise<void> => {
    let picked;
    try {
      picked = await deps.bridge.pickWorkspaceFolder();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không mở được hộp thoại.";
      if (activePath !== null) {
        renderStatus({ kind: "rejected", message, preservePath: activePath });
      } else {
        renderStatus({ kind: "rejected", message });
      }
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
      renderRecent([]);
    }
  }

  async function restorePersisted(): Promise<void> {
    renderStatus({ kind: "busy" });
    try {
      const saved = (await deps.client.getSettings()).activeWorkspace;
      if (saved === null) {
        syncActivation(null);
        renderStatus({ kind: "idle" });
        return;
      }
      const result = await deps.client.grantWorkspace(saved.rootPath);
      if (result.granted) {
        await applyGranted(result.grant.rootPath, false);
        return;
      }
      syncActivation(null);
      renderStatus({
        kind: "restore_lost",
        savedPath: saved.rootPath,
        message: result.message,
      });
    } catch (error) {
      syncActivation(null);
      const message = error instanceof Error ? error.message : "Không khôi phục được workspace.";
      renderStatus({ kind: "rejected", message });
    }
  }

  chooseBtn.addEventListener("click", () => void choose());
  void (async () => {
    await restorePersisted();
    await refreshRecent();
  })();

  return { choose };
}
