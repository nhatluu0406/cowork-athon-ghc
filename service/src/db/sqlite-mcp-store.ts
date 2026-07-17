/**
 * SQLite-backed MCP server persistence (Wave 2B, MCP Phase 1 — ADR 0007 tables).
 *
 * Persists ONLY non-secret server config (`mcp_servers.document_json`): id, name, transport
 * (`command` OR `url`), `enabled`, `updatedAt`. A header secret is NEVER stored here — the row in
 * `mcp_secret_refs` carries only the vault `secret_account` handle; the value itself lives in the
 * encrypted vault via the existing {@link import("./vault-credential-store.js").VaultCredentialStore}
 * / `CredentialService`. This mirrors the provider-credential discipline: app/session state and
 * this store see a handle only, never the secret bytes.
 */

import type { SqliteDatabase } from "./sqlite.js";

/** Non-secret MCP server config persisted across relaunch. Exactly one of `command` | `url`. */
export interface McpServerDocument {
  readonly id: string;
  readonly name: string;
  readonly command?: string;
  readonly url?: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

/** A reference to a header-secret stored in the vault under `mcp:<id>:header` (never the value). */
export interface McpSecretRef {
  readonly id: string;
  readonly serverId: string;
  readonly secretAccount: string;
}

export interface McpStore {
  list(): readonly McpServerDocument[];
  get(id: string): McpServerDocument | null;
  upsert(doc: McpServerDocument): void;
  delete(id: string): boolean;
  getSecretRef(serverId: string): McpSecretRef | null;
  setSecretRef(serverId: string, secretAccount: string): void;
  deleteSecretRef(serverId: string): void;
}

interface McpServerRow {
  readonly id: string;
  readonly name: string;
  readonly command?: string;
  readonly url?: string;
  readonly enabled: boolean;
  readonly updatedAt: string;
}

function parseDocument(documentJson: string): McpServerDocument {
  const row = JSON.parse(documentJson) as McpServerRow;
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === true,
    updatedAt: row.updatedAt,
    ...(row.command !== undefined ? { command: row.command } : {}),
    ...(row.url !== undefined ? { url: row.url } : {}),
  };
}

/** Build the SQLite-backed {@link McpStore} over the existing `mcp_servers` + `mcp_secret_refs` tables. */
export function createSqliteMcpStore(db: SqliteDatabase): McpStore {
  const getStmt = db.prepare("SELECT document_json AS documentJson FROM mcp_servers WHERE id = ?");
  const listStmt = db.prepare(
    "SELECT document_json AS documentJson FROM mcp_servers ORDER BY id ASC",
  );
  const upsertStmt = db.prepare(
    "INSERT INTO mcp_servers (id, document_json, updated_at) VALUES (@id, @documentJson, @updatedAt) " +
      "ON CONFLICT(id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at",
  );
  const deleteStmt = db.prepare("DELETE FROM mcp_servers WHERE id = ?");

  const getSecretRefStmt = db.prepare(
    "SELECT id, server_id AS serverId, secret_account AS secretAccount FROM mcp_secret_refs WHERE server_id = ?",
  );
  const deleteSecretRefStmt = db.prepare("DELETE FROM mcp_secret_refs WHERE server_id = ?");
  const insertSecretRefStmt = db.prepare(
    "INSERT INTO mcp_secret_refs (id, server_id, secret_account, document_json) VALUES (@id, @serverId, @secretAccount, @documentJson)",
  );

  return {
    list() {
      return (listStmt.all() as Array<{ documentJson: string }>).map((row) =>
        parseDocument(row.documentJson),
      );
    },

    get(id) {
      const row = getStmt.get(id) as { documentJson: string } | undefined;
      return row === undefined ? null : parseDocument(row.documentJson);
    },

    upsert(doc) {
      const row: McpServerRow = {
        id: doc.id,
        name: doc.name,
        enabled: doc.enabled,
        updatedAt: doc.updatedAt,
        ...(doc.command !== undefined ? { command: doc.command } : {}),
        ...(doc.url !== undefined ? { url: doc.url } : {}),
      };
      upsertStmt.run({ id: doc.id, documentJson: JSON.stringify(row), updatedAt: doc.updatedAt });
    },

    delete(id) {
      // A secret ref (if any) is dropped alongside the server so no orphaned vault account
      // reference survives removal — same transactional guarantee the credential layer expects.
      const run = db.transaction((serverId: string) => {
        deleteSecretRefStmt.run(serverId);
        return deleteStmt.run(serverId).changes > 0;
      });
      return run(id);
    },

    getSecretRef(serverId) {
      const row = getSecretRefStmt.get(serverId) as
        | { id: string; serverId: string; secretAccount: string }
        | undefined;
      return row === undefined ? null : row;
    },

    setSecretRef(serverId, secretAccount) {
      const run = db.transaction(() => {
        deleteSecretRefStmt.run(serverId);
        insertSecretRefStmt.run({
          id: `${serverId}:header`,
          serverId,
          secretAccount,
          documentJson: JSON.stringify({ kind: "header" }),
        });
      });
      run();
    },

    deleteSecretRef(serverId) {
      deleteSecretRefStmt.run(serverId);
    },
  };
}
