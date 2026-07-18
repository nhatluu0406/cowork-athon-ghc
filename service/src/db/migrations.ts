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
  {
    // Local Knowledge Base + Knowledge Graph MVP (local-first, Option 1 in local-first-strategy.md):
    // embedded SQLite + FTS5 keyword search + deterministic node/edge tables. Every row is scoped by
    // `workspace_root` so switching/clearing a workspace never leaks index data across workspaces.
    // No embeddings, no external service — the index is derived only from files the WorkspaceGuard
    // already permits (secret-like files excluded by the indexer). Document/chunk TEXT is extracted
    // content, held locally only; nothing here is sent to any provider by default.
    id: 4,
    name: "local_knowledge_index",
    sql: `
CREATE TABLE IF NOT EXISTS knowledge_index_state (
  workspace_root TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  document_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  node_count INTEGER NOT NULL DEFAULT 0,
  edge_count INTEGER NOT NULL DEFAULT 0,
  last_indexed_at TEXT,
  error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  UNIQUE(workspace_root, relative_path)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_ws ON knowledge_documents(workspace_root);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  workspace_root TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  char_start INTEGER NOT NULL DEFAULT 0,
  char_end INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc ON knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_ws ON knowledge_chunks(workspace_root);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  text,
  relative_path,
  workspace_root UNINDEXED,
  document_id UNINDEXED,
  chunk_id UNINDEXED,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  relative_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_ws ON knowledge_nodes(workspace_root);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL,
  UNIQUE(workspace_root, from_id, to_id, type)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_ws ON knowledge_edges(workspace_root);
`,
  },
  {
    // BGE-M3 int8 embedding column — nullable so existing chunks stay valid; populated
    // incrementally by the indexer when the llm-svc embedding backend is available.
    // 1024-dimensional float32 vectors stored as little-endian BLOB (1024 * 4 = 4096 bytes).
    id: 5,
    name: "knowledge_chunks_embedding",
    sql: `
ALTER TABLE knowledge_chunks ADD COLUMN embedding BLOB;
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
