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
