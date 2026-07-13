import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileReviewArtifact } from "@cowork-ghc/service/file-review";
import { createCodeExplorer, latestReviewsByPath, renderSourceControl } from "../src/ui-shell/code/code-explorer.js";

function review(partial: Partial<FileReviewArtifact>): FileReviewArtifact {
  return {
    id: "r", eventKind: "file_modified", relativePath: "a.ts", at: "2026-07-13T00:00:00.000Z",
    seq: 1, source: "runtime", beforeExists: true, afterExists: true,
    truncated: false, diffTruncated: false, previewTruncated: false, isBinary: false, contentRedacted: false,
    ...partial,
  } as FileReviewArtifact;
}

test("latestReviewsByPath keeps highest seq per path", () => {
  const rows = latestReviewsByPath([
    review({ id: "r1", relativePath: "a.ts", seq: 1 }),
    review({ id: "r2", relativePath: "a.ts", seq: 3 }),
    review({ id: "r3", relativePath: "b.ts", seq: 2 }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["r2", "r3"]);
});

test("empty source control is honest", () => {
  const dom = createCodeExplorer();
  renderSourceControl(dom, [], () => undefined);
  assert.match(dom.sourceControl.textContent ?? "", /Chưa có thay đổi tệp nào/);
});

test("rows show badge and stats, click opens review", () => {
  const dom = createCodeExplorer();
  let opened: string | null = null;
  const r = review({ id: "r9", eventKind: "file_created", relativePath: "src/new.ts", unifiedDiff: "@@ -0,0 +1,2 @@\n+a\n+b" });
  renderSourceControl(dom, [r], (rev) => { opened = rev.id; });
  const row = dom.sourceControl.querySelector<HTMLButtonElement>(".code-scm__row");
  assert.match(row?.textContent ?? "", /A/);
  assert.match(row?.textContent ?? "", /\+2/);
  row?.click();
  assert.equal(opened, "r9");
});
