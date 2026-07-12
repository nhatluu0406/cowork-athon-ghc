/**
 * CGHC-028 Wave C (packaging-completeness) — run-mode-aware path resolution.
 *
 * Proves `resolvePackagedPaths`:
 *   - PACKAGED: the pinned OpenCode binary resolves under `resourcesPath/opencode/opencode.exe`
 *     (shipped via extraResources, NOT node_modules) and the writable runtime root is `userData`
 *     (the install dir is read-only);
 *   - DEV: the binary resolves under `node_modules/opencode-ai/bin/opencode.exe` and the runtime
 *     root is left undefined (the caller defaults it to the writable workspace root).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";

import { resolvePackagedPaths } from "../src/service/packaged-paths.js";

test("packaged mode resolves the binary under resourcesPath and runtimeRoot to userData", () => {
  const paths = resolvePackagedPaths({
    isPackaged: true,
    resourcesPath: "C:/Program Files/Cowork GHC/resources",
    userData: "C:/Users/x/AppData/Roaming/Cowork GHC",
    devAppRoot: "C:/repo",
  });
  assert.equal(paths.binPath, join("C:/Program Files/Cowork GHC/resources", "opencode", "opencode.exe"));
  assert.equal(paths.runtimeRoot, "C:/Users/x/AppData/Roaming/Cowork GHC");
});

test("dev mode resolves the binary under node_modules and leaves runtimeRoot undefined", () => {
  const paths = resolvePackagedPaths({
    isPackaged: false,
    resourcesPath: "/ignored",
    userData: "/ignored",
    devAppRoot: "C:/repo",
  });
  assert.equal(paths.binPath, join("C:/repo", "node_modules", "opencode-ai", "bin", "opencode.exe"));
  assert.equal(paths.runtimeRoot, undefined);
});
