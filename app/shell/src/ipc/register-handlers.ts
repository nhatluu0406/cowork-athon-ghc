/**
 * IPC handlers for the shell's native capabilities.
 *
 * Each handler is registered against exactly one explicit channel and returns a typed
 * payload declared in `@cowork-ghc/contracts`. This is the ONLY bridge into the main
 * process; there is no generic passthrough. Business logic lives behind the loopback
 * service (ADR 0003), not here — these handlers only expose native OS capabilities.
 */

import { writeFile } from "node:fs/promises";
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import type {
  ConnectLiveResult,
  PickedWorkspaceFile,
  PickedWorkspaceFolder,
  PreviewLoadResult,
  PreviewViewBounds,
  RendererBootstrap,
  SaveTextFileRequest,
  SaveTextFileResult,
  StartupAuthModeResult,
  WindowTheme,
} from "@cowork-ghc/contracts";

import { IpcChannel } from "./channels.js";
import type { ShellBootstrap } from "../bootstrap.js";
import { createPreviewViewController, type PreviewViewController } from "../preview/preview-view.js";
import {
  clearSealedDeviceSecret,
  generateDeviceSecret,
  isSecureAutoUnlockAvailable,
  sealDeviceSecret,
} from "../service/device-unlock.js";
import { applyStartupAuthMode } from "../service/startup-auth-mode.js";

/** Packaged verification: pop one path per pick from `COWORK_GHC_E2E_ATTACHMENT_QUEUE` (`|` separated). */
let e2eAttachmentQueue: string[] | null = null;

function consumeE2eAttachmentPath(): string | undefined {
  const queueEnv = process.env["COWORK_GHC_E2E_ATTACHMENT_QUEUE"]?.trim();
  if (queueEnv !== undefined && queueEnv !== "") {
    if (e2eAttachmentQueue === null) {
      e2eAttachmentQueue = queueEnv
        .split("|")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
    }
    return e2eAttachmentQueue.shift();
  }
  const single = process.env["COWORK_GHC_E2E_ATTACHMENT_PATH"]?.trim();
  return single !== undefined && single !== "" ? single : undefined;
}

/**
 * Register all native-capability IPC handlers. Call once, after `app.whenReady()`.
 *
 * `getBootstrap` is a LIVE getter (not a snapshot): the handler reads it on every renderer
 * request so the handshake reflects the true service state at call time — an honest empty
 * handshake while the service is starting / failed, the real base URL + token once running.
 *
 * `connectLive` ensures the loopback service is live: idempotent when already live (no restart,
 * no dropped in-memory state — e.g. the MS365 manual token / session scope survive), and forces a
 * stop+restart (re-resolving launch config from the now-persisted onboarding settings) only when
 * the caller passes `{ force: true }` — the settings-only → live transition, and after a
 * provider-config change. It is best-effort and honest: it never throws to the renderer, and the
 * true post-call state is read back via `getBootstrap` on the renderer's next readiness poll.
 */
export interface IpcHandlerDeps {
  readonly getBootstrap: () => ShellBootstrap;
  readonly connectLive: (force: boolean) => Promise<ConnectLiveResult>;
  /** Writable app-data root where the safeStorage-sealed deviceSecret lives (auto-unlock.seal). */
  readonly appDataRoot: string;
}

