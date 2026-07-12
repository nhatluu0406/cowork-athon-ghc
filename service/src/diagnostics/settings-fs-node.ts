/**
 * Node-backed {@link SettingsFs} seam (CGHC-022, SD1). The production filesystem adapter
 * for the settings store: reads the settings file (resolving `undefined` when it does not
 * exist yet) and writes ATOMICALLY (temp file + rename) so a crash mid-write can never
 * leave a half-written, corrupt document — which the SD5 recovery path would then have to
 * salvage. Kept out of {@link SettingsStore} so the store stays `node:fs`-free and unit
 * tests inject an in-memory fake instead.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SettingsFs } from "./settings-store.js";

/** True for the Node "file does not exist" error, so first-run reads resolve `undefined`. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Build a filesystem seam backed by a real file at `filePath`. The parent directory is
 * created on write; a missing file on read is reported as `undefined` (first run).
 */
export function createNodeSettingsFs(filePath: string): SettingsFs {
  const tmpPath = `${filePath}.tmp`;
  return {
    async read(): Promise<string | undefined> {
      try {
        return await readFile(filePath, "utf8");
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async write(data: string): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      // Atomic swap: fully write a temp file, then rename over the target.
      await writeFile(tmpPath, data, "utf8");
      await rename(tmpPath, filePath);
    },
  };
}
