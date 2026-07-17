/**
 * Wave 2 OpenCode compatibility gate runner.
 * Probes the installed workspace binary (current pin) against the server-contract matrix.
 *
 * Optional: COWORK_OPENCODE_BIN=/path/to/opencode.exe to override.
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultBin = join(REPO, "node_modules", "opencode-ai", "bin", "opencode.exe");
const bin = process.env.COWORK_OPENCODE_BIN ?? defaultBin;
const probe = join(REPO, "tools", "verify", "opencode-server-probe.mjs");

if (!existsSync(bin)) {
  console.error(`opencode-compat: missing binary at ${bin}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [probe, bin, "pinned"], {
  cwd: REPO,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
process.stdout.write(result.stdout ?? "");
if (result.status !== 0) {
  console.error("opencode-compat: FAIL — server contracts did not all pass");
  process.exit(result.status ?? 1);
}
console.log("opencode-compat: PASS (server-contract matrix)");
