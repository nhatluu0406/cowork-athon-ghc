/**
 * Shared child-process environment for packaged Electron verification.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Local-service readiness copy (legacy topbar + V3 status bar). */
export const LOCAL_SERVICE_READY = /(?:Local service:|Service ·)\s*Sẵn sàng/i;

/** V3 status bar with legacy topbar fallback for packaged verifiers. */
export const SERVICE_STATUS_SELECTOR = ".status-bar__service, .topbar__status";

/** Provider/settings entry (V3 status bar + legacy topbar gateway). */
export const PROVIDER_SETTINGS_SELECTOR = ".status-bar__provider, .topbar__gateway";

/** Full-screen settings surface or legacy modal. */
export const SETTINGS_ROOT_SELECTOR = ".settings-surface:not([hidden]), .modal:not([hidden])";

/** Close/back control for settings surface or legacy modal. */
export const SETTINGS_CLOSE_SELECTOR =
  ".settings-surface__close, .settings-surface__back, .modal .icon-btn";

/** New conversation control in contextual sidebar. */
export const NEW_CONVERSATION_SELECTOR = ".cowork-sidebar__new, .sidebar__new-btn";

/** Continuation unlock when composer is locked. */
export const CONTINUATION_UNLOCK_SELECTOR =
  ".continuation-banner__button, .continuation-banner .label-btn";

/** Packaged executable that all packaged tests must launch (never a temp copy). */
export function packagedExecutablePath(repoRoot = process.cwd()) {
  return join(repoRoot, "dist-app", "win-unpacked", "Cowork GHC.exe");
}

/**
 * Assert the project artifact exists and looks like the current repo build.
 * Does not copy or install into a temporary directory.
 */
export function assertPackagedExecutable(repoRoot = process.cwd()) {
  const exe = packagedExecutablePath(repoRoot);
  if (!existsSync(exe)) {
    throw new Error(`missing packaged executable: ${exe} — run npm run package:win / scripts\\build.bat`);
  }
  const unpacked = join(repoRoot, "dist-app", "win-unpacked");
  if (!existsSync(join(unpacked, "resources", "app.asar")) && !existsSync(join(unpacked, "resources"))) {
    throw new Error(`packaged build incomplete under ${unpacked}`);
  }
  return exe;
}

/**
 * Create an isolated writable runtime root under `<repo>/.runtime/test-runs/<run-id>`.
 * Database resolves to `<root>/data/cowork-ghc.db` via COWORK_GHC_RUNTIME_ROOT.
 */
export function createPackagedTestRuntime(repoRoot = process.cwd()) {
  const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const runtimeRoot = join(repoRoot, ".runtime", "test-runs", runId);
  mkdirSync(join(runtimeRoot, "data", "backups"), { recursive: true });
  mkdirSync(join(runtimeRoot, "electron-profile"), { recursive: true });
  return {
    runId,
    runtimeRoot,
    databasePath: join(runtimeRoot, "data", "cowork-ghc.db"),
    electronProfile: join(runtimeRoot, "electron-profile"),
    cleanup(success) {
      if (success) {
        rmSync(runtimeRoot, { recursive: true, force: true });
        return;
      }
      console.error(`[packaged-test] preserved runtime root for debugging:\n  ${runtimeRoot}`);
    },
  };
}

/**
 * Build a child env for packaged Cowork GHC launches.
 * Strips ELECTRON_RUN_AS_NODE so the binary starts as a GUI app.
 */
export function packagedChildEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}
