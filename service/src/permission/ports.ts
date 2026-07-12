/**
 * Permission enforcement ports + seams (CGHC-016, P1/P3/P4/P5/P6).
 *
 * These are the provider-neutral boundaries the {@link import("./permission-gate.js").PermissionGate}
 * talks to. The DEFAULT test suite supplies fakes, so nothing here touches a live runtime,
 * network, or LLM. Enforcement lives SERVER-SIDE at the execution boundary — a decision
 * object is never itself an authorization (P3).
 *
 * The two runtime seams are deliberately split:
 *  - INBOUND (P1): the runtime proxy calls {@link PermissionGate.submit} with a request that
 *    ORIGINATED at the execution boundary. The gate does not poll the runtime; the runtime
 *    surfaces a permission event to it.
 *  - OUTBOUND: the gate calls {@link RuntimeReplyPort.reply} to POST the Allow/Deny back to
 *    the runtime (`POST /session/{id}/permissions/{permissionID}` or
 *    `/permission/{requestID}/reply`). The LIVE OpenCode adapter is CGHC-018; here we design
 *    the port only.
 */

import type {
  ApprovalLevel,
  PermissionActionKind,
  PermissionDecision,
  PermissionReply,
  SessionId,
} from "@cowork-ghc/contracts";

/**
 * Why a request reached a decision (P5 audit). `user_decision` is an explicit Allow/Deny;
 * `fail_closed_timeout` is the P6 auto-deny when no decision arrived in time.
 */
export type PermissionDecisionReason = "user_decision" | "fail_closed_timeout";

/**
 * A LOCAL audit record for one Allow/Deny decision (P5). Deliberately carries ONLY
 * structured, non-secret fields — the free-form {@link import("@cowork-ghc/contracts").PermissionAction.description}
 * is NOT copied, so an arbitrary/secret-shaped string in a description can never reach the
 * audit log. `targetPath` is a workspace path (non-secret).
 */
export interface PermissionAuditEvent {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly actionKind: PermissionActionKind;
  /** Present only for file actions; a path, never a credential. */
  readonly targetPath?: string;
  readonly decision: PermissionDecision;
  /** The BOUNDARY-assigned level (P4) — recomputed from the action kind, not client-supplied. */
  readonly approvalLevel: ApprovalLevel;
  readonly reason: PermissionDecisionReason;
  /** ISO-8601 timestamp the decision was recorded. */
  readonly at: string;
}

/**
 * Injectable audit sink (P5). Every Allow AND Deny is recorded here. An in-memory default
 * lives in {@link import("./audit.js").createInMemoryAuditSink}; the app wires a durable
 * local sink later. Implementations MUST NOT log secret values.
 */
export interface PermissionAuditSink {
  record(event: PermissionAuditEvent): void;
}

/**
 * OUTBOUND runtime-reply port. The gate calls this to forward an Allow/Deny reply so the
 * runtime is never stranded (P3) — on a Deny (explicit or fail-closed) the runtime still
 * gets an explicit deny reply. `requestId` maps to the runtime's `permissionID`; the live
 * adapter (CGHC-018) turns it into the concrete POST.
 */
export interface RuntimeReplyPort {
  reply(reply: PermissionReply): Promise<void>;
}

/**
 * Seam that drives a session to a terminal state so a Deny does not leave it hanging
 * (P3, "no strand"). The concrete adapter over the CGHC-013 session mechanism lives in
 * {@link import("./session-denial.js").createSessionDenialSink}; tests may supply a fake.
 */
export interface SessionDenialSink {
  /** Drive `sessionId` to the terminal `denied` state (idempotent if already terminal). */
  denySession(sessionId: SessionId, requestId: string, at: string): void;
}

/** An opaque handle for a scheduled timer (fail-closed P6). */
export interface TimerHandle {
  readonly id: number;
}

/**
 * Injectable timer seam so the P6 fail-closed timeout is DETERMINISTIC in tests (no real
 * wall-clock sleeps). The default node scheduler lives in
 * {@link import("./timer.js").createNodeScheduler}; tests use a manual one.
 */
export interface TimerScheduler {
  schedule(delayMs: number, callback: () => void): TimerHandle;
  cancel(handle: TimerHandle): void;
}
