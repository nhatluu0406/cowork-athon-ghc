/**
 * Approval-level classifier + request factory (CGHC-016, P4).
 *
 * The BOUNDARY decides the approval level from the action kind — the UI never chooses it
 * (a malicious/buggy client must not be able to downgrade a delete to `standard`). Both the
 * request factory and the gate derive the level from THIS pure function, so the level is
 * always boundary-authoritative.
 */

import type {
  ApprovalLevel,
  PermissionAction,
  PermissionActionKind,
  PermissionRequest,
  SessionId,
} from "@cowork-ghc/contracts";

/**
 * Classify the approval level for an action kind (P4). Destructive/irreversible or
 * arbitrary-code actions are `elevated` so the UI requires a stronger confirmation:
 *  - `file_delete`   — data loss.
 *  - `command_exec`  — arbitrary code execution.
 *  - `file_move`     — can overwrite/destroy a target; treated as elevated (defensive).
 * Additive/in-place edits are `standard`:
 *  - `file_create`, `file_edit`.
 *
 * The `switch` is exhaustive over {@link PermissionActionKind}; adding a kind without a
 * branch is a compile error (see the `never` default), so no kind silently defaults to a
 * weaker level.
 */
export function classifyApprovalLevel(kind: PermissionActionKind): ApprovalLevel {
  switch (kind) {
    case "file_delete":
    case "command_exec":
    case "file_move":
    case "ms365_write":
      // ms365_write — bounded external mutation (SharePoint upload); treat as elevated.
      return "elevated";
    case "file_create":
    case "file_edit":
      return "standard";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Inputs the execution boundary supplies when raising a permission request (P1). */
export interface PermissionRequestInput {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly action: PermissionAction;
  /** ISO-8601 timestamp the request was raised. */
  readonly requestedAt: string;
}

/**
 * Build a {@link PermissionRequest}, stamping the boundary-decided {@link ApprovalLevel}
 * from the action kind (P4). Callers cannot pass a level in — it is always classified here.
 */
export function createPermissionRequest(input: PermissionRequestInput): PermissionRequest {
  return {
    requestId: input.requestId,
    sessionId: input.sessionId,
    action: input.action,
    approvalLevel: classifyApprovalLevel(input.action.kind),
    requestedAt: input.requestedAt,
  };
}
