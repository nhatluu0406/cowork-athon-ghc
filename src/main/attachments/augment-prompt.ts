import * as path from 'path';
import { ContentPart } from '../agent/types';
import { extractText } from './extract-text';
import { isImagePath, encodeImage } from './image-encode';

export interface AttachmentLimits {
  maxFiles: number;
  maxTokens: number;
}

/**
 * Embed attachment paths AND their extracted contents into the prompt so the
 * agent actually reads each attached file; images become real vision content
 * blocks. Returns a plain string unless at least one image was encoded.
 */
export async function augmentPrompt(
  text: string,
  attachmentPaths: string[],
  limits: AttachmentLimits,
): Promise<string | ContentPart[]> {
  if (!attachmentPaths.length) return text;

  let paths = attachmentPaths;
  let droppedNote = '';
  if (limits.maxFiles > 0 && paths.length > limits.maxFiles) {
    droppedNote = `(giới hạn ${limits.maxFiles} tệp đính kèm — ${paths.length - limits.maxFiles} tệp cuối bị bỏ qua)`;
    paths = paths.slice(0, limits.maxFiles);
  }
  const charLimit = Math.max(1000, limits.maxTokens) * 4;

  const lines: string[] = text ? [text] : [];
  lines.push('\n[Attachments] — read and use these files to answer the request:');
  const imageParts: ContentPart[] = [];

  for (const p of paths) {
    const name = path.basename(p);
    if (isImagePath(p)) {
      try {
        const { mimeType, data } = encodeImage(p);
        imageParts.push({ type: 'image', mimeType, data });
        lines.push(`- ${name} (image attached below; located at ${p})`);
      } catch (exc) {
        const reason = exc instanceof Error ? exc.message : String(exc);
        lines.push(`- ${name} (could not read image: ${reason}; located at ${p})`);
      }
      continue;
    }
    const { text: content, note } = await extractText(p);
    if (content === null) {
      lines.push(`- ${name} (${note}; located at ${p})`);
      continue;
    }
    let body = content;
    let extra = '';
    if (body.length > charLimit) {
      body = body.slice(0, charLimit);
      extra = `\n…(truncated to ~${Math.floor(charLimit / 4)} tokens)…`;
    }
    lines.push(`- ${name} (${p})`);
    lines.push(`\n--- Content of ${name} ---\n${body}${extra}\n--- end of ${name} ---`);
  }
  if (droppedNote) lines.push(droppedNote);

  const fullText = lines.join('\n');
  if (!imageParts.length) return fullText;
  return [{ type: 'text', text: fullText }, ...imageParts];
}
