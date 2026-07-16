/**
 * Explicit SQL migrations for the Cowork GHC local vault (ADR 0007).
 */

import type { SqliteDatabase } from "./sqlite.js";

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

/** Wave 0A initial schema; Wave 0B adds conversation indexes on the existing tables. */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "initial_local_vault",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_salt BLOB NOT NULL,
  password_hash BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES local_users(id) ON DELETE CASCADE,
  kdf_salt BLOB NOT NULL,
  wrapped_master_key BLOB NOT NULL,
  wrap_nonce BLOB NOT NULL,
  wrap_tag BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL UNIQUE,
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  tag BLOB NOT NULL,
  aad TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  id TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_verifications (
  profile_id TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  document_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_review_refs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  relative_path TEXT NOT NULL,
  document_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_state (
  id TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  document_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_secret_refs (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  secret_account TEXT NOT NULL,
  document_json TEXT NOT NULL
);
`,
  },
  {
    id: 2,
    name: "conversation_persistence_indexes",
    sql: `
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_runtime_turns_conversation_id ON runtime_turns(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_attachments_conversation_id ON conversation_attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_file_review_refs_conversation_id ON file_review_refs(conversation_id);
`,
  },
  {
    // Wave 6 local-only telemetry: bounded AGGREGATE counters only (name -> integer). Never any
    // prompt/message/document content, filename, workspace path, model output, or raw runtime event
    // — the writable key space is a fixed allowlist enforced in the telemetry store.
    id: 3,
    name: "local_telemetry_counters",
    sql: `
CREATE TABLE IF NOT EXISTS telemetry_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`,
  },
];

export function appliedMigrationIds(db: SqliteDatabase): readonly number[] {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get() as { name: string } | undefined;
  if (row === undefined) return [];
  const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id ASC").all() as Array<{
    id: number;
  }>;
  return rows.map((r) => r.id);
}

/** Apply pending migrations in a single transaction. Idempotent. */
export function runMigrations(
  db: SqliteDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
  now: () => string = () => new Date().toISOString(),
): readonly number[] {
  const applied = new Set(appliedMigrationIds(db));
  const freshlyApplied: number[] = [];

  const applyOne = db.transaction((migration: Migration) => {
    if (applied.has(migration.id)) return;
    db.exec(migration.sql);
    db.prepare(
      "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
    ).run(migration.id, migration.name, now());
    freshlyApplied.push(migration.id);
  });

  for (const migration of migrations) {
    applyOne(migration);
  }
  return freshlyApplied;
}
