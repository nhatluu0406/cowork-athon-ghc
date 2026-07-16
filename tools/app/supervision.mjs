// Windows process supervision identity (ADR 0004, task CGHC-004).
//
// Zero-dependency ESM (Node builtins only, same style as the rest of the controller).
// Provides the `.runtime/pids/<role>.json` writer/reader, identity capture + re-match
// (PID + startedAt + exePath), and stale-record pruning. It does NOT kill anything and
// does NOT reap orphans: the graceful loopback shutdown, `taskkill /PID /T /F` / Win32
// Job Object, and the Windows orphan reaper are CGHC-005. This module is the identity +
// pid-file seam that CGHC-005 consumes (see `verifyRecord`, `win32ProcessInfo`).
//
// M2 (CGHC-001 review carry-forward): `startedAt` MUST come from Win32_Process
// `CreationDate`, on BOTH capture and re-match, via the SINGLE source `win32ProcessInfo`.
// Never a wall-clock timestamp taken at spawn — if capture and re-match used different
// clocks the strings would never match, so a reused PID could be mis-killed (defeats LC3).
//
// Security: the pid-file carries process identity ONLY. The ADR 0003 / CGHC-002 boundary
// client token is a per-launch secret and is NEVER written here (or to any file) — it is
// passed to the child non-persistently (stdout/env at spawn) and stays out of `.runtime/`.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const PID_SCHEMA_VERSION = 1;
export const ROLES = ['app-shell', 'local-service', 'agent-runtime'];

function pidsDir(root) { return join(root, '.runtime', 'pids'); }

// Single normalization for every `startedAt` value in this module, so a Win32 CreationDate
// (7-digit fractional seconds) and a stored ISO string collapse to the same canonical form
// (millisecond ISO). Capture and re-match both flow through here → deterministic equality.
export function normalizeStartedAt(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid startedAt: ${String(value)}`);
  return d.toISOString();
}

// ---- The SINGLE identity source: Win32_Process CreationDate + ExecutablePath ----

function defaultPwshRunner(script) {
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: 8000 });
}

// Return true when PowerShell/CIM is usable on this host (else identity queries degrade).
export function powershellAvailable(runner = defaultPwshRunner) {
  try { runner("''"); return true; } catch { return false; }
}

// Query the live identity of a PID from Win32_Process. Returns
// `{ pid, startedAt (canonical ISO), exePath }` or `null` when the PID is not live.
// This is the ONE place startedAt/exePath are read for both capture and re-match (M2).
export function win32ProcessInfo(pid, runner = defaultPwshRunner) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid pid: ${String(pid)}`);
  const script =
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; ` +
    `if ($null -eq $p) { '' } else { ` +
    `[pscustomobject]@{ pid = $p.ProcessId; ` +
    `startedAt = $p.CreationDate.ToUniversalTime().ToString('o'); ` +
    `exePath = $p.ExecutablePath } | ConvertTo-Json -Compress }`;
  const text = String(runner(script)).trim();
  if (!text) return null;
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || !Number.isInteger(o.pid)) return null;
  return {
    pid: o.pid,
    startedAt: normalizeStartedAt(o.startedAt),
    exePath: typeof o.exePath === 'string' ? o.exePath : '',
  };
}

// ---- pid-file record: build / parse / write / read ----

// Build a validated pid-file record. `startedAt` + `exePath` must originate from the Win32
// source (see `capturePidRecord`); callers never fabricate them from a wall-clock.
export function buildPidRecord(input) {
  const { role, pid, startedAt, exePath } = input;
  const host = input.host ?? null;
  const port = input.port ?? null;
  const runtimeVersion = input.runtimeVersion ?? null;
  const ppidRole = input.ppidRole ?? null;
  if (!ROLES.includes(role)) throw new Error(`invalid role: ${String(role)}`);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid pid: ${String(pid)}`);
  if (port != null && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
    throw new Error(`invalid port: ${String(port)}`);
  }
  if (host != null && (typeof host !== 'string' || !host.trim())) throw new Error('invalid host');
  if (typeof exePath !== 'string' || !exePath.trim()) throw new Error('exePath must be non-empty');
  if (ppidRole != null && !ROLES.includes(ppidRole)) throw new Error(`invalid ppidRole: ${String(ppidRole)}`);
  return {
    schemaVersion: PID_SCHEMA_VERSION,
    role, pid, ppidRole,
    host, port,
    startedAt: normalizeStartedAt(startedAt),
    exePath,
    runtimeVersion: runtimeVersion == null ? null : String(runtimeVersion),
  };
}

