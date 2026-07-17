// Tests for the Windows orphan reaper + graceful-then-force stop (CGHC-005, ADR 0004, LC3).
// Zero-dependency: node:test + builtins. The Win32 verifier and taskkill are injected so the
// start/stop orchestration is deterministic without real PowerShell/taskkill; one guarded
// test reaps a REAL spawned child via real `taskkill /PID /T /F` when PowerShell is available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writePidRecord, capturePidRecord, verifyRecord, powershellAvailable } from '../supervision.mjs';
import {
  taskkillTreeArgs, killProcessTree, orderLeafFirst, pidAlive,
  reapRecords, reapUnverifiable, stopAll, requestGracefulShutdown,
} from '../reaper.mjs';
import { main as lifecycleMain } from '../lifecycle.mjs';

const tmpRoot = () => mkdtempSync(join(tmpdir(), 'cghc-reap-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pidFile = (root, role) => join(root, '.runtime', 'pids', `${role}.json`);

// The force-kill argv targets the process TREE by PID only. There is no /IM (image name)
// path — killing unrelated node.exe/opencode.exe by image is forbidden (LC3).
test('taskkillTreeArgs targets the tree by PID only — never /IM', () => {
  assert.deepEqual(taskkillTreeArgs(4242), ['/PID', '4242', '/T', '/F']);
  assert.ok(!taskkillTreeArgs(4242).includes('/IM'));
  assert.throws(() => taskkillTreeArgs(0));
  assert.throws(() => taskkillTreeArgs(-1));
  assert.throws(() => taskkillTreeArgs('node.exe'));
});

test('orderLeafFirst stops leaf-first: agent-runtime, then local-service, then app-shell', () => {
  const recs = [
    { file: 'app-shell.json', record: { role: 'app-shell', pid: 1 } },
    { file: 'agent-runtime.json', record: { role: 'agent-runtime', pid: 3 } },
    { file: 'local-service.json', record: { role: 'local-service', pid: 2 } },
  ];
  assert.deepEqual(orderLeafFirst(recs).map((r) => r.record.role),
    ['agent-runtime', 'local-service', 'app-shell']);
});

// START/STOP ORCHESTRATION LOGIC: the reaper kills ONLY identity-verified-ours records, via
// taskkill /PID <pid> /T /F (never /IM), gated on verify(...) === 'match'. The verifier and
// killer are injected so no real taskkill runs. A stale/reused-PID record is pruned, not killed.
test('reapRecords force-kills only identity-verified records (taskkill /PID /T /F), prunes stale, never /IM', () => {
  const root = tmpRoot();
  try {
    writePidRecord(root, { role: 'local-service', pid: 4242, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    writePidRecord(root, { role: 'agent-runtime', pid: 777, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });

    const alive = new Set([4242]);                 // 777 is a dead/reused (stale) PID
    const verify = (rec) => (alive.has(rec.pid) ? 'match' : 'stale');
    const killedArgs = [];
    // Inject the low-level exec so the REAL taskkillTreeArgs argv is captured; killing marks
    // the pid dead so the reaper's post-kill re-verify observes 'stale' (kill succeeded).
    const kill = (pid) => killProcessTree(pid, (args) => { killedArgs.push(args); alive.delete(pid); });

    const { killed, pruned, failed } = reapRecords(root, { verify, kill });

    assert.equal(failed.length, 0);
    assert.equal(killed.length, 1, 'exactly the one identity-matched record is killed');
    assert.equal(killed[0].record.pid, 4242);
    assert.deepEqual(killed[0].command.args, ['/PID', '4242', '/T', '/F']);
    // The reaper NEVER kills the stale/reused PID and NEVER emits an /IM image kill.
    assert.equal(killedArgs.length, 1);
    assert.deepEqual(killedArgs, [['/PID', '4242', '/T', '/F']]);
    for (const a of killedArgs) assert.ok(!a.includes('/IM') && !a.some((x) => /node\.exe/i.test(x)));
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0].pid, 777);
    // Both files removed: stale pruned, killed-then-pruned.
    assert.ok(!existsSync(pidFile(root, 'agent-runtime')));
    assert.ok(!existsSync(pidFile(root, 'local-service')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Graceful path: if the loopback shutdown seam reports the process exited cooperatively, the
// reaper prunes WITHOUT ever calling taskkill.
test('reapRecords honors a graceful shutdown that exits the process (no force-kill)', () => {
  const root = tmpRoot();
  try {
    writePidRecord(root, { role: 'agent-runtime', pid: 5555, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    const alive = new Set([5555]);
    const verify = (rec) => (alive.has(rec.pid) ? 'match' : 'stale');
    const requestShutdown = (rec) => { alive.delete(rec.pid); return { requested: true, exited: true, reason: 'graceful' }; };
    let killCalls = 0;
    const kill = () => { killCalls += 1; return { command: 'taskkill', args: [] }; };
    const { killed, pruned, failed } = reapRecords(root, { verify, requestShutdown, kill });
    assert.equal(killCalls, 0, 'graceful exit must not force-kill');
    assert.equal(killed.length, 0);
    assert.equal(pruned.length, 1);
    assert.equal(failed.length, 0);
    assert.ok(!existsSync(pidFile(root, 'agent-runtime')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A process that survives taskkill is reported as failed — the reaper NEVER escalates to an
// image-name kill.
test('reapRecords reports a survivor as failed and never escalates to an image-name kill', () => {
  const root = tmpRoot();
  try {
    writePidRecord(root, { role: 'local-service', pid: 9001, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    const verify = () => 'match';                         // stays alive even after "kill"
    const kill = (pid) => killProcessTree(pid, () => { /* pretend taskkill had no effect */ });
    const { killed, pruned, failed } = reapRecords(root, { verify, kill });
    assert.equal(killed.length, 0);
    assert.equal(pruned.length, 0);
    assert.equal(failed.length, 1);
    assert.match(failed[0].reason, /still alive after taskkill/);
    assert.ok(existsSync(pidFile(root, 'local-service')), 'a survivor record is kept, not silently pruned');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// NEGATIVE / no-CIM fallback: identity is unverifiable, so NEVER kill (never by image name).
// Prune only provably-dead PIDs; keep a live-but-unverifiable record and report it.
test('reapUnverifiable prunes provably-dead records but refuses to kill live-unverifiable ones', () => {
  const root = tmpRoot();
  try {
    writePidRecord(root, { role: 'local-service', pid: 4242, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    writePidRecord(root, { role: 'agent-runtime', pid: 777, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    const { killed, pruned, unverifiable } = reapUnverifiable(root, { alive: (pid) => pid === 4242 });
    assert.equal(killed.length, 0, 'no identity => never kills');
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0].pid, 777);
    assert.equal(unverifiable.length, 1);
    assert.equal(unverifiable[0].pid, 4242);
    assert.ok(existsSync(pidFile(root, 'local-service')), 'live-unverifiable record kept');
    assert.ok(!existsSync(pidFile(root, 'agent-runtime')), 'dead record pruned');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pidAlive: EPERM counts as alive, ESRCH (dead) as not alive', () => {
  assert.equal(pidAlive(1, () => { throw Object.assign(new Error('perm'), { code: 'EPERM' }); }), true);
  assert.equal(pidAlive(1, () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); }), false);
  assert.equal(pidAlive(1, () => { /* exists */ }), true);
});

test('stopAll: empty runtime is a valid no-op; routes to reaper (CIM) vs refuse-to-kill (no CIM)', () => {
  const root = tmpRoot();
  try {
    assert.equal(stopAll(root, { records: [], powershellAvailable: () => true }).mode, 'empty');
    writePidRecord(root, { role: 'agent-runtime', pid: 777, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    // No CIM → refuse-to-kill fallback path.
    const noCim = stopAll(root, { powershellAvailable: () => false, alive: () => false });
    assert.equal(noCim.mode, 'unverifiable');
    assert.equal(noCim.killed.length, 0);
    assert.equal(noCim.pruned.length, 1);
    // CIM present → identity-gated reaper path (inject verify+kill so no real taskkill).
    writePidRecord(root, { role: 'agent-runtime', pid: 4242, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    const alive = new Set([4242]);
    const verified = stopAll(root, {
      powershellAvailable: () => true,
      verify: (rec) => (alive.has(rec.pid) ? 'match' : 'stale'),
      kill: (pid) => killProcessTree(pid, () => alive.delete(pid)),
    });
    assert.equal(verified.mode, 'verified');
    assert.equal(verified.killed.length, 1);
    assert.equal(verified.killed[0].record.pid, 4242);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('lifecycle stop on an empty runtime is a valid 0 (nothing running)', () => {
  const root = tmpRoot();
  try {
    assert.equal(lifecycleMain(['stop', '--root', root]), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('requestGracefulShutdown is an honest no-op stub until the local service exists (CGHC-006 seam)', () => {
  const g = requestGracefulShutdown({ role: 'local-service', pid: 1, port: 51763 });
  assert.equal(g.requested, false);
  assert.equal(g.exited, false);
  assert.match(g.reason, /CGHC-006/);
});

// REAL spawned child, only where PowerShell/CIM is usable. Captures identity, verifies it is
// ours, reaps it with REAL `taskkill /PID <pid> /T /F`, and confirms it is gone + pruned.
// This kills only OUR OWN spawned test child, never by image name. Guarded (skips) elsewhere.
test('real spawned child: capture, identity-verify, reap via real taskkill /PID /T /F, confirm gone', { skip: !powershellAvailable() }, async () => {
  const root = tmpRoot();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
  try {
    await sleep(500); // let CIM see the process
    const { record } = capturePidRecord(root, { role: 'agent-runtime', pid: child.pid, port: 51901, host: '127.0.0.1', runtimeVersion: 'v1.18.1' });
    assert.equal(verifyRecord(record), 'match', 'the live child must identity-match its captured record');

    const { killed, pruned, failed } = reapRecords(root); // real verify + real taskkill
    assert.equal(failed.length, 0, 'reap should not fail on our own child');
    assert.equal(pruned.length, 0);
    assert.equal(killed.length, 1);
    assert.equal(killed[0].record.pid, child.pid);
    assert.deepEqual(killed[0].command.args, ['/PID', String(child.pid), '/T', '/F']);

    await sleep(500); // let the OS reap it
    assert.equal(verifyRecord(record), 'stale', 'the child must be gone after taskkill /T /F');
    assert.ok(!existsSync(pidFile(root, 'agent-runtime')), 'the pid-file is pruned after a confirmed kill');
  } finally {
    try { child.kill(); } catch { /* already dead */ }
    rmSync(root, { recursive: true, force: true });
  }
});
