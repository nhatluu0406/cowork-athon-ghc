/**
 * Deterministic text diff for file review (unified, CRLF-safe).
 */

import {
  FILE_REVIEW_MAX_DIFF_CHARS,
  FILE_REVIEW_MAX_DIFF_LINES,
} from "./limits.js";

export interface DiffResult {
  readonly text: string;
  readonly truncated: boolean;
  readonly unchanged: boolean;
}

/** Normalize line endings to LF before comparison. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitLines(text: string): string[] {
  const normalized = normalizeNewlines(text);
  if (normalized.length === 0) return [];
  return normalized.split("\n");
}

/**
 * Simple line-based unified diff. Deterministic for identical inputs.
 * Does not attempt merge-editor semantics.
 */
export function buildUnifiedDiff(
  before: string,
  after: string,
  relativePath: string,
  options: { readonly maxLines?: number; readonly maxChars?: number } = {},
): DiffResult {
  const maxLines = options.maxLines ?? FILE_REVIEW_MAX_DIFF_LINES;
  const maxChars = options.maxChars ?? FILE_REVIEW_MAX_DIFF_CHARS;

  const bLines = splitLines(before).slice(0, maxLines);
  const aLines = splitLines(after).slice(0, maxLines);
  if (normalizeNewlines(before) === normalizeNewlines(after)) {
    return { text: "(không có thay đổi)", truncated: false, unchanged: true };
  }

  const out: string[] = [`--- ${relativePath}`, `+++ ${relativePath}`];
  const max = Math.max(bLines.length, aLines.length);
  for (let i = 0; i < max; i += 1) {
    const b = bLines[i];
    const a = aLines[i];
    if (b === a) {
      if (b !== undefined) out.push(` ${b}`);
    } else {
      if (b !== undefined) out.push(`-${b}`);
      if (a !== undefined) out.push(`+${a}`);
    }
  }

  let text = out.join("\n");
  let truncated = bLines.length >= maxLines || aLines.length >= maxLines;
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n… [diff đã bị giới hạn]`;
    truncated = true;
  }
  return { text, truncated, unchanged: false };
}
