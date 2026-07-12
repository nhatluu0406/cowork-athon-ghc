/**
 * Typed rejections for the workspace boundary (W4/F4).
 *
 * Every refusal carries a stable, non-secret {@link PathRejectReason} so the caller
 * (and the local audit trail) can classify why confinement blocked the operation.
 * Messages are deliberately generic and NEVER embed the escaping absolute/real path —
 * that would leak a filesystem location outside the granted workspace into an error
 * surface. The reason code is the machine-readable signal; the message is human context.
 */

import type { PathRejectReason } from "@cowork-ghc/contracts";

/** Thrown when a candidate child path escapes (or would escape) the workspace root. */
export class WorkspaceBoundaryError extends Error {
  readonly code = "workspace_boundary_violation" as const;
  readonly reason: PathRejectReason;
  constructor(reason: PathRejectReason, message: string) {
    super(message);
    this.name = "WorkspaceBoundaryError";
    this.reason = reason;
  }
}

/** Thrown when a workspace root itself cannot be granted (not absolute / UNC / malformed). */
export class WorkspaceGrantError extends Error {
  readonly code = "workspace_grant_invalid" as const;
  readonly reason: PathRejectReason;
  constructor(reason: PathRejectReason, message: string) {
    super(message);
    this.name = "WorkspaceGrantError";
    this.reason = reason;
  }
}
