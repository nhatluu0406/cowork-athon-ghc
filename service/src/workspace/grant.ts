/**
 * `grantWorkspace` — turn a user-selected folder into the single confinement boundary (W1/W4).
 *
 * This validates and normalizes the *root* only; it does not check existence/writability (that
 * is W3 / the picker task CGHC-008). A granted root must be a plain absolute local path: UNC and
 * device/extended-length roots are refused here so no downstream comparison has to reason about
 * `\\server\share` surprises. The returned {@link WorkspaceGrant} is the immutable handle every
 * file operation confines against at the execution boundary.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { WorkspaceGrant, WorkspaceId } from "@cowork-ghc/contracts";
import { WorkspaceGrantError } from "./errors.js";
import { hasNullByte, isUncOrDevicePath } from "./path-safety.js";

export interface GrantWorkspaceInput {
  /** The absolute local folder the user granted. */
  readonly rootPath: string;
  /** Optional stable id; a random UUID is generated when omitted. */
  readonly id?: WorkspaceId;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

/**
 * Validate + normalize a workspace root into a {@link WorkspaceGrant}. Throws
 * {@link WorkspaceGrantError} (with a stable reason) for a non-absolute, UNC/device, empty, or
 * null-byte-bearing root. Spaces and Unicode in the root are legitimate and accepted. Never
 * embeds the raw path in the thrown message.
 */
export function grantWorkspace(input: GrantWorkspaceInput): WorkspaceGrant {
  const raw = (input.rootPath ?? "").trim();
  if (raw === "" || hasNullByte(raw)) {
    throw new WorkspaceGrantError("not_absolute", "Workspace root is empty or malformed.");
  }
  if (isUncOrDevicePath(raw)) {
    throw new WorkspaceGrantError("unc_path", "UNC/device workspace roots are not allowed.");
  }
  if (!path.isAbsolute(raw)) {
    throw new WorkspaceGrantError("not_absolute", "Workspace root must be an absolute path.");
  }
  const rootPath = path.resolve(raw);
  return {
    id: input.id ?? randomUUID(),
    rootPath,
    grantedAt: (input.now?.() ?? new Date()).toISOString(),
  };
}
