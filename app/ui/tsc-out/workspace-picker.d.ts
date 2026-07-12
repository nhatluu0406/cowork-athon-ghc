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
import type { ServiceClient } from "./service-client.js";
export interface WorkspacePickerDeps {
    readonly bridge: Pick<CoworkShellBridge, "pickWorkspaceFolder">;
    readonly client: Pick<ServiceClient, "grantWorkspace" | "recentWorkspaces">;
    /** Notified when a folder is validated + granted (becomes the active workspace). */
    readonly onActivated?: (rootPath: string) => void;
}
/** Mount the workspace picker into `container` and load the recent list. */
export declare function mountWorkspacePicker(container: HTMLElement, deps: WorkspacePickerDeps): void;
//# sourceMappingURL=workspace-picker.d.ts.map