import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isImagePath, encodeImage } from '../../../src/main/attachments/image-encode';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgenc-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('isImagePath', () => {
  it('recognises the supported extensions case-insensitively', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'PNG', 'JPG']) {
      expect(isImagePath(`photo.${ext}`)).toBe(true);
    }
  });

  it('rejects non-image extensions', () => {
    expect(isImagePath('report.docx')).toBe(false);
    expect(isImagePath('archive.zip')).toBe(false);
    expect(isImagePath('noext')).toBe(false);
  });
});

describe('encodeImage', () => {
  it('returns mime type and base64 payload without a data: prefix', () => {
    const p = path.join(tmpDir, 'tiny.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fs.writeFileSync(p, bytes);
    const { mimeType, data } = encodeImage(p);
    expect(mimeType).toBe('image/png');
    expect(data).toBe(bytes.toString('base64'));
    expect(data.startsWith('data:')).toBe(false);
  });

  it('maps .jpg and .jpeg to image/jpeg', () => {
    const p = path.join(tmpDir, 'a.jpg');
    fs.writeFileSync(p, Buffer.from([1, 2, 3]));
    expect(encodeImage(p).mimeType).toBe('image/jpeg');
  });

  it('throws for a missing file', () => {
    expect(() => encodeImage(path.join(tmpDir, 'gone.png'))).toThrow();
  });

  it('throws for a non-image extension', () => {
    expect(() => encodeImage(path.join(tmpDir, 'a.txt'))).toThrow();
  });
});
