// APP lifecycle command implementations (CGHC-028 Wave B2b) — init/start/stop/clean/status for
// the ACTUAL Cowork GHC desktop app (distinct from the loop-engineer controller). All real logic
// lives here behind injectable seams so the exit-code contract is unit-testable WITHOUT a real
// npm build, a real Electron spawn, or a real OpenCode child. Reuses the loop-engineer supervision
// (pid identity), reaper (identity-gated stop), and clean (manifest allowlist) — one source of truth.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { capturePidRecord, writePidRecord } from './supervision.mjs';
import { stopAll } from './reaper.mjs';
import { cleanCommand } from './clean.mjs';
import { log, ensureRuntimeDirs, runtimeInitialized, liveRecords, isRunning } from './runtime-io.mjs';

// Honest, distinct exit codes (never always-0). Clean returns its own codes from clean.mjs.
export const EXIT = Object.freeze({
  OK: 0,
  NOT_INITIALIZED: 3, // start before init
  MISSING_TOOLCHAIN: 2, // npm not found
  BUILD_FAILED: 4, // install/build/tsc failed
  MISSING_BINARY: 5, // pinned OpenCode binary absent
  START_FAILED: 6, // could not spawn / record the app
  STOP_FAILED: 7, // a tracked process could not be stopped
});

