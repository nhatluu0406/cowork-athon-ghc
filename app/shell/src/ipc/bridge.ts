/**
 * The renderer-visible bridge surface, as a pure builder (renderer-hardening baseline).
 *
 * Separated from `preload.ts` so the exact exposed API can be asserted in a unit test
 * without loading electron. {@link createShellBridge} returns ONLY the narrow, typed
 * {@link CoworkShellBridge}: each method maps to exactly one allow-listed channel and
 * closes over the injected `ipc.invoke`. The `ipcRenderer` object itself is never placed
 * on the bridge, so the renderer gets no generic `invoke`/`send`/`on` passthrough.
 */

import type { IpcRenderer } from "electron";
import { COWORK_SHELL_BRIDGE_KEY, type CoworkShellBridge } from "@cowork-ghc/contracts";

import { IpcChannel } from "./channels.js";

/** Only the `invoke` capability of `ipcRenderer` is needed (and it is never exposed). */
export type BridgeIpc = Pick<IpcRenderer, "invoke">;

/** Minimal `contextBridge` surface used to expose the API onto `window`. */
export interface ContextBridgeLike {
  exposeInMainWorld(key: string, api: unknown): void;
}

/** Build the narrow bridge object. It contains functions only — no raw ipc handle. */
export function createShellBridge(ipc: BridgeIpc): CoworkShellBridge {
  return {
    getBootstrap: () => ipc.invoke(IpcChannel.GetBootstrap),
    pickWorkspaceFolder: () => ipc.invoke(IpcChannel.PickWorkspaceFolder),
    pickWorkspaceFile: (workspaceRoot: string) =>
      ipc.invoke(IpcChannel.PickWorkspaceFile, workspaceRoot),
    connectLive: (opts) => ipc.invoke(IpcChannel.ConnectLive, opts),
    setWindowTheme: (theme) => ipc.invoke(IpcChannel.SetWindowTheme, theme),
    setDevToolsEnabled: (enabled) => ipc.invoke(IpcChannel.SetDevToolsEnabled, enabled),
    saveTextFile: (request) => ipc.invoke(IpcChannel.SaveTextFile, request),
    previewLoad: (url) => ipc.invoke(IpcChannel.PreviewLoad, url),
    previewSetBounds: (bounds) => ipc.invoke(IpcChannel.PreviewSetBounds, bounds),
    previewHide: () => ipc.invoke(IpcChannel.PreviewHide),
    previewReload: () => ipc.invoke(IpcChannel.PreviewReload),
    previewClose: () => ipc.invoke(IpcChannel.PreviewClose),
  };
}

/** Expose the narrow bridge on `window` under the shared, contract-defined key. */
export function exposeShellBridge(contextBridge: ContextBridgeLike, ipc: BridgeIpc): void {
  contextBridge.exposeInMainWorld(COWORK_SHELL_BRIDGE_KEY, createShellBridge(ipc));
}
