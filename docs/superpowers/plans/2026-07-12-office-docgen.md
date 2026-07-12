# Office Document Generation (Sub-project #3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Cowork agent four dedicated tools (`create_docx`/`create_xlsx`/`create_pptx`/`create_pdf`) that render real Office files from structured input via bundled JS libraries, plus the always-on HTML Document Builder built-in skill.

**Architecture:** Pure render modules in `src/main/docgen/` (structured input → Buffer, no filesystem), a `doc-tools.ts` executor that validates args and writes buffers into the output dir via the existing `titledFilename` convention, and `run-cowork.ts` integration (tool registration, dispatch, `[[ACTIVE_SKILLS]]` skill injection, rewritten tool prompt). PDF uses Electron's `printToPDF` behind an injectable `PdfRenderer` so everything else stays unit-testable.

**Tech Stack:** TypeScript, `docx` + `marked` (Markdown→Word), `xlsx`/SheetJS write side (already a dependency), `pptxgenjs`, Electron `BrowserWindow.webContents.printToPDF`, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-12-office-docgen-design.md`. Python reference: `OldVersion/src/cowork_local/core/chat_agent.py` (prompt/pipeline), `skill_templates/html-document.skill` (skill text).
- Every shell command that runs `npm`/`npx`/`node` MUST be prefixed with `export PATH="$PATH:/c/Program Files/nodejs"` (bash) — Node is not on the default PATH in this environment.
- New runtime deps (pure JS, esbuild-bundleable): `docx`, `pptxgenjs`, `marked`. `xlsx` is already installed — reuse it; do NOT add exceljs.
- No arbitrary code execution: no `run_command`, no `install_package`, no `.scratch/` sandbox — those belong to Tab Code (#5).
- Tool executors never throw into the agent loop: every failure returns `{ok: false, output: '<clear description>'}` so the model can read and retry.
- Output files: written to output root via `titledFilename(title, filename)` (from `src/main/agent/save-file-tool.ts`), overwrite-in-place, correct extension forced (`.docx`/`.xlsx`/`.pptx`/`.pdf`).
- HTML Document Builder skill text is verbatim from the spec appendix EXCEPT step 3, which becomes exactly: `3. Save it with the save_file tool as \`\`<name>.html\`\` — that is the final deliverable.` The ported text must NOT contain the string `.scratch`.
- Skill injection: a second system message starting with `[[ACTIVE_SKILLS]]` followed by `The user enabled the following skills — follow them:` then a blank line then the skill text — inserted at index 1 (right after the base system prompt), only if not already present.
- PDF render timeout: 30s. The hidden BrowserWindow is always destroyed in `finally`.
- All existing tests keep passing (108 as of start); run `export PATH="$PATH:/c/Program Files/nodejs" && npm test` before every commit.
- All work directly on `master` (standing project decision).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/docgen/sheets-xlsx.ts` (create) | `SheetSpec[]` → `.xlsx` Buffer (SheetJS) |
| `src/main/docgen/slides-pptx.ts` (create) | `SlideSpec[]` → `.pptx` Buffer (pptxgenjs) |
| `src/main/docgen/markdown-docx.ts` (create) | Markdown string → `.docx` Buffer (marked + docx) |
| `src/main/docgen/html-pdf.ts` (create) | HTML → `.pdf` Buffer; `PdfRenderer` type; Electron impl with lazy `import('electron')` |
| `src/main/agent/skills-builtin.ts` (create) | `HTML_DOC_BUILDER_SKILL`, `ACTIVE_SKILLS_TAG`, `activeSkillsMessage()` |
| `src/main/agent/doc-tools.ts` (create) | 4 ToolSpecs, `DOC_TOOL_NAMES`, `executeDocTool()` (validate → render → write) |
| `src/main/agent/run-cowork.ts` (modify) | register specs, dispatch branch, skill injection, new `COWORK_TOOL_PROMPT` |

---

### Task 1: Install deps + `sheets-xlsx.ts`

**Files:**
- Modify: `package.json` (via npm install)
- Create: `src/main/docgen/sheets-xlsx.ts`
- Test: `tests/main/docgen/sheets-xlsx.test.ts`

**Interfaces:**
- Produces: `interface SheetSpec { name?: string; rows: any[][] }`; `function sheetsToXlsx(sheets: SheetSpec[]): Buffer`. Throws `Error` with a descriptive message on invalid input (executor in Task 6 catches).

- [ ] **Step 1: Install the new dependencies**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm install docx pptxgenjs marked`
Expected: added to `dependencies`. (`xlsx` is already present from sub-project #2.)

- [ ] **Step 2: Write the failing tests** — create `tests/main/docgen/sheets-xlsx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { sheetsToXlsx } from '../../../src/main/docgen/sheets-xlsx';

describe('sheetsToXlsx', () => {
  it('writes one sheet with the given rows, preserving numbers and strings', () => {
    const buf = sheetsToXlsx([{ name: 'Data', rows: [['Name', 'Qty'], ['Widget', 3]] }]);
    const wb = XLSX.read(buf, { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Data']);
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets.Data, { header: 1 });
    expect(rows).toEqual([['Name', 'Qty'], ['Widget', 3]]);
  });

  it('writes multiple sheets in order', () => {
    const buf = sheetsToXlsx([
      { name: 'A', rows: [['a']] },
      { name: 'B', rows: [['b']] },
    ]);
    expect(XLSX.read(buf, { type: 'buffer' }).SheetNames).toEqual(['A', 'B']);
  });

  it('defaults missing/empty sheet names to SheetN', () => {
    const buf = sheetsToXlsx([{ rows: [['x']] }, { name: '   ', rows: [['y']] }]);
    expect(XLSX.read(buf, { type: 'buffer' }).SheetNames).toEqual(['Sheet1', 'Sheet2']);
  });

  it('sanitizes forbidden characters and caps names at 31 chars', () => {
    const buf = sheetsToXlsx([{ name: 'Bad:Name/With*Chars[2025]' + 'x'.repeat(40), rows: [['x']] }]);
    const name = XLSX.read(buf, { type: 'buffer' }).SheetNames[0];
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[\\\/\?\*\[\]:]/);
  });

  it('deduplicates repeated sheet names', () => {
    const buf = sheetsToXlsx([
      { name: 'Same', rows: [['a']] },
      { name: 'Same', rows: [['b']] },
    ]);
    const names = XLSX.read(buf, { type: 'buffer' }).SheetNames;
    expect(new Set(names).size).toBe(2);
  });

  it('throws a descriptive error for empty or malformed input', () => {
    expect(() => sheetsToXlsx([])).toThrow(/sheets/);
    expect(() => sheetsToXlsx([{ rows: [] }])).toThrow(/rows/);
    expect(() => sheetsToXlsx([{ rows: 'nope' as any }])).toThrow(/rows/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/docgen/sheets-xlsx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — create `src/main/docgen/sheets-xlsx.ts`:

```ts
import * as XLSX from 'xlsx';

export interface SheetSpec {
  name?: string;
  rows: any[][];
}

function sanitizeSheetName(name: string | undefined, index: number, used: Set<string>): string {
  let base = String(name || '')
    .replace(/[\\\/\?\*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .trim();
  if (!base) base = `Sheet${index + 1}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

export function sheetsToXlsx(sheets: SheetSpec[]): Buffer {
  if (!Array.isArray(sheets) || !sheets.length) {
    throw new Error('sheets must be a non-empty array of {name, rows} objects.');
  }
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  sheets.forEach((sheet, i) => {
    if (!Array.isArray(sheet.rows) || !sheet.rows.length || !sheet.rows.every(Array.isArray)) {
      throw new Error(`sheet ${i + 1}: rows must be a non-empty 2D array (array of row arrays).`);
    }
    const name = sanitizeSheetName(sheet.name, i, used);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), name);
  });
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
```

- [ ] **Step 5: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: all pass (108 + 6 new), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/docgen/sheets-xlsx.ts tests/main/docgen/sheets-xlsx.test.ts
git commit -m "feat: xlsx generation module (sheets JSON -> Buffer) + docgen deps"
```

---

### Task 2: `slides-pptx.ts`

**Files:**
- Create: `src/main/docgen/slides-pptx.ts`
- Test: `tests/main/docgen/slides-pptx.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pptxgenjs installed in Task 1).
- Produces: `interface SlideSpec { title: string; bullets?: string[]; notes?: string }`; `async function slidesToPptx(slides: SlideSpec[]): Promise<Buffer>`. Throws `Error` on invalid input.

- [ ] **Step 1: Write the failing tests** — create `tests/main/docgen/slides-pptx.test.ts`. Round-trip through the existing pptx extractor from sub-project #2:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { slidesToPptx } from '../../../src/main/docgen/slides-pptx';
import { extractText } from '../../../src/main/attachments/extract-text';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptxgen-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('slidesToPptx', () => {
  it('produces a pptx whose slides round-trip through extractText', async () => {
    const buf = await slidesToPptx([
      { title: 'Quarterly Report', bullets: ['Revenue up 12%', 'Costs stable'] },
      { title: 'Next Steps', bullets: ['Hire two engineers'] },
    ]);
    const p = path.join(tmpDir, 'deck.pptx');
    fs.writeFileSync(p, buf);
    const { text, note } = await extractText(p);
    expect(note).toBe('');
    expect(text).toContain('--- Slide 1 ---');
    expect(text).toContain('Quarterly Report');
    expect(text).toContain('Revenue up 12%');
    expect(text).toContain('--- Slide 2 ---');
    expect(text).toContain('Hire two engineers');
  });

  it('accepts a slide with no bullets', async () => {
    const buf = await slidesToPptx([{ title: 'Title only' }]);
    const p = path.join(tmpDir, 'title-only.pptx');
    fs.writeFileSync(p, buf);
    const { text } = await extractText(p);
    expect(text).toContain('Title only');
  });

  it('throws a descriptive error for empty slides or a missing title', async () => {
    await expect(slidesToPptx([])).rejects.toThrow(/slides/);
    await expect(slidesToPptx([{ title: '' }])).rejects.toThrow(/title/);
    await expect(slidesToPptx([{ title: '  ' } as any])).rejects.toThrow(/title/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/docgen/slides-pptx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/docgen/slides-pptx.ts`:

```ts
import PptxGenJS from 'pptxgenjs';

export interface SlideSpec {
  title: string;
  bullets?: string[];
  notes?: string;
}

export async function slidesToPptx(slides: SlideSpec[]): Promise<Buffer> {
  if (!Array.isArray(slides) || !slides.length) {
    throw new Error('slides must be a non-empty array of {title, bullets, notes} objects.');
  }
  const pptx = new PptxGenJS();
  slides.forEach((spec, i) => {
    if (typeof spec.title !== 'string' || !spec.title.trim()) {
      throw new Error(`slide ${i + 1}: title must be a non-empty string.`);
    }
    const slide = pptx.addSlide();
    slide.addText(spec.title, { x: 0.5, y: 0.4, w: 9, h: 0.9, fontSize: 28, bold: true });
    const bullets = (spec.bullets || []).map(String).filter((b) => b.trim());
    if (bullets.length) {
      slide.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y: 1.5, w: 8.6, h: 3.8, fontSize: 16, valign: 'top' },
      );
    }
    if (spec.notes) slide.addNotes(String(spec.notes));
  });
  return Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
}
```

(If the installed pptxgenjs major rejects `write({outputType:'nodebuffer'})`, its older signature is `pptx.write('nodebuffer')` — adapt to whichever the installed version's typings accept and note it in your report; the return contract stays `Promise<Buffer>`.)

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/docgen/slides-pptx.ts tests/main/docgen/slides-pptx.test.ts
git commit -m "feat: pptx generation module (slides JSON -> Buffer)"
```

---

### Task 3: `markdown-docx.ts`

**Files:**
- Create: `src/main/docgen/markdown-docx.ts`
- Test: `tests/main/docgen/markdown-docx.test.ts`

**Interfaces:**
- Produces: `async function markdownToDocx(markdown: string): Promise<Buffer>`. Throws `Error` on empty input. Supported Markdown subset (per spec): headings 1–6, paragraphs, bold/italic/inline-code, bullet lists, numbered lists (one nesting level), GFM tables, blockquote, fenced code blocks, horizontal rule. Unknown syntax renders as plain text — never throws.

- [ ] **Step 1: Write the failing tests** — create `tests/main/docgen/markdown-docx.test.ts` (round-trip via mammoth through `extractText`):

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/docgen/markdown-docx.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/docgen/markdown-docx.ts`:

```ts
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { lexer } from 'marked';

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const ORDERED_REF = 'md-ordered';

interface InlineStyle {
  bold?: boolean;
  italics?: boolean;
}

function inlineRuns(tokens: any[] | undefined, style: InlineStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  for (const t of tokens || []) {
    if (t.type === 'strong') {
      runs.push(...inlineRuns(t.tokens, { ...style, bold: true }));
    } else if (t.type === 'em') {
      runs.push(...inlineRuns(t.tokens, { ...style, italics: true }));
    } else if (t.type === 'codespan') {
      runs.push(new TextRun({ text: t.text, font: 'Consolas', bold: style.bold, italics: style.italics }));
    } else if (t.type === 'link') {
      const inner = t.tokens && t.tokens.length ? t.tokens : [{ type: 'text', text: t.text || t.href || '' }];
      runs.push(...inlineRuns(inner, style));
    } else if (t.type === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
    } else if (t.tokens && t.tokens.length) {
      runs.push(...inlineRuns(t.tokens, style));
    } else if (typeof t.text === 'string' && t.text) {
      runs.push(new TextRun({ text: t.text, bold: style.bold, italics: style.italics }));
    } else if (typeof t.raw === 'string' && t.raw) {
      runs.push(new TextRun({ text: t.raw, bold: style.bold, italics: style.italics }));
    }
  }
  return runs;
}

function listItemInlines(item: any): TextRun[] {
  const inline: any[] = [];
  for (const t of item.tokens || []) {
    if (t.type === 'text' || t.type === 'paragraph') inline.push(...(t.tokens || [{ type: 'text', text: t.text || '' }]));
  }
  return inlineRuns(inline);
}

function listParagraphs(tok: any, level: number): Paragraph[] {
  const out: Paragraph[] = [];
  for (const item of tok.items || []) {
    out.push(
      new Paragraph(
        tok.ordered
          ? { children: listItemInlines(item), numbering: { reference: ORDERED_REF, level } }
          : { children: listItemInlines(item), bullet: { level } },
      ),
    );
    for (const sub of item.tokens || []) {
      if (sub.type === 'list' && level < 1) out.push(...listParagraphs(sub, level + 1));
    }
  }
  return out;
}

function blockChildren(tokens: any[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading':
        out.push(
          new Paragraph({
            heading: HEADINGS[Math.min(6, Math.max(1, tok.depth)) - 1],
            children: inlineRuns(tok.tokens),
          }),
        );
        break;
      case 'paragraph':
        out.push(new Paragraph({ children: inlineRuns(tok.tokens) }));
        break;
      case 'list':
        out.push(...listParagraphs(tok, 0));
        break;
      case 'table': {
        const headerRow = new TableRow({
          children: (tok.header || []).map(
            (cell: any) =>
              new TableCell({ children: [new Paragraph({ children: inlineRuns(cell.tokens, { bold: true }) })] }),
          ),
        });
        const bodyRows = (tok.rows || []).map(
          (row: any[]) =>
            new TableRow({
              children: row.map(
                (cell: any) => new TableCell({ children: [new Paragraph({ children: inlineRuns(cell.tokens) })] }),
              ),
            }),
        );
        out.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] }));
        break;
      }
      case 'blockquote':
        for (const child of blockChildren(tok.tokens || [])) out.push(child);
        break;
      case 'code':
        for (const line of String(tok.text || '').split('\n')) {
          out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Consolas' })] }));
        }
        break;
      case 'hr':
        out.push(
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1 } },
            children: [],
          }),
        );
        break;
      case 'space':
        break;
      default:
        if (typeof tok.raw === 'string' && tok.raw.trim()) {
          out.push(new Paragraph({ children: [new TextRun(tok.raw.trim())] }));
        }
        break;
    }
  }
  return out;
}

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('markdown must be a non-empty string with the full document content.');
  }
  const children = blockChildren(lexer(markdown));
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: ORDERED_REF,
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
            { level: 1, format: LevelFormat.DECIMAL, text: '%2.', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph('')] }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/docgen/markdown-docx.ts tests/main/docgen/markdown-docx.test.ts
