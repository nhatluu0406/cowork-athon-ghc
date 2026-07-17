/**
 * File-backed SiteScopePersistence. Stores site-enabled preferences (NOT secrets) as JSON.
 * A missing/corrupt file loads as an empty allowlist (all sites default-enabled), never throws
 * on read — a preference file must not break MS365 startup.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SiteEnabledRecord, SiteScopePersistence } from "./site-scope-store.js";

export function createSiteScopeFilePersistence(filePath: string): SiteScopePersistence {
  return {
    async load(): Promise<SiteEnabledRecord[]> {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
          (r): r is SiteEnabledRecord =>
            typeof r === "object" && r !== null &&
            typeof (r as SiteEnabledRecord).siteId === "string" &&
            typeof (r as SiteEnabledRecord).enabled === "boolean",
        );
      } catch {
        return [];
      }
    },
    async save(records: SiteEnabledRecord[]): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(records), "utf8");
    },
  };
}
