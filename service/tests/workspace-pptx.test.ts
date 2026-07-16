/**
 * Local-only PowerPoint (.pptx) text preview: ordered slides, malformed handling, and that the
 * read path stays inside the workspace and never produces a remote URL.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { parsePptxSlides } from "../src/workspace/pptx.js";
import { readWorkspaceFileContent } from "../src/workspace/file-content.js";

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-pptx-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return resolve(root);
}

function slideXml(paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`)
    .join("");
  return `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
}

/**
 * Build a minimal but structurally real .pptx. `order` lists slide file numbers in PRESENTATION
 * display order (via presentation.xml + rels), which may differ from the numeric file order.
 */
async function buildPptx(slides: Record<number, string[]>, order: number[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const [num, paras] of Object.entries(slides)) {
    zip.file(`ppt/slides/slide${num}.xml`, slideXml(paras));
  }
  const rels = order
    .map(
      (num, i) =>
        `<Relationship Id="rId${i + 2}" Type="slide" Target="slides/slide${num}.xml"/>`,
    )
    .join("");
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0"?><Relationships>${rels}</Relationships>`,
  );
  const sldIds = order.map((_num, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("");
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>${sldIds}</p:sldIdLst></p:presentation>`,
  );
  return zip.generateAsync({ type: "nodebuffer" }) as Promise<Buffer>;
}

test("parses .pptx into slides in presentation display order (not file order)", async () => {
  // Files slide1/slide2 exist, but presentation order is slide2 THEN slide1.
  const buf = await buildPptx(
    { 1: ["First file content"], 2: ["Second file content"] },
    [2, 1],
  );
  const slides = await parsePptxSlides(buf);
  assert.equal(slides.length, 2);
  assert.equal(slides[0]?.index, 1);
  assert.match(slides[0]?.text ?? "", /Second file content/);
  assert.match(slides[1]?.text ?? "", /First file content/);
});

test("extracts multi-paragraph text and a title line, decoding XML entities", async () => {
  const buf = await buildPptx(
    { 1: ["Quý 1 &amp; Quý 2", "Doanh thu &lt; kế hoạch"] },
    [1],
  );
  const slides = await parsePptxSlides(buf);
  assert.equal(slides.length, 1);
  assert.equal(slides[0]?.title, "Quý 1 & Quý 2");
  assert.equal(slides[0]?.text, "Quý 1 & Quý 2\nDoanh thu < kế hoạch");
});

test("read path returns kind=presentation with slides for a .pptx in the workspace", async () => {
  const root = await tempWorkspace();
  const buf = await buildPptx({ 1: ["Slide one"], 2: ["Slide two"] }, [1, 2]);
  await writeFile(join(root, "deck.pptx"), buf);
  const result = await readWorkspaceFileContent(root, "deck.pptx");
  assert.equal(result.kind, "presentation");
  assert.equal(result.editable, false);
  assert.equal(result.slides?.length, 2);
  assert.match(result.slides?.[0]?.text ?? "", /Slide one/);
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("malformed / encrypted .pptx yields an unsupported state, never a crash", async () => {
  const root = await tempWorkspace();
  // Not a ZIP at all (an encrypted OOXML is an OLE compound file — JSZip cannot open it).
  await writeFile(join(root, "broken.pptx"), Buffer.from("NOT A ZIP FILE"));
  const result = await readWorkspaceFileContent(root, "broken.pptx");
  assert.equal(result.kind, "unsupported");
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("legacy .ppt is not treated as a presentation (unsupported)", async () => {
  const root = await tempWorkspace();
  await writeFile(join(root, "old.ppt"), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
  const result = await readWorkspaceFileContent(root, "old.ppt");
  assert.equal(result.kind, "unsupported");
  await rm(join(root, ".."), { recursive: true, force: true });
});

test("a .pptx outside the workspace boundary is rejected", async () => {
  const root = await tempWorkspace();
  await assert.rejects(() => readWorkspaceFileContent(root, "../escape.pptx"));
  await rm(join(root, ".."), { recursive: true, force: true });
});
