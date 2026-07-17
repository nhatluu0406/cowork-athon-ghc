/**
 * Unit tests for {@link resolveCoworkDataPaths}.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  COWORK_GHC_RUNTIME_ROOT_ENV,
  CoworkDataPathError,
  resolveCoworkDataPaths,
} from "../src/service/cowork-data-paths.js";

test("packaged mode resolves under LOCALAPPDATA\\Cowork GHC\\data", () => {
  const paths = resolveCoworkDataPaths({
    isPackaged: true,
    repoRoot: "C:/repo",
    localAppData: "C:/Users/x/AppData/Local",
    ensureDirectories: false,
    env: {},
  });
  assert.equal(paths.dataRoot, "C:\\Users\\x\\AppData\\Local\\Cowork GHC\\data");
  assert.equal(paths.databasePath, "C:\\Users\\x\\AppData\\Local\\Cowork GHC\\data\\cowork-ghc.db");
  assert.equal(paths.backupRoot, "C:\\Users\\x\\AppData\\Local\\Cowork GHC\\data\\backups");
  assert.equal(paths.logRoot, "C:\\Users\\x\\AppData\\Local\\Cowork GHC\\data\\logs");
});

test("packaged mode fails clearly when LOCALAPPDATA is missing", () => {
  assert.throws(
    () =>
      resolveCoworkDataPaths({
        isPackaged: true,
        repoRoot: "C:/repo",
        ensureDirectories: false,
        env: {},
      }),
    (error: unknown) => error instanceof CoworkDataPathError && /LOCALAPPDATA/i.test(error.message),
  );
});

test("development mode resolves under <repo>\\.runtime\\data", () => {
  const paths = resolveCoworkDataPaths({
    isPackaged: false,
    repoRoot: "C:/Workspace/cowork-athon-ghc",
    ensureDirectories: false,
    env: {},
  });
  assert.equal(paths.databasePath, "C:\\Workspace\\cowork-athon-ghc\\.runtime\\data\\cowork-ghc.db");
});

test("COWORK_GHC_RUNTIME_ROOT overrides packaged and development defaults", () => {
  const root = mkdtempSync(join(tmpdir(), "cghc-runtime-"));
  try {
    const paths = resolveCoworkDataPaths({
      isPackaged: true,
      repoRoot: "C:/repo",
      localAppData: "C:/Users/x/AppData/Local",
      env: { [COWORK_GHC_RUNTIME_ROOT_ENV]: root },
    });
    assert.equal(paths.databasePath, join(root, "data", "cowork-ghc.db"));
    assert.ok(existsSync(paths.backupRoot));
    assert.ok(existsSync(paths.logRoot), "ensureDirectories creates the logs dir");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime root override must be absolute", () => {
  assert.throws(
    () =>
      resolveCoworkDataPaths({
        isPackaged: false,
        repoRoot: "C:/repo",
        ensureDirectories: false,
        env: { [COWORK_GHC_RUNTIME_ROOT_ENV]: "relative/path" },
      }),
    CoworkDataPathError,
  );
});
