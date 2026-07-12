/**
 * Spaces + Unicode workspace path test (CGHC-008, MUST).
 *
 * A folder whose name contains spaces AND parentheses AND non-ASCII Unicode (e.g.
 * "My Projects (tệp) — 日本語") is a legitimate workspace. It must validate against the REAL
 * filesystem (`nodeFsProbe`) and resolve to the correct absolute path with NO lexical mangling
 * (the whole path is one argument — never split on spaces, never shell-interpolated), and it must
 * still confine correctly: the root is inside itself and a child stays inside; a `..` escape is
 * still refused. This proves the path is treated as data, not a shell string.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  validateWorkspaceSelection,
  nodeFsProbe,
  isInsideRoot,
  resolveWorkspacePath,
} from "../src/workspace/index.js";

const TRICKY_NAME = "My Projects (tệp) — 日本語 space";

test("a path with spaces + Unicode validates and resolves to the exact absolute path", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "cghc-ws-uni-"));
  const root = path.join(base, TRICKY_NAME);
  await mkdir(root, { recursive: true });

  const result = await validateWorkspaceSelection({ rootPath: root }, nodeFsProbe());
  assert.equal(result.ok, true, "a real writable Unicode/space dir must be granted");
  if (!result.ok) return;

  // No lexical mangling: the granted root is exactly the resolved input (spaces/Unicode intact).
  assert.equal(result.grant.rootPath, path.resolve(root));
  assert.ok(result.grant.rootPath.includes(TRICKY_NAME), "the tricky name survives verbatim");

  // Confinement still holds for this root: it is inside itself, a child stays inside, `..` escapes.
  assert.equal(isInsideRoot(result.grant.rootPath, result.grant.rootPath), true);
  const child = resolveWorkspacePath(result.grant.rootPath, "notes/日本語.txt");
  assert.equal(child.ok, true);
  assert.equal(child.resolvedPath, path.join(result.grant.rootPath, "notes", "日本語.txt"));
  assert.equal(isInsideRoot(result.grant.rootPath, child.resolvedPath), true);

  const escape = resolveWorkspacePath(result.grant.rootPath, "../outside.txt");
  assert.equal(escape.ok, false, "a traversal escape is still refused even with a tricky root");
});
