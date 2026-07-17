/**
 * Local-only, read-only PowerPoint (.pptx) text extraction for Workspace Companion preview.
 *
 * A `.pptx` is an Open Packaging Convention ZIP container. We parse it fully IN MEMORY with JSZip
 * (already a dependency via mammoth) — nothing is extracted to disk, no remote URL is opened, and
 * no macro/embedded/active content is executed: we only read the slide XML parts and pull their
 * text runs. This is deliberately text-first (ordered slides + per-slide text), NOT a pixel-perfect
 * renderer. Encrypted `.pptx` (an OLE/CFBF compound file, not a ZIP) and malformed archives make
 * JSZip throw, which the caller turns into a clear unsupported/error state instead of a crash.
 *
 * Legacy `.ppt` (binary OLE) is a different format and is intentionally not handled here.
 */

import JSZip from "jszip";

export interface PptxSlideView {
  /** 1-based slide position in presentation order. */
  readonly index: number;
  /** First non-empty text line, trimmed — a light label for navigation. May be empty. */
  readonly title: string;
  /** Extracted slide text, paragraphs joined by newlines. May be empty for image-only slides. */
  readonly text: string;
}

// Bounded to keep a malformed or adversarial deck from producing an unbounded payload.
const MAX_SLIDES = 500;
const MAX_CHARS_PER_SLIDE = 50_000;

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    // Ampersand last so we don't double-decode the entities above.
    .replace(/&amp;/g, "&");
}

/** Pull ordered paragraph text from one slide's XML: `<a:t>` runs grouped by `<a:p>` paragraphs. */
function extractSlideText(xml: string): string {
  const paragraphs: string[] = [];
  // Split on paragraph boundaries so each `<a:p>` becomes its own line.
  const paraMatches = xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
  const blocks = paraMatches.length > 0 ? paraMatches : [xml];
  for (const block of blocks) {
    const runs = block.match(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g) ?? [];
    if (runs.length === 0) continue;
    let line = "";
    for (const run of runs) {
      const inner = run.replace(/^<a:t\b[^>]*>/, "").replace(/<\/a:t>$/, "");
      line += decodeXmlEntities(inner);
    }
    paragraphs.push(line);
    if (paragraphs.join("\n").length > MAX_CHARS_PER_SLIDE) break;
  }
  const text = paragraphs.join("\n");
  return text.length > MAX_CHARS_PER_SLIDE ? `${text.slice(0, MAX_CHARS_PER_SLIDE)}\n…` : text;
}

/**
 * Resolve slide XML part names in presentation display order using
 * `ppt/presentation.xml` (`<p:sldIdLst>`) + `ppt/_rels/presentation.xml.rels`. Falls back to a
 * numeric sort of `ppt/slides/slideN.xml` when the ordering parts are missing/unreadable.
 */
async function orderedSlidePaths(zip: JSZip): Promise<string[]> {
  const allSlides = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name),
  );
  const numericSort = (names: string[]): string[] =>
    [...names].sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });

  const presentation = zip.file("ppt/presentation.xml");
  const rels = zip.file("ppt/_rels/presentation.xml.rels");
  if (presentation === null || rels === null) return numericSort(allSlides);

  try {
    const presXml = await presentation.async("string");
    const relsXml = await rels.async("string");
    const relMap = new Map<string, string>();
    for (const rel of relsXml.match(/<Relationship\b[^>]*>/g) ?? []) {
      const id = rel.match(/Id="([^"]+)"/)?.[1];
      const target = rel.match(/Target="([^"]+)"/)?.[1];
      if (id === undefined || target === undefined) continue;
      // Targets are relative to ppt/ (e.g. "slides/slide1.xml"); normalize any "../".
      const normalized = target.replace(/^\.\//, "").replace(/^\.\.\//, "");
      relMap.set(id, normalized.startsWith("ppt/") ? normalized : `ppt/${normalized}`);
    }
    const ordered: string[] = [];
    for (const sldId of presXml.match(/<p:sldId\b[^>]*>/g) ?? []) {
      const rid = sldId.match(/r:id="([^"]+)"/)?.[1];
      if (rid === undefined) continue;
      const path = relMap.get(rid);
      if (path !== undefined && zip.file(path) !== null) ordered.push(path);
    }
    // Append any slide parts not referenced by the id list, keeping numeric order.
    for (const name of numericSort(allSlides)) {
      if (!ordered.includes(name)) ordered.push(name);
    }
    return ordered.length > 0 ? ordered : numericSort(allSlides);
  } catch {
    return numericSort(allSlides);
  }
}

/**
 * Parse a `.pptx` buffer into ordered, text-only slide views. Throws when the buffer is not a
 * readable ZIP/OOXML package (malformed or encrypted) — the caller maps that to an error state.
 */
export async function parsePptxSlides(buffer: Buffer): Promise<PptxSlideView[]> {
  const zip = await JSZip.loadAsync(buffer);
  const paths = (await orderedSlidePaths(zip)).slice(0, MAX_SLIDES);
  const slides: PptxSlideView[] = [];
  for (let i = 0; i < paths.length; i += 1) {
    const part = zip.file(paths[i]!);
    if (part === null) continue;
    const xml = await part.async("string");
    const text = extractSlideText(xml);
    const title = (text.split("\n").find((line) => line.trim().length > 0) ?? "").trim().slice(0, 120);
    slides.push({ index: slides.length + 1, title, text });
  }
  return slides;
}
