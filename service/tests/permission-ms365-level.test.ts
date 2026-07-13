import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyApprovalLevel } from "../src/permission/approval-level.js";

test("ms365_write classifies as elevated (bounded external write)", () => {
  assert.equal(classifyApprovalLevel("ms365_write"), "elevated");
});

test("existing file kinds keep their levels", () => {
  assert.equal(classifyApprovalLevel("file_create"), "standard");
  assert.equal(classifyApprovalLevel("file_delete"), "elevated");
});
