/**
 * Physical (symlink-aware) confinement for the workspace boundary (W4/F4).
 *
 * The lexical resolver (`path-safety.ts`) cannot see a symlink whose *target* lives outside
 * the workspace: `path.resolve` never touches disk. This layer canonicalizes real paths with
 * `fs.realpath` and re-checks containment, so a file inside the workspace that symlinks out is
 * refused. This is the seam CGHC-016/018 (permission) calls on *every* proxied tool-permission
 * event: re-validate the resolved real path so no tool call can escape via a symlink.
 */

import { realpath } from "node:fs/promises";
import path from "node:path";
import { isInsideRoot } from "./path-safety.js";

interface NodeErrno {
  readonly code?: string;
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as NodeErrno).code : undefined;
}

/**
 * Canonicalize `target` even when the leaf (or a suffix of it) does not yet exist — needed for
 * create operations. Walks up to the nearest existing ancestor, resolves *its* real path
 * (following any symlinks in the existing prefix), then re-appends the not-yet-existing tail.
 * Throws for any non-ENOENT error (e.g. permission/loop) rather than silently allowing.
 */
export async function realpathAllowingMissing(target: string): Promise<string> {
  let current = path.resolve(target);
  const missingTail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      if (missingTail.length === 0) return real;
      return path.join(real, ...missingTail.reverse());
    } catch (err) {
      if (errnoCode(err) !== "ENOENT") throw err;
      const parent = path.dirname(current);
      if (parent === current) throw err; // reached a filesystem root; nothing on this path exists
      missingTail.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Re-validate that `candidateAbsolutePath` — after full symlink resolution — is still inside
 * `root` (whose own real path is resolved too, so a symlinked root compares correctly).
 * Returns the canonical real path when safe; returns `undefined` when it escapes (the caller
 * maps that to a `symlink_escape` rejection + audit). Never returns an out-of-workspace path.
 */
export async function realPathInsideRoot(
  root: string,
  candidateAbsolutePath: string,
): Promise<string | undefined> {
  const realRoot = await realpath(path.resolve(root));
  const realCandidate = await realpathAllowingMissing(candidateAbsolutePath);
  return isInsideRoot(realRoot, realCandidate) ? realCandidate : undefined;
}
