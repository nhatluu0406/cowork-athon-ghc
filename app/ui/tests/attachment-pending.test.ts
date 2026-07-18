/**
 * Pending attachment chip state tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPendingRelativePath,
  totalValidBytes,
  type PendingAttachment,
} from "../src/attachment-pending.js";

test("totalValidBytes sums valid attachment sizes", () => {
  const pending: PendingAttachment[] = [
    {
      id: "1",
      relativePath: "a.txt",
      filename: "a.txt",
      status: "valid",
      metadata: {
        relativePath: "a.txt",
        filename: "a.txt",
        sizeBytes: 100,
        modifiedAt: "",
        contentHash: "x",
        truncated: false,
        maxBytesApplied: 32768,
      },
    },
    {
      id: "2",
      relativePath: "b.txt",
      filename: "b.txt",
      status: "error",
      errorMessage: "fail",
    },
  ];
  assert.equal(totalValidBytes(pending), 100);
});

test("isPendingRelativePath dedupes by relative path across valid and error chips", () => {
  const pending: PendingAttachment[] = [
    {
      id: "1",
      relativePath: "src/a.ts",
      filename: "a.ts",
      status: "valid",
      metadata: {
        relativePath: "src/a.ts",
        filename: "a.ts",
        sizeBytes: 10,
        modifiedAt: "",
        contentHash: "x",
        truncated: false,
        maxBytesApplied: 32768,
      },
    },
    { id: "2", relativePath: "b.txt", filename: "b.txt", status: "error", errorMessage: "fail" },
  ];
  assert.equal(isPendingRelativePath(pending, "src/a.ts"), true);
  assert.equal(isPendingRelativePath(pending, "b.txt"), true, "errored chips still count as pending");
  assert.equal(isPendingRelativePath(pending, "src/c.ts"), false);
  assert.equal(isPendingRelativePath([], "src/a.ts"), false);
});
