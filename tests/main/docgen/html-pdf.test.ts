import { describe, it, expect, vi, afterEach } from 'vitest';
import { htmlToPdf, PDF_RENDER_TIMEOUT_MS } from '../../../src/main/docgen/html-pdf';

afterEach(() => {
  vi.useRealTimers();
});

describe('htmlToPdf', () => {
  it('delegates to the injected renderer and returns its buffer', async () => {
    const fake = vi.fn().mockResolvedValue(Buffer.from('%PDF-fake'));
    const out = await htmlToPdf('<html><body>hi</body></html>', fake);
    expect(out).toEqual(Buffer.from('%PDF-fake'));
    expect(fake).toHaveBeenCalledWith('<html><body>hi</body></html>');
  });

  it('rejects with a descriptive error for empty html without calling the renderer', async () => {
    const fake = vi.fn();
    await expect(htmlToPdf('', fake)).rejects.toThrow(/html/);
    await expect(htmlToPdf('   ', fake)).rejects.toThrow(/html/);
    expect(fake).not.toHaveBeenCalled();
  });

  it('propagates renderer failures', async () => {
    const fake = vi.fn().mockRejectedValue(new Error('render crashed'));
    await expect(htmlToPdf('<p>x</p>', fake)).rejects.toThrow('render crashed');
  });

  it('times out after PDF_RENDER_TIMEOUT_MS when the renderer never resolves', async () => {
    vi.useFakeTimers();
    const never: () => Promise<Buffer> = () => new Promise(() => undefined);
    const pending = htmlToPdf('<p>x</p>', never);
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(PDF_RENDER_TIMEOUT_MS + 1);
    await assertion;
  });
});
