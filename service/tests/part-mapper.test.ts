/**
 * part-mapper — apply_patch delete marker → file_mutation delete.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPart, parseApplyPatchMarker } from "../src/execution/part-mapper.js";

test("parseApplyPatchMarker extracts delete path", () => {
  const marker = parseApplyPatchMarker(
    "*** Begin Patch\n*** Delete File: delete-me.txt\n*** End Patch",
  );
  assert.equal(marker.operation, "delete");
  assert.equal(marker.path, "delete-me.txt");
});

test("mapPart emits file_mutation delete for completed apply_patch delete marker", () => {
  let seq = 0;
  const alloc = () => ({
    sessionId: "sess-1",
    seq: ++seq,
    at: "2026-07-13T08:00:00.000Z",
  });
  const events = mapPart(
    {
      type: "tool",
      tool: "apply_patch",
      callID: "call-delete",
      state: {
        status: "completed",
        input: {
          patchText: "*** Begin Patch\n*** Delete File: delete-me.txt\n*** End Patch",
        },
      },
    },
    alloc,
  );
  const mutation = events.find((event) => event.kind === "file_mutation");
  assert.ok(mutation && mutation.kind === "file_mutation");
  assert.equal(mutation.operation, "delete");
  assert.match(mutation.path, /delete-me\.txt$/);
});
