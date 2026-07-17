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
  assert.equal(detectWorkspaceFileRole("deck.pptx"), "presentation");
  assert.equal(detectWorkspaceFileRole("app.exe"), "unsupported");
});

test("only modern .pptx previews; legacy .ppt stays unsupported", () => {
  assert.equal(detectWorkspaceFileRole("Report.PPTX"), "presentation");
  assert.equal(detectWorkspaceFileRole("legacy.ppt"), "unsupported");
  // .pptx is safe to auto-open; .ppt is not (unsupported role).
  assert.equal(isAutoOpenSafe("slides/deck.pptx"), true);
  assert.equal(isAutoOpenSafe("slides/legacy.ppt"), false);
});

test("detectWorkspaceFileRole treats code files as editable text", () => {
  for (const p of ["main.py", "styles.css", "engine.cpp", "app.ts", "config.json"]) {
    assert.equal(detectWorkspaceFileRole(p), "text", `${p} should be text`);
  }
  // Secret extensions must stay unsupported (never previewed as text).
  assert.equal(detectWorkspaceFileRole("server.pem"), "unsupported");
  assert.equal(detectWorkspaceFileRole("id.key"), "unsupported");
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
