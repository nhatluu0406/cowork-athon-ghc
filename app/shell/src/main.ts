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

import { app, BrowserWindow, Menu, protocol, session } from "electron";
import { appendFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const remoteDebugPort = process.env["COWORK_GHC_REMOTE_DEBUG_PORT"]?.trim();
if (remoteDebugPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);
}

import { createMainWindow } from "./create-window.js";
import { runUiAuditIfEnabled } from "./audit/ui-capture.js";
import { registerIpcHandlers } from "./ipc/register-handlers.js";
import { runShellLifecycle, type LifecycleApp } from "./lifecycle.js";
import { hardenWebContents } from "./security/navigation.js";
import { installCsp } from "./security/csp.js";
import { APP_ORIGIN, installAppProtocol, registerAppScheme } from "./security/app-protocol.js";
import { ServiceController, type StartService } from "./service/service-controller.js";
import { createConnectLive } from "./service/connect-live.js";
import { createLiveStartService } from "./service/live-service-adapter.js";
import { createLiveOptionsResolver } from "./service/live-launch-resolver.js";
import { createEnvLaunchSource } from "./service/env-launch-source.js";
import { resolvePackagedPaths } from "./service/packaged-paths.js";
import {
  CoworkDataPathError,
  resolveCoworkDataPaths,
} from "./service/cowork-data-paths.js";
import { createSettingsOnlyStartService } from "./service/tiered-start-service.js";
import { createHealthVerifiedStartService } from "./service/wait-for-health.js";
import {
  createFirstConfiguredSource,
  createPersistedSettingsSource,
} from "./service/persisted-settings-source.js";
import { loadProjectEnvFile } from "./load-project-env.js";
import { clearRememberedUnlock } from "./service/session-unlock.js";
import { resolveM365KGStackPaths } from "./service/m365kg-stack-paths.js";
import { createM365KGStackLaunch, type M365KGStackLaunch } from "./service/m365kg-stack-launch.js";
import { gateway } from "@cowork-ghc/service";

const here = dirname(fileURLToPath(import.meta.url));

/** M365 Knowledge Graph additive stack — null until `prepare` resolves successfully. */
let m365kgStack: M365KGStackLaunch | null = null;

export interface ResolvedM365KGConfig {
  apiKey: string;
  baseUrl?: string;
  embeddingMode?: "cloud" | "local";
  embeddingModelId?: string;
}

/**
 * Read the Claude API key and embedding settings for M365KG llm-svc at stack-launch time:
 *  1. Env var fast path (dev / CI): `ANTHROPIC_API_KEY` or `LLM_API_KEY`.
 *  2. Production vault path: calls the live loopback service's `/api/m365kg/credentials`
 *     endpoint (token-guarded, 127.0.0.1 only) which resolves the active provider's
 *     credential and embedding settings from the vault-backed service store.
 *
 * Returns undefined on any failure — llm-svc degrades to local ONNX (no crash, no block).
 * The key is never logged (writeLifecycleLog redacts ≥32-char strings) and never persisted.
 */
