// Windows lifecycle backend (init/start/stop/clean/status) called by scripts/*.bat.
// The .bat files are thin entry points; all real logic lives here and is testable.
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readPidRecords, verifyRecord, powershellAvailable } from './supervision.mjs';
import { stopAll } from './reaper.mjs';
import { cleanCommand, normRel, assessCleanTarget, resolveCleanTargets } from './clean.mjs';

// The clean allowlist logic lives in clean.mjs (single source of truth, CGHC-023). These are
// re-exported so the existing lifecycle unit tests keep importing them from here unchanged.
export { normRel, assessCleanTarget, resolveCleanTargets };

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(HERE, '..', '..');

const RUNTIME_DIRS = ['pids', 'logs', 'state', 'temp'];

// ---- Pure, testable helpers ----

export function parsePidFile(text) {
  try {
    const o = JSON.parse(text);
    return typeof o === 'object' && o ? o : null;
  } catch { return null; }
}

// ---- IO helpers ----

function log(root, name, msg) {
  const dir = join(root, '.runtime', 'logs');
  mkdirSync(dir, { recursive: true });
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendFileSync(join(dir, `${name}.log`), line, 'utf8');
  process.stdout.write(msg + '\n');
}

function toolPresent(cmd) {
  try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { return false; }
}

function ensureRuntimeDirs(root) {
  for (const d of RUNTIME_DIRS) mkdirSync(join(root, '.runtime', d), { recursive: true });
}

// Identity-verified live processes (ADR 0004 / CGHC-004), NON-MUTATING — a read/status query
// must never delete files. "Nothing running" is a valid 0 and never spawns PowerShell. When
// records exist, classify each by Win32 CreationDate identity (no rmSync here); if PowerShell/
// CIM is unavailable, fall back to the raw tracked records (reported as unverified). The
// deliberate stale-file pruning happens only on the explicit `stop` action (cmdStop).
function liveRecords(root) {
  const records = readPidRecords(root).map((r) => r.record);
  if (records.length === 0) return [];
  if (!powershellAvailable()) return records;
  return records.filter((rec) => verifyRecord(rec) === 'match');
}

// ---- Commands ----

// Idempotent bootstrap. Creates the `.runtime/` subdirs (mkdir -p is a clean no-op on
// repeat), never requires admin, never downloads unverified binaries. The `present`/`install`
// seams are injectable so the exit-code contract (0 on repeat; 2 when the toolchain is
// missing) is unit-testable without a real npm on PATH and without running npm install.
// Re-running is a no-op: ensureRuntimeDirs is recursive-safe and no state is overwritten.
export function cmdInit(root, deps = {}) {
  const present = deps.toolPresent ?? toolPresent;
  const install = deps.install ?? ((cwd) => execSync('npm install', { cwd, stdio: 'inherit' }));
  log(root, 'init', 'init: preparing local environment for Cowork GHC');
  ensureRuntimeDirs(root);
  const tools = { node: true, npm: present('npm --version'), git: present('git --version') };
  log(root, 'init', `toolchain: node=${tools.node} npm=${tools.npm} git=${tools.git}`);
  if (!tools.npm) { log(root, 'init', 'ERROR: npm not found. Install Node.js from https://nodejs.org'); return 2; }
  if (existsSync(join(root, 'package.json'))) {
    log(root, 'init', 'package.json found — running npm install');
    try { install(root); }
    catch { log(root, 'init', 'ERROR: npm install failed'); return 2; }
  } else {
    log(root, 'init', 'no package.json yet — app toolchain is chosen in L3; nothing to install now');
  }
  log(root, 'init', 'init: OK (environment prepared to current scope)');
  return 0;
}

export function cmdStart(root) {
  if (!existsSync(join(root, '.runtime'))) { log(root, 'start', 'NOT INITIALIZED — run init.bat first'); return 3; }
  log(root, 'start', 'NOT_READY: Cowork GHC runtime is not implemented yet (L0 scaffold only).');
  log(root, 'start', 'The application/runtime is defined and built in later loops (L3+).');
  log(root, 'start', 'Run: node tools/loop-engineer/cli.mjs status  — to see project progress.');
  return 3; // honest not-ready, not a fake success
}

// Graceful-then-force stop + Windows orphan reaper (ADR 0004 / CGHC-005). `deps` is the
// injection seam for tests (stopAll/log); production calls pass nothing. Every kill is
// identity-gated inside the reaper (verifyRecord === 'match'); a stale/reused PID is pruned,
// never killed; killing by image name is never attempted. Honest exit codes: 0 when every
// tracked process is handled (killed or pruned) or nothing was running; 5 when a tracked
// process remains that we could neither identity-verify-and-kill nor prove dead.
export function cmdStop(root, deps = {}) {
  const run = deps.stopAll ?? stopAll;
  const result = run(root);
  if (result.mode === 'empty') {
    log(root, 'stop', 'nothing to stop: no Cowork GHC processes are tracked');
    return 0;
  }
  for (const p of result.pruned) log(root, 'stop', `pruned stale pid record: role=${p.role} pid=${p.pid} (identity did not re-match; not killed)`);
  for (const k of result.killed) log(root, 'stop', `stopped: role=${k.record.role} pid=${k.record.pid} via ${k.command.command} ${k.command.args.join(' ')}`);
  if (result.mode === 'unverifiable') {
    for (const u of result.unverifiable) log(root, 'stop', `WARN: role=${u.role} pid=${u.pid} is live but identity is UNVERIFIABLE (no PowerShell/CIM) — refusing to kill (never by image name)`);
    return result.unverifiable.length ? 5 : 0;
  }
  for (const f of result.failed) log(root, 'stop', `ERROR: could not stop role=${f.record.role} pid=${f.record.pid}: ${f.reason}`);
  return result.failed.length ? 5 : 0;
}

// Delegates to the single clean implementation (clean.mjs). All allowlist / preserve /
// root-certainty / unsafe-entry / running / symlink-escape decisions live there; this only
// supplies the IO seams (log + identity-verified running check) and returns its exit code.
function cmdClean(root, confirmed) {
  return cleanCommand({
    root,
    confirmed,
    deps: {
      log: (msg) => log(root, 'clean', msg),
      isRunning: () => running(root),
    },
  });
}

function running(root) { return liveRecords(root).length > 0; }

function cmdStatus(root) {
  ensureRuntimeDirs(root);
  const pids = liveRecords(root); // non-mutating: status never deletes pid-files
  log(root, 'status', `runtime: ${pids.length ? pids.length + ' tracked process(es)' : 'not running'}`);
  log(root, 'status', `initialized: ${existsSync(join(root, '.runtime')) ? 'yes' : 'no'}`);
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const rootArg = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : null;
  const root = rootArg ? resolve(rootArg) : DEFAULT_ROOT;
  const confirmed = argv.includes('--yes');
  switch (cmd) {
    case 'init': return cmdInit(root);
    case 'start': return cmdStart(root);
    case 'stop': return cmdStop(root);
    case 'clean': return cmdClean(root, confirmed);
    case 'status': return cmdStatus(root);
    default:
      process.stdout.write('usage: lifecycle.mjs <init|start|stop|clean|status> [--root <path>] [--yes]\n');
      return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('lifecycle.mjs')) {
  process.exit(main());
}

export default { main, normRel, assessCleanTarget, resolveCleanTargets, parsePidFile, DEFAULT_ROOT };
