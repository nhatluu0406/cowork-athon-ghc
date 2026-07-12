/**
 * Workspace file preview — boundary, binary detection, truncation.
 */

import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readWorkspaceFilePreview } from "../src/workspace/file-preview.js";

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-preview-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return resolve(root);
}

test("reads text file inside workspace with truncation flag", async () => {
  const root = await tempWorkspace();
  const file = join(root, "hello.txt");
  await writeFile(file, "hello world", "utf8");
  const result = await readWorkspaceFilePreview(root, "hello.txt", { maxBytes: 4 });
  assert.equal(result.kind, "text");
  assert.equal(result.truncated, true);
  assert.equal(result.content, "hell");
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("rejects path traversal outside workspace", async () => {
  const root = await tempWorkspace();
  await assert.rejects(() => readWorkspaceFilePreview(root, "../outside.txt"));
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("detects binary extension without reading as text", async () => {
  const root = await tempWorkspace();
  await writeFile(join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]), "binary");
  const result = await readWorkspaceFilePreview(root, "image.png");
  assert.equal(result.kind, "binary");
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("rejects symlink escape from workspace", async () => {
  const base = await mkdtemp(join(tmpdir(), "cghc-preview-esc-"));
  const root = resolve(join(base, "workspace"));
  const outside = resolve(join(base, "outside"));
  await mkdir(root, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "secret.txt"), "secret", "utf8");
  const linkDir = join(root, "link-out");
  let symlinkOk = false;
  try {
    const type = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, linkDir, type);
    symlinkOk = true;
  } catch {
    symlinkOk = false;
  }
  if (!symlinkOk) {
    await rm(base, { recursive: true, force: true });
    return;
  }
  await assert.rejects(() => readWorkspaceFilePreview(root, "link-out/secret.txt"));
  await rm(base, { recursive: true, force: true });
});
