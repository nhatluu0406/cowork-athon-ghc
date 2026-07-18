/**
 * docx-service — real .docx generation (issue #25). Verifies the produced bytes are a genuine
 * OOXML Word package (not mislabeled text) and that path/size safety holds.
 */

import { mkdtemp, rm, readFile, mkdir, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createDocx, type DocxServiceDeps } from "../src/documents/docx-service.js";

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-docx-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return root;
}

function deps(root: string): DocxServiceDeps {
  return { workspaceRoot: () => root };
}

test("creates a real, valid OOXML .docx with the requested content", async () => {
  const root = await tempWorkspace();
  try {
    const result = await createDocx(deps(root), {
      title: "Báo cáo tuần",
      relativePath: "reports/weekly.docx",
      sections: [
        { heading: { text: "Tổng quan", level: 1 }, paragraphs: [{ text: "Nội dung quan trọng.", bold: true }] },
        { list: { ordered: true, items: ["Mục một", "Mục hai"] } },
        { table: { rows: [["Tên", "Số"], ["A", "1"]] } },
      ],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.data.verifiedOoxml, true);
    assert.ok(result.data.sizeBytes > 0);

    // Independently confirm the file on disk is a real OOXML package containing the text.
    const bytes = await readFile(join(root, "reports", "weekly.docx"));
    const zip = await JSZip.loadAsync(bytes);
    assert.ok(zip.file("[Content_Types].xml"), "has [Content_Types].xml");
    const docXml = await zip.file("word/document.xml")!.async("string");
    assert.match(docXml, /Báo cáo tuần/u);
    assert.match(docXml, /Tổng quan/u);
    assert.match(docXml, /Nội dung quan trọng/u);
    assert.match(docXml, /Mục một/u);
    assert.match(docXml, /Tên/u);
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("rejects a non-.docx extension without writing", async () => {
  const root = await tempWorkspace();
  try {
    const result = await createDocx(deps(root), { relativePath: "notes.txt", sections: [{ paragraphs: [{ text: "x" }] }] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "invalid_extension");
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("rejects path traversal outside the workspace", async () => {
  const root = await tempWorkspace();
  try {
    for (const relativePath of ["../evil.docx", "../../evil.docx"]) {
      const result = await createDocx(deps(root), { relativePath, sections: [{ paragraphs: [{ text: "x" }] }] });
      assert.equal(result.ok, false, `should reject ${relativePath}`);
      if (!result.ok) assert.equal(result.error.kind, "path_escape");
    }
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("rejects a spec that exceeds bounds", async () => {
  const root = await tempWorkspace();
  try {
    const tooMany = Array.from({ length: 5000 }, () => ({ text: "x" }));
    const result = await createDocx(deps(root), {
      relativePath: "big.docx",
      sections: [{ paragraphs: tooMany }],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "invalid_spec");
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("returns no_workspace when no workspace is active", async () => {
  const result = await createDocx({ workspaceRoot: () => undefined }, {
    relativePath: "x.docx",
    sections: [{ paragraphs: [{ text: "x" }] }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "no_workspace");
});
