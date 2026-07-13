import assert from "node:assert/strict";
import { test } from "node:test";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import {
  detectFileActionIntent,
  hasVerifiedFileAction,
  markFileActionUnverified,
  UNVERIFIED_FILE_ACTION_WARNING,
} from "../src/file-action-integrity.js";

function review(overrides: Partial<FileReviewArtifact> = {}): FileReviewArtifact {
  return {
    id: "review-1",
    eventKind: "file_created",
    relativePath: "permission-demo.txt",
    at: "2026-07-13T00:00:00.000Z",
    seq: 1,
    source: "runtime_tool",
    operation: "create",
    runtimeTurnId: "turn-1",
    beforeExists: false,
    afterExists: true,
    truncated: false,
    diffTruncated: false,
    previewTruncated: false,
    isBinary: false,
    contentRedacted: false,
    ...overrides,
  };
}

test("detects explicit Vietnamese and English file actions", () => {
  assert.equal(detectFileActionIntent("Hãy tạo file permission-demo.txt"), "create");
  assert.equal(detectFileActionIntent("Sửa tệp notes.md"), "edit");
  assert.equal(detectFileActionIntent("Delete file old.txt"), "delete");
  assert.equal(detectFileActionIntent("Rename document report.md"), "move");
  assert.equal(detectFileActionIntent("Xin chào, hôm nay thế nào?"), null);
});

test("requires a disk-backed review for the same runtime turn", () => {
  assert.equal(hasVerifiedFileAction([review()], "turn-1", "create"), true);
  assert.equal(hasVerifiedFileAction([review()], "turn-2", "create"), false);
  assert.equal(hasVerifiedFileAction([review({ afterExists: false })], "turn-1", "create"), false);
});

test("edit verification requires an actual before/after change", () => {
  const changed = review({
    eventKind: "file_modified",
    operation: "edit",
    beforeExists: true,
    afterExists: true,
    beforeHash: "before",
    afterHash: "after",
  });
  const unchanged = review({
    eventKind: "file_modified",
    operation: "edit",
    beforeExists: true,
    afterExists: true,
    beforeHash: "same",
    afterHash: "same",
  });
  assert.equal(hasVerifiedFileAction([changed], "turn-1", "edit"), true);
  assert.equal(hasVerifiedFileAction([unchanged], "turn-1", "edit"), false);
});

test("unverified response is clearly marked and preserves model text as unverified", () => {
  const text = markFileActionUnverified("Đã tạo file thành công.");
  assert.match(text, new RegExp(UNVERIFIED_FILE_ACTION_WARNING));
  assert.match(text, /Phản hồi của Agent \(chưa xác minh\)/u);
  assert.match(text, /Đã tạo file thành công/u);
});
