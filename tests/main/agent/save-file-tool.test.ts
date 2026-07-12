import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeFilename, titledFilename, doSaveFile, SAVE_FILE_SPEC } from '../../../src/main/agent/save-file-tool';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-savefile-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SAVE_FILE_SPEC', () => {
  it('requires filename and content', () => {
    expect(SAVE_FILE_SPEC.name).toBe('save_file');
    expect(SAVE_FILE_SPEC.parameters.required).toEqual(['filename', 'content']);
  });
});

describe('safeFilename', () => {
  it('strips path separators and unsafe characters but keeps unicode letters', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('Báo cáo tuần.md')).toBe('Báo cáo tuần.md');
  });

  it('adds a .txt extension when none is present', () => {
    expect(safeFilename('notes')).toBe('notes.txt');
  });

  it('falls back to output.txt when the name is empty after sanitizing', () => {
    expect(safeFilename('///')).toBe('output.txt');
  });
});

describe('titledFilename', () => {
  it('uses the chat title as the base name, keeping the agent extension', () => {
    expect(titledFilename('Báo cáo tuần', 'draft.md')).toBe('Báo cáo tuần.md');
  });

  it('falls back to the agent filename stem when the title is empty', () => {
    expect(titledFilename('', 'draft.md')).toBe('draft.md');
  });

  it('truncates very long titles to 80 characters', () => {
    const longTitle = 'a'.repeat(200);
    const result = titledFilename(longTitle, 'x.md');
    expect(result.length).toBeLessThanOrEqual(83); // 80 + '.md'
  });
});

describe('doSaveFile', () => {
  it('writes content to the output dir using the titled filename', () => {
    const result = doSaveFile(tmpDir, 'Weekly report', { filename: 'draft.md', content: '# Hello' });
    expect(result.ok).toBe(true);
    expect(result.path).toBe(path.join(tmpDir, 'Weekly report.md'));
    expect(fs.readFileSync(result.path!, 'utf-8')).toBe('# Hello');
  });

  it('overwrites an existing file of the same name in place', () => {
    doSaveFile(tmpDir, 'Notes', { filename: 'a.md', content: 'v1' });
    const result = doSaveFile(tmpDir, 'Notes', { filename: 'a.md', content: 'v2' });
    expect(fs.readFileSync(result.path!, 'utf-8')).toBe('v2');
  });
});
