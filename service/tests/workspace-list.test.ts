/**
 * Minimal Workspace Navigator listing boundary.
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { listWorkspaceChildren } from "../src/workspace/list.js";

async function tempWorkspace(): Promise<{ base: string; root: string }> {
  const base = await mkdtemp(join(tmpdir(), "cghc-workspace-list-"));
  const root = resolve(join(base, "workspace"));
  await mkdir(root, { recursive: true });
  return { base, root };
}

test("lists direct children with folders first and bounded metadata", async () => {
  const { base, root } = await tempWorkspace();
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "README.md"), "# Hello", "utf8");
    await writeFile(join(root, "package.json"), "{}", "utf8");

    const result = await listWorkspaceChildren(root);
    assert.equal(result.parentPath, "");
    assert.deepEqual(result.entries.map((entry) => [entry.kind, entry.name]), [
      ["folder", "src"],
      ["file", "package.json"],
      ["file", "README.md"],
    ]);
    assert.equal(result.entries.find((entry) => entry.name === "README.md")?.extension, ".md");
    assert.equal(typeof result.entries.find((entry) => entry.name === "README.md")?.sizeBytes, "number");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("lazy-loads child folder and applies request limit", async () => {
  const { base, root } = await tempWorkspace();
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "b.ts"), "b", "utf8");
    await writeFile(join(root, "src", "a.ts"), "a", "utf8");

    const result = await listWorkspaceChildren(root, { relativePath: "src", limit: 1 });
    assert.equal(result.parentPath, "src");
    assert.equal(result.entries.length, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.entries[0]?.name, "a.ts");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("does not list symlink targets that escape the workspace", async () => {
  const base = await mkdtemp(join(tmpdir(), "cghc-workspace-list-esc-"));
  const root = resolve(join(base, "workspace"));
  const outside = resolve(join(base, "outside"));
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "secret.txt"), "secret", "utf8");
  let symlinkOk = false;
  try {
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, join(root, "link-out"), type);
    symlinkOk = true;
  } catch {
    symlinkOk = false;
  }

  try {
    if (!symlinkOk) return;
    const result = await listWorkspaceChildren(root);
    assert.equal(result.entries.some((entry) => entry.name === "link-out"), false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
