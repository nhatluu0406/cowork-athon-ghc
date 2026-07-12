/**
 * File review — snapshot capture, diff, artifact build, secret redaction.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUnifiedDiff, normalizeNewlines } from "../src/file-review/diff.js";
import { buildFileReviewArtifact } from "../src/file-review/review.js";
import { captureWorkspaceFileSnapshot, hashContent } from "../src/file-review/snapshot.js";
import { FILE_REVIEW_MAX_SNAPSHOT_BYTES } from "../src/file-review/limits.js";

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-freview-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return resolve(root);
}

test("hashContent is deterministic", () => {
  assert.equal(hashContent("hello"), hashContent("hello"));
  assert.notEqual(hashContent("hello"), hashContent("world"));
});

test("normalizeNewlines treats CRLF and LF equally", () => {
  assert.equal(normalizeNewlines("a\r\nb"), normalizeNewlines("a\nb"));
});

test("buildUnifiedDiff shows line additions and removals", () => {
  const diff = buildUnifiedDiff("FIRST_VERSION", "SECOND_VERSION", "note.txt");
  assert.match(diff.text, /-FIRST_VERSION/);
  assert.match(diff.text, /\+SECOND_VERSION/);
  assert.equal(diff.unchanged, false);
});

test("buildUnifiedDiff is unchanged for identical normalized content", () => {
  const diff = buildUnifiedDiff("line\r\n", "line\n", "x.txt");
  assert.equal(diff.unchanged, true);
});

test("captureWorkspaceFileSnapshot truncates large files", async () => {
  const root = await tempWorkspace();
  const big = "X".repeat(FILE_REVIEW_MAX_SNAPSHOT_BYTES + 100);
  await writeFile(join(root, "big.txt"), big, "utf8");
  const snap = await captureWorkspaceFileSnapshot(root, "big.txt");
  assert.equal(snap.truncated, true);
  assert.equal(snap.exists, true);
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("captureWorkspaceFileSnapshot redacts secret-like paths", async () => {
  const root = await tempWorkspace();
  await writeFile(join(root, ".env"), "SECRET_TOKEN=abc", "utf8");
  const snap = await captureWorkspaceFileSnapshot(root, ".env");
  assert.equal(snap.contentRedacted, true);
  assert.equal(snap.content, undefined);
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("buildFileReviewArtifact for create shows after-only semantics", () => {
  const review = buildFileReviewArtifact({
    id: "r1",
    relativePath: "new.txt",
    at: "2026-07-12T08:00:00.000Z",
    seq: 1,
    source: "runtime_tool",
    operation: "create",
    before: {
      relativePath: "new.txt",
      exists: false,
      kind: "missing",
      sizeBytes: 0,
      truncated: false,
      contentRedacted: false,
    },
    after: {
      relativePath: "new.txt",
      exists: true,
      kind: "text",
      content: "CREATE-BLUE-314",
      sizeBytes: 17,
      truncated: false,
      contentRedacted: false,
    },
  });
  assert.equal(review.eventKind, "file_created");
  assert.equal(review.beforeExists, false);
  assert.equal(review.afterExists, true);
  assert.match(review.unifiedDiff ?? "", /CREATE-BLUE-314/);
});

test("buildFileReviewArtifact for delete shows before-only semantics", () => {
  const review = buildFileReviewArtifact({
    id: "r2",
    relativePath: "gone.txt",
    at: "2026-07-12T08:00:00.000Z",
    seq: 2,
    source: "runtime_tool",
    operation: "delete",
    before: {
      relativePath: "gone.txt",
      exists: true,
      kind: "text",
      content: "bye",
      sizeBytes: 3,
      truncated: false,
      contentRedacted: false,
    },
    after: {
      relativePath: "gone.txt",
      exists: false,
      kind: "missing",
      sizeBytes: 0,
      truncated: false,
      contentRedacted: false,
    },
  });
  assert.equal(review.eventKind, "file_deleted");
  assert.equal(review.afterExists, false);
});

test("buildFileReviewArtifact marks binary without text diff", () => {
  const review = buildFileReviewArtifact({
    id: "r3",
    relativePath: "image.png",
    at: "2026-07-12T08:00:00.000Z",
    seq: 3,
    source: "runtime_tool",
    operation: "edit",
    before: {
      relativePath: "image.png",
      exists: true,
      kind: "binary",
      sizeBytes: 100,
      truncated: false,
      contentRedacted: false,
    },
    after: {
      relativePath: "image.png",
      exists: true,
      kind: "binary",
      sizeBytes: 120,
      truncated: false,
      contentRedacted: false,
    },
  });
  assert.equal(review.isBinary, true);
  assert.equal(review.unifiedDiff, undefined);
});

test("buildFileReviewArtifact detects current file hash mismatch", () => {
  const review = buildFileReviewArtifact({
    id: "r4",
    relativePath: "a.txt",
    at: "2026-07-12T08:00:00.000Z",
    seq: 4,
    source: "runtime_tool",
    operation: "edit",
    before: {
      relativePath: "a.txt",
      exists: true,
      kind: "text",
      content: "A",
      hash: hashContent("A"),
      sizeBytes: 1,
      truncated: false,
      contentRedacted: false,
    },
    after: {
      relativePath: "a.txt",
      exists: true,
      kind: "text",
      content: "B",
      hash: hashContent("B"),
      sizeBytes: 1,
      truncated: false,
      contentRedacted: false,
    },
    currentFileHash: hashContent("C"),
  });
  assert.equal(review.currentFileHashMismatch, true);
});
