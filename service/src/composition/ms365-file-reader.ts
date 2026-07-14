/**
 * Minimal workspace-confined {@link LocalFileReader} for MS365 SharePoint uploads (Task 11).
 *
 * There is no existing bytes-oriented file-read seam in this codebase shaped for
 * `LocalFileReader.readBytes` (the guarded {@link FileService} in `../files` returns UTF-8
 * `string`, not bytes, and gates writes only — reads are ungated). Rather than force a
 * mismatched cast or invent a parallel confinement mechanism, this adapter reuses the SAME
 * primitives every other file operation confines through: {@link grantWorkspace} turns the
 * active workspace root into a {@link WorkspaceGrant}, and {@link createWorkspaceGuard} +
 * `assertRealPathInside` perform the identical lexical-then-realpath confinement used by
 * `FileService`, `attachment-read.ts`, and `list.ts`. No new boundary is introduced.
 */
import { readFile } from "node:fs/promises";
import { grantWorkspace, createWorkspaceGuard } from "../workspace/index.js";
import type { LocalFileReader } from "../ms365/index.js";

/** Resolves the CURRENT active workspace root at call time (not captured at construction). */
export type ActiveWorkspaceRootLookup = () => string | undefined;

/**
 * Builds a {@link LocalFileReader} confined to whatever workspace is active when `readBytes`
 * is called. Throws a plain {@link Error} (no secret, no raw path) when no workspace is active
 * or the relative path escapes the granted root — the SAME confinement guarantee as every
 * other workspace-scoped read in this service.
 */
export function createWorkspaceLocalFileReader(
  activeWorkspaceRoot: ActiveWorkspaceRootLookup,
): LocalFileReader {
  return {
    async readBytes(relativePath: string): Promise<Uint8Array> {
      const rootPath = activeWorkspaceRoot();
      if (rootPath === undefined) {
        throw new Error("No active workspace is granted; select a workspace before uploading.");
      }
      const guard = createWorkspaceGuard(grantWorkspace({ rootPath }));
      const realPath = await guard.assertRealPathInside(relativePath);
      const buf = await readFile(realPath);
      return new Uint8Array(buf);
    },
  };
}
