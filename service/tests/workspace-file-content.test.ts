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

test("truncated text preview is read-only to prevent destructive overwrite", async () => {
  const root = await tempWorkspace();
  await writeFile(join(root, "large.txt"), "x".repeat(512 * 1024 + 10), "utf8");
  const result = await readWorkspaceFileContent(root, "large.txt");
  assert.equal(result.kind, "text");
  assert.equal(result.truncated, true);
  assert.equal(result.editable, false);
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

test("reads xlsx as read-only and rejects destructive rewrite", async () => {
  const root = await tempWorkspace();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["A", "B"], ["1", "2"]]), "Demo");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Keep me"]]), "Second");
  const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await writeFile(join(root, "sheet.xlsx"), buf);
  const read = await readWorkspaceFileContent(root, "sheet.xlsx");
  assert.equal(read.kind, "spreadsheet");
  assert.equal(read.editable, false);
  assert.deepEqual(read.sheets?.[0]?.rows[0], ["A", "B"]);
  await assert.rejects(
    writeWorkspaceFileContent(root, "sheet.xlsx", {
      kind: "spreadsheet",
      sheets: [{ name: "Demo", rows: [["changed"]] }],
    }),
    /tạm thời bị vô hiệu hóa/i,
  );
  assert.deepEqual(await readFile(join(root, "sheet.xlsx")), buf);
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("exposes every visible sheet in workbook order", async () => {
  const root = await tempWorkspace();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["one"]]), "First");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["two"]]), "Second");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["three"]]), "Third");
  const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await writeFile(join(root, "multi.xlsx"), buf);
  const read = await readWorkspaceFileContent(root, "multi.xlsx");
  assert.equal(read.kind, "spreadsheet");
  assert.deepEqual(
    read.sheets?.map((s) => s.name),
    ["First", "Second", "Third"],
  );
  assert.deepEqual(read.sheets?.[1]?.rows[0], ["two"]);
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("hidden sheets are never surfaced", async () => {
  const root = await tempWorkspace();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["visible"]]), "Visible");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["secret"]]), "Hidden");
  // Mark the second sheet hidden (1 = hidden, 2 = very hidden). SheetNames order is preserved.
  workbook.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
  const buf = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await writeFile(join(root, "hidden.xlsx"), buf);
  const read = await readWorkspaceFileContent(root, "hidden.xlsx");
  assert.deepEqual(
    read.sheets?.map((s) => s.name),
    ["Visible"],
    "the hidden sheet is filtered out",
  );
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("rejects traversal on write", async () => {
  const root = await tempWorkspace();
  await assert.rejects(() =>
    writeWorkspaceFileContent(root, "../escape.txt", { kind: "text", content: "x" }),
  );
  await rm(join(root, ".."), { recursive: true, force: true });
});
