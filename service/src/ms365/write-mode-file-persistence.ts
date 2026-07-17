/**
 * File-backed WriteModePersistence. Stores the batch-write mode (NOT a secret) as JSON.
 * A missing/corrupt/unknown-value file loads as null (store falls back to "manual"),
 * never throws on read — a preference file must not break MS365 startup.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Ms365WriteMode, WriteModePersistence } from "./write-mode-store.js";

function isMode(value: unknown): value is Ms365WriteMode {
  return value === "manual" || value === "auto";
}

export function createWriteModeFilePersistence(filePath: string): WriteModePersistence {
  return {
    async load(): Promise<Ms365WriteMode | null> {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return null;
        const mode = (parsed as Record<string, unknown>).mode;
        return isMode(mode) ? mode : null;
      } catch {
        return null;
      }
    },
    async save(mode: Ms365WriteMode): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify({ mode }), "utf8");
    },
  };
}
