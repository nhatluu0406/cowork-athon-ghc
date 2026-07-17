/**
 * Idempotent import of legacy `.runtime/conversations` JSON into SQLite (Wave 0B).
 *
 * After a successful import, the directory is renamed to `*.migrated-backup` and the
 * service uses SQLite as the sole conversation source (no dual writes).
 */

import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { ConversationRecord } from "../conversation/types.js";
import type { AppMetaRepository } from "./repositories.js";
import type { SqliteDatabase } from "./sqlite.js";
import {
  META_LAST_ACTIVE_CONVERSATION,
  persistConversationRecord,
} from "./sqlite-conversation-store.js";

export const META_JSON_CONVERSATIONS_MIGRATED = "legacy.json_conversations_migrated";

export interface JsonConversationsMigrationResult {
  readonly imported: boolean;
  readonly backedUp: boolean;
  readonly importedCount: number;
  readonly skippedCount: number;
  readonly reason?: string;
}

interface IndexFile {
  readonly version?: number;
  readonly conversations?: readonly { readonly id: string }[];
  readonly lastActiveConversationId?: string | null;
}

function conversationExists(db: SqliteDatabase, id: string): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM conversations WHERE id = ?").get(id) as
    | { ok: number }
    | undefined;
  return row !== undefined;
}

function readRecordFile(path: string): ConversationRecord | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as ConversationRecord;
    if (typeof parsed.id !== "string" || parsed.id.length === 0) return null;
    if (!Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Import JSON conversation files into SQLite. Idempotent:
 * - already-migrated meta → no-op
 * - existing conversation ids in SQLite → skipped
 * - missing legacy directory → mark migrated
 * - after import, rename directory to `.migrated-backup` so dual writes stop
 */
export function migrateJsonConversationsToSqlite(deps: {
  readonly conversationsDir: string;
  readonly db: SqliteDatabase;
  readonly appMeta: AppMetaRepository;
}): JsonConversationsMigrationResult {
  if (deps.appMeta.get(META_JSON_CONVERSATIONS_MIGRATED) === "1") {
    return { imported: false, backedUp: false, importedCount: 0, skippedCount: 0, reason: "already_migrated" };
  }

  const dir = deps.conversationsDir;
  if (!existsSync(dir)) {
    deps.appMeta.set(META_JSON_CONVERSATIONS_MIGRATED, "1");
    return { imported: false, backedUp: false, importedCount: 0, skippedCount: 0, reason: "no_legacy_dir" };
  }

  let index: IndexFile = {};
  const indexPath = join(dir, "index.json");
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8")) as IndexFile;
    } catch {
      index = {};
    }
  }

  const ids = new Set<string>();
  for (const summary of index.conversations ?? []) {
    if (typeof summary.id === "string" && summary.id.length > 0) ids.add(summary.id);
  }
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "index.json") continue;
    ids.add(name.slice(0, -".json".length));
  }

  let importedCount = 0;
  let skippedCount = 0;
  for (const id of ids) {
    if (conversationExists(deps.db, id)) {
      skippedCount += 1;
      continue;
    }
    const record = readRecordFile(join(dir, `${id}.json`));
    if (record === null) {
      skippedCount += 1;
      continue;
    }
    persistConversationRecord(deps.db, record);
    importedCount += 1;
  }

  const lastActive = index.lastActiveConversationId;
  if (typeof lastActive === "string" && lastActive.length > 0 && conversationExists(deps.db, lastActive)) {
    if (
      deps.appMeta.get(META_LAST_ACTIVE_CONVERSATION) === null ||
      deps.appMeta.get(META_LAST_ACTIVE_CONVERSATION) === ""
    ) {
      deps.appMeta.set(META_LAST_ACTIVE_CONVERSATION, lastActive);
    }
  }

  deps.appMeta.set(META_JSON_CONVERSATIONS_MIGRATED, "1");

  const backupPath = `${dir}.migrated-backup`;
  let backedUp = false;
  try {
    if (!existsSync(backupPath)) {
      renameSync(dir, backupPath);
      backedUp = true;
    }
  } catch {
    // Keep original directory if rename fails; SQLite already holds imported records.
  }

  return {
    imported: importedCount > 0 || skippedCount > 0 || backedUp,
    backedUp,
    importedCount,
    skippedCount,
  };
}
