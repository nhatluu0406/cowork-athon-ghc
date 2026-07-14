/**
 * First-launch secret generation/persistence for the bundled M365KG stack (ADR 0010 remaining
 * work) — the Postgres superuser+`m365kg`-role password and the bundled Go backend's JWT signing
 * secret. Neither is a user-facing provider credential (those go through the OS keyring per
 * `credential/index.js`); these are internal, machine-generated, service-to-service secrets that
 * never leave this machine, so — matching the checklist's own suggested resolution for this exact
 * open question — they persist in a single `0600` JSON file under the writable runtime root
 * rather than the keyring, kept out of `.runtime/service-lifecycle.log` and every other log line.
 *
 * Generated once, then reused: a fresh secret on every relaunch would make `M365KGStackInitializer`
 * appear "already initialized" (by its `.runtime/m365kg-init.done` marker) while the actual
 * Postgres/Neo4j cluster still has the OLD password — this module's whole job is to prevent that.
 */

import { randomBytes as nodeRandomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StackSupervisorSecrets } from "@cowork-ghc/service/knowledge/stack";

function secretsPath(runtimeRoot: string): string {
  return join(runtimeRoot, ".runtime", "m365kg-secrets.json");
}

function isValid(record: unknown): record is StackSupervisorSecrets {
  return (
    typeof record === "object" &&
    record !== null &&
    typeof (record as Record<string, unknown>)["pgPassword"] === "string" &&
    (record as Record<string, unknown>)["pgPassword"] !== "" &&
    typeof (record as Record<string, unknown>)["jwtSecret"] === "string" &&
    (record as Record<string, unknown>)["jwtSecret"] !== ""
  );
}

export interface LoadOrCreateM365KGStackSecretsOptions {
  readonly runtimeRoot: string;
  /** Test seam — defaults to `node:crypto`'s CSPRNG. */
  readonly randomBytes?: (size: number) => Buffer;
}

/** Read the persisted secrets if present and well-formed; otherwise generate + persist new ones. */
export async function loadOrCreateM365KGStackSecrets(
  options: LoadOrCreateM365KGStackSecretsOptions,
): Promise<StackSupervisorSecrets> {
  const path = secretsPath(options.runtimeRoot);
  try {
    const existing = JSON.parse(await readFile(path, "utf8"));
    if (isValid(existing)) return { pgPassword: existing.pgPassword, jwtSecret: existing.jwtSecret };
  } catch {
    // Missing, unreadable, or malformed — fall through and generate a fresh set below.
  }

  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const secrets: StackSupervisorSecrets = {
    pgPassword: randomBytes(24).toString("hex"),
    jwtSecret: randomBytes(32).toString("hex"),
  };

  const dir = join(options.runtimeRoot, ".runtime");
  await mkdir(dir, { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, path); // atomic replace on the same volume
  return secrets;
}