/** Absolute path to the pinned OpenCode binary shipped under the app's node_modules. */
export function opencodeBinPath(root) {
  return join(root, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
}

function toolPresent(cmd) {
  try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { return false; }
}

// ---- init: idempotent deps + build + binary verification ----

export function cmdInit(root, deps = {}) {
  const present = deps.toolPresent ?? toolPresent;
  const install = deps.install ?? ((cwd) => execSync('npm install', { cwd, stdio: 'inherit' }));
  const rebuildNative = deps.rebuildNative ??
    ((cwd) => execSync('npm run rebuild:native:electron', { cwd, stdio: 'inherit' }));
  const build = deps.build ?? ((cwd) => execSync('npm run build:app', { cwd, stdio: 'inherit' }));
  const binExists = deps.binExists ?? (() => existsSync(opencodeBinPath(root)));

  log(root, 'init', 'init: preparing Cowork GHC (deps + build)');
  ensureRuntimeDirs(root);
  if (!present('npm --version')) {
    log(root, 'init', 'ERROR: npm not found. Install Node.js LTS from https://nodejs.org');
    return EXIT.MISSING_TOOLCHAIN;
  }
  try { install(root); }
  catch { log(root, 'init', 'ERROR: npm install failed'); return EXIT.BUILD_FAILED; }
  // Native modules (e.g. better-sqlite3) are compiled against the system Node.js ABI by
  // `npm install`, but the packaged/dev app runs under Electron's own ABI — a mismatched
  // build throws NODE_MODULE_VERSION errors at service startup. Always rebuild for Electron
  // right after install so `init` is never followed by a silent native-module crash.
  try { rebuildNative(root); }
  catch { log(root, 'init', 'ERROR: native module rebuild for Electron failed'); return EXIT.BUILD_FAILED; }
  try { build(root); }
  catch { log(root, 'init', 'ERROR: build (renderer + shell + service) failed'); return EXIT.BUILD_FAILED; }
  if (!binExists()) {
    log(root, 'init', `ERROR: pinned OpenCode binary missing at ${opencodeBinPath(root)}`);
    return EXIT.MISSING_BINARY;
  }
  log(root, 'init', 'init: OK (deps installed, app built, OpenCode binary present)');
  return EXIT.OK;
}

// ---- start: launch the Electron app as a tracked child ----

/** Resolve the app executable to launch, preferring a packaged build when present. */
function resolveLaunch(root, deps) {
  const packaged = deps.packagedExe ?? join(root, 'dist-app', 'win-unpacked', 'coworkghc.exe');
  const exists = deps.exists ?? existsSync;
  if (exists(packaged)) return { exe: packaged, args: [], packaged: true };
  const mainJs = join(root, 'app', 'shell', 'dist', 'main.cjs');
  if (!exists(mainJs)) return null; // not built yet
  const electron = deps.electronPath ?? createRequire(import.meta.url)('electron');
  return { exe: electron, args: [mainJs], packaged: false };
}

// Persist the launched app's identity. In production, capture the Win32 CreationDate so `stop`
// can identity-verify before killing; if PowerShell/CIM is unavailable, fall back to a plain
// record stamped with the launch exe path (still stoppable, reported as unverified identity).
function defaultRecordPid(root, pid, exe) {
  try { capturePidRecord(root, { role: 'app-shell', pid }); }
  catch { writePidRecord(root, { role: 'app-shell', pid, startedAt: new Date().toISOString(), exePath: exe }); }
}

export function cmdStart(root, deps = {}) {
  if (!runtimeInitialized(root)) { log(root, 'start', 'NOT INITIALIZED — run init.bat first'); return EXIT.NOT_INITIALIZED; }
  ensureRuntimeDirs(root);
  if (isRunning(root)) { log(root, 'start', 'already running (a tracked app-shell process is live)'); return EXIT.OK; }

  const launch = resolveLaunch(root, deps);
  if (launch === null) {
    log(root, 'start', 'ERROR: app is not built (app/shell/dist/main.cjs missing) — run init.bat first');
    return EXIT.NOT_INITIALIZED;
  }
  const doSpawn = deps.spawn ?? ((exe, args) =>
    spawn(exe, args, {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: withoutElectronRunAsNode(process.env),
    }));
  const recordPid = deps.recordPid ?? defaultRecordPid;

  let child;
  try { child = doSpawn(launch.exe, launch.args); }
  catch (err) { log(root, 'start', `ERROR: failed to launch app: ${err.message} — see .runtime/logs/start.log`); return EXIT.START_FAILED; }
  const pid = child && child.pid;
  if (!Number.isInteger(pid) || pid <= 0) { log(root, 'start', 'ERROR: launched process reported no PID — see .runtime/logs/start.log'); return EXIT.START_FAILED; }
  if (typeof child.unref === 'function') child.unref();

  try { recordPid(root, pid, launch.exe); }
  catch (err) { log(root, 'start', `ERROR: could not record app PID: ${err.message}`); return EXIT.START_FAILED; }

  log(root, 'start', `start: READY (${launch.packaged ? 'packaged' : 'dev'} app pid=${pid}); the app owns the live service + OpenCode child`);
  return EXIT.OK;
}

export function withoutElectronRunAsNode(env) {
  const next = { ...env };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.electron_run_as_node;
  return next;
}

// ---- stop: identity-gated graceful-then-force over the tracked app ----

export function cmdStop(root, deps = {}) {
  const run = deps.stopAll ?? stopAll;
  const result = run(root);
  if (result.mode === 'empty') { log(root, 'stop', 'nothing to stop: no Cowork GHC processes are tracked'); return EXIT.OK; }
  for (const p of result.pruned) log(root, 'stop', `pruned stale pid record: role=${p.role} pid=${p.pid} (identity did not re-match; not killed)`);
  for (const k of result.killed) log(root, 'stop', `stopped: role=${k.record.role} pid=${k.record.pid}`);
  if (result.mode === 'unverifiable') {
    for (const u of result.unverifiable) log(root, 'stop', `WARN: role=${u.role} pid=${u.pid} is live but identity is UNVERIFIABLE (no PowerShell/CIM) — refusing to kill`);
    return result.unverifiable.length ? EXIT.STOP_FAILED : EXIT.OK;
  }
  for (const f of result.failed) log(root, 'stop', `ERROR: could not stop role=${f.record.role} pid=${f.record.pid}: ${f.reason}`);
  return result.failed.length ? EXIT.STOP_FAILED : EXIT.OK;
}

// ---- clean: delegate to the single manifest-allowlist implementation ----

export function cmdClean(root, confirmed, deps = {}) {
  return cleanCommand({
    root,
    confirmed,
    deps: {
      log: (msg) => log(root, 'clean', msg),
      isRunning: deps.isRunning ?? (() => isRunning(root)),
      ...(deps.loadManifest ? { loadManifest: deps.loadManifest } : {}),
      ...(deps.existsAbs ? { existsAbs: deps.existsAbs } : {}),
      ...(deps.existsRel ? { existsRel: deps.existsRel } : {}),
      ...(deps.rm ? { rm: deps.rm } : {}),
    },
  });
}

// ---- status: honest running/stopped ----

export function cmdStatus(root, deps = {}) {
  ensureRuntimeDirs(root);
  const records = (deps.liveRecords ?? liveRecords)(root);
  log(root, 'status', `runtime: ${records.length ? records.length + ' tracked process(es)' : 'not running'}`);
  log(root, 'status', `initialized: ${runtimeInitialized(root) ? 'yes' : 'no'}`);
  return EXIT.OK;
}
