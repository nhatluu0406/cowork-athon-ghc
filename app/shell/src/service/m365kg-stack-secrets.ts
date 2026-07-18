/**
 * First-launch secret generation/persistence for the M365KG stack (ADR 0010).
 *
 * Machine-generated secrets only: the Postgres superuser/m365kg-role password and the Go
 * backend's JWT signing secret. These are internal, machine-generated, service-to-service
 * secrets that never leave this machine. They persist in a single `0600` JSON file under the
 * writable runtime root.
 *
 * The Claude API key is NOT stored here — it is a user credential read from the vault at
 * launch time via the `resolveClaude` seam in `m365kg-stack-launch.ts`.
 *
 * Generated once, then reused: a fresh secret on every relaunch would create a mismatch with
 * the already-initialized Postgres/Neo4j cluster passwords.
 */

import { randomBytes as nodeRandomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface M365KGSecretsOptions {
  readonly runtimeRoot: string;
  /** Injectable for tests — defaults to `node:crypto` `randomBytes`. */
  readonly randomBytes?: (n: number) => Buffer;
}

export interface MachineSecrets {
  readonly pgPassword: string;
  readonly jwtSecret: string;
}

function secretsPath(runtimeRoot: string): string {
  return join(runtimeRoot, ".runtime", "m365kg-secrets.json");
}

function isValid(record: unknown): record is MachineSecrets {
  return (
    typeof record === "object" &&
    record !== null &&
    typeof (record as Record<string, unknown>)["pgPassword"] === "string" &&
    (record as Record<string, unknown>)["pgPassword"] !== "" &&
    typeof (record as Record<string, unknown>)["jwtSecret"] === "string" &&
    (record as Record<string, unknown>)["jwtSecret"] !== ""
  );
}

/** Read the persisted machine secrets if present and well-formed; otherwise generate + persist new ones. */
export async function loadOrCreateM365KGStackSecrets(
  options: M365KGSecretsOptions,
): Promise<MachineSecrets> {
  const path = secretsPath(options.runtimeRoot);
  try {
    const existing = JSON.parse(await readFile(path, "utf8"));
    if (isValid(existing)) return { pgPassword: existing.pgPassword, jwtSecret: existing.jwtSecret };
  } catch {
    // Missing, unreadable, or malformed — fall through and generate fresh below.
  }
  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const secrets: MachineSecrets = {
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
