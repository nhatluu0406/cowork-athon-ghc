/**
 * Pure, disk-free path-safety resolver for the workspace boundary (W4/F4).
 *
 * Reference pattern only (`normalizeWorkspaceRelativePath`/`resolveSafeChildPath`,
 * design §5) — re-implemented, never copied. This layer does NO filesystem access: it is
 * string math (`path.resolve`) plus prefix containment, so it can never *open* a file
 * outside the workspace. Symlink escapes are a physical property and are handled by the
 * realpath layer (`realpath.ts`); here we block the lexical vectors: null bytes, UNC /
 * device paths, absolute / drive-qualified escapes, and `..` traversal.
 */

import path from "node:path";
import type { PathRejectReason, PathValidation } from "@cowork-ghc/contracts";

/**
 * Single definition of the NUL character, built via `String.fromCharCode(0)` so the byte is
 * never an invisible literal embedded in source (which previously diverged between files).
 */
const NUL = String.fromCharCode(0);

/** True when `value` contains a NUL byte — a classic path-truncation / injection vector. */
export function hasNullByte(value: string): boolean {
  return value.includes(NUL);
}

/** Windows is case-insensitive; normalize case there so `C:\WS` == `c:\ws` for comparison. */
function normCase(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * True when `candidate` (absolute) is the root itself or a descendant of it. Comparison is
 * case-insensitive on win32 and uses a trailing separator so `C:\ws-evil` is NOT treated as
 * inside `C:\ws`.
 */
export function isInsideRoot(root: string, candidate: string): boolean {
  const r = normCase(path.resolve(root));
  const c = normCase(path.resolve(candidate));
  if (c === r) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return c.startsWith(prefix);
}

/** Detect UNC (`\\server\share`, `//server/share`) and Windows device / extended-length
 * paths (`\\?\...`, `\\.\...`). Any path beginning with two separators is refused. */
export function isUncOrDevicePath(raw: string): boolean {
  return /^[\\/]{2}/.test(raw);
}

/** Detect an absolute or drive-qualified input (`/etc`, `C:\`, `C:foo`, `\\` handled above). */
function isAbsoluteOrDriveQualified(raw: string): boolean {
  return path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw);
}

/** Split on either separator and drop empty segments to inspect for `..` traversal. */
function hasParentSegment(raw: string): boolean {
  return raw
    .split(/[\\/]+/)
    .filter(Boolean)
    .includes("..");
}

function reject(root: string, reason: PathRejectReason): PathValidation {
  // Never surface an escaping absolute path: report the root (the boundary) instead.
  return { ok: false, resolvedPath: root, reason };
}

/**
 * Resolve a workspace-*relative* input against `root`, refusing any lexical escape. Returns a
 * {@link PathValidation}: `ok:true` with the resolved absolute path when safe, otherwise
 * `ok:false` with a stable reason. Pure — touches no disk. An empty/whitespace input maps to
 * the root itself (inside the boundary); callers that require a concrete child enforce that
 * separately (e.g. the files task).
 */
export function resolveWorkspacePath(root: string, input: string): PathValidation {
  const rootResolved = path.resolve(root);
  if (typeof input !== "string" || hasNullByte(input)) {
    return reject(rootResolved, "traversal");
  }
  const raw = input.trim();
  if (raw === "") return { ok: true, resolvedPath: rootResolved };
  if (isUncOrDevicePath(raw)) return reject(rootResolved, "unc_path");
  if (isAbsoluteOrDriveQualified(raw)) return reject(rootResolved, "outside_workspace");
  if (hasParentSegment(raw)) return reject(rootResolved, "traversal");
  const candidate = path.resolve(rootResolved, raw);
  // Belt-and-suspenders: even if the lexical checks missed a vector, containment is authoritative.
  if (!isInsideRoot(rootResolved, candidate)) {
    return reject(rootResolved, "outside_workspace");
  }
  return { ok: true, resolvedPath: candidate };
}
