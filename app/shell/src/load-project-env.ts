/**
 * Load project-root `.env` into `process.env` for development / verification bootstrap only.
 *
 * Never logs values. Skips when the file is missing. Only keys not already set in the process
 * environment are applied so packaged verification can inject secrets via spawn `env` instead.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadProjectEnvFile(appRoot: string): void {
  const path = join(appRoot, ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key.length === 0 || process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
