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

const here = dirname(fileURLToPath(import.meta.url));

/**
 * App install root (dev): `app/shell/dist/main.cjs` → three levels up is the repo root, where
 * `node_modules/opencode-ai/bin/opencode.exe` lives. In a PACKAGED app this path points inside
 * `app.asar` (no `node_modules` there), so the packaged binary/runtime paths are resolved
 * separately from `process.resourcesPath` / `userData` below.
 */
const DEV_APP_ROOT = join(here, "..", "..", "..");

/**
 * Run-mode-aware paths: in a packaged app the pinned OpenCode binary ships via `extraResources`
 * to `<resourcesPath>/opencode/opencode.exe` and per-launch `.runtime/` state must live under the
 * WRITABLE `userData` dir (the install dir is read-only). In dev both fall back to the repo tree.
 * These become the explicit `binPath` / `runtimeRoot` the launch source hands `buildLiveCoworkOptions`.
 */
const packaged = resolvePackagedPaths({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  userData: app.getPath("userData"),
  devAppRoot: DEV_APP_ROOT,
});

/**
 * Directory of the Vite-built renderer. Layout: `app/shell/dist/main.cjs` and
 * `app/ui/dist/index.html` — i.e. up out of `shell/dist` into `ui/dist`. Served over
 * `app://` rather than loaded from `file://` so the CSP header attaches deterministically.
 */
const RENDERER_DIR = join(here, "..", "..", "ui", "dist");

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
 * The persistent settings file, resolved to a WRITABLE absolute path (packaged: Electron
 * `userData`; dev: the repo tree). Both the Tier-1 onboarding fallback and the live launch read +
 * write THIS file, so a provider/model saved during onboarding is the same state the live launch
 * consumes.
 */
const SETTINGS_FILE_PATH = join(packaged.runtimeRoot ?? DEV_APP_ROOT, ".runtime", "settings.json");
const LIFECYCLE_LOG_PATH = join(packaged.runtimeRoot ?? DEV_APP_ROOT, ".runtime", "service-lifecycle.log");

function redactLifecycleLine(line: string): string {
  return line.replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]");
}

function writeLifecycleLog(line: string): void {
  writeStartupTrace(`log:${redactLifecycleLine(line)}`);
  try {
    mkdirSync(dirname(LIFECYCLE_LOG_PATH), { recursive: true });
    appendFileSync(
      LIFECYCLE_LOG_PATH,
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

// The live launch config comes from the FIRST configured source: the persisted onboarding settings
// (what the user entered in the UI) take priority; the launch-env source is a fallback for bounded
// live tests. Both make the live loopback service reachable by the renderer (`app://cowork`) and
// share the SAME settings file the onboarding service writes.
const liveSource = createFirstConfiguredSource([
  createPersistedSettingsSource({
    settingsFilePath: SETTINGS_FILE_PATH,
    allowedOrigins: [APP_ORIGIN],
    binPath: packaged.binPath,
    appRoot: DEV_APP_ROOT,
    ...(packaged.runtimeRoot !== undefined ? { runtimeRoot: packaged.runtimeRoot } : {}),
  }),
  createEnvLaunchSource({
    appRoot: DEV_APP_ROOT,
    binPath: packaged.binPath,
    allowedOrigins: [APP_ORIGIN],
    settingsFilePath: SETTINGS_FILE_PATH,
    ...(packaged.runtimeRoot !== undefined ? { runtimeRoot: packaged.runtimeRoot } : {}),
  }),
]);

// The ONE in-memory owner of the loopback service + (once connected) the supervised OpenCode child.
// The StartService is MODE-AWARE: it tries the live path (persisted/env launch source → the REAL
// child); when nothing is configured yet the live resolver throws `ServiceLaunchNotConfiguredError`
// and it falls back to the Tier-1 SETTINGS-ONLY service so the shell boots into an ONBOARDING-ready
// state (folder picker + provider/model settings reachable) — no child, no provider call. Actually
// going live is a separate user-gated step (a "Connect" restart into the live path).
const controller = new ServiceController({
  log: writeLifecycleLog,
  startService: createTieredStartService(
    tracedStartService("live", createLiveStartService(createLiveOptionsResolver(liveSource))),
    tracedStartService(
      "settings_only",
      createSettingsOnlyStartService({
        settingsFilePath: SETTINGS_FILE_PATH,
        allowedOrigins: [APP_ORIGIN],
      }),
    ),
  ),
});

const lifecycleApp: LifecycleApp = {
  whenReady: () => app.whenReady(),
  onBeforeQuit: (listener) => {
    app.on("before-quit", listener);
  },
  quit: () => app.quit(),
};

void runShellLifecycle({
  app: lifecycleApp,
  controller,
  trace: writeStartupTrace,
  onReady: () => {
    installAppProtocol(protocol, RENDERER_DIR);
    installCsp(session.defaultSession);
    // Live getter: every renderer `getBootstrap` reflects the true service state at call time.
    // `restartService` performs the user-gated onboarding → live transition (stop, then start, which
    // now re-resolves the persisted config). Stop+start are each idempotent + own the child.
    registerIpcHandlers({
      getBootstrap: () => controller.getBootstrap(),
      restartService: async () => {
        await controller.stop();
        await controller.start();
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
