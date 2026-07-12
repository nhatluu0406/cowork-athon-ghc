/**
 * Electron main process entry (ADR 0002, CGHC-028 Wave B1).
 *
 * Responsibilities of the shell, and ONLY these: START and OWN the live loopback service
 * (ADR 0003) + the supervised OpenCode child (ADR 0004) IN-PROCESS via the
 * {@link ServiceController}, holding the running `{ baseUrl, token }` in memory and handing
 * it to the renderer over the bridge; serve the renderer over the hardened `app://` protocol
 * (with the CSP as a real response header); stamp the CSP on ordinary session responses as
 * defense-in-depth; register the narrow native-capability IPC handlers; harden every web
 * contents; and open the main window. No business logic — that lives behind the service the
 * renderer talks to.
 *
 * Ownership: the ServiceController is the ONE in-memory owner of the service handle; on
 * `before-quit` the lifecycle stops it (socket + child) exactly once, so there is no
 * orphaned OpenCode process. The token is a secret held only in the controller + the bridge
 * response; it is never logged or written to disk here.
 */

import { app, BrowserWindow, protocol, session } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const remoteDebugPort = process.env["COWORK_GHC_REMOTE_DEBUG_PORT"]?.trim();
if (remoteDebugPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);
}

import { createMainWindow } from "./create-window.js";
import { registerIpcHandlers } from "./ipc/register-handlers.js";
import { runShellLifecycle, type LifecycleApp } from "./lifecycle.js";
import { hardenWebContents } from "./security/navigation.js";
import { installCsp } from "./security/csp.js";
import { APP_ORIGIN, installAppProtocol, registerAppScheme } from "./security/app-protocol.js";
import { ServiceController, type StartService } from "./service/service-controller.js";
import { createLiveStartService } from "./service/live-service-adapter.js";
import { createLiveOptionsResolver } from "./service/live-launch-resolver.js";
import { createEnvLaunchSource } from "./service/env-launch-source.js";
import { resolvePackagedPaths } from "./service/packaged-paths.js";
import {
  createSettingsOnlyStartService,
  createTieredStartService,
} from "./service/tiered-start-service.js";
import { createHealthVerifiedStartService } from "./service/wait-for-health.js";
import {
  createFirstConfiguredSource,
  createPersistedSettingsSource,
} from "./service/persisted-settings-source.js";
import { loadProjectEnvFile } from "./load-project-env.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * App install root (dev): `app/shell/dist/main.cjs` → three levels up is the repo root, where
 * `node_modules/opencode-ai/bin/opencode.exe` lives. In a PACKAGED app this path points inside
 * `app.asar` (no `node_modules` there), so the packaged binary/runtime paths are resolved
 * separately from `process.resourcesPath` / `userData` below.
 */
const DEV_APP_ROOT = join(here, "..", "..", "..");

/**
 * Directory of the Vite-built renderer. Layout: `app/shell/dist/main.cjs` and
 * `app/ui/dist/index.html` — i.e. up out of `shell/dist` into `ui/dist`. Served over
 * `app://` rather than loaded from `file://` so the CSP header attaches deterministically.
 */
const RENDERER_DIR = join(here, "..", "..", "ui", "dist");

let lifecycleLogPath = join(DEV_APP_ROOT, ".runtime", "service-lifecycle.log");
let shellController: ServiceController | null = null;

function envCredentialImportEnabled(): boolean {
  return !app.isPackaged || process.env["COWORK_GHC_ALLOW_ENV_IMPORT"] === "1";
}

function resolveRuntimePaths() {
  const packaged = resolvePackagedPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userData: app.getPath("userData"),
    devAppRoot: DEV_APP_ROOT,
  });
  const settingsFilePath = join(packaged.runtimeRoot ?? DEV_APP_ROOT, ".runtime", "settings.json");
  lifecycleLogPath = join(packaged.runtimeRoot ?? DEV_APP_ROOT, ".runtime", "service-lifecycle.log");
  return { packaged, settingsFilePath };
}

