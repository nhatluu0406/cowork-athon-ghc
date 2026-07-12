/**
 * `.runtime/pids/agent-runtime.json` state helper for the supervisor (CGHC-028 Wave A1).
 *
 * The single owner of the OpenCode child persists its PID/port/identity here so the durable
 * record is the source of truth across a crashed shell (ADR 0004). The on-disk shape matches the
 * ADR 0004 schema (`role`/`startedAt`) so the lifecycle reaper (`tools/loop-engineer/supervision.mjs`)
 * can read/verify/prune it; the identity fields round-trip through the runtime's own
 * {@link parseIdentityRecord} (`startedAt` == `RuntimeProcessIdentity.startTime`), keeping this
 * consistent with `process-identity`. Writes are ATOMIC (temp file + rename) so a crash mid-write
 * never leaves a half-written record.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseIdentityRecord, type RuntimeProcessIdentity } from "@cowork-ghc/runtime";

/** This supervisor owns the `agent-runtime` role; its parent role is the local service. */
export const AGENT_RUNTIME_ROLE = "agent-runtime" as const;
const PPID_ROLE = "local-service" as const;
const SCHEMA_VERSION = 1 as const;

function pidsDir(root: string): string {
  return join(root, ".runtime", "pids");
}

function recordPath(root: string): string {
  return join(pidsDir(root), `${AGENT_RUNTIME_ROLE}.json`);
}

/**
 * Persist the child identity atomically. `startedAt` mirrors `identity.startTime` (the ADR 0004
 * reaper field name); `startTime` is kept too so `parseIdentityRecord` round-trips this file.
 */
export function writeRuntimeState(root: string, identity: RuntimeProcessIdentity): void {
  const dir = pidsDir(root);
  mkdirSync(dir, { recursive: true });
  const record = {
    schemaVersion: SCHEMA_VERSION,
    role: AGENT_RUNTIME_ROLE,
    ppidRole: PPID_ROLE,
    pid: identity.pid,
    host: identity.host,
    port: identity.port,
    startedAt: identity.startTime,
    startTime: identity.startTime,
    exePath: identity.exePath,
    runtimeVersion: identity.runtimeVersion,
  };
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  const finalPath = recordPath(root);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, serialized, "utf8");
  renameSync(tmpPath, finalPath); // atomic replace on the same volume
}

/** Read + validate the persisted child identity, or `null` when absent/corrupt. */
export function readRuntimeState(root: string): RuntimeProcessIdentity | null {
  let text: string;
  try {
    text = readFileSync(recordPath(root), "utf8");
  } catch {
    return null;
  }
  try {
    return parseIdentityRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Remove the persisted record (idempotent — a missing file is not an error). */
export function clearRuntimeState(root: string): void {
  try {
    rmSync(recordPath(root), { force: true });
  } catch {
    /* already gone — clearing is idempotent */
  }
}
