import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import {
  badgeForReview,
  createCodeEditor,
  fileTabKey,
  renderCodeEditor,
  type OpenCodeFile,
} from "../src/ui-shell/code/code-editor.js";

const REVIEW: FileReviewArtifact = {
  id: "review-1",
  eventKind: "file_modified",
  relativePath: "src/app.ts",
  at: "2026-07-13T00:00:00.000Z",
  seq: 1,
  source: "runtime",
  beforeExists: true,
  afterExists: true,
  unifiedDiff: "@@ -1,1 +1,1 @@\n-old\n+new",
  truncated: false,
  diffTruncated: false,
  previewTruncated: false,
  isBinary: false,
  contentRedacted: false,
} as FileReviewArtifact;

const NO_HANDLERS = { onSelect: () => undefined, onClose: () => undefined, onLoadFile: () => undefined };

test("badge mapping", () => {
  assert.equal(badgeForReview({ eventKind: "file_created" }), "A");
  assert.equal(badgeForReview({ eventKind: "file_deleted" }), "D");
  assert.equal(badgeForReview({ eventKind: "file_modified" }), "M");
});

test("welcome screen when nothing open", () => {
  const dom = createCodeEditor();
  renderCodeEditor(dom, { openFiles: [], activeKey: null, reviews: [] }, NO_HANDLERS);
  assert.match(dom.body.textContent ?? "", /Chưa mở tệp nào/);
});

test("diff tab renders add/del rows and stats", () => {
  const dom = createCodeEditor();
  const open: OpenCodeFile = { key: fileTabKey("review", "src/app.ts"), relativePath: "src/app.ts", kind: "review", reviewId: "review-1" };
  renderCodeEditor(dom, { openFiles: [open], activeKey: open.key, reviews: [REVIEW] }, NO_HANDLERS);
  assert.equal(dom.body.querySelectorAll(".code-diff__row--add").length, 1);
  assert.equal(dom.body.querySelectorAll(".code-diff__row--del").length, 1);
  assert.match(dom.root.textContent ?? "", /\+1/);
  assert.equal(dom.root.querySelector(".code-editor__accept"), null); // no fake accept/reject
});

test("redacted review shows notice and no diff content", () => {
  const dom = createCodeEditor();
  const redacted = { ...REVIEW, id: "review-2", contentRedacted: true, relativePath: ".env" } as FileReviewArtifact;
  const open: OpenCodeFile = { key: fileTabKey("review", ".env"), relativePath: ".env", kind: "review", reviewId: "review-2" };
  renderCodeEditor(dom, { openFiles: [open], activeKey: open.key, reviews: [redacted] }, NO_HANDLERS);
  assert.match(dom.body.textContent ?? "", /credential hoặc secret/);
  assert.equal(dom.body.querySelectorAll(".code-diff__row").length, 0);
});

test("plain file tab shows read-only pill and close fires handler", () => {
  const dom = createCodeEditor();
  let closed: string | null = null;
  const open: OpenCodeFile = { key: fileTabKey("file", "README.md"), relativePath: "README.md", kind: "file" };
  renderCodeEditor(
    dom,
    { openFiles: [open], activeKey: open.key, reviews: [] },
    { ...NO_HANDLERS, onClose: (key) => { closed = key; } },
  );
  assert.match(dom.root.textContent ?? "", /Chỉ đọc/);
  dom.tabBar.querySelector<HTMLButtonElement>(".code-tab__close")?.click();
  assert.equal(closed, open.key);
});
