/**
 * Workspace selection validation unit test (CGHC-008, W3 MUST).
 *
 * Drives every branch of `validateWorkspaceSelection` with an injected filesystem seam (no real
 * disk): a writable existing directory is GRANTED; a missing path, a file (not a directory), a
 * read-only directory, a relative/empty root, and a UNC root are each REJECTED with a stable,
 * non-secret reason and NO grant. Asserts the outcome carries no grant on rejection so a bad pick
 * can never become the active workspace / start a session.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  validateWorkspaceSelection,
  type WorkspaceFsProbe,
  type WorkspaceStat,
} from "../src/workspace/index.js";

/** A fake probe driven by two lookup maps, so tests never touch the real filesystem. */
function fakeProbe(
  stats: Readonly<Record<string, WorkspaceStat | undefined>>,
  writable: ReadonlySet<string>,
): WorkspaceFsProbe {
  return {
    stat: async (p) => stats[p],
    isWritable: async (p) => writable.has(p),
  };
}

const ROOT = path.resolve("C:/Users/test/My Projects");

test("a writable existing directory is granted", async () => {
  const probe = fakeProbe({ [ROOT]: { isDirectory: true } }, new Set([ROOT]));
  const result = await validateWorkspaceSelection({ rootPath: ROOT }, probe);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.grant.rootPath, ROOT);
    assert.ok(result.grant.id.length > 0);
    assert.ok(result.grant.grantedAt.length > 0);
  }
});

test("a missing folder is rejected as not_found with NO grant", async () => {
  const probe = fakeProbe({ [ROOT]: undefined }, new Set());
  const result = await validateWorkspaceSelection({ rootPath: ROOT }, probe);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "not_found");
    assert.ok(result.message.length > 0);
    assert.ok(!("grant" in result), "a rejection must not carry a grant");
    assert.ok(!result.message.includes(ROOT), "message must not leak the raw path");
  }
});

test("a file (not a directory) is rejected as not_a_directory with NO grant", async () => {
  const probe = fakeProbe({ [ROOT]: { isDirectory: false } }, new Set([ROOT]));
  const result = await validateWorkspaceSelection({ rootPath: ROOT }, probe);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_a_directory");
});

test("a read-only directory is rejected as not_writable with NO grant", async () => {
  const probe = fakeProbe({ [ROOT]: { isDirectory: true } }, new Set());
  const result = await validateWorkspaceSelection({ rootPath: ROOT }, probe);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_writable");
});

test("a relative/empty root is rejected lexically before any disk probe", async () => {
  let probed = false;
  const probe: WorkspaceFsProbe = {
    stat: async () => {
      probed = true;
      return { isDirectory: true };
    },
    isWritable: async () => true,
  };
  const relative = await validateWorkspaceSelection({ rootPath: "some/relative/dir" }, probe);
  assert.equal(relative.ok, false);
  if (!relative.ok) assert.equal(relative.reason, "not_absolute");

  const empty = await validateWorkspaceSelection({ rootPath: "   " }, probe);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, "not_absolute");
  assert.equal(probed, false, "a lexically-invalid root must never reach the disk probe");
});

test("a UNC / network root is rejected as unc_path", async () => {
  const probe = fakeProbe({}, new Set());
  const result = await validateWorkspaceSelection(
    { rootPath: "\\\\server\\share\\ws" },
    probe,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "unc_path");
});
