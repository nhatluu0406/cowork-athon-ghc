// Windows orphan reaper + graceful-then-force stop (ADR 0004 / CGHC-005, LC3, VS-02).
//
// The reference orphan sweep (`runtime.mjs` `cleanupPackagedSidecars`) is Unix-only —
// it shells out to `spawnSync("ps", …)` with no Windows branch — so it cannot be reused.
// This is the WINDOWS reaper: it acts ONLY on processes whose stored pid-file identity
// re-matches the LIVE Win32 identity (`verifyRecord(record) === 'match'`, from
// supervision.mjs). A 'stale'/reused-PID record is pruned, NEVER killed. Force-kill is
// `taskkill /PID <pid> /T /F` (whole tree) — never `/IM <image>` (that would kill
// unrelated node.exe/opencode.exe processes; forbidden by LC3).
//
// Zero-dependency ESM (Node builtins only), same style as the rest of the controller.
// The graceful loopback shutdown request is an injectable seam; today it is a documented
// no-op stub because the local service is not started yet (CGHC-006 wires the real one).

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPidRecords, verifyRecord, powershellAvailable, ROLES } from './supervision.mjs';

// ---- Force-kill construction (identity-gated by the caller; NEVER by image name) ----

// Build the taskkill arguments for a process TREE. `/T` kills descendants, `/F` forces.
// It is `/PID <pid>` ONLY — there is intentionally no code path that emits `/IM <image>`.
export function taskkillTreeArgs(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid pid for taskkill: ${String(pid)}`);
  return ['/PID', String(pid), '/T', '/F'];
}

function defaultTaskkill(args) {
  execFileSync('taskkill', args, { windowsHide: true, timeout: 15000, stdio: 'ignore' });
}

// Force-kill one identity-verified process tree. `exec(args)` is injectable so unit tests
// assert the exact argv without invoking real taskkill. Returns the command that was run.
export function killProcessTree(pid, exec = defaultTaskkill) {
  const args = taskkillTreeArgs(pid);
  exec(args);
  return { command: 'taskkill', args };
}

// ---- Graceful loopback shutdown seam (stub now; real HTTP is CGHC-006) ----

// Ask a process to shut down cooperatively over its recorded loopback port. SIGTERM is NOT
// used as a graceful mechanism on Windows (not catchable there — ADR 0004 DR1/DR2). Today
// the local service is not started, so this is an honest no-op: it requests nothing and
// reports the child did not exit, so the reaper proceeds to the identity-gated force-kill.
// Returns `{ requested, exited, reason }`. CGHC-006 replaces the body with a bounded
// loopback HTTP shutdown + liveness poll; the reaper contract stays identical.
export function requestGracefulShutdown(record) {
  return { requested: false, exited: false, reason: 'local-service not started (CGHC-006 seam)' };
}

// ---- Liveness probe (no-CIM fallback ONLY; identity is NOT verifiable here) ----

// True when a PID currently exists. `process.kill(pid, 0)` sends no signal; it throws
// ESRCH when the PID is dead and EPERM when it exists but we lack rights (=> alive).
// This proves liveness, NOT identity — so it is used only to prune provably-dead records,
// never to authorize a kill.
export function pidAlive(pid, probe = (p) => process.kill(p, 0)) {
  try { probe(pid); return true; }
  catch (e) { return e && e.code === 'EPERM'; }
}

// ---- Ordering + pruning helpers ----

function pruneFile(root, file) {
  try { rmSync(join(root, '.runtime', 'pids', file), { force: true }); return true; }
  catch { return false; } // already gone — non-error
}

// Identity check that can never throw the reap loop apart. A `verify` failure (e.g. a transient
// PowerShell/CIM error mid-run) is treated as 'error' → we NEVER kill on it (safe direction):
// the caller reports it as failed/unverifiable and returns a non-zero exit, rather than aborting
// the whole stop on an uncaught exception or, worse, killing an unverified PID.
function safeVerify(verify, record) {
  try { return verify(record); } catch { return 'error'; }
}

// Leaf-first stop order (agent-runtime → local-service → app-shell) so a child is asked to
// stop before the parent that supervises it (ADR 0004 graceful-then-force ordering).
export function orderLeafFirst(records) {
  const rank = (role) => ROLES.indexOf(role); // app-shell=0 … agent-runtime=2; unknown=-1 (last)
  return [...records].sort((a, b) => rank(b.record.role) - rank(a.record.role));
}

// ---- The reaper: identity-gated graceful-then-force over identity-verified records ----

// For each tracked pid-file, leaf-first:
//   verify(record) !== 'match'  → STALE/reused PID → prune the file, NEVER kill.
//   verify(record) === 'match'  → it is ours → request graceful shutdown; if it exited,
//                                 prune; else force-kill the tree (taskkill /PID /T /F),
//                                 re-verify it is gone, then prune. If it survives, report
//                                 a failure (never escalate to an image-name kill).
// Every kill is gated on a fresh `verify(...) === 'match'`. Seams (`verify`, `kill`,
// `requestShutdown`, `records`) are injectable so the orchestration is unit-tested without
// real PowerShell/taskkill. Returns `{ killed, pruned, failed }`.
export function reapRecords(root, opts = {}) {
  const {
    records = readPidRecords(root),
    verify = (rec) => verifyRecord(rec),
    requestShutdown = requestGracefulShutdown,
    kill = killProcessTree,
    onEvent = () => {},
  } = opts;

  const killed = [], pruned = [], failed = [];
  for (const { file, record } of orderLeafFirst(records)) {
    const entry = safeVerify(verify, record);
    if (entry === 'error') { failed.push({ record, reason: 'identity unverifiable (verify threw)' }); onEvent({ kind: 'unverifiable', record }); continue; }
    if (entry !== 'match') {
      pruneFile(root, file); pruned.push(record);
      onEvent({ kind: 'pruned', record }); continue;
    }
    let grace;
    try { grace = requestShutdown(record); }
    catch (e) { grace = { requested: false, exited: false, reason: e && e.message }; }
    onEvent({ kind: 'graceful', record, grace });
    if (grace && grace.exited && safeVerify(verify, record) !== 'match') {
      pruneFile(root, file); pruned.push(record);
      onEvent({ kind: 'exited-gracefully', record }); continue;
    }
    // FRESH identity gate taken AFTER the graceful wait, immediately before the force-kill
    // (MEDIUM fix, CGHC-005 review): once CGHC-006 makes requestShutdown a real time-consuming
    // loopback poll, our PID could be reused during the wait — never force-kill without a
    // re-match taken here. 'error'/non-'match' → do NOT kill (report / prune), never mis-kill.
    const preKill = safeVerify(verify, record);
    if (preKill === 'error') { failed.push({ record, reason: 'identity unverifiable before force-kill' }); onEvent({ kind: 'unverifiable', record }); continue; }
    if (preKill !== 'match') { pruneFile(root, file); pruned.push(record); onEvent({ kind: 'stale-after-grace', record }); continue; }
    // Still identity-verified ours and alive → force-kill the tree (freshly gated above).
    try {
      const command = kill(record.pid);
      if (safeVerify(verify, record) === 'match') {
        failed.push({ record, reason: 'process still alive after taskkill /T /F' });
        onEvent({ kind: 'kill-failed', record }); continue;
      }
      pruneFile(root, file); killed.push({ record, command });
      onEvent({ kind: 'killed', record, command });
    } catch (e) {
      failed.push({ record, reason: (e && e.message) || 'kill error' });
      onEvent({ kind: 'kill-error', record, reason: (e && e.message) || 'kill error' });
    }
  }
  return { killed, pruned, failed };
}

// ---- No-CIM fallback: refuse to kill (never by image name); prune only provably-dead ----

// When PowerShell/CIM is unavailable, identity CANNOT be re-verified, so we NEVER kill
// (killing by image name is forbidden). We only prune records whose PID is provably dead;
// a live-but-unverifiable record is left in place and reported. Returns
// `{ killed: [], pruned, unverifiable }`.
export function reapUnverifiable(root, opts = {}) {
  const { records = readPidRecords(root), alive = pidAlive } = opts;
  const pruned = [], unverifiable = [];
  for (const { file, record } of records) {
    if (!alive(record.pid)) { pruneFile(root, file); pruned.push(record); }
    else unverifiable.push(record);
  }
  return { killed: [], pruned, unverifiable };
}

// Convenience used by lifecycle `cmdStop`: pick the identity-gated reaper when CIM is
// available, else the refuse-to-kill fallback. `psAvailable` is injectable for tests.
export function stopAll(root, opts = {}) {
  const psAvailable = opts.powershellAvailable ?? powershellAvailable;
  const records = opts.records ?? readPidRecords(root);
  if (records.length === 0) return { mode: 'empty', killed: [], pruned: [], failed: [], unverifiable: [] };
  if (!psAvailable()) return { mode: 'unverifiable', failed: [], ...reapUnverifiable(root, { ...opts, records }) };
  return { mode: 'verified', unverifiable: [], ...reapRecords(root, { ...opts, records }) };
}
