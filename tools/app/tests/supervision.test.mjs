// Tests for the Windows process supervision identity module (CGHC-004, ADR 0004).
// Zero-dependency: node:test + builtins. The Win32/PowerShell source is injected via the
// `runner`/`verifier` seams so the parse + identity logic is deterministic without CIM;
// one guarded test exercises a REAL spawned child when PowerShell is available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  normalizeStartedAt, win32ProcessInfo, powershellAvailable,
  buildPidRecord, parsePidRecord, writePidRecord, capturePidRecord,
  readPidRecords, identityMatches, verifyRecord, pruneStaleRecords, ROLES,
} from '../supervision.mjs';

function tmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'cghc-sup-'));
  return root;
}

// A Win32 CreationDate (`.ToString('o')`, 7-digit fractional) and its millisecond
// truncation must collapse to the same canonical instant, so capture == re-match.
test('normalizeStartedAt collapses Win32 7-digit fractional to canonical ms ISO', () => {
  const a = normalizeStartedAt('2026-07-11T04:00:00.1234567Z');
  const b = normalizeStartedAt('2026-07-11T04:00:00.123Z');
  assert.equal(a, b);
  assert.equal(a, '2026-07-11T04:00:00.123Z');
  assert.equal(normalizeStartedAt(new Date('2026-07-11T04:00:00Z')), '2026-07-11T04:00:00.000Z');
  assert.throws(() => normalizeStartedAt('not-a-date'));
});

test('buildPidRecord validates role/pid/port/exePath and carries the full schema', () => {
  const rec = buildPidRecord({
    role: 'local-service', pid: 4242, host: '127.0.0.1', port: 51789,
    startedAt: '2026-07-11T04:00:00.1234567Z', exePath: 'C:\\Program Files\\nodejs\\node.exe',
    runtimeVersion: 'v1.18.1',
  });
  assert.equal(rec.role, 'local-service');
  assert.equal(rec.startedAt, '2026-07-11T04:00:00.123Z');
  assert.equal(rec.port, 51789);
  assert.equal(rec.runtimeVersion, 'v1.18.1');
  assert.throws(() => buildPidRecord({ role: 'nope', pid: 1, startedAt: '2026-01-01T00:00:00Z', exePath: 'x' }));
  assert.throws(() => buildPidRecord({ role: 'local-service', pid: 0, startedAt: '2026-01-01T00:00:00Z', exePath: 'x' }));
  assert.throws(() => buildPidRecord({ role: 'local-service', pid: 5, port: 99999, startedAt: '2026-01-01T00:00:00Z', exePath: 'x' }));
  assert.throws(() => buildPidRecord({ role: 'local-service', pid: 5, startedAt: '2026-01-01T00:00:00Z', exePath: '   ' }));
});

// PID state parsing: total function, never throws, returns null on any problem.
test('parsePidRecord rejects corrupt/foreign records without throwing', () => {
  assert.equal(parsePidRecord('{ not json'), null);
  assert.equal(parsePidRecord('[]'), null);
  assert.equal(parsePidRecord(JSON.stringify({ role: 'ghost', pid: 5, startedAt: 'x', exePath: 'y' })), null);
  assert.equal(parsePidRecord(JSON.stringify({ role: 'local-service', pid: -1, startedAt: '2026-01-01T00:00:00Z', exePath: 'y' })), null);
  assert.equal(parsePidRecord(JSON.stringify({ role: 'local-service', pid: 5, startedAt: '2026-01-01T00:00:00Z', exePath: '' })), null);
  const ok = parsePidRecord(JSON.stringify({ role: 'agent-runtime', pid: 7, startedAt: '2026-07-11T04:00:00.1234567Z', exePath: 'C:\\x\\node.exe', port: 8, host: '::1' }));
  assert.ok(ok);
  assert.equal(ok.pid, 7);
  assert.equal(ok.startedAt, '2026-07-11T04:00:00.123Z');
});

