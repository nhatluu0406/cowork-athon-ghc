/**
 * Server-side validation of a user-selected workspace folder (CGHC-008, W3 MUST).
 *
 * The UI never validates or grants a workspace itself: it hands the chosen absolute path
 * to the service, and THIS module — at the execution boundary — decides. It layers the
 * existing lexical `grantWorkspace` check (absolute / non-UNC / non-malformed) with a
 * disk probe (exists / is a directory / is writable). Only a fully valid folder becomes a
 * {@link WorkspaceGrant}; every rejection returns a stable, NON-SECRET reason + message and
 * NO grant, so a rejected pick can never become the active workspace or start a session.
 *
 * Filesystem access is injected via {@link WorkspaceFsProbe} so tests can drive every branch
 * without touching disk; the default {@link nodeFsProbe} is the production adapter.
 */

import { access, constants, stat } from "node:fs/promises";
import type { WorkspaceGrant } from "@cowork-ghc/contracts";
import { grantWorkspace, type GrantWorkspaceInput } from "./grant.js";
import { WorkspaceGrantError } from "./errors.js";

/** Why a workspace selection was refused. Stable, machine-readable, never a path/secret. */
export type WorkspaceRejectReason =
  | "not_absolute" // empty / relative / malformed root (from the lexical grant check)
  | "unc_path" // UNC / device / extended-length root
  | "not_found" // the folder does not exist on disk
  | "not_a_directory" // the path exists but is a file, not a directory
  | "not_writable"; // the directory exists but the process cannot write into it

/** Minimal stat result the probe returns; `undefined` means the path does not exist. */
export interface WorkspaceStat {
  readonly isDirectory: boolean;
}

/**
 * Injectable filesystem seam for validation. Kept tiny so tests can substitute a fake and
 * exercise every rejection branch deterministically, on any OS, without real files.
 */
export interface WorkspaceFsProbe {
  /** Resolve the stat of `path`, or `undefined` when it does not exist (ENOENT). */
  stat(path: string): Promise<WorkspaceStat | undefined>;
  /** True when the current process may create/write entries inside the directory `path`. */
  isWritable(path: string): Promise<boolean>;
}

/** Outcome of {@link validateWorkspaceSelection}: a grant, or a reasoned refusal. */
export type WorkspaceValidation =
  | { readonly ok: true; readonly grant: WorkspaceGrant }
  | { readonly ok: false; readonly reason: WorkspaceRejectReason; readonly message: string };

const REJECT_MESSAGE: Readonly<Record<WorkspaceRejectReason, string>> = {
  not_absolute: "The selected workspace must be an absolute local folder.",
  unc_path: "Network (UNC) and device paths cannot be used as a workspace.",
  not_found: "The selected folder no longer exists. Pick another folder.",
  not_a_directory: "The selected path is a file, not a folder. Pick a folder.",
  not_writable: "The selected folder is read-only. Pick a writable folder.",
};

function reject(reason: WorkspaceRejectReason): WorkspaceValidation {
  return { ok: false, reason, message: REJECT_MESSAGE[reason] };
}

/**
 * Validate a selected folder and, only when it is a writable existing directory with a safe
 * lexical root, return its {@link WorkspaceGrant}. Spaces and Unicode in the path are legal and
 * accepted (the whole path is treated as a single argument — never split or shell-interpolated).
 * Never embeds the raw path in the returned message.
 */
export async function validateWorkspaceSelection(
  input: GrantWorkspaceInput,
  probe: WorkspaceFsProbe,
): Promise<WorkspaceValidation> {
  // 1) Lexical safety first: reuse the single grant check (absolute / non-UNC / non-null).
  let grant: WorkspaceGrant;
  try {
    grant = grantWorkspace(input);
  } catch (err) {
    if (err instanceof WorkspaceGrantError) {
      const reason: WorkspaceRejectReason = err.reason === "unc_path" ? "unc_path" : "not_absolute";
      return reject(reason);
    }
    throw err; // never swallow an unexpected failure
  }

  // 2) Physical checks against the normalized root (existence / directory / writable).
  const info = await probe.stat(grant.rootPath);
  if (info === undefined) return reject("not_found");
  if (!info.isDirectory) return reject("not_a_directory");
  if (!(await probe.isWritable(grant.rootPath))) return reject("not_writable");

  return { ok: true, grant };
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { readonly code?: string }).code
    : undefined;
}

/** Production {@link WorkspaceFsProbe} backed by `node:fs/promises`. */
export function nodeFsProbe(): WorkspaceFsProbe {
  return {
    async stat(path: string): Promise<WorkspaceStat | undefined> {
      try {
        const s = await stat(path);
        return { isDirectory: s.isDirectory() };
      } catch (err) {
        if (errnoCode(err) === "ENOENT") return undefined;
        throw err; // permission/loop/etc. must not be silently treated as "missing"
      }
    },
    async isWritable(path: string): Promise<boolean> {
      // BEST-EFFORT pre-check only (review LOW): on Windows (the release target) `access(W_OK)`
      // reflects the read-only file attribute, which directories ignore — it does NOT consult
      // the directory ACL, so an ACL-denied folder may still return true here. The EXECUTION
      // boundary (WorkspaceGuard + the actual write) remains authoritative for write denial;
      // this only spares the user an obvious not-writable pick early. Not a hard guarantee.
      try {
        await access(path, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
  };
}
