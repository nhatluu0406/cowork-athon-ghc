/**
 * Workspace attachment read — boundary and limit tests.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { readWorkspaceAttachment } from "../src/workspace/attachment-read.js";
import { ATTACHMENT_MAX_FILE_BYTES } from "../src/workspace/attachment-limits.js";

test("reads supported text file inside workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-att-"));
  try {
    await writeFile(join(root, "secret.txt"), "VIOLET-428", "utf8");
    const result = await readWorkspaceAttachment({
      workspaceRoot: root,
      absolutePath: join(root, "secret.txt"),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.content, "VIOLET-428");
      assert.equal(result.metadata.relativePath, "secret.txt");
      assert.equal(result.metadata.truncated, false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects file outside workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-att-"));
  const outside = await mkdtemp(join(tmpdir(), "cghc-out-"));
  try {
    const outsideFile = join(outside, "outside.txt");
    await writeFile(outsideFile, "nope", "utf8");
    const result = await readWorkspaceAttachment({
      workspaceRoot: root,
      absolutePath: outsideFile,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "outside_workspace");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("rejects path traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-att-"));
  const outside = await mkdtemp(join(tmpdir(), "cghc-out-"));
  try {
    await writeFile(join(outside, "leak.txt"), "secret", "utf8");
    const result = await readWorkspaceAttachment({
      workspaceRoot: root,
      absolutePath: join(root, "..", "..", outside.replace(/\\/g, "/").split("/").pop() ?? "x"),
    });
    assert.equal(result.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("rejects unsupported binary extension", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-att-"));
  try {
    await writeFile(join(root, "image.png"), "not-really-png", "utf8");
    const result = await readWorkspaceAttachment({
      workspaceRoot: root,
      absolutePath: join(root, "image.png"),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unsupported_type");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects binary content with null bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-att-"));
  try {
    await writeFile(join(root, "data.txt"), Buffer.from([0x48, 0x00, 0x69]));
    const result = await readWorkspaceAttachment({
      workspaceRoot: root,
      absolutePath: join(root, "data.txt"),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "binary_content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects oversized file", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-att-"));
  try {
    const big = "x".repeat(ATTACHMENT_MAX_FILE_BYTES + 1);
    await writeFile(join(root, "big.txt"), big, "utf8");
    const result = await readWorkspaceAttachment({
      workspaceRoot: root,
      absolutePath: join(root, "big.txt"),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "file_too_large");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects symlink escape when target is outside workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "cghc-att-"));
  const outside = await mkdtemp(join(tmpdir(), "cghc-out-"));
  try {
    await writeFile(join(outside, "secret.txt"), "escaped", "utf8");
    try {
      await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "ENOENT") {
        t.skip("symlink creation not permitted in this environment");
        return;
      }
      throw err;
    }
    const result = await readWorkspaceAttachment({
      workspaceRoot: root,
      absolutePath: join(root, "link.txt"),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.reason === "symlink_escape" || result.reason === "outside_workspace");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("persists attachment metadata shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "cghc-att-"));
  try {
    await writeFile(join(root, "meta.md"), "# hi", "utf8");
    const result = await readWorkspaceAttachment({
      workspaceRoot: root,
      absolutePath: join(root, "meta.md"),
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.metadata.filename, "meta.md");
      assert.match(result.metadata.contentHash, /^[a-f0-9]{64}$/u);
      assert.equal(typeof result.metadata.modifiedAt, "string");
      assert.equal(result.metadata.maxBytesApplied, ATTACHMENT_MAX_FILE_BYTES);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