test('readPidRecords: missing dir and empty dir both yield 0 records; corrupt files skipped', () => {
  const root = tmpRoot();
  try {
    assert.deepEqual(readPidRecords(root), []); // missing .runtime/pids
    const dir = join(root, '.runtime', 'pids');
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(readPidRecords(root), []); // empty
    writeFileSync(join(dir, 'corrupt.json'), '{ broken', 'utf8');
    writeFileSync(join(dir, 'not-json.txt'), 'ignored', 'utf8');
    writePidRecord(root, { role: 'app-shell', pid: 11, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    const recs = readPidRecords(root);
    assert.equal(recs.length, 1); // corrupt + non-json skipped, the valid one kept
    assert.equal(recs[0].record.role, 'app-shell');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Identity re-match: PID + startedAt + exePath must ALL match → a reused PID is rejected (LC3).
test('identityMatches rejects a reused PID (same number, different start-time/exePath)', () => {
  const record = { pid: 4242, startedAt: '2026-07-11T04:00:00.123Z', exePath: 'C:\\a\\node.exe' };
  assert.equal(identityMatches(record, { pid: 4242, startedAt: '2026-07-11T04:00:00.1234567Z', exePath: 'C:\\a\\node.exe' }), true);
  assert.equal(identityMatches(record, { pid: 4242, startedAt: '2026-07-11T05:59:59.000Z', exePath: 'C:\\a\\node.exe' }), false); // PID reused, newer start
  assert.equal(identityMatches(record, { pid: 4242, startedAt: '2026-07-11T04:00:00.123Z', exePath: 'C:\\evil\\node.exe' }), false); // different exe
  assert.equal(identityMatches(record, { pid: 9, startedAt: '2026-07-11T04:00:00.123Z', exePath: 'C:\\a\\node.exe' }), false);
  assert.equal(identityMatches(null, record), false);
});

test('win32ProcessInfo parses the injected CIM JSON; empty output => not live (null)', () => {
  const runner = (script) => script.includes('ProcessId=4242')
    ? JSON.stringify({ pid: 4242, startedAt: '2026-07-11T04:00:00.1234567Z', exePath: 'C:\\a\\node.exe' })
    : '';
  const info = win32ProcessInfo(4242, runner);
  assert.equal(info.pid, 4242);
  assert.equal(info.startedAt, '2026-07-11T04:00:00.123Z');
  assert.equal(info.exePath, 'C:\\a\\node.exe');
  assert.equal(win32ProcessInfo(9999, runner), null);
  assert.throws(() => win32ProcessInfo(0, runner));
});

test('verifyRecord classifies match vs stale via the injected runner', () => {
  const record = buildPidRecord({ role: 'local-service', pid: 4242, startedAt: '2026-07-11T04:00:00.1234567Z', exePath: 'C:\\a\\node.exe' });
  const liveRunner = () => JSON.stringify({ pid: 4242, startedAt: '2026-07-11T04:00:00.1234567Z', exePath: 'C:\\a\\node.exe' });
  const reusedRunner = () => JSON.stringify({ pid: 4242, startedAt: '2026-07-11T09:00:00.0000000Z', exePath: 'C:\\other\\thing.exe' });
  const deadRunner = () => '';
  assert.equal(verifyRecord(record, liveRunner), 'match');
  assert.equal(verifyRecord(record, reusedRunner), 'stale'); // PID reused by an unrelated process
  assert.equal(verifyRecord(record, deadRunner), 'stale');   // PID no longer live
});

test('pruneStaleRecords keeps live, deletes stale files, and nothing-running is a valid 0', () => {
  const root = tmpRoot();
  try {
    assert.deepEqual(pruneStaleRecords(root, () => 'match'), { live: [], pruned: [] }); // empty
    writePidRecord(root, { role: 'local-service', pid: 4242, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    writePidRecord(root, { role: 'agent-runtime', pid: 777, startedAt: '2026-07-11T04:00:00Z', exePath: 'C:\\a\\node.exe' });
    const verifier = (rec) => (rec.pid === 4242 ? 'match' : 'stale');
    const { live, pruned } = pruneStaleRecords(root, verifier);
    assert.equal(live.length, 1);
    assert.equal(live[0].pid, 4242);
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0].pid, 777);
    assert.ok(existsSync(join(root, '.runtime', 'pids', 'local-service.json')));
    assert.ok(!existsSync(join(root, '.runtime', 'pids', 'agent-runtime.json'))); // stale file removed
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Real spawned child, only where PowerShell/CIM is usable. Proves capture + re-match against
// the live Win32 identity, and that a dead PID classifies stale. Guarded (skips) elsewhere.
test('real spawned child: capture identity, verify match, then stale after exit', { skip: !powershellAvailable() }, async () => {
  const root = tmpRoot();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true });
  try {
    await new Promise((r) => setTimeout(r, 400)); // let CIM see the process
    const info = win32ProcessInfo(child.pid);
    assert.ok(info, 'expected a live Win32_Process record for the spawned child');
    assert.ok(/node\.exe$/i.test(info.exePath), `exePath should be node.exe, got ${info.exePath}`);
    assert.doesNotThrow(() => normalizeStartedAt(info.startedAt));
    const { record } = capturePidRecord(root, { role: 'agent-runtime', pid: child.pid, port: 51900, host: '127.0.0.1', runtimeVersion: 'v1.18.1' });
    assert.equal(record.pid, child.pid);
    assert.equal(verifyRecord(record), 'match');
    child.kill();
    await new Promise((r) => setTimeout(r, 600)); // let the OS reap it
    assert.equal(verifyRecord(record), 'stale'); // dead PID => stale, never mis-matched
  } finally {
    try { child.kill(); } catch { /* already dead */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test('ROLES is the fixed one-owner-per-child set', () => {
  assert.deepEqual(ROLES, ['app-shell', 'local-service', 'agent-runtime']);
});