async function resolveClaude(): Promise<ResolvedM365KGConfig | undefined> {
  const envKey = (process.env["ANTHROPIC_API_KEY"] ?? process.env["LLM_API_KEY"] ?? "").trim();
  if (envKey) {
    return { apiKey: envKey, baseUrl: process.env["LLM_API_BASE_URL"] || "https://api.anthropic.com" };
  }

  // Production: read from the active provider profile via the live service loopback.
  const bootstrap = shellController?.getBootstrap();
  const svcBaseUrl = bootstrap?.serviceBaseUrl;
  const svcToken = bootstrap?.clientToken;
  if (!svcBaseUrl || !svcToken) return undefined;

  try {
    const res = await fetch(new URL("/api/m365kg/credentials", svcBaseUrl), {
      headers: { authorization: `Bearer ${svcToken}` },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    const claudeApiKey = typeof body["claudeApiKey"] === "string" ? body["claudeApiKey"].trim() : "";
    if (!claudeApiKey) return undefined;
    const claudeBaseUrl =
      typeof body["claudeBaseUrl"] === "string" && body["claudeBaseUrl"].trim()
        ? body["claudeBaseUrl"].trim()
        : "https://api.anthropic.com";
    const result: ResolvedM365KGConfig = { apiKey: claudeApiKey, baseUrl: claudeBaseUrl };
    if (body["embeddingMode"] === "local" || body["embeddingMode"] === "cloud") {
      result.embeddingMode = body["embeddingMode"];
    }
    if (typeof body["embeddingModelId"] === "string" && body["embeddingModelId"].trim()) {
      result.embeddingModelId = body["embeddingModelId"].trim();
    }
    return result;
  } catch {
    return undefined;
  }
}

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
/** Writable app-data root (holds the safeStorage-sealed deviceSecret for auto-unlock). */
let shellAppDataRoot = "";

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
  const dataPaths = resolveCoworkDataPaths({
    isPackaged: app.isPackaged,
    repoRoot: DEV_APP_ROOT,
    ...(process.env["LOCALAPPDATA"] !== undefined
      ? { localAppData: process.env["LOCALAPPDATA"] }
      : {}),
  });
  // Writable app root owns settings/conversations beside `data/` (never beside the .exe).
  const appDataRoot = dirname(dataPaths.dataRoot);
  const settingsFilePath = join(appDataRoot, "settings.json");
  const conversationsDir = join(appDataRoot, "conversations");
  const skillsStateFilePath = join(appDataRoot, "skills-enabled.json");
  const dbPath = dataPaths.databasePath;
  maybeMigrateLegacyDatabase(join(app.getPath("userData"), "cowork-ghc.db"), dbPath);
  const userSkillsRoot =
    process.env["COWORK_GHC_E2E_SKILLS_ROOT"]?.trim() || join(appDataRoot, "skills");
  const builtInSkillsRoot = app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(DEV_APP_ROOT, "skills", "builtin");
  // Claude Code-style skill folders: the project checkout's `.agents/skills` (shipped to
  // `<resources>/agents-skills` when packaged) plus the user-global `~/.agents/skills`. Both are
  // optional discovery roots — a missing directory is skipped by the catalog (realpath guard).
  const agentsSkillsRoot = app.isPackaged
    ? join(process.resourcesPath, "agents-skills")
    : join(DEV_APP_ROOT, ".agents", "skills");
  const userAgentsSkillsRoot = join(homedir(), ".agents", "skills");
  lifecycleLogPath = join(appDataRoot, "service-lifecycle.log");
  mkdirSync(conversationsDir, { recursive: true });
  if (process.env["COWORK_GHC_VERBOSE_LOGGING"] === "1") {
    writeStartupTrace(`database_path:${dbPath}`);
  }
  return {
    packaged,
    settingsFilePath,
    conversationsDir,
    skillsStateFilePath,
    dbPath,
    dataPaths,
    skillRoots: [
      { path: builtInSkillsRoot, source: "built_in" as const },
      { path: agentsSkillsRoot, source: "built_in" as const },
      { path: userAgentsSkillsRoot, source: "built_in" as const },
      { path: userSkillsRoot, source: "user_local" as const, createIfMissing: true },
    ],
  };
}

/**
 * Peek the user's saved Gateway proxy port from `gateway.json` (same directory as
 * `settingsFilePath`) BEFORE any composition happens, so a value the user saved in Settings →
 * Gateway on a PRIOR run actually takes effect on this restart. Falls back to
 * `DEFAULT_GATEWAY_PROXY_PORT` when nothing was ever saved. A raw peek (no store construction,
 * no write lock held) — `createCoworkService` opens its own `GatewayStore` from the same file.
 */
async function resolveGatewayProxyPort(settingsFilePath: string): Promise<number> {
  const fs = gateway.createNodeGatewayStoreFs(dirname(settingsFilePath));
  return gateway.readGatewayServerPort(fs);
}

function createShellController(
  settingsFilePath: string,
  conversationsDir: string,
  skillsStateFilePath: string,
  dbPath: string,
  skillRoots: readonly {
    readonly path: string;
    readonly source: "built_in" | "user_local";
    readonly createIfMissing?: boolean;
  }[],
  packaged: ReturnType<typeof resolvePackagedPaths>,
  gatewayProxyPort: number,
) {
  const liveSource = createFirstConfiguredSource([
    createPersistedSettingsSource({
      settingsFilePath,
      dbPath,
      allowedOrigins: [APP_ORIGIN],
      binPath: packaged.binPath,
      appRoot: DEV_APP_ROOT,
      conversationsDir,
      ...(packaged.runtimeRoot !== undefined ? { runtimeRoot: packaged.runtimeRoot } : {}),
      skillsStateFilePath,
      skillRoots,
      gatewayProxyPort,
    }),
    createEnvLaunchSource({
      appRoot: DEV_APP_ROOT,
      binPath: packaged.binPath,
      allowedOrigins: [APP_ORIGIN],
      settingsFilePath,
      dbPath,
      conversationsDir,
      ...(packaged.runtimeRoot !== undefined ? { runtimeRoot: packaged.runtimeRoot } : {}),
      skillsStateFilePath,
      skillRoots,
      gatewayProxyPort,
    }),
  ]);

  const settingsOnlyOptions = {
    settingsFilePath,
    conversationsDir,
    skillsStateFilePath,
    dbPath,
    skillRoots,
    allowedOrigins: [APP_ORIGIN] as const,
    allowEnvCredentialImport: envCredentialImportEnabled(),
    gatewayProxyPort,
  };
  const settingsOnlyStart = createSettingsOnlyStartService(settingsOnlyOptions);
  // Route the remote gateway's diagnostics (LAN URL, "gateway ready", Discord-on) into the
  // lifecycle log. Without this they default to process.stdout, which a packaged Windows GUI
  // app swallows — leaving the gateway impossible to debug from a log file. The lines carry no
  // secret (URLs only; pairing codes/tokens are never passed to remoteLog) and are redacted by
  // writeLifecycleLog anyway.
  const resolveLiveOptions = createLiveOptionsResolver(liveSource);
  const liveStart = createLiveStartService(async () => ({
    ...(await resolveLiveOptions()),
    remoteLog: writeLifecycleLog,
  }));

  return new ServiceController({
    log: writeLifecycleLog,
    allowEnvCredentialImport: envCredentialImportEnabled(),
    startService: tracedStartService("settings_only", settingsOnlyStart),
    // User-gated connectLive must fail honestly — never silently degrade to settings-only.
    startLiveService: tracedStartService("live", liveStart),
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

function maybeMigrateLegacyDatabase(legacyPath: string, nextPath: string): void {
  if (existsSync(nextPath) || !existsSync(legacyPath)) return;
  try {
    mkdirSync(dirname(nextPath), { recursive: true });
    copyFileSync(legacyPath, nextPath);
    for (const suffix of ["-wal", "-shm"] as const) {
      const side = `${legacyPath}${suffix}`;
      if (existsSync(side)) copyFileSync(side, `${nextPath}${suffix}`);
    }
    writeStartupTrace(`database_migrated_from_legacy:${legacyPath}`);
  } catch {
    // Best-effort; startup continues with a fresh DB if copy fails.
  }
}

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
    app.on("before-quit", (event) => {
      clearRememberedUnlock();
      // Best-effort additive stop — runs in parallel with the main controller stop.
      void m365kgStack?.stop();
      listener(event);
    });
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
  prepare: async () => {
    if (envCredentialImportEnabled()) {
      loadProjectEnvFile(DEV_APP_ROOT);
    }
    try {
      const {
        packaged,
        settingsFilePath,
        conversationsDir,
        skillsStateFilePath,
        dbPath,
        skillRoots,
      } = resolveRuntimePaths();
      shellAppDataRoot = dirname(settingsFilePath);
      const gatewayProxyPort = await resolveGatewayProxyPort(settingsFilePath);
      shellController = createShellController(
        settingsFilePath,
        conversationsDir,
        skillsStateFilePath,
        dbPath,
        skillRoots,
        packaged,
        gatewayProxyPort,
      );
      // Additive M365KG stack — created here so paths are stable; started (non-blocking) in onReady.
      const m365kgPaths = resolveM365KGStackPaths({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        userData: app.getPath("userData"),
        devAppRoot: DEV_APP_ROOT,
      });
      m365kgStack = createM365KGStackLaunch({
        paths: m365kgPaths,
        log: writeLifecycleLog,
        resolveClaude,
      });
    } catch (error) {
      if (error instanceof CoworkDataPathError) {
        writeStartupTrace(`data_path_error:${error.message}`);
        throw error;
      }
      throw error;
    }
  },
  onReady: () => {
    if (shellController === null) {
      throw new Error("Shell controller not initialized");
    }
    installAppProtocol(protocol, RENDERER_DIR);
    installCsp(session.defaultSession);
    Menu.setApplicationMenu(null);
    if (process.platform === "win32") {
      app.setAppUserModelId("com.coworkghc.desktop");
    }
    // Live getter: every renderer `getBootstrap` reflects the true service state at call time.
    // `connectLive` is idempotent when the service is ALREADY live (no stop/start, no dropped
    // in-memory state — e.g. the MS365 manual token / session scope survive a chat turn) and only
    // forces a stop+restart (re-resolving the persisted config) when the renderer explicitly asks
    // for it — the settings-only → live transition, and after a provider-config change. Stop+start
    // are each idempotent + own the child.
    const baseConnectLive = createConnectLive(shellController!);
    registerIpcHandlers({
      getBootstrap: () => shellController!.getBootstrap(),
      connectLive: async (force: boolean) => {
        const result = await baseConnectLive(force);
        // After a new live connection the vault is unlocked → restart M365KG so
        // resolveClaude can now read the active provider credential from the service.
        if (result.restarted) {
          void m365kgStack?.stop().then(() => m365kgStack?.start());
        }
        return result;
      },
      appDataRoot: shellAppDataRoot,
    });
    // Start the M365KG additive stack at launch (uses env-var credential if set; vault
    // credential is resolved on the first connectLive restart above).
    void m365kgStack?.start();
    const mainWindow = createMainWindow();
    // Off by default; only the ER-013 UI-audit tool sets COWORK_GHC_UI_AUDIT=1. When enabled it
    // drives capture in-process then quits the app; skip normal activate wiring in that mode.
    runUiAuditIfEnabled(mainWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  },
});