git commit -m "feat: docx generation module (Markdown -> Buffer)"
```

---

### Task 4: `html-pdf.ts`

**Files:**
- Create: `src/main/docgen/html-pdf.ts`
- Test: `tests/main/docgen/html-pdf.test.ts`

**Interfaces:**
- Produces: `type PdfRenderer = (html: string) => Promise<Buffer>`; `const PDF_RENDER_TIMEOUT_MS = 30000`; `async function htmlToPdf(html: string, renderer?: PdfRenderer): Promise<Buffer>` (validates input, applies timeout, defaults to `electronPdfRenderer`); `async function electronPdfRenderer(html: string): Promise<Buffer>` (hidden BrowserWindow + printToPDF; NEVER imported statically from electron — uses `await import('electron')` inside the function so this module stays importable under Vitest).

- [ ] **Step 1: Write the failing tests** — create `tests/main/docgen/html-pdf.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { htmlToPdf, PDF_RENDER_TIMEOUT_MS } from '../../../src/main/docgen/html-pdf';

afterEach(() => {
  vi.useRealTimers();
});

describe('htmlToPdf', () => {
  it('delegates to the injected renderer and returns its buffer', async () => {
    const fake = vi.fn().mockResolvedValue(Buffer.from('%PDF-fake'));
    const out = await htmlToPdf('<html><body>hi</body></html>', fake);
    expect(out).toEqual(Buffer.from('%PDF-fake'));
    expect(fake).toHaveBeenCalledWith('<html><body>hi</body></html>');
  });

  it('rejects with a descriptive error for empty html without calling the renderer', async () => {
    const fake = vi.fn();
    await expect(htmlToPdf('', fake)).rejects.toThrow(/html/);
    await expect(htmlToPdf('   ', fake)).rejects.toThrow(/html/);
    expect(fake).not.toHaveBeenCalled();
  });

  it('propagates renderer failures', async () => {
    const fake = vi.fn().mockRejectedValue(new Error('render crashed'));
    await expect(htmlToPdf('<p>x</p>', fake)).rejects.toThrow('render crashed');
  });

  it('times out after PDF_RENDER_TIMEOUT_MS when the renderer never resolves', async () => {
    vi.useFakeTimers();
    const never: () => Promise<Buffer> = () => new Promise(() => undefined);
    const pending = htmlToPdf('<p>x</p>', never);
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(PDF_RENDER_TIMEOUT_MS + 1);
    await assertion;
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/docgen/html-pdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/docgen/html-pdf.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type PdfRenderer = (html: string) => Promise<Buffer>;

export const PDF_RENDER_TIMEOUT_MS = 30000;

export async function htmlToPdf(html: string, renderer: PdfRenderer = electronPdfRenderer): Promise<Buffer> {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('html must be a non-empty string containing one complete self-contained HTML document.');
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`PDF render timed out after ${PDF_RENDER_TIMEOUT_MS / 1000}s.`)),
      PDF_RENDER_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([renderer(html), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renders HTML to PDF in a hidden BrowserWindow via webContents.printToPDF (A4).
 * Electron is imported lazily so this module can be imported under Vitest,
 * where the 'electron' package resolves to a binary-path stub, not the runtime API.
 * The HTML goes through a temp file (loadFile) instead of a data: URL, which
 * Chromium truncates for large documents.
 */
export async function electronPdfRenderer(html: string): Promise<Buffer> {
  const { BrowserWindow } = await import('electron');
  const tmp = path.join(os.tmpdir(), `cowork-pdf-${Date.now()}-${Math.floor(Math.random() * 1e6)}.html`);
  fs.writeFileSync(tmp, html, 'utf-8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    return Buffer.from(pdf);
  } finally {
    win.destroy();
    fs.rmSync(tmp, { force: true });
  }
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/docgen/html-pdf.ts tests/main/docgen/html-pdf.test.ts
git commit -m "feat: pdf generation module (html -> Buffer via injectable renderer)"
```

---

### Task 5: `skills-builtin.ts` — HTML Document Builder

**Files:**
- Create: `src/main/agent/skills-builtin.ts`
- Test: `tests/main/agent/skills-builtin.test.ts`

**Interfaces:**
- Produces: `const HTML_DOC_BUILDER_SKILL: string`; `const ACTIVE_SKILLS_TAG = '[[ACTIVE_SKILLS]]'`; `function activeSkillsMessage(): string` returning `` `${ACTIVE_SKILLS_TAG}\nThe user enabled the following skills — follow them:\n\n${HTML_DOC_BUILDER_SKILL}` ``.

- [ ] **Step 1: Write the failing tests** — create `tests/main/agent/skills-builtin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  HTML_DOC_BUILDER_SKILL,
  ACTIVE_SKILLS_TAG,
  activeSkillsMessage,
} from '../../../src/main/agent/skills-builtin';

describe('HTML_DOC_BUILDER_SKILL', () => {
  it('carries the original skill text verbatim (spot checks)', () => {
    expect(HTML_DOC_BUILDER_SKILL).toContain('# HTML Document Builder');
    expect(HTML_DOC_BUILDER_SKILL).toContain('self-contained **HTML document**');
    expect(HTML_DOC_BUILDER_SKILL).toContain('Put ALL CSS inline in a ``<style>`` block');
    expect(HTML_DOC_BUILDER_SKILL).toContain('centred content column (max-width ~820px)');
    expect(HTML_DOC_BUILDER_SKILL).toContain('Do NOT ask clarifying or confirmation questions');
  });

  it('uses the ported step 3 (save_file tool, no .scratch)', () => {
    expect(HTML_DOC_BUILDER_SKILL).toContain('Save it with the save_file tool as ``<name>.html``');
    expect(HTML_DOC_BUILDER_SKILL).not.toContain('.scratch');
  });
});

describe('activeSkillsMessage', () => {
  it('wraps the skill in the ACTIVE_SKILLS envelope', () => {
    const msg = activeSkillsMessage();
    expect(msg.startsWith(`${ACTIVE_SKILLS_TAG}\n`)).toBe(true);
    expect(msg).toContain('The user enabled the following skills — follow them:');
    expect(msg).toContain('# HTML Document Builder');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/agent/skills-builtin.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/agent/skills-builtin.ts` with the skill text verbatim from the spec appendix (only step 3 replaced, per the spec's port note):

```ts
/**
 * Built-in, always-on skills. Sub-project #4 (Skills system) will fold this
 * constant into its built-in skill list; keep the text and envelope format
 * identical to the Python original (skill_templates/html-document.skill,
 * _apply_skills in code_agent.py).
 */
export const HTML_DOC_BUILDER_SKILL = `# HTML Document Builder

You turn the user's request into a polished, self-contained **HTML document** and
save it as the final \`\`.html\`\` file.

When the user asks for a document — report, one-pager, memo, proposal, meeting
minutes, guide, letter, summary, etc.:

1. Write the full content called for: clear structure, accurate to the request,
   in the user's language.
2. Produce ONE standalone \`\`.html\`\` file (no external dependencies):
   - Put ALL CSS inline in a \`\`<style>\`\` block; embed any images as base64 data URIs.
   - Include \`\`<meta charset="utf-8">\`\` and a \`\`<title>\`\`.
   - Clean, readable typography; a centred content column (max-width ~820px);
     clear heading hierarchy; bordered tables; a subtle accent colour; spacing
     that prints well on A4.
3. Save it with the save_file tool as \`\`<name>.html\`\` — that is the final deliverable.
4. Do NOT ask clarifying or confirmation questions — make reasonable assumptions,
   complete the request end-to-end, then report the saved file name.
`;

export const ACTIVE_SKILLS_TAG = '[[ACTIVE_SKILLS]]';

export function activeSkillsMessage(): string {
  return `${ACTIVE_SKILLS_TAG}\nThe user enabled the following skills — follow them:\n\n${HTML_DOC_BUILDER_SKILL}`;
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/skills-builtin.ts tests/main/agent/skills-builtin.test.ts
git commit -m "feat: built-in HTML Document Builder skill constant"
```

---

### Task 6: `doc-tools.ts` — ToolSpecs + executor

**Files:**
- Create: `src/main/agent/doc-tools.ts`
- Test: `tests/main/agent/doc-tools.test.ts`

**Interfaces:**
- Consumes: `sheetsToXlsx`/`SheetSpec` (Task 1), `slidesToPptx`/`SlideSpec` (Task 2), `markdownToDocx` (Task 3), `htmlToPdf`/`PdfRenderer` (Task 4), `titledFilename` from `./save-file-tool`, `ToolSpec` from `./types`.
- Produces: `const DOC_TOOL_SPECS: ToolSpec[]` (create_docx, create_xlsx, create_pptx, create_pdf — in that order); `const DOC_TOOL_NAMES: Set<string>`; `async function executeDocTool(outputDir: string, title: string, name: string, args: Record<string, any>, pdfRenderer?: PdfRenderer): Promise<{ ok: boolean; output: string; path?: string }>`.

- [ ] **Step 1: Write the failing tests** — create `tests/main/agent/doc-tools.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/agent/doc-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `src/main/agent/doc-tools.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { ToolSpec } from './types';
import { titledFilename } from './save-file-tool';
import { markdownToDocx } from '../docgen/markdown-docx';
import { sheetsToXlsx, SheetSpec } from '../docgen/sheets-xlsx';
import { slidesToPptx, SlideSpec } from '../docgen/slides-pptx';
import { htmlToPdf, PdfRenderer } from '../docgen/html-pdf';

export const CREATE_DOCX_SPEC: ToolSpec = {
  name: 'create_docx',
  description:
    'Create a real Word (.docx) document from Markdown. Use when the user wants a Word file (report, memo, minutes).',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name, extension .docx (added automatically if missing)' },
      markdown: {
        type: 'string',
        description: 'FULL document content as Markdown: headings, paragraphs, bold/italic, lists, tables.',
      },
    },
    required: ['filename', 'markdown'],
  },
};

export const CREATE_XLSX_SPEC: ToolSpec = {
  name: 'create_xlsx',
  description: 'Create a real Excel (.xlsx) workbook from structured rows. Use when the user wants a spreadsheet.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name, extension .xlsx (added automatically if missing)' },
      sheets: {
        type: 'array',
        description: 'Sheets: [{name, rows}] where rows is a 2D array; make the first row the header row.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            rows: { type: 'array', items: { type: 'array' } },
          },
          required: ['rows'],
        },
      },
    },
    required: ['filename', 'sheets'],
  },
};

export const CREATE_PPTX_SPEC: ToolSpec = {
  name: 'create_pptx',
  description: 'Create a real PowerPoint (.pptx) deck. Use when the user wants slides/a presentation.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name, extension .pptx (added automatically if missing)' },
      slides: {
        type: 'array',
        description: 'Slides: [{title, bullets, notes?}]. Keep each bullet short (one line).',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['title'],
        },
      },
    },
    required: ['filename', 'slides'],
  },
};

export const CREATE_PDF_SPEC: ToolSpec = {
  name: 'create_pdf',
  description:
    'Create a PDF from ONE complete self-contained HTML document (inline CSS, A4-friendly). Use when the user wants a PDF.',
  parameters: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'File name, extension .pdf (added automatically if missing)' },
      html: { type: 'string', description: 'One complete standalone HTML document with all CSS inline.' },
    },
    required: ['filename', 'html'],
  },
};

export const DOC_TOOL_SPECS: ToolSpec[] = [CREATE_DOCX_SPEC, CREATE_XLSX_SPEC, CREATE_PPTX_SPEC, CREATE_PDF_SPEC];
export const DOC_TOOL_NAMES = new Set(DOC_TOOL_SPECS.map((s) => s.name));

const TOOL_EXT: Record<string, string> = {
  create_docx: '.docx',
  create_xlsx: '.xlsx',
  create_pptx: '.pptx',
  create_pdf: '.pdf',
};

function forceExt(filename: any, ext: string): string {
  const f = String(filename || 'output').trim() || 'output';
  if (path.extname(f).toLowerCase() === ext) return f;
  const base = f.slice(0, f.length - path.extname(f).length) || 'output';
  return base + ext;
}

async function buildBuffer(name: string, args: Record<string, any>, pdfRenderer?: PdfRenderer): Promise<Buffer> {
  switch (name) {
    case 'create_docx':
      return markdownToDocx(args.markdown as string);
    case 'create_xlsx':
      return sheetsToXlsx(args.sheets as SheetSpec[]);
    case 'create_pptx':
      return slidesToPptx(args.slides as SlideSpec[]);
    case 'create_pdf':
      return htmlToPdf(args.html as string, pdfRenderer);
    default:
      throw new Error(`Tool not found: ${name}`);
  }
}

export async function executeDocTool(
  outputDir: string,
  title: string,
  name: string,
  args: Record<string, any>,
  pdfRenderer?: PdfRenderer,
): Promise<{ ok: boolean; output: string; path?: string }> {
  try {
    const buffer = await buildBuffer(name, args || {}, pdfRenderer);
    fs.mkdirSync(outputDir, { recursive: true });
    const ext = TOOL_EXT[name] || '';
    const fname = titledFilename(title, forceExt((args || {}).filename, ext));
    const target = path.join(outputDir, fname);
    fs.writeFileSync(target, buffer);
    return { ok: true, output: `Saved ${fname}.`, path: target };
  } catch (exc: any) {
    return { ok: false, output: `${name} failed: ${exc?.message || exc}` };
  }
}
```

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent/doc-tools.ts tests/main/agent/doc-tools.test.ts
git commit -m "feat: doc-tools specs + executor (validate, render, write via titledFilename)"
```

---

### Task 7: `run-cowork.ts` integration — registration, dispatch, skill injection, new prompt

**Files:**
- Modify: `src/main/agent/run-cowork.ts`
- Test: `tests/main/agent/run-cowork.test.ts` (extend; adjust existing assertions ONLY where the new system-message insertion shifts message indexes — keep their semantics)

**Interfaces:**
- Consumes: `DOC_TOOL_SPECS`, `DOC_TOOL_NAMES`, `executeDocTool` (Task 6); `activeSkillsMessage`, `ACTIVE_SKILLS_TAG` (Task 5); `PdfRenderer` (Task 4); existing `titledFilename`, `SAVE_FILE_SPEC`, `UPDATE_PLAN_SPEC`, `contentText`.
- Produces: `RunCoworkOptions` gains `pdfRenderer?: PdfRenderer`. Message layout after this task: `messages[0]` = base system prompt, `messages[1]` = `[[ACTIVE_SKILLS]]` system message (both inserted only when absent).

- [ ] **Step 1: Read the current file and its tests**

Read `src/main/agent/run-cowork.ts` and `tests/main/agent/run-cowork.test.ts` fully before changing anything. Existing tests drive a fake `Provider`; note any assertions on `messages` indexes or lengths — the skill message at index 1 shifts them by one.

- [ ] **Step 2: Write the failing tests** — add to `tests/main/agent/run-cowork.test.ts` (follow the file's existing fake-provider pattern for constructing providers and tool-call turns; the assertions below are the contract):

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { ACTIVE_SKILLS_TAG } from '../../../src/main/agent/skills-builtin';
import { COWORK_TOOL_PROMPT } from '../../../src/main/agent/run-cowork';

it('injects the ACTIVE_SKILLS system message at index 1 exactly once', async () => {
  // provider: fake that immediately returns a plain assistant message (no tools)
  const messages: Message[] = [];
  await runCowork(fakeProviderReturning({ role: 'assistant', content: 'hi', tool_calls: [] }), messages, os.tmpdir(), () => {});
  expect(messages[0].role).toBe('system');
  expect(String(messages[1].content).startsWith(ACTIVE_SKILLS_TAG)).toBe(true);
  // second run on the same array must NOT duplicate it
  await runCowork(fakeProviderReturning({ role: 'assistant', content: 'again', tool_calls: [] }), messages, os.tmpdir(), () => {});
  const skillMsgs = messages.filter((m) => m.role === 'system' && String(m.content).startsWith(ACTIVE_SKILLS_TAG));
  expect(skillMsgs).toHaveLength(1);
});

it('dispatches create_xlsx: writes the file, emits tool_result + outputs_added, pushes the tool message', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-doc-'));
  const events: StreamEvent[] = [];
  // provider turn 1: assistant with tool_call create_xlsx; turn 2: plain "done"
  const provider = fakeProviderWithToolCall({
    id: 'tc1',
    name: 'create_xlsx',
    arguments: { filename: 'data', sheets: [{ name: 'S', rows: [['a', 1]] }] },
  });
  const messages: Message[] = [{ role: 'user', content: 'make a sheet' }];
  await runCowork(provider, messages, outDir, (e) => events.push(e), { title: 'Sheet title' });
  const toolResult = events.find((e) => e.type === 'tool_result') as any;
  expect(toolResult.ok).toBe(true);
  expect(toolResult.path).toContain('Sheet title.xlsx');
  expect(events.some((e) => e.type === 'outputs_added')).toBe(true);
  const toolMsg = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'tc1');
  expect(toolMsg).toBeDefined();
  expect(XLSX.read(fs.readFileSync(toolResult.path), { type: 'buffer' }).SheetNames).toEqual(['S']);
  fs.rmSync(outDir, { recursive: true, force: true });
});

it('feeds a failing doc tool result back to the model instead of throwing', async () => {
  const events: StreamEvent[] = [];
  const provider = fakeProviderWithToolCall({ id: 'tc2', name: 'create_pptx', arguments: { filename: 'd', slides: [] } });
  const messages: Message[] = [{ role: 'user', content: 'deck' }];
  await runCowork(provider, messages, os.tmpdir(), (e) => events.push(e));
  const toolResult = events.find((e) => e.type === 'tool_result') as any;
  expect(toolResult.ok).toBe(false);
  const toolMsg = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'tc2');
  expect(String(toolMsg!.content)).toMatch(/slides/);
});

it('COWORK_TOOL_PROMPT teaches the four tools and no script workflow', () => {
  for (const t of ['create_docx', 'create_xlsx', 'create_pptx', 'create_pdf', 'save_file']) {
    expect(COWORK_TOOL_PROMPT).toContain(t);
  }
  expect(COWORK_TOOL_PROMPT).not.toMatch(/run_command|\.scratch|install_package|Python script/i);
});
```

(`fakeProviderReturning` / `fakeProviderWithToolCall` refer to the test file's existing fake-provider helpers — reuse/extend whatever the file already defines rather than inventing parallel ones. A tool-call fake returns the tool-call message on the first `chat()` call and a plain `{role:'assistant', content:'done', tool_calls: []}` on the second.)

- [ ] **Step 3: Run to verify failure**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npx vitest run tests/main/agent/run-cowork.test.ts`
Expected: FAIL — `ACTIVE_SKILLS_TAG` message absent, `create_xlsx` hits the unknown-tool branch, prompt assertions fail.

- [ ] **Step 4: Implement in `src/main/agent/run-cowork.ts`**

Add imports:

```ts
import { DOC_TOOL_SPECS, DOC_TOOL_NAMES, executeDocTool } from './doc-tools';
import { activeSkillsMessage, ACTIVE_SKILLS_TAG } from './skills-builtin';
import { PdfRenderer } from '../docgen/html-pdf';
```

Replace `COWORK_TOOL_PROMPT` with:

```ts
export const COWORK_TOOL_PROMPT =
  COWORK_SYSTEM_PROMPT +
  '\nYou can create real files for the user in the output folder.\n' +
  '• For text (.md/.txt/.csv/.json/.html): call save_file(filename, content) ONCE with the FINAL ' +
  'content. Re-saving the same filename overwrites in place.\n' +
  '• For a Word document: call create_docx(filename, markdown) with the FULL content as Markdown.\n' +
  '• For a spreadsheet: call create_xlsx(filename, sheets) — sheets is [{name, rows}] with rows a 2D ' +
  'array whose first row is the header.\n' +
  '• For a presentation: call create_pptx(filename, slides) — slides is [{title, bullets, notes?}].\n' +
  '• For a PDF: call create_pdf(filename, html) with ONE complete self-contained HTML document ' +
  '(all CSS inline, A4-friendly).\n' +
  'If a tool call fails, read the error, fix the input, and call it again until the file is produced; ' +
  'then report the final file name. For plain conversation, do NOT call any tool.\n' +
  'For any task that takes more than one step, FIRST call update_plan with a short checklist ' +
  "(2–6 short imperative steps, each status 'pending'); then, as you work, call update_plan " +
  "again to mark the current step 'running' and finished steps 'done'. Skip the plan for a " +
  'trivial one-line reply.\n' +
  'Do NOT ask the user clarifying or confirmation questions — make reasonable assumptions and ' +
  'carry out the ORIGINAL request end-to-end on your own, then report only the final result.';
```

Extend `RunCoworkOptions`:

```ts
export interface RunCoworkOptions {
  cancel?: CancelFn;
  maxSteps?: number;
  title?: string;
  pdfRenderer?: PdfRenderer;
}
```

After the existing system-prompt unshift block, insert the skill message (idempotent):

```ts
  if (!messages.length || messages[0].role !== 'system') {
    messages.unshift({ role: 'system', content: COWORK_TOOL_PROMPT });
  }
  const hasSkills = messages.some(
    (m) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith(ACTIVE_SKILLS_TAG),
  );
  if (!hasSkills) {
    messages.splice(1, 0, { role: 'system', content: activeSkillsMessage() });
  }
```

Register the specs:

```ts
  const toolSpecs: ToolSpec[] = [SAVE_FILE_SPEC, UPDATE_PLAN_SPEC, ...DOC_TOOL_SPECS];
```

Add the dispatch branch INSIDE the tool-call loop, after the `save_file` branch and before the unknown-tool fallback:

```ts
      if (DOC_TOOL_NAMES.has(name)) {
        const previewFilename = titledFilename(title, String((args as any).filename || 'output'));
        const previewText = String(
          (args as any).markdown ?? (args as any).html ?? JSON.stringify((args as any).sheets ?? (args as any).slides ?? args, null, 2),
        ).slice(0, 4000);
        emit({
          type: 'tool_proposed',
          id: tcId,
          name,
          args,
          preview: { kind: 'diff', title: `Create ${previewFilename}`, text: previewText },
        });
        const result = await executeDocTool(outputDir, title, name, args as any, opts.pdfRenderer);
        emit({
          type: 'tool_result',
          id: tcId,
          name,
          ok: result.ok,
          output: result.output,
          ...(result.path ? { path: result.path } : {}),
        });
        if (result.ok && result.path) {
          emit({ type: 'outputs_added', paths: [result.path] });
        }
        messages.push({ role: 'tool', tool_call_id: tcId, name, content: result.output });
        continue;
      }
```

- [ ] **Step 5: Fix index-shift fallout in existing tests**

Run the full suite. Any pre-existing `run-cowork.test.ts` assertion that counts messages or reads `messages[N]` may shift by one because of the new system message at index 1. Update ONLY those index/count numbers — do not weaken what the assertions verify. If ipc-level or history tests fail for the same reason, apply the same minimal adjustment.

- [ ] **Step 6: Run the full suite + build**

Run: `export PATH="$PATH:/c/Program Files/nodejs" && npm test && npx tsc --noEmit && npm run build`
Expected: all pass, tsc clean, esbuild bundles docx/pptxgenjs/marked successfully.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/run-cowork.ts tests/main/agent/run-cowork.test.ts
git commit -m "feat: register doc tools in cowork loop, inject HTML Doc Builder skill, rewrite tool prompt"
```

---

### Task 8: Manual end-to-end verification (deferred to the user)

No code. Run `npm start` with a real API key and verify:

- [ ] "Tạo báo cáo Word về X" → model calls `create_docx`, file `<title>.docx` xuất hiện trong panel "Tệp đầu ra", mở được bằng Word/LibreOffice với heading/bảng đúng.
- [ ] "Tạo file Excel so sánh A và B" → `create_xlsx`, mở được, đúng sheet/cột.
- [ ] "Làm slide giới thiệu Y" → `create_pptx`, mở được bằng PowerPoint, đúng title/bullet.
- [ ] "Xuất PDF tài liệu Z" → `create_pdf` (cửa sổ ẩn, không nhấp nháy UI), PDF mở được, render CSS đúng khổ A4.
- [ ] "Soạn tài liệu/báo cáo..." không nêu định dạng → HTML Document Builder kích hoạt, ra một file `.html` tự chứa qua `save_file`.
- [ ] Hội thoại thường (không yêu cầu file) → không tool nào được gọi (regression).
- [ ] Compress/Stop/history/attachments từ các sub-project trước vẫn hoạt động (regression).
