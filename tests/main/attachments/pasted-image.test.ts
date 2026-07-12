import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { savePastedImage } from '../../../src/main/attachments/pasted-image';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pasted-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('savePastedImage', () => {
  it('writes the decoded bytes to paste-<timestamp>.png and returns the path', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const saved = savePastedImage(bytes.toString('base64'), tmpDir);
    expect(path.basename(saved)).toMatch(/^paste-\d{8}-\d{6}-\d{3}\.png$/);
    expect(fs.readFileSync(saved)).toEqual(bytes);
  });

  it('creates the target directory when missing', () => {
    const nested = path.join(tmpDir, 'deep', 'dir');
    const saved = savePastedImage(Buffer.from([1]).toString('base64'), nested);
    expect(fs.existsSync(saved)).toBe(true);
  });
});
