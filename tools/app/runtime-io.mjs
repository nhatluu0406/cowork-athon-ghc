// Shared runtime IO helpers for the APP lifecycle CLI (CGHC-028 Wave B2b).
//
// Distinct from the loop-engineer controller: this drives the ACTUAL packaged/dev app. It reuses
// the SAME `.runtime/` conventions (pid-files under `.runtime/pids`, secret-free logs under
// `.runtime/logs`) and the SAME identity-verified liveness check (supervision.mjs) so `stop`,
// `clean`, and `status` agree on what "running" means. Zero-dependency ESM (Node builtins only).

import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPidRecords, verifyRecord, powershellAvailable } from './supervision.mjs';

export const RUNTIME_DIRS = ['pids', 'logs', 'state', 'temp'];

/** Append a secret-free line to `.runtime/logs/<name>.log` AND echo it to stdout. */
export function log(root, name, msg) {
  const dir = join(root, '.runtime', 'logs');
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${name}.log`), `[${new Date().toISOString()}] ${msg}\n`, 'utf8');
  process.stdout.write(msg + '\n');
}

/** Idempotent creation of the `.runtime/` subdirs (mkdir -p is a no-op on repeat). */
export function ensureRuntimeDirs(root) {
  for (const d of RUNTIME_DIRS) mkdirSync(join(root, '.runtime', d), { recursive: true });
}

export function runtimeInitialized(root) {
  return existsSync(join(root, '.runtime'));
}

// Identity-verified live records (ADR 0004 / CGHC-004), NON-MUTATING — never deletes a pid-file.
// "Nothing tracked" → []. When PowerShell/CIM is unavailable, identity cannot be re-matched, so we
// fall back to the raw tracked records (reported as unverified) rather than guessing.
export function liveRecords(root) {
  const records = readPidRecords(root).map((r) => r.record);
  if (records.length === 0) return [];
  if (!powershellAvailable()) return records;
  return records.filter((rec) => verifyRecord(rec) === 'match');
}

export function isRunning(root) {
  return liveRecords(root).length > 0;
}
