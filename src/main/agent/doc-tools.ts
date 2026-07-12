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
