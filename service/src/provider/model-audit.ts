/**
 * Local audit surface for provider/model changes (CGHC-019, P5).
 *
 * Every default-model or per-session-model change is *recorded* to an injectable sink so the
 * decision is auditable locally. The event carries ONLY structured, secret-free fields —
 * the previous/next {@link ModelRef} (provider id + model id), the scope, an optional
 * sessionId, and a timestamp. It NEVER carries a key, a {@link CredentialRef.account} value,
 * a base_url, or any free-form string, so a secret cannot reach the audit log by construction.
 *
 * This is the SINGLE audit sink for model changes — it deliberately mirrors the shape of the
 * permission P5 sink ({@link import("../permission/ports.js").PermissionAuditSink}) rather
 * than introducing a second, divergent audit mechanism. The app wires a durable local sink
 * later; the in-memory default here is for tests and early wiring.
 */

import type { ModelRef, ModelSelectionScope } from "@cowork-ghc/contracts";

/** One recorded provider/model change (P5). Structured + secret-free by construction. */
export interface ModelChangeAuditEvent {
  readonly type: "model_selection_changed";
  /** Which scope changed: the global default, or one session's override. */
  readonly scope: ModelSelectionScope;
  /** Present only when `scope` is `"session"` — the session whose override changed. */
  readonly sessionId?: string;
  /** The selection in effect for this scope BEFORE the change, or `null` if none was set. */
  readonly previous: ModelRef | null;
  /**
   * The selection now in effect for this scope, or `null` when the change leaves NOTHING
   * selected (review LOW: clearing a session override when no global default is configured is
   * a real state change — the session now resolves to no model — and must still be audited).
   */
  readonly next: ModelRef | null;
  /** ISO-8601 timestamp the change was recorded (from the injected clock). */
  readonly at: string;
}

/**
 * Injectable audit sink (P5). Every provider/model change is recorded here. Implementations
 * MUST NOT add secret-bearing fields — they receive an already-structured, non-secret event.
 */
export interface ModelAuditSink {
  record(event: ModelChangeAuditEvent): void;
}

/** An in-memory {@link ModelAuditSink} exposing its records for assertions. */
export interface InMemoryModelAuditSink extends ModelAuditSink {
  /** The recorded changes, oldest first (a defensive copy). */
  events(): readonly ModelChangeAuditEvent[];
  /** Number of recorded changes. */
  size(): number;
}

export function createInMemoryModelAuditSink(): InMemoryModelAuditSink {
  const log: ModelChangeAuditEvent[] = [];
  return {
    record(event) {
      log.push(event);
    },
    events: () => [...log],
    size: () => log.length,
  };
}
