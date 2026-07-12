/**
 * Pending attachment chip state tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { totalValidBytes, type PendingAttachment } from "../src/attachment-pending.js";

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