/** One authenticated call to the loopback service; returns the parsed envelope. */
async function serviceCall(
  bootstrap: ShellBootstrap,
  method: string,
  path: string,
  body: unknown,
): Promise<{ ok: boolean }> {
  const base = bootstrap.serviceBaseUrl;
  const token = bootstrap.clientToken;
  if (base === undefined || base === "" || token === undefined || token === "") {
    return { ok: false };
  }
  try {
    const res = await fetch(new URL(path, base), {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const env = (await res.json()) as { ok?: boolean };
    return { ok: res.ok && env?.ok === true };
  } catch {
    return { ok: false };
  }
}

/** Lazily-created embedded preview controller, one per owning window. */
const previewControllers = new WeakMap<BrowserWindow, PreviewViewController>();

function previewControllerFor(event: IpcMainInvokeEvent): PreviewViewController | null {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (owner === null) return null;
  let controller = previewControllers.get(owner);
  if (controller === undefined) {
    controller = createPreviewViewController(owner);
    previewControllers.set(owner, controller);
    // The child view is destroyed with the window; drop our reference so a relaunch re-creates it.
    owner.once("closed", () => previewControllers.delete(owner));
  }
  return controller;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { getBootstrap, connectLive, appDataRoot } = deps;

  ipcMain.handle(IpcChannel.IsSecureAutoUnlockAvailable, (): boolean => isSecureAutoUnlockAvailable());

  ipcMain.handle(
    IpcChannel.SetStartupAuthMode,
    async (
      _event: IpcMainInvokeEvent,
      arg: unknown,
    ): Promise<StartupAuthModeResult> => {
      const requireLogin = (arg as { requireLogin?: unknown })?.requireLogin === true;
      const password = (arg as { password?: unknown })?.password;
      const bootstrap = getBootstrap();
      // The two-step orchestration (envelope in the service ↔ seal in the shell) with its rollback
      // lives in `applyStartupAuthMode` so the interruption behaviour is unit-tested; here we only
      // bind the real seams (loopback call + safeStorage device-unlock).
      return applyStartupAuthMode(
        {
          serviceCall: (method, path, body) => serviceCall(bootstrap, method, path, body),
          isSecureAvailable: isSecureAutoUnlockAvailable,
          generateDeviceSecret,
          sealDeviceSecret: (secret) => sealDeviceSecret(appDataRoot, secret),
          clearSealedDeviceSecret: () => clearSealedDeviceSecret(appDataRoot),
        },
        requireLogin,
        typeof password === "string" ? password : "",
      );
    },
  );


  ipcMain.handle(IpcChannel.GetBootstrap, (): RendererBootstrap => {
    const bootstrap = getBootstrap();
    return {
      serviceBaseUrl: bootstrap.serviceBaseUrl,
      clientToken: bootstrap.clientToken,
      ...(bootstrap.allowEnvCredentialImport === true
        ? { allowEnvCredentialImport: true as const }
        : {}),
    };
  });

  ipcMain.handle(
    IpcChannel.ConnectLive,
    async (_event, opts?: { readonly force?: boolean }): Promise<ConnectLiveResult> => {
      // Best-effort + honest: a failing live start is swallowed by the controller
      // (→ not_connected), never surfaced as a thrown IPC error. The renderer re-handshakes to
      // learn the real outcome.
      return connectLive(opts?.force === true);
    },
  );

  ipcMain.handle(
    IpcChannel.SetWindowTheme,
    (event: IpcMainInvokeEvent, theme: WindowTheme): void => {
      if (theme !== "light" && theme !== "dark") return;
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || process.platform !== "win32") return;
      owner.setTitleBarOverlay({
        color: theme === "dark" ? "#181B1E" : "#FFFFFF",
        symbolColor: theme === "dark" ? "#F4F6F8" : "#1F2933",
        height: 44,
      });
      owner.setBackgroundColor(theme === "dark" ? "#111315" : "#F5F6F8");
    },
  );

  ipcMain.handle(
    IpcChannel.SetDevToolsEnabled,
    (event: IpcMainInvokeEvent, enabled: unknown): void => {
      if (typeof enabled !== "boolean") return;
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner) return;
      if (enabled) {
        if (!owner.webContents.isDevToolsOpened()) {
          owner.webContents.openDevTools({ mode: "detach" });
        }
        return;
      }
      if (owner.webContents.isDevToolsOpened()) {
        owner.webContents.closeDevTools();
      }
    },
  );

  ipcMain.handle(
    IpcChannel.PickWorkspaceFolder,
    async (event: IpcMainInvokeEvent): Promise<PickedWorkspaceFolder> => {
      // Packaged verification seam only: when set, return the fixture path without opening the
      // native dialog. Normal launches leave this unset.
      const fixtureRoot = process.env["COWORK_GHC_E2E_WORKSPACE_ROOT"]?.trim();
      if (fixtureRoot !== undefined && fixtureRoot !== "") {
        return { canceled: false, rootPath: fixtureRoot };
      }

      const owner = BrowserWindow.fromWebContents(event.sender);
      const result = owner
        ? await dialog.showOpenDialog(owner, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] });

      const [first] = result.filePaths;
      if (result.canceled || first === undefined) {
        return { canceled: true };
      }
      return { canceled: false, rootPath: first };
    },
  );

  ipcMain.handle(
    IpcChannel.PickWorkspaceFile,
    async (event: IpcMainInvokeEvent, workspaceRoot: string): Promise<PickedWorkspaceFile> => {
      const fixturePath = consumeE2eAttachmentPath();
      if (fixturePath !== undefined) {
        return { canceled: false, filePath: fixturePath };
      }

      const defaultPath =
        typeof workspaceRoot === "string" && workspaceRoot.length > 0 ? workspaceRoot : undefined;
      const owner = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions: OpenDialogOptions = {
        properties: ["openFile"],
        ...(defaultPath !== undefined ? { defaultPath } : {}),
      };
      const result = owner
        ? await dialog.showOpenDialog(owner, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      const [first] = result.filePaths;
      if (result.canceled || first === undefined) {
        return { canceled: true };
      }
      return { canceled: false, filePath: first };
    },
  );

  ipcMain.handle(
    IpcChannel.SaveTextFile,
    async (event: IpcMainInvokeEvent, request: SaveTextFileRequest): Promise<SaveTextFileResult> => {
      const filename =
        typeof request?.filename === "string" && request.filename.length > 0
          ? request.filename
          : "cowork-ghc-export.json";
      const content = typeof request?.content === "string" ? request.content : "";
      const owner = BrowserWindow.fromWebContents(event.sender);
      const options = { defaultPath: filename, filters: [{ name: "JSON", extensions: ["json"] }] };
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || result.filePath === undefined || result.filePath === "") {
        return { canceled: true };
      }
      try {
        await writeFile(result.filePath, content, "utf8");
        return { canceled: false, path: result.filePath };
      } catch {
        // Honest failure: report canceled rather than a fake success (the write did not happen).
        return { canceled: true };
      }
    },
  );

  // --- Embedded runtime preview (WebContentsView, hardened) ---
  ipcMain.handle(
    IpcChannel.PreviewLoad,
    (event: IpcMainInvokeEvent, url: unknown): PreviewLoadResult => {
      if (typeof url !== "string") return { ok: false, error: "invalid_url" };
      const controller = previewControllerFor(event);
      if (controller === null) return { ok: false, error: "no_window" };
      return controller.load(url);
    },
  );
  ipcMain.handle(
    IpcChannel.PreviewSetBounds,
    (event: IpcMainInvokeEvent, bounds: unknown): void => {
      const b = bounds as Partial<PreviewViewBounds> | null;
      if (
        b === null ||
        typeof b !== "object" ||
        !isFiniteNumber(b.x) ||
        !isFiniteNumber(b.y) ||
        !isFiniteNumber(b.width) ||
        !isFiniteNumber(b.height)
      ) {
        return;
      }
      previewControllerFor(event)?.setBounds({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        visible: b.visible === true,
      });
    },
  );
  ipcMain.handle(IpcChannel.PreviewHide, (event: IpcMainInvokeEvent): void => {
    previewControllerFor(event)?.hide();
  });
  ipcMain.handle(IpcChannel.PreviewReload, (event: IpcMainInvokeEvent): void => {
    previewControllerFor(event)?.reload();
  });
  ipcMain.handle(IpcChannel.PreviewClose, (event: IpcMainInvokeEvent): void => {
    previewControllerFor(event)?.close();
  });
}
