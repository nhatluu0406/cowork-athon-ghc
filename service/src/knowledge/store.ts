/**
 * `KnowledgeSourceConfig` persistence — `.runtime/knowledge-source.json` (data-model.md §1.1).
 *
 * Follows the EXACT write-temp-then-atomic-rename convention `conversation/store.ts` already
 * uses (crash-safety; no new persistence mechanism is invented). The file never holds a raw
 * token — only the secret-free `CredentialRef` handle (T1.9).
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CredentialRef } from "@cowork-ghc/contracts";
import { DEFAULT_KNOWLEDGE_SOURCE_CONFIG, type KnowledgeSourceConfig, type KnowledgeSourceStatus } from "./types.js";

export interface KnowledgeSourceConfigStore {
  read(): Promise<KnowledgeSourceConfig>;
  write(config: KnowledgeSourceConfig): Promise<void>;
  /** Reset to the pristine default (R6 "Disconnect"). */
  clear(): Promise<void>;
}

export interface KnowledgeSourceConfigStoreOptions {
  readonly filePath: string;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function isCredentialRef(value: unknown): value is CredentialRef {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record["store"] === "os" && typeof record["account"] === "string" && record["account"].length > 0;
}

function isStatus(value: unknown): value is KnowledgeSourceStatus {
  return value === "not_configured" || value === "connected" || value === "unreachable" || value === "auth_failed";
}

/** Parse a persisted config, falling back to the default on ANY corruption (never throws). */
function parseConfig(raw: unknown): KnowledgeSourceConfig {
  if (typeof raw !== "object" || raw === null) return DEFAULT_KNOWLEDGE_SOURCE_CONFIG;
  const record = raw as Record<string, unknown>;
  const baseUrl = typeof record["baseUrl"] === "string" ? record["baseUrl"] : null;
  const credentialRef = isCredentialRef(record["credentialRef"]) ? record["credentialRef"] : null;
  const status = isStatus(record["status"]) ? record["status"] : "not_configured";
  const lastHealthCheckAt = typeof record["lastHealthCheckAt"] === "string" ? record["lastHealthCheckAt"] : null;
  const configuredAt = typeof record["configuredAt"] === "string" ? record["configuredAt"] : null;
  // Validation rule (data-model.md §1.1): credentialRef is null iff status = not_configured.
  if (credentialRef === null && status !== "not_configured") return DEFAULT_KNOWLEDGE_SOURCE_CONFIG;
  return { baseUrl, credentialRef, status, lastHealthCheckAt, configuredAt };
}

/** Build the file-backed `.runtime/knowledge-source.json` store. */
export function createKnowledgeSourceConfigStore(
  options: KnowledgeSourceConfigStoreOptions,
): KnowledgeSourceConfigStore {
  const { filePath } = options;

  async function ensureDir(): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
  }

  return {
    async read(): Promise<KnowledgeSourceConfig> {
      try {
        const raw = await readFile(filePath, "utf8");
        return parseConfig(JSON.parse(raw));
      } catch {
        // Missing file / corrupt JSON — an unconfigured source is the safe, honest default.
        return DEFAULT_KNOWLEDGE_SOURCE_CONFIG;
      }
    },

    async write(config: KnowledgeSourceConfig): Promise<void> {
      await ensureDir();
      await atomicWriteJson(filePath, config);
    },

    async clear(): Promise<void> {
      await ensureDir();
      await atomicWriteJson(filePath, DEFAULT_KNOWLEDGE_SOURCE_CONFIG);
    },
  };
}
