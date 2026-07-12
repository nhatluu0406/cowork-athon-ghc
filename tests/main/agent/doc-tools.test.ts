import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { DOC_TOOL_SPECS, DOC_TOOL_NAMES, executeDocTool } from '../../../src/main/agent/doc-tools';

let outDir: string;

beforeAll(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctools-'));
});

afterAll(() => {
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe('DOC_TOOL_SPECS', () => {
  it('exposes the four tools with required params', () => {
    expect(DOC_TOOL_SPECS.map((s) => s.name)).toEqual(['create_docx', 'create_xlsx', 'create_pptx', 'create_pdf']);
    expect(DOC_TOOL_NAMES.has('create_docx')).toBe(true);
    for (const spec of DOC_TOOL_SPECS) {
      expect(spec.parameters.required).toContain('filename');
    }
  });
});

describe('executeDocTool', () => {
  it('creates an xlsx named after the conversation title with the forced extension', async () => {
    const result = await executeDocTool(outDir, 'Báo cáo quý', 'create_xlsx', {
      filename: 'data.txt',
      sheets: [{ name: 'S', rows: [['a', 1]] }],
    });
    expect(result.ok).toBe(true);
    expect(result.path).toBeDefined();
    expect(path.basename(result.path!)).toBe('Báo cáo quý.xlsx');
    const wb = XLSX.read(fs.readFileSync(result.path!), { type: 'buffer' });
    expect(XLSX.utils.sheet_to_json<any[]>(wb.Sheets.S, { header: 1 })).toEqual([['a', 1]]);
  });

  it('overwrites in place when called twice with the same title', async () => {
    const args = { filename: 'x.xlsx', sheets: [{ rows: [['v2']] }] };
    await executeDocTool(outDir, 'Same title', 'create_xlsx', { filename: 'x.xlsx', sheets: [{ rows: [['v1']] }] });
    const second = await executeDocTool(outDir, 'Same title', 'create_xlsx', args);
    const files = fs.readdirSync(outDir).filter((f) => f.startsWith('Same title'));
    expect(files).toHaveLength(1);
    const wb = XLSX.read(fs.readFileSync(second.path!), { type: 'buffer' });
    expect(XLSX.utils.sheet_to_json<any[]>(wb.Sheets.Sheet1, { header: 1 })).toEqual([['v2']]);
  });

  it('creates a docx from markdown', async () => {
    const result = await executeDocTool(outDir, 'Doc title', 'create_docx', {
      filename: 'report',
      markdown: '# Hello\n\nWorld.',
    });
    expect(result.ok).toBe(true);
    expect(path.extname(result.path!)).toBe('.docx');
    expect(fs.statSync(result.path!).size).toBeGreaterThan(0);
  });

  it('creates a pptx from slides', async () => {
    const result = await executeDocTool(outDir, 'Deck', 'create_pptx', {
      filename: 'deck',
      slides: [{ title: 'One', bullets: ['a'] }],
    });
    expect(result.ok).toBe(true);
    expect(path.extname(result.path!)).toBe('.pptx');
  });

  it('creates a pdf via the injected renderer', async () => {
    const fake = vi.fn().mockResolvedValue(Buffer.from('%PDF-fake'));
    const result = await executeDocTool(outDir, 'Pdf title', 'create_pdf', { filename: 'r', html: '<p>x</p>' }, fake);
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(result.path!).toString()).toBe('%PDF-fake');
    expect(fake).toHaveBeenCalledWith('<p>x</p>');
  });

  it('returns ok:false with a descriptive message for invalid args (never throws)', async () => {
    const bad = await executeDocTool(outDir, 'T', 'create_xlsx', { filename: 'x', sheets: [] });
    expect(bad.ok).toBe(false);
    expect(bad.output).toMatch(/sheets/);

    const noTitle = await executeDocTool(outDir, 'T', 'create_pptx', { filename: 'x', slides: [{ title: '' }] });
    expect(noTitle.ok).toBe(false);
    expect(noTitle.output).toMatch(/title/);

    const emptyMd = await executeDocTool(outDir, 'T', 'create_docx', { filename: 'x', markdown: '' });
    expect(emptyMd.ok).toBe(false);
    expect(emptyMd.output).toMatch(/markdown/);
  });

  it('returns ok:false for an unknown tool name', async () => {
    const result = await executeDocTool(outDir, 'T', 'create_gif', { filename: 'x' });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/create_gif/);
  });
});
