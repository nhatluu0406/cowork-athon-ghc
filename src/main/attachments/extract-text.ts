import * as fs from 'fs';
import * as path from 'path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export interface ExtractResult {
  text: string | null;
  note: string;
}

const MAX_ROWS = 2000; // per spreadsheet sheet, same bound as the Python original

/**
 * Best-effort text extraction so the agent can read attachments.
 * Never throws — failures come back as {text: null, note}.
 */
export async function extractText(filePath: string): Promise<ExtractResult> {
  const suffix = path.extname(filePath).toLowerCase();
  try {
    if (suffix === '.docx' || suffix === '.docm') {
      const { value } = await mammoth.extractRawText({ path: filePath });
      return { text: value.trim(), note: '' };
    }
    if (suffix === '.xlsx' || suffix === '.xlsm') {
      return { text: extractXlsx(filePath), note: '' };
    }
    if (suffix === '.pptx') {
      return { text: await extractPptx(filePath), note: '' };
    }
    if (suffix === '.pdf') {
      const { text } = await pdfParse(fs.readFileSync(filePath));
      const trimmed = (text || '').trim();
      if (trimmed) return { text: trimmed, note: '' };
      return { text: null, note: 'PDF text could not be extracted' };
    }
    const raw = fs.readFileSync(filePath);
    if (raw.subarray(0, 8192).includes(0)) {
      return { text: null, note: 'binary file — content not extracted' };
    }
    return { text: raw.toString('utf-8'), note: '' };
  } catch (exc) {
    return { text: null, note: `could not read (${exc instanceof Error ? exc.message : String(exc)})` };
  }
}

function extractXlsx(filePath: string): string {
  const wb = XLSX.readFile(filePath, { sheetRows: MAX_ROWS });
  const out: string[] = [];
  wb.SheetNames.forEach((name, idx) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { FS: '\t' }).trim();
    if (csv) out.push(`--- Sheet ${idx + 1} ---\n${csv}`);
  });
  return out.join('\n\n').trim();
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

async function extractPptx(filePath: string): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10));
  const out: string[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const xml = await zip.files[slideNames[i]].async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1]));
    if (texts.length) out.push(`--- Slide ${i + 1} ---\n${texts.join('\n')}`);
  }
  return out.join('\n\n').trim();
}
