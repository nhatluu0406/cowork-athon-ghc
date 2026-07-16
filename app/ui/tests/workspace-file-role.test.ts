import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectWorkspaceFileRole,
  isAutoOpenSafe,
  isSecretLikeWorkspacePath,
} from "../src/workspace-file-role.js";

test("detectWorkspaceFileRole maps supported extensions", () => {
  assert.equal(detectWorkspaceFileRole("notes.txt"), "text");
  assert.equal(detectWorkspaceFileRole("readme.md"), "text");
  assert.equal(detectWorkspaceFileRole("photo.png"), "image");
  assert.equal(detectWorkspaceFileRole("scan.pdf"), "pdf");
  assert.equal(detectWorkspaceFileRole("brief.docx"), "docx");
  assert.equal(detectWorkspaceFileRole("budget.xlsx"), "spreadsheet");
  assert.equal(detectWorkspaceFileRole("app.exe"), "unsupported");
});

test("isSecretLikeWorkspacePath flags credential-bearing paths", () => {
  assert.equal(isSecretLikeWorkspacePath(".env"), true);
  assert.equal(isSecretLikeWorkspacePath("config/.env.production"), true);
  assert.equal(isSecretLikeWorkspacePath("keys/server.pem"), true);
  assert.equal(isSecretLikeWorkspacePath("deploy\\id_rsa"), true);
  assert.equal(isSecretLikeWorkspacePath("service-account-prod.json"), true);
  assert.equal(isSecretLikeWorkspacePath("src/notes.md"), false);
});

test("isAutoOpenSafe allows supported non-secret files only", () => {
  assert.equal(isAutoOpenSafe("docs/report.pdf"), true);
  assert.equal(isAutoOpenSafe("src/readme.md"), true);
  // Unsupported type: never force-opened (still manually openable).
  assert.equal(isAutoOpenSafe("build/app.exe"), false);
  // Secret-like: never auto-opened even though its extension is a supported role.
  assert.equal(isAutoOpenSafe("credentials.json"), false);
  assert.equal(isAutoOpenSafe(".env"), false);
});
