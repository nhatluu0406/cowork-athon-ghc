/**
 * Canonical workspace-relative path resolution (W4/F4).
 *
 * Resolves a candidate absolute or workspace-relative path against the active workspace using
 * `fs.realpath` confinement — never substring or folder-basename heuristics. Create targets whose
 * leaf does not yet exist are resolved via {@link realpathAllowingMissing} on the parent chain.
 */

import { realpath } from "node:fs/promises";
import path from "node:path";
import type { PathRejectReason } from "@cowork-ghc/contracts";
import {
  hasNullByte,
  isInsideRoot,
  isUncOrDevicePath,
  resolveWorkspacePath,
} from "./path-safety.js";
import { realPathInsideRoot } from "./realpath.js";

export type ResolveWorkspaceRelativeResult =
  | { readonly ok: true; readonly relativePath: string }
  | { readonly ok: false; readonly reason: PathRejectReason };

function isAbsoluteOrDriveQualified(raw: string): boolean {
  return path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw);
}

function toPosixRelative(rootReal: string, targetReal: string): string {
  const rel = path.relative(rootReal, targetReal).replace(/\\/g, "/");
  if (rel === "" || rel === ".") return ".";
  return rel;
}

function hasParentInRelative(rel: string): boolean {
  return rel.split("/").filter(Boolean).includes("..");
}

/**
 * Resolve `candidatePath` to a canonical workspace-relative POSIX path, or refuse when the
 * canonical target is outside the workspace or escapes via symlink.
 */
export async function resolveWorkspaceRelativePath(
  workspaceRoot: string,
  candidatePath: string,
): Promise<ResolveWorkspaceRelativeResult> {
  if (typeof candidatePath !== "string" || hasNullByte(candidatePath)) {
    return { ok: false, reason: "traversal" };
  }
  const raw = candidatePath.trim();
  if (raw === "") return { ok: false, reason: "outside_workspace" };

  const rootResolved = path.resolve(workspaceRoot);

  if (!isAbsoluteOrDriveQualified(raw) && !isUncOrDevicePath(raw) && !raw.startsWith("\\")) {
    const validation = resolveWorkspacePath(rootResolved, raw);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason ?? "outside_workspace" };
    }
    const realSafe = await realPathInsideRoot(rootResolved, validation.resolvedPath);
    if (realSafe === undefined) return { ok: false, reason: "symlink_escape" };
    const realRoot = await realpath(rootResolved);
    const relativePath = toPosixRelative(realRoot, realSafe);
    if (hasParentInRelative(relativePath)) return { ok: false, reason: "outside_workspace" };
    return { ok: true, relativePath };
  }

  if (isUncOrDevicePath(raw)) return { ok: false, reason: "unc_path" };

  const absCandidate = path.resolve(raw);
  const realSafe = await realPathInsideRoot(rootResolved, absCandidate);
  if (realSafe === undefined) {
    if (!isInsideRoot(rootResolved, absCandidate)) {
      return { ok: false, reason: "outside_workspace" };
    }
    return { ok: false, reason: "symlink_escape" };
  }

  const realRoot = await realpath(rootResolved);
  const relativePath = toPosixRelative(realRoot, realSafe);
  if (hasParentInRelative(relativePath)) return { ok: false, reason: "outside_workspace" };
  return { ok: true, relativePath };
}
