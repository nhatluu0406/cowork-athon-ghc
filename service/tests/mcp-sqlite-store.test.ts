/**
 * MCP Phase 1 SQLite persistence (Wave 2B) — `mcp_servers` + `mcp_secret_refs` behavior.
 *
 * Asserts the store round-trips ONLY non-secret config, that a secret ref carries the vault
 * account handle only (never a value), and that delete() drops an orphaned secret ref alongside
 * the server row (no dangling `mcp_secret_refs` entry survives removal).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSqliteMcpStore, openMemorySqliteDatabase, runMigrations } from "../src/db/index.js";

const FIXED_NOW = (): string => "2026-07-16T02:00:00.000Z";

function freshStore() {
  const db = openMemorySqliteDatabase();
  runMigrations(db, undefined, FIXED_NOW);
  return { db, store: createSqliteMcpStore(db) };
}

test("upsert + get + list round-trip non-secret config only", () => {
  const { store } = freshStore();
  store.upsert({ id: "srv-1", name: "Files MCP", command: "files-mcp", enabled: false, updatedAt: FIXED_NOW() });
  store.upsert({
    id: "srv-2",
    name: "Remote MCP",
    url: "https://mcp.example.com/sse",
    enabled: true,
    updatedAt: FIXED_NOW(),
  });

  const list = store.list();
  assert.equal(list.length, 2);
  assert.deepEqual(store.get("srv-1"), {
    id: "srv-1",
    name: "Files MCP",
    command: "files-mcp",
    enabled: false,
    updatedAt: FIXED_NOW(),
  });
  assert.deepEqual(store.get("srv-2"), {
    id: "srv-2",
    name: "Remote MCP",
    url: "https://mcp.example.com/sse",
    enabled: true,
    updatedAt: FIXED_NOW(),
  });
  assert.equal(store.get("missing"), null);
});

test("upsert on an existing id overwrites in place (no duplicate row)", () => {
  const { store } = freshStore();
  store.upsert({ id: "srv-1", name: "V1", command: "a", enabled: false, updatedAt: "2026-01-01T00:00:00.000Z" });
  store.upsert({ id: "srv-1", name: "V2", command: "b", enabled: true, updatedAt: "2026-01-02T00:00:00.000Z" });

  assert.equal(store.list().length, 1);
  assert.deepEqual(store.get("srv-1"), {
    id: "srv-1",
    name: "V2",
    command: "b",
    enabled: true,
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
});

test("setSecretRef stores only the vault account handle, never a secret value", () => {
  const { store } = freshStore();
  store.upsert({ id: "srv-1", name: "Files MCP", command: "files-mcp", enabled: false, updatedAt: FIXED_NOW() });
  store.setSecretRef("srv-1", "mcp:srv-1:header");

  const ref = store.getSecretRef("srv-1");
  assert.ok(ref !== null);
  assert.equal(ref?.serverId, "srv-1");
  assert.equal(ref?.secretAccount, "mcp:srv-1:header");
  assert.equal(store.get("srv-1")?.name, "Files MCP", "the server row itself is unaffected by the secret ref");
});

test("setSecretRef replaces a prior ref for the same server (no stale duplicate)", () => {
  const { store } = freshStore();
  store.upsert({ id: "srv-1", name: "Files MCP", command: "files-mcp", enabled: false, updatedAt: FIXED_NOW() });
  store.setSecretRef("srv-1", "mcp:srv-1:header");
  store.setSecretRef("srv-1", "mcp:srv-1:header");

  assert.equal(store.getSecretRef("srv-1")?.secretAccount, "mcp:srv-1:header");
});

test("deleteSecretRef removes the ref without touching the server row", () => {
  const { store } = freshStore();
  store.upsert({ id: "srv-1", name: "Files MCP", command: "files-mcp", enabled: false, updatedAt: FIXED_NOW() });
  store.setSecretRef("srv-1", "mcp:srv-1:header");
  store.deleteSecretRef("srv-1");

  assert.equal(store.getSecretRef("srv-1"), null);
  assert.ok(store.get("srv-1") !== null);
});

test("delete() drops the server AND any secret ref (no orphaned vault handle survives)", () => {
  const { store } = freshStore();
  store.upsert({ id: "srv-1", name: "Files MCP", command: "files-mcp", enabled: false, updatedAt: FIXED_NOW() });
  store.setSecretRef("srv-1", "mcp:srv-1:header");

  const removed = store.delete("srv-1");
  assert.equal(removed, true);
  assert.equal(store.get("srv-1"), null);
  assert.equal(store.getSecretRef("srv-1"), null, "the secret ref must not outlive the server row");
});

test("delete() on an unknown id is an honest no-op (false, no throw)", () => {
  const { store } = freshStore();
  assert.equal(store.delete("nope"), false);
});
