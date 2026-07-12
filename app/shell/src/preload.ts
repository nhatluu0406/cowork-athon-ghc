/**
 * Preload script — the ONLY thing the renderer can see of the shell.
 *
 * Runs with `sandbox: true` + `contextIsolation: true`. It exposes a NARROW, typed API
 * (`CoworkShellBridge`) via `contextBridge` and nothing else: no `ipcRenderer`, no
 * generic `invoke(channel, …)`, no Node, no `require`. The bridge is built by
 * {@link exposeShellBridge}, where each method maps to exactly one explicit, allow-listed
 * channel. Widening the surface means adding a typed method there AND a channel in
 * `channels.ts` AND a method on the shared bridge contract.
 *
 * NOTE (build): a sandboxed preload must be delivered as a single bundled file. The
 * packaging step (CGHC-028) bundles this module + its imports; `tsc` here only typechecks
 * and emits it. It is not loaded as a raw ESM module tree at runtime.
 */

import { contextBridge, ipcRenderer } from "electron";

import { exposeShellBridge } from "./ipc/bridge.js";

exposeShellBridge(contextBridge, ipcRenderer);
