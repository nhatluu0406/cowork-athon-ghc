/**
 * In-memory permission audit sink (CGHC-016, P5).
 *
 * The default {@link PermissionAuditSink} for tests and early wiring: it appends each
 * decision to an in-memory log. The app replaces it with a durable local sink later. It
 * stores exactly the structured {@link PermissionAuditEvent} the gate hands it — no
 * free-form/secret-bearing fields are added here, so the sink cannot introduce a leak.
 */

import type { PermissionAuditEvent, PermissionAuditSink } from "./ports.js";

/** An in-memory audit sink exposing its recorded events for assertions. */
export interface InMemoryAuditSink extends PermissionAuditSink {
  /** The recorded decisions, oldest first (a defensive copy). */
  events(): readonly PermissionAuditEvent[];
  /** Number of recorded decisions. */
  size(): number;
}

export function createInMemoryAuditSink(): InMemoryAuditSink {
  const log: PermissionAuditEvent[] = [];
  return {
    record(event) {
      log.push(event);
    },
    events: () => [...log],
    size: () => log.length,
  };
}