// Parse + validate an untrusted pid-file. TOTAL: never throws, returns `null` on any problem
// (corrupt JSON, wrong shape, unknown role, bad pid/port/startedAt). Used by `readPidRecords`.
export function parsePidRecord(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  if (!ROLES.includes(o.role)) return null;
  if (!Number.isInteger(o.pid) || o.pid <= 0) return null;
  if (typeof o.exePath !== 'string' || !o.exePath.trim()) return null;
  if (typeof o.startedAt !== 'string' || !o.startedAt.trim()) return null;
  if (o.port != null && (!Number.isInteger(o.port) || o.port <= 0 || o.port > 65535)) return null;
  let startedAt;
  try { startedAt = normalizeStartedAt(o.startedAt); } catch { return null; }
  return {
    schemaVersion: Number.isInteger(o.schemaVersion) ? o.schemaVersion : PID_SCHEMA_VERSION,
    role: o.role,
    pid: o.pid,
    ppidRole: ROLES.includes(o.ppidRole) ? o.ppidRole : null,
    host: typeof o.host === 'string' && o.host.trim() ? o.host : null,
    port: o.port == null ? null : o.port,
    startedAt,
    exePath: o.exePath,
    runtimeVersion: typeof o.runtimeVersion === 'string' ? o.runtimeVersion : null,
  };
}

// Write one pid-file (`<role>.json`). One owner per child → one file per role.
export function writePidRecord(root, input) {
  const record = buildPidRecord(input);
  const dir = pidsDir(root);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${record.role}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return { file, record };
}

// Capture identity from the LIVE process via the single Win32 source, then persist it.
// Throws if the pid is not live (we never write an unverifiable identity).
export function capturePidRecord(root, spec, runner = defaultPwshRunner) {
  const info = win32ProcessInfo(spec.pid, runner);
  if (!info) throw new Error(`cannot capture identity: pid ${spec.pid} not live (Win32_Process)`);
  return writePidRecord(root, {
    role: spec.role,
    pid: spec.pid,
    host: spec.host ?? null,
    port: spec.port ?? null,
    runtimeVersion: spec.runtimeVersion ?? null,
    ppidRole: spec.ppidRole ?? null,
    startedAt: info.startedAt,
    exePath: info.exePath,
  });
}

// Read + validate every pid-file. Corrupt/foreign files are skipped, never thrown on.
// Empty or missing dir → `[]` (0 records). Returns `[{ file, record }]`.
export function readPidRecords(root) {
  const dir = pidsDir(root);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    const record = parsePidRecord(text);
    if (record) out.push({ file: f, record });
  }
  return out;
}

// ---- Identity re-match + stale pruning (CGHC-005 reaper seam) ----

// Re-match a live identity against a stored record. PID + startedAt + exePath must ALL
// match, so a reused PID (same number, different creation-time/exePath) is rejected (LC3).
export function identityMatches(record, live) {
  if (!record || !live) return false;
  let a, b;
  try { a = normalizeStartedAt(record.startedAt); b = normalizeStartedAt(live.startedAt); }
  catch { return false; }
  return record.pid === live.pid && a === b && record.exePath === live.exePath;
}

// Classify a stored record against the live OS state:
//   'match' — the live process is ours (safe for CGHC-005 to act on)
//   'stale' — PID dead, or PID reused by an unrelated process → prune, do NOT touch it
export function verifyRecord(record, runner = defaultPwshRunner) {
  const live = win32ProcessInfo(record.pid, runner);
  if (!live) return 'stale';
  return identityMatches(record, live) ? 'match' : 'stale';
}

// Prune stale pid-files and return the live (identity-verified-ours) records.
// "Nothing running" is a valid, non-error result (`{ live: [], pruned: [] }`).
// `verifier(record) -> 'match' | 'stale'` is injectable for tests / to avoid PowerShell.
export function pruneStaleRecords(root, verifier) {
  const verify = verifier ?? ((rec) => verifyRecord(rec));
  const live = [], pruned = [];
  for (const { file, record } of readPidRecords(root)) {
    if (verify(record) === 'match') { live.push(record); continue; }
    try { rmSync(join(pidsDir(root), file), { force: true }); } catch { /* already gone */ }
    pruned.push(record);
  }
  return { live, pruned };
}
