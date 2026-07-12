import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { markdownToDocx } from '../../../src/main/docgen/markdown-docx';
import { extractText } from '../../../src/main/attachments/extract-text';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mddocx-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function roundTrip(markdown: string, name: string): Promise<string> {
  const buf = await markdownToDocx(markdown);
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, buf);
  const { text, note } = await extractText(p);
  expect(note).toBe('');
  return text || '';
}

describe('markdownToDocx', () => {
  it('renders headings and paragraphs', async () => {
    const text = await roundTrip('# Báo cáo quý\n\nDoanh thu tăng trưởng tốt.\n\n## Chi tiết\n\nXem bảng dưới.', 'h.docx');
    expect(text).toContain('Báo cáo quý');
    expect(text).toContain('Doanh thu tăng trưởng tốt.');
    expect(text).toContain('Chi tiết');
  });

  it('renders bold/italic/inline-code runs (text content preserved)', async () => {
    const text = await roundTrip('This is **bold**, *italic* and `code`.', 'inline.docx');
    expect(text).toContain('bold');
    expect(text).toContain('italic');
    expect(text).toContain('code');
  });

  it('renders bullet and numbered lists', async () => {
    const text = await roundTrip('- first item\n- second item\n\n1. step one\n2. step two', 'lists.docx');
    expect(text).toContain('first item');
    expect(text).toContain('second item');
    expect(text).toContain('step one');
    expect(text).toContain('step two');
  });

  it('renders GFM tables with all cell text', async () => {
    const md = '| Name | Qty |\n|------|-----|\n| Widget | 3 |\n| Gadget | 7 |';
    const text = await roundTrip(md, 'table.docx');
    expect(text).toContain('Name');
    expect(text).toContain('Widget');
    expect(text).toContain('Gadget');
  });

  it('renders blockquotes and fenced code blocks as text', async () => {
    const text = await roundTrip('> quoted wisdom\n\n```\nconst x = 1;\n```', 'quote.docx');
    expect(text).toContain('quoted wisdom');
    expect(text).toContain('const x = 1;');
  });

  it('does not throw on unknown/exotic syntax', async () => {
    const text = await roundTrip('Text with ~~strike~~ and <kbd>keys</kbd> and $math$.', 'exotic.docx');
    expect(text.length).toBeGreaterThan(0);
  });

  it('throws a descriptive error for empty markdown', async () => {
    await expect(markdownToDocx('')).rejects.toThrow(/markdown/);
    await expect(markdownToDocx('   ')).rejects.toThrow(/markdown/);
  });
});
