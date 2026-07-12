import PptxGenJS from 'pptxgenjs';

export interface SlideSpec {
  title: string;
  bullets?: string[];
  notes?: string;
}

export async function slidesToPptx(slides: SlideSpec[]): Promise<Buffer> {
  if (!Array.isArray(slides) || !slides.length) {
    throw new Error('slides must be a non-empty array of {title, bullets, notes} objects.');
  }
  const pptx = new PptxGenJS();
  slides.forEach((spec, i) => {
    if (typeof spec.title !== 'string' || !spec.title.trim()) {
      throw new Error(`slide ${i + 1}: title must be a non-empty string.`);
    }
    const slide = pptx.addSlide();
    slide.addText(spec.title, { x: 0.5, y: 0.4, w: 9, h: 0.9, fontSize: 28, bold: true });
    const bullets = (spec.bullets || []).map(String).filter((b) => b.trim());
    if (bullets.length) {
      slide.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y: 1.5, w: 8.6, h: 3.8, fontSize: 16, valign: 'top' },
      );
    }
    if (spec.notes) slide.addNotes(String(spec.notes));
  });
  return Buffer.from((await pptx.write({ outputType: 'nodebuffer' })) as Buffer);
}
