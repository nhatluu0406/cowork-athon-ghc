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
