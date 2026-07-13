/**
 * Canonical workspace-relative path resolution tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveWorkspaceRelativePath } from "../src/workspace/resolve-relative.js";

async function makeWorkspace(label: string): Promise<string> {
  const base = await mkdtemp(path.join(os.tmpdir(), `cghc-resolve-${label}-`));
  const root = path.join(base, "my workspace");
  await mkdir(root, { recursive: true });
  return realpath(root);
}

test("resolveWorkspaceRelativePath: normal absolute path inside workspace", async () => {
  const root = await makeWorkspace("inside");
  const file = path.join(root, "src", "a.ts");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "ok", "utf8");
  const resolved = await resolveWorkspaceRelativePath(root, file);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.relativePath, "src/a.ts");
});

test("resolveWorkspaceRelativePath: workspace-relative input", async () => {
  const root = await makeWorkspace("rel");
  const resolved = await resolveWorkspaceRelativePath(root, "notes/readme.md");
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.relativePath, "notes/readme.md");
});

test("resolveWorkspaceRelativePath: Windows case-insensitivity", async () => {
  const root = await makeWorkspace("case");
  const upper = path.join(root.toUpperCase(), "File.TXT");
  await writeFile(upper, "x", "utf8");
  const resolved = await resolveWorkspaceRelativePath(root, upper);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.relativePath.toLowerCase(), "file.txt");
});

test("resolveWorkspaceRelativePath: separator differences", async () => {
  const root = await makeWorkspace("sep");
  const file = path.join(root, "a", "b.txt");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "x", "utf8");
  const mixed = `${root}\\a/b.txt`;
  const resolved = await resolveWorkspaceRelativePath(root, mixed);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.relativePath, "a/b.txt");
});

test("resolveWorkspaceRelativePath: workspace with spaces", async () => {
  const root = await makeWorkspace("spaces");
  const file = path.join(root, "create-blue.txt");
  await writeFile(file, "x", "utf8");
  const resolved = await resolveWorkspaceRelativePath(root, file);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.relativePath, "create-blue.txt");
});

test("resolveWorkspaceRelativePath: rejects external path with same folder basename", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "cghc-resolve-fp-"));
  const root = path.join(base, "project");
  const external = path.join(base, "external", "project");
  await mkdir(root, { recursive: true });
  await mkdir(external, { recursive: true });
  const rootReal = await realpath(root);
  const outsideFile = path.join(external, "file.txt");
  await writeFile(outsideFile, "secret", "utf8");
  const resolved = await resolveWorkspaceRelativePath(rootReal, outsideFile);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reason, "outside_workspace");
});

test("resolveWorkspaceRelativePath: rejects sibling prefix project-other", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "cghc-resolve-sib-"));
  const root = path.join(base, "project");
  const sibling = path.join(base, "project-other");
  await mkdir(root, { recursive: true });
  await mkdir(sibling, { recursive: true });
  const rootReal = await realpath(root);
  const siblingReal = await realpath(sibling);
  const outsideFile = path.join(siblingReal, "file.txt");
  await writeFile(outsideFile, "x", "utf8");
  const resolved = await resolveWorkspaceRelativePath(rootReal, outsideFile);
  assert.equal(resolved.ok, false);
  if (!resolved.ok) assert.equal(resolved.reason, "outside_workspace");
});

test("resolveWorkspaceRelativePath: create target parent resolution", async () => {
  const root = await makeWorkspace("create");
  const target = path.join(root, "new", "child.txt");
  const resolved = await resolveWorkspaceRelativePath(root, target);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.relativePath, "new/child.txt");
});

test("resolveWorkspaceRelativePath: rejects outside workspace", async () => {
  const root = await makeWorkspace("outside");
  const resolved = await resolveWorkspaceRelativePath(root, "C:\\Windows\\System32\\drivers\\etc\\hosts");
  assert.equal(resolved.ok, false);
});

test(
  "resolveWorkspaceRelativePath: Windows 8.3 parent path",
  { skip: process.platform !== "win32" ? "Windows-only" : false },
  async (t) => {
    const base = await mkdtemp(path.join(os.tmpdir(), "cghc-resolve-83-"));
    const longRoot = path.join(base, "Long Workspace Name");
    await mkdir(longRoot, { recursive: true });
    const root = await realpath(longRoot);
    const shortRoot = await realpath(base);
    const entries = await import("node:fs/promises").then((fs) => fs.readdir(shortRoot));
    const shortName = entries.find((name) => name.includes("~"));
    if (shortName === undefined) {
      t.skip("8.3 alias not materialized in this environment");
      return;
    }
    const shortPath = path.join(shortRoot, shortName, "file.txt");
    await writeFile(shortPath, "x", "utf8");
    const resolved = await resolveWorkspaceRelativePath(root, shortPath);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.relativePath, "file.txt");
  },
);
