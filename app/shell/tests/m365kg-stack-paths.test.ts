/**
 * ADR 0010 remaining work — run-mode-aware M365KG stack path resolution, mirroring
 * `packaged-paths.test.ts`'s two run-mode cases for the OpenCode binary.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";

import { resolveM365KGStackPaths } from "../src/service/m365kg-stack-paths.js";

test("packaged mode: stackRoot + migrations under userData/resourcesPath, never the read-only install dir", () => {
  const paths = resolveM365KGStackPaths({
    isPackaged: true,
    resourcesPath: "C:/Program Files/Cowork GHC/resources",
    userData: "C:/Users/x/AppData/Roaming/Cowork GHC",
    devAppRoot: "C:/repo",
  });
  assert.equal(paths.stackRoot, join("C:/Users/x/AppData/Roaming/Cowork GHC", "m365kg-stack"));
  assert.equal(paths.stack.stackRoot, paths.stackRoot);
  assert.equal(paths.stack.pgDataDir, join(paths.stackRoot, "pgdata"));
  assert.equal(paths.migrationsDir, join("C:/Program Files/Cowork GHC/resources", "m365kg-migrations"));
  assert.equal(paths.runtimeRoot, "C:/Users/x/AppData/Roaming/Cowork GHC");
});

test("dev mode: stackRoot under the repo's .runtime/, migrations read straight from app/backend/migrations", () => {
  const paths = resolveM365KGStackPaths({
    isPackaged: false,
    resourcesPath: "/ignored",
    userData: "/ignored",
    devAppRoot: "/repo",
  });
  assert.equal(paths.stackRoot, join("/repo", ".runtime", "m365kg-stack"));
  assert.equal(paths.migrationsDir, join("/repo", "app", "backend", "migrations"));
  assert.equal(paths.runtimeRoot, "/repo");
});
