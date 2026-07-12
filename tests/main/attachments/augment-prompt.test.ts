import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { augmentPrompt } from '../../../src/main/attachments/augment-prompt';
import { ContentPart } from '../../../src/main/agent/types';

let tmpDir: string;
const limits = { maxFiles: 10, maxTokens: 500000 };

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'augment-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeText(name: string, content: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

describe('augmentPrompt', () => {
  it('returns the text unchanged when there are no attachments', async () => {
    expect(await augmentPrompt('just chat', [], limits)).toBe('just chat');
  });

  it('embeds a text file as an [Attachments] section and stays a string', async () => {
    const p = writeText('notes.txt', 'file body here');
    const result = await augmentPrompt('summarise this', [p], limits);
    expect(typeof result).toBe('string');
    const s = result as string;
    expect(s.startsWith('summarise this')).toBe(true);
    expect(s).toContain('[Attachments] — read and use these files to answer the request:');
    expect(s).toContain(`- notes.txt (${p})`);
    expect(s).toContain('--- Content of notes.txt ---');
    expect(s).toContain('file body here');
    expect(s).toContain('--- end of notes.txt ---');
  });

  it('returns ContentPart[] with a leading text part when an image is attached', async () => {
    const img = path.join(tmpDir, 'shot.png');
    fs.writeFileSync(img, Buffer.from([1, 2, 3, 4]));
    const result = await augmentPrompt('what is this?', [img], limits);
    expect(Array.isArray(result)).toBe(true);
    const parts = result as ContentPart[];
    expect(parts[0].type).toBe('text');
    expect((parts[0] as any).text).toContain('what is this?');
    expect((parts[0] as any).text).toContain('shot.png');
    expect(parts[1]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: Buffer.from([1, 2, 3, 4]).toString('base64'),
    });
  });

  it('mixes text extraction and image parts in one message', async () => {
    const doc = writeText('data.txt', 'tabular stuff');
    const img = path.join(tmpDir, 'pic.jpg');
    fs.writeFileSync(img, Buffer.from([9, 9]));
    const parts = (await augmentPrompt('analyse', [doc, img], limits)) as ContentPart[];
    expect(parts).toHaveLength(2);
    expect((parts[0] as any).text).toContain('tabular stuff');
    expect((parts[1] as any).mimeType).toBe('image/jpeg');
  });

  it('truncates over-limit file content and notes the cut', async () => {
    const small = { maxFiles: 10, maxTokens: 1000 }; // cap = 4000 chars (floor 1000 tokens)
    const p = writeText('big.txt', 'x'.repeat(10000));
    const s = (await augmentPrompt('read', [p], small)) as string;
    expect(s).toContain('…(truncated to ~1000 tokens)…');
    expect(s.length).toBeLessThan(6000);
  });

  it('notes unreadable files without blocking the send', async () => {
    const missing = path.join(tmpDir, 'gone.txt');
    const s = (await augmentPrompt('read', [missing], limits)) as string;
    expect(s).toContain('- gone.txt (');
    expect(s).toContain(`located at ${missing}`);
    expect(s).not.toContain('--- Content of gone.txt ---');
  });

  it('drops paths beyond maxFiles and records how many were skipped', async () => {
    const a = writeText('a.txt', 'A');
    const b = writeText('b.txt', 'B');
    const c = writeText('c.txt', 'C');
    const s = (await augmentPrompt('read', [a, b, c], { maxFiles: 2, maxTokens: 500000 })) as string;
    expect(s).toContain('--- Content of a.txt ---');
    expect(s).toContain('--- Content of b.txt ---');
    expect(s).not.toContain('--- Content of c.txt ---');
    expect(s).toContain('1');
  });

  it('sends only the [Attachments] section when the user typed no text', async () => {
    const p = writeText('only.txt', 'body');
    const s = (await augmentPrompt('', [p], limits)) as string;
    expect(s.trimStart().startsWith('[Attachments]')).toBe(true);
  });
});
