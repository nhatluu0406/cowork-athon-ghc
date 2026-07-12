/**
 * Permission contract types (P1–P7).
 *
 * Consumed by: CGHC-016 (permission enforcement + explicit deny reply) and
 * CGHC-017 (Allow/Deny modal). These types describe the request/decision shape;
 * ENFORCEMENT lives at the execution boundary (a Deny must actually block on disk,
 * P3) — never in the UI. A decision object is not itself an authorization.
 */

import type { SessionId } from "./session.js";

/**
 * Approval level (P4). Sensitive actions (delete, bulk write) carry `elevated` so
 * the UI can require a stronger confirmation; the boundary decides the level, not
 * the UI.
 */
export type ApprovalLevel = "standard" | "elevated";

/** The kind of action a permission request is gating. */
export type PermissionActionKind =
  | "file_create"
  | "file_edit"
  | "file_delete"
  | "file_move"
  | "command_exec"
  /**
   * A network-capable / external-data-access action (e.g. `m365_knowledge_search`,
   * REQ-205) — never a filesystem or local-execution action. Additive value; existing
   * kinds are never renamed or removed (T0.3/T1.8).
   */
  | "network_access";

/** What the user is being asked to Allow or Deny (P2 describes action + target). */
export interface PermissionAction {
  readonly kind: PermissionActionKind;
  /** Target path for file actions; absent for non-file actions. */
  readonly targetPath?: string;
  /** Human-readable, non-secret description of the change (P2/F5). */
  readonly description: string;
}

/** A pending permission request surfaced from the execution boundary (P1). */
export interface PermissionRequest {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly action: PermissionAction;
  readonly approvalLevel: ApprovalLevel;
  /** ISO-8601 timestamp the request was raised. */
  readonly requestedAt: string;
}

/** The user's decision. */
export type PermissionDecision = "allow" | "deny";

/**
 * Scope of an allow decision (research FR-010: Allow once / Allow always). Only
 * meaningful when `decision` is `"allow"`.
 */
export type PermissionScope = "once" | "always";

/**
 * The reply sent back through the boundary. On `deny` the boundary MUST both block
 * the action on disk AND forward an explicit deny reply so the runtime is not
 * stranded (P3, ADR 0003:76-81), returning the session to a terminal state.
 */
export interface PermissionReply {
  readonly requestId: string;
  readonly decision: PermissionDecision;
  /** Present only for an allow decision. */
  readonly scope?: PermissionScope;
}
