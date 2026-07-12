import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { extractText } from '../../../src/main/attachments/extract-text';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function buildDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildPptx(slideTexts: string[][]): Promise<Buffer> {
  const zip = new JSZip();
  slideTexts.forEach((texts, i) => {
    const runs = texts.map((t) => `<a:r><a:t>${t}</a:t></a:r>`).join('');
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${runs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  });
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Minimal valid single-page PDF with one text-drawing operator; xref offsets computed at build time. */
function buildTinyPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

describe('extractText', () => {
  it('extracts paragraphs from a .docx', async () => {
    const p = path.join(tmpDir, 'a.docx');
    fs.writeFileSync(p, await buildDocx(['Hello docx', 'Second paragraph']));
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('Hello docx');
    expect(text).toContain('Second paragraph');
  });

  it('extracts sheet rows from an .xlsx with sheet headers', async () => {
    const p = path.join(tmpDir, 'a.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Qty'], ['Widget', 3]]), 'Sheet1');
    XLSX.writeFile(wb, p);
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('--- Sheet 1 ---');
    expect(text).toContain('Widget');
    expect(text).toContain('3');
  });

  it('extracts slide text from a .pptx with slide headers', async () => {
    const p = path.join(tmpDir, 'a.pptx');
    fs.writeFileSync(p, await buildPptx([['Title slide'], ['Second slide', 'bullet']]));
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('--- Slide 1 ---');
    expect(text).toContain('Title slide');
    expect(text).toContain('--- Slide 2 ---');
    expect(text).toContain('bullet');
  });

  it('extracts text from a .pdf', async () => {
    const p = path.join(tmpDir, 'a.pdf');
    fs.writeFileSync(p, buildTinyPdf('Hello PDF'));
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('Hello PDF');
  });

  it('reads unknown extensions as UTF-8 when not binary', async () => {
    const p = path.join(tmpDir, 'notes.rst');
    fs.writeFileSync(p, 'plain text content', 'utf-8');
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toBe('plain text content');
  });

  it('flags binary files instead of dumping bytes', async () => {
    const p = path.join(tmpDir, 'blob.bin');
    fs.writeFileSync(p, Buffer.from([0x89, 0x00, 0x01, 0x02]));
    const { text, note } = await extractText(p);
    expect(text).toBeNull();
    expect(note).toBe('binary file — content not extracted');
  });

  it('returns a note (never throws) for unreadable/corrupt files', async () => {
    const p = path.join(tmpDir, 'corrupt.docx');
    fs.writeFileSync(p, 'this is not a zip', 'utf-8');
    const { text, note } = await extractText(p);
    expect(text).toBeNull();
    expect(note).toMatch(/^could not read/);
  });

  it('returns a note for a missing file', async () => {
    const { text, note } = await extractText(path.join(tmpDir, 'does-not-exist.txt'));
    expect(text).toBeNull();
    expect(note).toMatch(/^could not read/);
  });
});
