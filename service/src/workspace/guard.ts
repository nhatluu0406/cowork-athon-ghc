/**
 * `WorkspaceGuard` — the confinement surface every downstream file op calls at the execution
 * boundary (W4/F4). It binds a {@link WorkspaceGrant} to an optional audit sink and layers the
 * two defenses: the lexical resolver (`path-safety.ts`) and the symlink-aware realpath check
 * (`realpath.ts`). Enforcement lives HERE, in the service — never in the UI.
 *
 * Seam for CGHC-016/018 (permission): on every proxied tool-permission event, call
 * {@link WorkspaceGuard.assertRealPathInside} with the tool's target path. It re-validates the
 * *resolved real path* so a symlink/UNC/`..` tool argument cannot escape the workspace. A refusal
 * throws {@link WorkspaceBoundaryError} and is recorded via the audit sink.
 */

import type { PathValidation, WorkspaceGrant } from "@cowork-ghc/contracts";
import type { WorkspaceAuditSink } from "./audit.js";
import { WorkspaceBoundaryError } from "./errors.js";
import { isInsideRoot, resolveWorkspacePath } from "./path-safety.js";
import { realPathInsideRoot } from "./realpath.js";

export interface WorkspaceGuardOptions {
  /** Local sink notified on every refusal (P5). Omit to disable auditing. */
  readonly audit?: WorkspaceAuditSink;
}

export interface WorkspaceGuard {
  readonly grant: WorkspaceGrant;
  /** Non-throwing lexical safety check for a workspace-relative input. Records a refusal. */
  resolve(input: string): PathValidation;
  /** Throwing lexical variant: returns the safe absolute path or throws + records the refusal. */
  resolveOrThrow(input: string): string;
  /** Assert an already-absolute path (e.g. a realpath from a tool event) is inside the root. */
  assertInside(absolutePath: string): void;
  /** Realpath re-validation seam (CGHC-016/018): resolves symlinks, then confines. */
  assertRealPathInside(input: string): Promise<string>;
}

class WorkspaceGuardImpl implements WorkspaceGuard {
  constructor(
    readonly grant: WorkspaceGrant,
    private readonly audit?: WorkspaceAuditSink,
  ) {}

  resolve(input: string): PathValidation {
    const validation = resolveWorkspacePath(this.grant.rootPath, input);
    if (!validation.ok && validation.reason !== undefined) {
      this.record(validation.reason, input, "string");
    }
    return validation;
  }

  resolveOrThrow(input: string): string {
    const validation = this.resolve(input);
    if (!validation.ok) {
      throw new WorkspaceBoundaryError(
        validation.reason ?? "outside_workspace",
        "Path is outside the granted workspace.",
      );
    }
    return validation.resolvedPath;
  }

  assertInside(absolutePath: string): void {
    if (!isInsideRoot(this.grant.rootPath, absolutePath)) {
      this.record("outside_workspace", absolutePath, "realpath");
      throw new WorkspaceBoundaryError(
        "outside_workspace",
        "Resolved path is outside the granted workspace.",
      );
    }
  }

  async assertRealPathInside(input: string): Promise<string> {
    // 1) Lexical safety first (blocks .., absolute, UNC, drive-qualified before any disk touch).
    const safeLexical = this.resolveOrThrow(input);
    // 2) Symlink-aware: canonicalize and re-confine so a symlinked target can't escape.
    const realSafe = await realPathInsideRoot(this.grant.rootPath, safeLexical);
    if (realSafe === undefined) {
      this.record("symlink_escape", input, "realpath");
      throw new WorkspaceBoundaryError(
        "symlink_escape",
        "Resolved real path escapes the granted workspace.",
      );
    }
    return realSafe;
  }

  private record(reason: PathValidation["reason"], attempted: string, stage: "string" | "realpath"): void {
    if (reason === undefined) return;
    this.audit?.({
      type: "workspace_path_rejected",
      workspaceId: this.grant.id,
      reason,
      attempted,
      stage,
    });
  }
}

/** Build a {@link WorkspaceGuard} bound to a granted workspace. */
export function createWorkspaceGuard(
  grant: WorkspaceGrant,
  options: WorkspaceGuardOptions = {},
): WorkspaceGuard {
  return new WorkspaceGuardImpl(grant, options.audit);
}
