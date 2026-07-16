/**
 * Shared text/code file classification (@cowork-ghc/contracts) — the single source both the
 * service (read classification) and the renderer (role + highlight language) rely on.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isTextFilePath, languageForPath, TEXT_FILE_EXTENSIONS } from "@cowork-ghc/contracts";

test("code and text extensions are recognised as text", () => {
  for (const p of [
    "a.txt",
    "readme.md",
    "main.py",
    "styles.css",
    "engine.cpp",
    "header.h",
    "app.ts",
    "index.tsx",
    "server.js",
    "config.json",
    "build.gradle",
    "query.sql",
    "script.sh",
    "data.yaml",
    "index.html",
  ]) {
    assert.equal(isTextFilePath(p), true, `${p} should be text`);
  }
});

test("extension-less config basenames are text", () => {
  assert.equal(isTextFilePath("Dockerfile"), true);
  assert.equal(isTextFilePath("sub/dir/Makefile"), true);
  assert.equal(isTextFilePath(".gitignore"), true);
});

test("secrets and binary/office kinds are NOT text", () => {
  for (const p of [
    ".env",
    ".env.local",
    "config.env", // .env extension is deliberately excluded
    "server.pem",
    "id.key",
    "photo.png",
    "doc.pdf",
    "report.docx",
    "book.xlsx",
  ]) {
    assert.equal(isTextFilePath(p), false, `${p} must not be text`);
  }
});

test("languageForPath maps to highlight.js ids, undefined for plain", () => {
  assert.equal(languageForPath("main.py"), "python");
  assert.equal(languageForPath("engine.cpp"), "cpp");
  assert.equal(languageForPath("styles.css"), "css");
  assert.equal(languageForPath("app.ts"), "typescript");
  assert.equal(languageForPath("index.html"), "xml");
  // Plain kinds highlight to nothing (rendered as plain text).
  assert.equal(languageForPath("notes.txt"), undefined);
  assert.equal(languageForPath("data.csv"), undefined);
  assert.equal(languageForPath("mystery.unknownext"), undefined);
});

test("the extension set is non-trivial and excludes secrets", () => {
  assert.ok(TEXT_FILE_EXTENSIONS.has(".py"));
  assert.ok(TEXT_FILE_EXTENSIONS.has(".cpp"));
  assert.ok(!TEXT_FILE_EXTENSIONS.has(".pem"));
  assert.ok(!TEXT_FILE_EXTENSIONS.has(".key"));
});
