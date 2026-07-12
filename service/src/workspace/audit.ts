/**
 * Local audit surface for workspace-boundary refusals (P5).
 *
 * When confinement refuses a path, the guard emits a {@link WorkspaceAuditEvent} to an
 * injectable sink so the decision is *recorded* (acceptance: "refused and recorded").
 * The event carries only the reason code and the raw *attempted* input string — never a
 * resolved out-of-workspace absolute/real path, and never a secret. The sink is a simple
 * callback for now; a later task can route it to the real local audit log.
 */

import type { PathRejectReason, WorkspaceId } from "@cowork-ghc/contracts";

/** Emitted whenever the workspace boundary refuses a candidate path. */
export interface WorkspacePathRejected {
  readonly type: "workspace_path_rejected";
  readonly workspaceId: WorkspaceId;
  readonly reason: PathRejectReason;
  /** The raw input the caller/tool supplied (a path, not a secret). */
  readonly attempted: string;
  /** Whether the refusal came from a realpath (symlink) re-check vs a pure string check. */
  readonly stage: "string" | "realpath";
}

export type WorkspaceAuditEvent = WorkspacePathRejected;

/** Sink for local workspace audit events (no secret values ever pass through). */
export type WorkspaceAuditSink = (event: WorkspaceAuditEvent) => void;
