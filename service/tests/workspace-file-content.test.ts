/**
 * Workspace file content — rich read/write for companion preview.
 */

import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  readWorkspaceFileContent,
  writeWorkspaceFileContent,
} from "../src/workspace/file-content.js";

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-content-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return resolve(root);
}

test("reads editable text file", async () => {
  const root = await tempWorkspace();
  await writeFile(join(root, "notes.md"), "# Hello", "utf8");
  const result = await readWorkspaceFileContent(root, "notes.md");
  assert.equal(result.kind, "text");
  assert.equal(result.editable, true);
  assert.equal(result.content, "# Hello");
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("writes text file", async () => {
  const root = await tempWorkspace();
  await writeFile(join(root, "draft.txt"), "old", "utf8");
  await writeWorkspaceFileContent(root, "draft.txt", { kind: "text", content: "new content" });
  const disk = await readFile(join(root, "draft.txt"), "utf8");
  assert.equal(disk, "new content");
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("reads png as image base64", async () => {
  const root = await tempWorkspace();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await writeFile(join(root, "icon.png"), bytes);
  const result = await readWorkspaceFileContent(root, "icon.png");
  assert.equal(result.kind, "image");
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.dataBase64, bytes.toString("base64"));
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("reads xlsx spreadsheet and writes cell edits", async () => {
  const root = await tempWorkspace();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["A", "B"], ["1", "2"]]), "Demo");
  const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await writeFile(join(root, "sheet.xlsx"), buf);
  const read = await readWorkspaceFileContent(root, "sheet.xlsx");
  assert.equal(read.kind, "spreadsheet");
  assert.equal(read.editable, true);
  assert.deepEqual(read.sheets?.[0]?.rows[0], ["A", "B"]);
  await writeWorkspaceFileContent(root, "sheet.xlsx", {
    kind: "spreadsheet",
    sheets: [{ name: "Demo", rows: [["A", "B"], ["9", "10"]] }],
  });
  const reread = await readWorkspaceFileContent(root, "sheet.xlsx");
  assert.deepEqual(reread.sheets?.[0]?.rows[1], ["9", "10"]);
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("rejects traversal on write", async () => {
  const root = await tempWorkspace();
  await assert.rejects(() =>
    writeWorkspaceFileContent(root, "../escape.txt", { kind: "text", content: "x" }),
  );
  await rm(join(root, ".."), { recursive: true, force: true });
});
