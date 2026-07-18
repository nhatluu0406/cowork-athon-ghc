/**
 * IPC channel registry (shell-internal).
 *
 * A CLOSED, explicit set of channel names shared by the main process (handlers) and the
 * preload (invocations). There is deliberately no generic/catch-all channel: each name
 * maps to exactly one typed capability declared on {@link CoworkShellBridge}. Adding a
 * capability means adding an entry here AND a typed method on the bridge contract.
 */

/** The complete set of IPC channels the shell answers. Frozen at authoring. */
export const IpcChannel = {
  /** Renderer requests its loopback base URL + per-launch client token. */
  GetBootstrap: "cowork:get-bootstrap",
  /** Renderer requests the native folder picker (W1). */
  PickWorkspaceFolder: "cowork:pick-workspace-folder",
  /** Renderer requests the native file picker for workspace attachments. */
  PickWorkspaceFile: "cowork:pick-workspace-file",
  /** Renderer asks the shell to restart the service into the LIVE runtime (user-gated Connect). */
  ConnectLive: "cowork:connect-live",
  /** Renderer synchronizes the native title-bar overlay with light/dark theme. */
  SetWindowTheme: "cowork:set-window-theme",
  /** Renderer opens or closes Electron DevTools for the owning window. */
  SetDevToolsEnabled: "cowork:set-devtools-enabled",
  /** Renderer asks the shell to save a text blob (diagnostics export) via a native save dialog. */
  SaveTextFile: "cowork:save-text-file",
  /** Renderer asks the shell to load a loopback preview URL into the embedded surface. */
  PreviewLoad: "cowork:preview-load",
  /** Renderer syncs the embedded preview surface geometry/visibility to its Preview pane. */
  PreviewSetBounds: "cowork:preview-set-bounds",
  /** Renderer hides the embedded preview surface. */
  PreviewHide: "cowork:preview-hide",
  /** Renderer reloads the current preview page. */
  PreviewReload: "cowork:preview-reload",
  /** Renderer tears down the embedded preview surface. */
  PreviewClose: "cowork:preview-close",
  /** Renderer asks whether device-bound secure auto-unlock is available (safeStorage/DPAPI). */
  IsSecureAutoUnlockAvailable: "cowork:is-secure-auto-unlock-available",
  /** Renderer asks the shell to flip the "Require login at startup" mode (safeStorage-owned). */
  SetStartupAuthMode: "cowork:set-startup-auth-mode",
} as const;

/** Union of the allowed channel name literals. */
export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];
