/**
 * Path allowlist unit test (CGHC-007, W4).
 *
 * Positive side of confinement: a granted workspace normalizes correctly, and legitimate
 * workspace-relative inputs (nested subdirs, spaces, Unicode, `./` prefixes, backslashes) resolve
 * to an absolute path *inside* the root. Also covers `assertInside` for an already-absolute path
 * and the create-case (`assertRealPathInside` for a not-yet-existing file inside the workspace).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createWorkspaceGuard,
  grantWorkspace,
  WorkspaceBoundaryError,
  WorkspaceGrantError,
} from "../src/workspace/index.js";

async function tempWorkspace(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "cghc-ws-ok-"));
}

test("grantWorkspace normalizes an absolute root and rejects a relative one", async () => {
  const root = await tempWorkspace();
  const grant = grantWorkspace({ rootPath: root, now: () => new Date("2026-07-11T00:00:00.000Z") });
  assert.equal(grant.rootPath, path.resolve(root));
  assert.equal(grant.grantedAt, "2026-07-11T00:00:00.000Z");
  assert.ok(grant.id.length > 0);
  assert.throws(() => grantWorkspace({ rootPath: "relative/dir" }), /absolute/i);
});

test("grantWorkspace accepts a real absolute root containing spaces and Unicode", async () => {
  // Windows paths routinely contain spaces (C:\Program Files, C:\Users\John Doe, My Documents).
  // Build a REAL directory with a space + Unicode so this exercises the filesystem, not a literal.
  const base = await mkdtemp(path.join(os.tmpdir(), "cghc-ws-space-"));
  const spaced = path.join(base, "John Doe", "My Workspace (dự án)");
  await mkdir(spaced, { recursive: true });
  const grant = grantWorkspace({ rootPath: spaced });
  assert.equal(grant.rootPath, path.resolve(spaced));
  // The grant is usable: a relative child under a spaced root still resolves inside.
  const guard = createWorkspaceGuard(grant);
  const v = guard.resolve("notes.txt");
  assert.equal(v.ok, true);
  assert.equal(v.resolvedPath, path.join(path.resolve(spaced), "notes.txt"));
});

test("grantWorkspace rejects an empty root and a NUL-byte-bearing root", async () => {
  const root = await tempWorkspace();
  const nul = String.fromCharCode(0);
  assert.throws(() => grantWorkspace({ rootPath: "" }), WorkspaceGrantError);
  assert.throws(() => grantWorkspace({ rootPath: "   " }), WorkspaceGrantError);
  assert.throws(
    () => grantWorkspace({ rootPath: `${root}${nul}evil` }),
    (err: unknown) => err instanceof WorkspaceGrantError && err.reason === "not_absolute",
  );
});

test("legitimate workspace-relative inputs resolve inside the root", async () => {
  const root = await tempWorkspace();
  const guard = createWorkspaceGuard(grantWorkspace({ rootPath: root }));
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["notes.txt", path.join(root, "notes.txt")],
    ["a/b/c.md", path.join(root, "a", "b", "c.md")],
    ["./deep/./file.json", path.join(root, "deep", "file.json")],
    ["sub\\win\\style.txt", path.join(root, "sub", "win", "style.txt")],
    ["My Projects (test)/a b.txt", path.join(root, "My Projects (test)", "a b.txt")],
    ["thư mục/tệp.txt", path.join(root, "thư mục", "tệp.txt")],
  ];
  for (const [input, expected] of cases) {
    const v = guard.resolve(input);
    assert.equal(v.ok, true, `expected ok for "${input}"`);
    assert.equal(v.resolvedPath, expected);
    assert.equal(guard.resolveOrThrow(input), expected);
  }
});

test("assertInside accepts an absolute path within the root and rejects one outside", async () => {
  const root = await tempWorkspace();
  const guard = createWorkspaceGuard(grantWorkspace({ rootPath: root }));
  assert.doesNotThrow(() => guard.assertInside(path.join(root, "x", "y.txt")));
  assert.doesNotThrow(() => guard.assertInside(root));
  assert.throws(
    () => guard.assertInside(path.join(path.dirname(root), "sibling", "z.txt")),
    WorkspaceBoundaryError,
  );
});

test("a sibling directory sharing a name prefix is NOT treated as inside", async () => {
  const root = await tempWorkspace();
  const guard = createWorkspaceGuard(grantWorkspace({ rootPath: root }));
  // `${root}-evil` shares the string prefix of `${root}` but is a different directory.
  assert.throws(() => guard.assertInside(`${root}-evil${path.sep}f.txt`), WorkspaceBoundaryError);
});

test("assertRealPathInside allows a not-yet-existing file inside the workspace (create case)", async () => {
  const root = await tempWorkspace();
  await mkdir(path.join(root, "existing"), { recursive: true });
  const guard = createWorkspaceGuard(grantWorkspace({ rootPath: root }));
  const real = await guard.assertRealPathInside("existing/new-file.txt");
  assert.equal(real, path.join(await realpathOf(root), "existing", "new-file.txt"));
});

async function realpathOf(p: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(p);
}
