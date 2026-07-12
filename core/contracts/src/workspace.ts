/**
 * Workspace contract types (W1/W3/W4/F4).
 *
 * Consumed by: the workspace grant/validate/confine surface in service/workspace
 * and rendered by app/ui (workspace picker + status). Pure data; path-safety
 * enforcement itself lives at the execution boundary, not in these types.
 */

/** Opaque identifier for a granted workspace. */
export type WorkspaceId = string;

/**
 * A user-granted workspace root. `rootPath` is the single confinement boundary;
 * all file operations must stay inside it (path-traversal guarded at the service
 * boundary, not here).
 */
export interface WorkspaceGrant {
  readonly id: WorkspaceId;
  /** Absolute, normalized root path the user granted. */
  readonly rootPath: string;
  /** ISO-8601 timestamp the grant was made. */
  readonly grantedAt: string;
}

/** Lightweight reference to the active workspace for UI/session binding. */
export interface WorkspaceRef {
  readonly id: WorkspaceId;
  readonly rootPath: string;
}

/**
 * Result of validating a candidate path against a workspace boundary. The boolean
 * is authoritative at the service; the UI only reflects it.
 */
export interface PathValidation {
  readonly ok: boolean;
  /** Normalized absolute path that was checked. */
  readonly resolvedPath: string;
  /** Present only when `ok` is false — a stable, non-secret reason code. */
  readonly reason?: PathRejectReason;
}

export type PathRejectReason =
  | "outside_workspace"
  | "traversal"
  | "symlink_escape"
  | "unc_path"
  | "not_absolute";