function createShellController(settingsFilePath: string, packaged: ReturnType<typeof resolvePackagedPaths>) {
  const liveSource = createFirstConfiguredSource([
    createPersistedSettingsSource({
      settingsFilePath,
      allowedOrigins: [APP_ORIGIN],
      binPath: packaged.binPath,
      appRoot: DEV_APP_ROOT,
      ...(packaged.runtimeRoot !== undefined ? { runtimeRoot: packaged.runtimeRoot } : {}),
    }),
    createEnvLaunchSource({
      appRoot: DEV_APP_ROOT,
      binPath: packaged.binPath,
      allowedOrigins: [APP_ORIGIN],
      settingsFilePath,
      ...(packaged.runtimeRoot !== undefined ? { runtimeRoot: packaged.runtimeRoot } : {}),
    }),
  ]);

  return new ServiceController({
    log: writeLifecycleLog,
    allowEnvCredentialImport: envCredentialImportEnabled(),
    startService: createTieredStartService(
      tracedStartService("live", createLiveStartService(createLiveOptionsResolver(liveSource))),
      tracedStartService(
        "settings_only",
        createSettingsOnlyStartService({
          settingsFilePath,
          allowedOrigins: [APP_ORIGIN],
          allowEnvCredentialImport: envCredentialImportEnabled(),
        }),
      ),
    ),
  });
}

// The privileged `app://` scheme MUST be registered before the app is ready.
registerAppScheme(protocol);

// Harden every web contents the moment it is created (belt-and-braces with the window).
app.on("web-contents-created", (_event, contents) => {
  hardenWebContents(contents);
});

app.on("window-all-closed", () => {
  // Windows/Linux: quit on last window; `before-quit` then stops the service + child.
  if (process.platform !== "darwin") {
    app.quit();
  }
});

/**
 * The persistent settings file is resolved AFTER `app.whenReady()` so Electron's final
 * `userData` path is used (import-time `getPath("userData")` is not stable in packaged apps).
 */
function writeLifecycleLog(line: string): void {
  writeStartupTrace(`log:${redactLifecycleLine(line)}`);
  try {
    mkdirSync(dirname(lifecycleLogPath), { recursive: true });
    appendFileSync(
      lifecycleLogPath,
      `${new Date().toISOString()} ${redactLifecycleLine(line)}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics are best-effort; logging must never block app startup or shutdown.
  }
}

function writeStartupTrace(marker: string): void {
  const tracePath = process.env["COWORK_GHC_STARTUP_TRACE"];
  if (tracePath === undefined || tracePath.trim() === "") return;
  try {
    appendFileSync(tracePath, `${marker}\n`, "utf8");
  } catch {
    // Trace is opt-in diagnostics only.
  }
}

function redactLifecycleLine(line: string): string {
  return line.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
}

function tracedStartService(name: string, start: StartService): StartService {
  const verified = createHealthVerifiedStartService(start);
  return async () => {
    writeLifecycleLog(`${name}_starting`);
    try {
      const service = await verified();
      writeLifecycleLog(`${name}_ready: ${service.baseUrl}`);
      writeLifecycleLog(`${name}_started: ${service.baseUrl}`);
      return service;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLifecycleLog(`${name}_failed: ${message}`);
      throw error;
    }
  };
}

const lifecycleApp: LifecycleApp = {
  whenReady: () => app.whenReady(),
  onBeforeQuit: (listener) => {
    app.on("before-quit", listener);
  },
  quit: () => app.quit(),
};

void runShellLifecycle({
  app: lifecycleApp,
  get controller() {
    if (shellController === null) {
      throw new Error("Shell controller not initialized");
    }
    return shellController;
  },
  trace: writeStartupTrace,
  prepare: () => {
    if (envCredentialImportEnabled()) {
      loadProjectEnvFile(DEV_APP_ROOT);
    }
    const { packaged, settingsFilePath } = resolveRuntimePaths();
    shellController = createShellController(settingsFilePath, packaged);
  },
  onReady: () => {
    if (shellController === null) {
      throw new Error("Shell controller not initialized");
    }
    installAppProtocol(protocol, RENDERER_DIR);
    installCsp(session.defaultSession);
    // Live getter: every renderer `getBootstrap` reflects the true service state at call time.
    // `restartService` performs the user-gated onboarding → live transition (stop, then start, which
    // now re-resolves the persisted config). Stop+start are each idempotent + own the child.
    registerIpcHandlers({
      getBootstrap: () => shellController!.getBootstrap(),
      restartService: async () => {
        await shellController!.stop();
        await shellController!.start();
      },
    });
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  },
});
