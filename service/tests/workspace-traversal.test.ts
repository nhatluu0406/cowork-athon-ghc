/**
 * Path traversal negative test (CGHC-007, W4/F4).
 *
 * On a REAL temp workspace with a REAL sibling "outside" dir holding a secret file, every escape
 * vector — `..`, absolute path, UNC/device path, and a symlink/junction whose target leaves the
 * workspace — is refused, recorded via the audit sink, and never resolves to the outside file.
 * F4: assert no file outside the workspace is touched (the outside secret is unchanged and is
 * never returned as a valid resolved/real path).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createWorkspaceGuard,
  grantWorkspace,
  realPathInsideRoot,
  WorkspaceBoundaryError,
  type WorkspaceAuditEvent,
} from "../src/workspace/index.js";

interface Fixture {
  readonly root: string;
  readonly outsideDir: string;
  readonly secretFile: string;
  readonly secretText: string;
}

async function makeFixture(): Promise<Fixture> {
  const base = await mkdtemp(path.join(os.tmpdir(), "cghc-ws-esc-"));
  const root = path.join(base, "workspace");
  const outsideDir = path.join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outsideDir, { recursive: true });
  const secretFile = path.join(outsideDir, "secret.txt");
  const secretText = "OUT-OF-WORKSPACE-DO-NOT-TOUCH";
  await writeFile(secretFile, secretText, "utf8");
  return { root, outsideDir, secretFile, secretText };
}

test(".., absolute, and UNC inputs are refused, recorded, and never resolve outside", async () => {
  const fx = await makeFixture();
  const events: WorkspaceAuditEvent[] = [];
  const grant = grantWorkspace({ rootPath: fx.root });
  const guard = createWorkspaceGuard(grant, { audit: (e) => events.push(e) });
  // A separate, un-audited guard proves the throwing variant without polluting the event count
  // (resolveOrThrow internally calls resolve, which itself records).
  const throwingGuard = createWorkspaceGuard(grant);

  const vectors: ReadonlyArray<readonly [string, string, string]> = [
    ["parent traversal", "../outside/secret.txt", "traversal"],
    ["deep traversal", "a/b/../../../outside/secret.txt", "traversal"],
    ["absolute posix", "/etc/passwd", "outside_workspace"],
    ["absolute drive", fx.secretFile, "outside_workspace"],
    ["drive-qualified", "C:secret.txt", "outside_workspace"],
    ["unc share", "\\\\evil-server\\share\\secret.txt", "unc_path"],
    ["unc forward", "//evil-server/share/secret.txt", "unc_path"],
    ["device path", "\\\\?\\C:\\Windows\\system32", "unc_path"],
  ];

  for (const [label, input, expectedReason] of vectors) {
    const v = guard.resolve(input);
    assert.equal(v.ok, false, `${label} must be refused`);
    assert.equal(v.reason, expectedReason, `${label} reason`);
    // The rejection never surfaces the escaping absolute path — it reports the boundary root.
    assert.equal(v.resolvedPath, path.resolve(fx.root), `${label} must not leak outside path`);
    assert.throws(() => throwingGuard.resolveOrThrow(input), WorkspaceBoundaryError, `${label} throws`);
  }

  // Every refusal was recorded (exactly one per audited resolve() call above).
  assert.equal(events.length, vectors.length);
  assert.deepEqual(
    events.map((e) => e.reason),
    vectors.map(([, , reason]) => reason),
  );
  assert.ok(events.every((e) => e.type === "workspace_path_rejected"));

  // F4: the out-of-workspace secret was never touched.
  assert.equal(await readFile(fx.secretFile, "utf8"), fx.secretText);
});

test("a symlink/junction escaping the workspace is refused by the realpath guard", async () => {
  const fx = await makeFixture();
  const events: WorkspaceAuditEvent[] = [];
  const guard = createWorkspaceGuard(grantWorkspace({ rootPath: fx.root }), {
    audit: (e) => events.push(e),
  });

  const linkDir = path.join(fx.root, "link-out");
  let symlinkRan = false;
  try {
    // Junctions do not require elevation on Windows; on POSIX a dir symlink is used.
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(fx.outsideDir, linkDir, type);
    symlinkRan = true;
  } catch {
    symlinkRan = false;
  }

  if (symlinkRan) {
    // The input is lexically clean ("link-out/secret.txt" has no .., no absolute) so ONLY the
    // realpath layer can catch it — proving symlink-aware confinement.
    await assert.rejects(
      guard.assertRealPathInside("link-out/secret.txt"),
      (err: unknown) =>
        err instanceof WorkspaceBoundaryError && err.reason === "symlink_escape",
      "symlinked target must be refused as symlink_escape",
    );
    assert.ok(
      events.some((e) => e.reason === "symlink_escape"),
      "symlink escape must be recorded",
    );
    // F4: the outside secret is unchanged and was never returned as a valid real path.
    assert.equal(await readFile(fx.secretFile, "utf8"), fx.secretText);
  } else {
    // Fallback (OS blocked link creation without privilege): assert the realpath guard rejects a
    // crafted escaping real path directly — the same guard the symlink case exercises.
    const escapeReal = await realPathInsideRoot(fx.root, fx.secretFile);
    assert.equal(escapeReal, undefined, "realPathInsideRoot must reject an outside real path");
  }
  // Document which branch ran for the evidence note.
  assert.equal(typeof symlinkRan, "boolean");
});

test("realPathInsideRoot returns the canonical path for a real file inside the workspace", async () => {
  const fx = await makeFixture();
  const inside = path.join(fx.root, "inside.txt");
  await writeFile(inside, "ok", "utf8");
  const real = await realPathInsideRoot(fx.root, inside);
  assert.equal(real, path.join(await realpath(fx.root), "inside.txt"));
});
