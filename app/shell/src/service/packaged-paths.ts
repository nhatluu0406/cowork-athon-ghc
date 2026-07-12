/**
 * Packaged-aware path resolution for the pinned OpenCode binary + the writable runtime root
 * (CGHC-028 Wave C, packaging-completeness fix).
 *
 * In DEV the shell runs from the repo tree: the pinned binary lives under
 * `node_modules/opencode-ai/bin/opencode.exe` and `.runtime/` may live under the workspace/repo.
 *
 * In a PACKAGED app the install dir is read-only and there is no `node_modules/opencode-ai`:
 *   - the 157MB binary is shipped via electron-builder `extraResources` to
 *     `<resourcesPath>/opencode/opencode.exe` (outside the asar, spawnable from disk);
 *   - the per-launch `.runtime/` state MUST go to a WRITABLE location — Electron's `userData`
 *     dir — never the read-only install directory.
 *
 * Pure + injectable (no `electron` import) so it is unit-testable; `main.ts` feeds it the real
 * `app.isPackaged` / `process.resourcesPath` / `app.getPath("userData")` values.
 */

import { join } from "node:path";

export interface PackagedPathsInput {
  /** `true` in a packaged build, `false` when running from the repo (dev). */
  readonly isPackaged: boolean;
  /** Electron `process.resourcesPath` (the packaged `resources/` dir). */
  readonly resourcesPath: string;
  /** Electron `app.getPath("userData")` — a per-user writable dir. */
  readonly userData: string;
  /** Repo/app root used in dev to locate `node_modules/opencode-ai/bin/opencode.exe`. */
  readonly devAppRoot: string;
}

export interface PackagedPaths {
  /** Absolute path to the pinned OpenCode binary for this run mode. */
  readonly binPath: string;
  /**
   * Writable root under which per-launch `.runtime/` state lives, or `undefined` in dev (the
   * caller then defaults it to the workspace root — the repo tree is writable in dev).
   */
  readonly runtimeRoot: string | undefined;
}

/** Resolve the OpenCode binary path + writable runtime root for the current run mode. */
export function resolvePackagedPaths(input: PackagedPathsInput): PackagedPaths {
  if (input.isPackaged) {
    return {
      binPath: join(input.resourcesPath, "opencode", "opencode.exe"),
      runtimeRoot: input.userData,
    };
  }
  return {
    binPath: join(input.devAppRoot, "node_modules", "opencode-ai", "bin", "opencode.exe"),
    runtimeRoot: undefined,
  };
}
