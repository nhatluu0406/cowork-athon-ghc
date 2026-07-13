import { test } from "node:test";
import assert from "node:assert/strict";
import { detectWorkspaceFileRole } from "../src/workspace-file-role.js";

test("detectWorkspaceFileRole maps supported extensions", () => {
  assert.equal(detectWorkspaceFileRole("notes.txt"), "text");
  assert.equal(detectWorkspaceFileRole("readme.md"), "text");
  assert.equal(detectWorkspaceFileRole("photo.png"), "image");
  assert.equal(detectWorkspaceFileRole("scan.pdf"), "pdf");
  assert.equal(detectWorkspaceFileRole("brief.docx"), "docx");
  assert.equal(detectWorkspaceFileRole("budget.xlsx"), "spreadsheet");
  assert.equal(detectWorkspaceFileRole("app.exe"), "unsupported");
});
