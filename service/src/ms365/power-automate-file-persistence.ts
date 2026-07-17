/**
 * File-backed PowerAutomatePersistence. Stores the configured flow list as JSON. A flow's
 * HTTP-trigger URL is itself an unguessable bearer of authorization — anyone holding it can
 * trigger the flow — so this file is written owner-only (0o600, directory 0o700), the same
 * discipline as a credential file, not the default world-readable mode. A missing/corrupt file
 * loads as null (store falls back to empty), never throws on read — a preference file must not
 * break MS365 startup.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PowerAutomateFlow, PowerAutomatePersistence } from "./power-automate-store.js";

function isFlow(value: unknown): value is PowerAutomateFlow {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.url === "string";
}

export function createPowerAutomateFilePersistence(filePath: string): PowerAutomatePersistence {
  return {
    async load(): Promise<readonly PowerAutomateFlow[] | null> {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return null;
        const flows = (parsed as Record<string, unknown>).flows;
        if (!Array.isArray(flows)) return null;
        return flows.filter(isFlow);
      } catch {
        return null;
      }
    },
    async save(flows: readonly PowerAutomateFlow[]): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
      await writeFile(filePath, JSON.stringify({ flows }), { encoding: "utf8", mode: 0o600 });
    },
  };
}
