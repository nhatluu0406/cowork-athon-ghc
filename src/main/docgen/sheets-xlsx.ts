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
