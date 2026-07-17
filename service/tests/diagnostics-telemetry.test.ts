/**
 * Wave 6 — local aggregate telemetry store.
 *
 * Proves the store is REAL (persists to the migration-id-3 table), that the enable toggle gates
 * collection, that the allowlist bounds the key space, that clear() removes data, and that the EV
 * event mapper counts only structural facts. Uses an in-memory SQLite DB with the real migrations.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { EvEvent } from "@cowork-ghc/contracts";
import { openMemorySqliteDatabase, runMigrations } from "../src/db/index.js";
import {
  createTelemetryStore,
  recordEventTelemetry,
  TELEMETRY_COUNTERS,
} from "../src/diagnostics/telemetry-store.js";

function freshDb() {
  const db = openMemorySqliteDatabase();
  runMigrations(db);
  return db;
}

test("migration id 3 creates the telemetry_counters table", () => {
  const db = freshDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telemetry_counters'")
    .get() as { name: string } | undefined;
  assert.equal(row?.name, "telemetry_counters");
});

test("disabled telemetry does NOT record any counter", () => {
  const db = freshDb();
  const store = createTelemetryStore({ db, enabled: false });
  store.increment("app_launches");
  store.increment("errors");
  const snap = store.snapshot();
  assert.equal(snap.enabled, false);
  assert.equal(snap.counters.app_launches, 0);
  assert.equal(snap.counters.errors, 0);
  assert.equal(snap.updatedAt, null, "nothing was written while disabled");
});

test("enabled telemetry increments and persists aggregate counters", () => {
  const db = freshDb();
  const store = createTelemetryStore({ db, enabled: true, now: () => "2026-07-17T00:00:00.000Z" });
  store.increment("app_launches");
  store.increment("permission_approved");
  store.increment("permission_approved");
  const snap = store.snapshot();
  assert.equal(snap.counters.app_launches, 1);
  assert.equal(snap.counters.permission_approved, 2);
  assert.equal(snap.updatedAt, "2026-07-17T00:00:00.000Z");
  // A brand-new store over the same DB sees the persisted values (real persistence).
  const reopened = createTelemetryStore({ db, enabled: true });
  assert.equal(reopened.snapshot().counters.permission_approved, 2);
});

test("toggling enabled at runtime stops/starts collection", () => {
  const db = freshDb();
  const store = createTelemetryStore({ db, enabled: true });
  store.increment("errors");
  store.setEnabled(false);
  store.increment("errors"); // ignored
  store.increment("errors"); // ignored
  assert.equal(store.snapshot().counters.errors, 1, "no new writes while disabled");
  store.setEnabled(true);
  store.increment("errors");
  assert.equal(store.snapshot().counters.errors, 2);
});

test("the key space is bounded by the allowlist — an unknown name is ignored", () => {
  const db = freshDb();
  const store = createTelemetryStore({ db, enabled: true });
  // A non-allowlisted name (e.g. a would-be PII key) must never be written.
  (store as unknown as { increment(n: string): void }).increment("workspace:/secret/path.txt");
  const rows = db.prepare("SELECT COUNT(*) AS n FROM telemetry_counters").get() as { n: number };
  assert.equal(rows.n, 0, "no row created for a non-allowlisted counter");
});

test("clear() removes all stored counters", () => {
  const db = freshDb();
  const store = createTelemetryStore({ db, enabled: true });
  store.increment("app_launches");
  store.increment("file_created");
  store.clear();
  const snap = store.snapshot();
  assert.equal(snap.counters.app_launches, 0);
  assert.equal(snap.counters.file_created, 0);
  const rows = db.prepare("SELECT COUNT(*) AS n FROM telemetry_counters").get() as { n: number };
  assert.equal(rows.n, 0, "clear deletes rows for real");
});

test("EV event mapper counts only structural facts (terminal, file_mutation, error)", () => {
  const db = freshDb();
  const store = createTelemetryStore({ db, enabled: true });
  const ev = (e: Partial<EvEvent> & { kind: string }): EvEvent => e as unknown as EvEvent;

  recordEventTelemetry(store, ev({ kind: "terminal", state: "completed" }));
  recordEventTelemetry(store, ev({ kind: "terminal", state: "errored" }));
  recordEventTelemetry(store, ev({ kind: "terminal", state: "cancelled" }));
  recordEventTelemetry(store, ev({ kind: "file_mutation", operation: "create" }));
  recordEventTelemetry(store, ev({ kind: "file_mutation", operation: "edit" }));
  recordEventTelemetry(store, ev({ kind: "file_mutation", operation: "move" }));
  recordEventTelemetry(store, ev({ kind: "file_mutation", operation: "delete" }));
  recordEventTelemetry(store, ev({ kind: "error", message: "boom" }));
  // These carry no counter meaning and must be ignored.
  recordEventTelemetry(store, ev({ kind: "token", text: "hello" }));
  recordEventTelemetry(store, ev({ kind: "plan" }));

  const c = store.snapshot().counters;
  assert.equal(c.chat_turns_completed, 1);
  assert.equal(c.chat_turns_failed, 2, "errored + cancelled both count as failed");
  assert.equal(c.file_created, 1);
  assert.equal(c.file_modified, 2, "edit + move count as modified");
  assert.equal(c.file_deleted, 1);
  assert.equal(c.errors, 1);
});

test("the allowlist contains no obviously-sensitive key names", () => {
  for (const name of TELEMETRY_COUNTERS) {
    assert.doesNotMatch(name, /path|file:|prompt|token|key|secret|url|workspace/i, `${name} looks unsafe`);
  }
  // Sanity: file_* counters are structural tallies, not paths.
  assert.ok(TELEMETRY_COUNTERS.includes("file_created"));
});
