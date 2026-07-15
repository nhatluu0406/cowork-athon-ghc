/**
 * Local SQLite adapter (ADR 0007) — service/main only.
 * Pinned better-sqlite3; no ORM. Renderer never imports this module.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SqliteDatabase = Database.Database;

export interface OpenSqliteOptions {
  readonly filePath: string;
  readonly readonly?: boolean;
}

/** Open (or create) the Cowork GHC SQLite database at the given absolute path. */
export function openSqliteDatabase(options: OpenSqliteOptions): SqliteDatabase {
  mkdirSync(dirname(options.filePath), { recursive: true });
  const db = new Database(options.filePath, {
    readonly: options.readonly === true,
    fileMustExist: false,
  });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** In-memory database for focused unit tests. */
export function openMemorySqliteDatabase(): SqliteDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

export function closeSqliteDatabase(db: SqliteDatabase): void {
  db.close();
}
