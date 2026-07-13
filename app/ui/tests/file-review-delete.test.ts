/**
 * File Work Review — delete journey semantics in activity model + review body formatting.
 */

import "./setup-dom.js";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import { buildActivitySnapshot } from "../src/activity-model.js";

const SID = "sess-delete";
const WS = "C:/fixture/ws";

function ev(partial: Omit<import("@cowork-ghc/contracts").EvEvent, "sessionId" | "at"> & { at?: string }) {
  return { sessionId: SID, at: partial.at ?? "2026-07-13T08:00:00.000Z", ...partial } as import("@cowork-ghc/contracts").EvEvent;
}

function deleteReview(): FileReviewArtifact {
  return {
    id: "review-delete-1",
    eventKind: "file_deleted",
    relativePath: "delete-me.txt",
    at: "2026-07-13T08:00:01.000Z",
    seq: 2,
    source: "runtime_tool",
    operation: "delete",
    beforeExists: true,
    afterExists: false,
    beforePreview: "DELETE-ME-CONTENT",
    unifiedDiff: "--- delete-me.txt\n+++ delete-me.txt\n@@\n-DELETE-ME-CONTENT",
    truncated: false,
    diffTruncated: false,
    previewTruncated: false,
    isBinary: false,
    contentRedacted: false,
    permissionDecision: "allowed_once",
  };
}

test("buildActivitySnapshot links delete mutation to persisted review", () => {
  const review = deleteReview();
  const snapshot = buildActivitySnapshot(
    [ev({ kind: "file_mutation", seq: 2, operation: "delete", path: `${WS}/delete-me.txt` })],
    WS,
    [],
    false,
    [review],
  );
  assert.equal(snapshot.fileChanges.length, 1);
  assert.equal(snapshot.fileChanges[0]?.operation, "delete");
  assert.equal(snapshot.fileChanges[0]?.reviewId, "review-delete-1");
  assert.equal(snapshot.fileReviews.length, 1);
  assert.equal(snapshot.fileReviews[0]?.eventKind, "file_deleted");
  assert.match(snapshot.fileReviews[0]?.beforePreview ?? "", /DELETE-ME-CONTENT/);
  assert.equal(snapshot.fileReviews[0]?.afterExists, false);
});
