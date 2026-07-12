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
