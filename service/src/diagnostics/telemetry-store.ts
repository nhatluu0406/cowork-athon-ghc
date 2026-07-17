/**
 * Local-only aggregate telemetry (Wave 6).
 *
 * Stores ONLY bounded aggregate counters (a fixed allowlist of event names → integer) in the local
 * SQLite database. It NEVER records prompt/message content, filenames, workspace paths, model
 * output, endpoints, credentials, or raw runtime events — the writable key space is the allowlist
 * below, and any non-allowlisted name is silently ignored. There is NO network egress anywhere in
 * this module: it only reads/writes the local table.
 *
 * Collection is gated by the user's `telemetryEnabled` setting: when disabled, `increment` is a
 * no-op (no new counters are written). `clear()` deletes the stored counters for real.
 */

import type { EvEvent } from "@cowork-ghc/contracts";
import type { SqliteDatabase } from "../db/sqlite.js";

/**
 * The fixed allowlist of aggregate counters. Adding PII/unbounded keys here is a bug. This is the
 * bounded, honest set actually incremented today (all wired at the composition boundary); the design
 * is intentionally extensible (provider-connect / preview-kind counters can be added later without a
 * schema change since the table is a generic name→value map).
 */
export const TELEMETRY_COUNTERS = [
  "app_launches",
  "chat_turns_completed",
  "chat_turns_failed",
  "permission_approved",
  "permission_denied",
  "file_created",
  "file_modified",
  "file_deleted",
  "errors",
] as const;

export type TelemetryCounter = (typeof TELEMETRY_COUNTERS)[number];

const ALLOWED: ReadonlySet<string> = new Set(TELEMETRY_COUNTERS);

export interface TelemetrySnapshot {
  /** Whether collection is currently on. */
  readonly enabled: boolean;
  /** Every allowlisted counter, defaulting to 0 when never incremented. */
  readonly counters: Record<TelemetryCounter, number>;
  /** ISO time of the most recent counter write, or null if none. */
  readonly updatedAt: string | null;
}

export interface TelemetryStore {
  /** Increment an allowlisted counter. No-op when disabled or the name is not allowlisted. */
  increment(name: TelemetryCounter, delta?: number): void;
  /** Read all allowlisted counters (0-filled) + enabled state. */
  snapshot(): TelemetrySnapshot;
  /** Delete all stored counters (real data removal). */
  clear(): void;
  readonly enabled: boolean;
  /** Turn collection on/off. Off stops NEW writes; it does not clear existing data. */
  setEnabled(on: boolean): void;
}

export interface TelemetryStoreOptions {
  readonly db: SqliteDatabase;
  /** Initial collection state (from the persisted `telemetryEnabled` setting). Default false. */
  readonly enabled?: boolean;
  readonly now?: () => string;
}

/**
 * Map a normalized EV event to aggregate counters. Only structural facts are counted (which KIND of
 * event, the terminal state, the file operation) — never any path, content, or payload. Called on the
 * already-normalized EV stream (no raw runtime frames), so nothing sensitive is inspected.
 */
export function recordEventTelemetry(store: TelemetryStore, event: EvEvent): void {
  switch (event.kind) {
    case "file_mutation":
      if (event.operation === "create") store.increment("file_created");
      else if (event.operation === "delete") store.increment("file_deleted");
      else store.increment("file_modified"); // edit | move
      break;
    case "terminal":
      store.increment(event.state === "completed" ? "chat_turns_completed" : "chat_turns_failed");
      break;
    case "error":
      store.increment("errors");
      break;
    default:
      break;
  }
}

function zeroed(): Record<TelemetryCounter, number> {
  const out = {} as Record<TelemetryCounter, number>;
  for (const name of TELEMETRY_COUNTERS) out[name] = 0;
  return out;
}

export function createTelemetryStore(options: TelemetryStoreOptions): TelemetryStore {
  const db = options.db;
  const now = options.now ?? (() => new Date().toISOString());
  let enabled = options.enabled ?? false;

  const upsert = db.prepare(
    "INSERT INTO telemetry_counters (name, value, updated_at) VALUES (@name, @delta, @at) " +
      "ON CONFLICT(name) DO UPDATE SET value = value + @delta, updated_at = @at",
  );
  const readAll = db.prepare(
    "SELECT name, value, updated_at AS updatedAt FROM telemetry_counters",
  );
  const deleteAll = db.prepare("DELETE FROM telemetry_counters");

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean): void {
      enabled = on;
    },
    increment(name: TelemetryCounter, delta = 1): void {
      // Two hard gates: collection must be on, and the name must be allowlisted. A non-integer or
      // non-positive delta is ignored so a caller cannot corrupt a counter.
      if (!enabled) return;
      if (!ALLOWED.has(name)) return;
      if (!Number.isInteger(delta) || delta <= 0) return;
      try {
        upsert.run({ name, delta, at: now() });
      } catch {
        // Telemetry must never break a real operation — a write failure is dropped.
      }
    },
    snapshot(): TelemetrySnapshot {
      const counters = zeroed();
      let updatedAt: string | null = null;
      try {
        for (const row of readAll.all() as Array<{
          name: string;
          value: number;
          updatedAt: string;
        }>) {
          if (ALLOWED.has(row.name)) counters[row.name as TelemetryCounter] = row.value;
          if (updatedAt === null || row.updatedAt > updatedAt) updatedAt = row.updatedAt;
        }
      } catch {
        // Return the zeroed snapshot on any read error rather than throwing.
      }
      return { enabled, counters, updatedAt };
    },
    clear(): void {
      try {
        deleteAll.run();
      } catch {
        // best-effort
      }
    },
  };
}
