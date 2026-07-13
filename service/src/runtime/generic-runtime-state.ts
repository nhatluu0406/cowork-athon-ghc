/**
 * Role-parameterized `.runtime/pids/<role>.json` state helper (ADR 0010). Same on-disk schema
 * and atomic-write convention as `runtime-state.ts` (the OpenCode-specific version this project
 * already ships), generalized so the M365KG stack's 4 new roles (`m365kg-postgres`,
 * `m365kg-neo4j`, `m365kg-backend`, `m365kg-llmsvc`) don't need 4 near-duplicate files.
 * `runtime-state.ts` itself is untouched — this is a new, additive file.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseIdentityRecord, type RuntimeProcessIdentity } from "@cowork-ghc/runtime";

const SCHEMA_VERSION = 1 as const;

function pidsDir(root: string): string {
  return join(root, ".runtime", "pids");
}

function recordPath(root: string, role: string): string {
  return join(pidsDir(root), `${role}.json`);
}

export function writeGenericRuntimeState(
  root: string,
  role: string,
  ppidRole: string,
  identity: RuntimeProcessIdentity,
): void {
  const dir = pidsDir(root);
  mkdirSync(dir, { recursive: true });
  const record = {
    schemaVersion: SCHEMA_VERSION,
    role,
    ppidRole,
    pid: identity.pid,
    host: identity.host,
    port: identity.port,
    startedAt: identity.startTime,
    startTime: identity.startTime,
    exePath: identity.exePath,
    runtimeVersion: identity.runtimeVersion,
  };
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  const finalPath = recordPath(root, role);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, serialized, "utf8");
  renameSync(tmpPath, finalPath); // atomic replace on the same volume
}

export function readGenericRuntimeState(root: string, role: string): RuntimeProcessIdentity | null {
  let text: string;
  try {
    text = readFileSync(recordPath(root, role), "utf8");
  } catch {
    return null;
  }
  try {
    return parseIdentityRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Idempotent — a missing record is not an error. */
export function clearGenericRuntimeState(root: string, role: string): void {
  try {
    rmSync(recordPath(root, role), { force: true });
  } catch {
    /* already gone */
  }
}
