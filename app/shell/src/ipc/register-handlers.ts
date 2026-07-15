/**
 * IPC handlers for the shell's native capabilities.
 *
 * Each handler is registered against exactly one explicit channel and returns a typed
 * payload declared in `@cowork-ghc/contracts`. This is the ONLY bridge into the main
 * process; there is no generic passthrough. Business logic lives behind the loopback
 * service (ADR 0003), not here — these handlers only expose native OS capabilities.
 */

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from "electron";
import type {
  ConnectLiveResult,
  PickedWorkspaceFile,
  PickedWorkspaceFolder,
  RendererBootstrap,
  WindowTheme,
} from "@cowork-ghc/contracts";

import { IpcChannel } from "./channels.js";
import type { ShellBootstrap } from "../bootstrap.js";

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
 * `restartService` restarts the loopback service so it re-resolves its launch config from the
 * now-persisted onboarding settings (the settings-only → live transition). It is best-effort and
 * honest: the restart itself never throws to the renderer, and the true post-restart state is read
 * back via `getBootstrap` on the renderer's next readiness poll.
 */
export interface IpcHandlerDeps {
  readonly getBootstrap: () => ShellBootstrap;
  readonly restartService: () => Promise<void>;
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { getBootstrap, restartService } = deps;
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

  ipcMain.handle(IpcChannel.ConnectLive, async (): Promise<ConnectLiveResult> => {
    // Best-effort + honest: a failing live start is swallowed by the controller (→ not_connected),
    // never surfaced as a thrown IPC error. The renderer re-handshakes to learn the real outcome.
    await restartService();
    return { restarted: true };
  });

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
}
