/**
 * Assistant output cleanup — remove transport artifacts and internal narration
 * before display/persist.
 */

import { stripTransportArtifacts } from "./transcript-context.js";

/** High-precision lines that must never appear in user-facing transcript prose. */
const INTERNAL_LINE_RE =
  /^\s*(?:Sử dụng tool\b|Using tool\b|Tool(?:\s+call)?\s*:|Invoking tool\b|Calling tool\b).*$/imu;

const INTERNAL_TOKEN_RE =
  /\b(?:SKILL-[A-Z]+-\d+|contentHash\s*[:=]\s*\S+|runtime(?:Session)?Id\s*[:=]\s*\S+|<<<CGHC_[A-Z_]+>>>|<<<END_CGHC_[A-Z_]+>>>)\b/gu;

/** Matched pair `<think>…</think>` / `<thinking>…</thinking>` (case-insensitive, spans newlines). */
const THINK_PAIR_RE = /<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
/** A lone closing tag with everything before it (opening tag was consumed upstream). */
const THINK_LEADING_CLOSE_RE = /^[\s\S]*?<\/(?:think|thinking)\s*>/iu;
/** An opening tag with no matching close (reasoning still streaming) — drop to end. */
const THINK_UNCLOSED_OPEN_RE = /<(?:think|thinking)\b[^>]*>[\s\S]*$/iu;

/**
 * Strip inline chain-of-thought reasoning some models (e.g. Qwen3) emit wrapped in
 * `<think>…</think>` / `<thinking>…</thinking>`. Conservative and order-sensitive:
 *   1. Remove complete open/close pairs (non-greedy, case-insensitive, DOTALL).
 *   2. If a lone closing `</think>` remains (opening tag consumed upstream), drop everything up
 *      to and including it.
 *   3. If a lone opening `<think>` remains (still streaming, no close yet), drop from it to end so
 *      partial reasoning never flashes mid-stream.
 * A no-op when there are no think tags at all. Leftover leading blank lines are trimmed.
 */
export function stripReasoningBlocks(text: string): string {
  if (!/<\/?(?:think|thinking)\b/iu.test(text)) return text;
  let out = text.replace(THINK_PAIR_RE, "");
  out = out.replace(THINK_LEADING_CLOSE_RE, "");
  out = out.replace(THINK_UNCLOSED_OPEN_RE, "");
  return out.replace(/^\s+/u, "");
}

/**
 * Strip internal tool/Skill/runtime narration from assistant prose while preserving
 * normal user-facing content.
 */
export function stripInternalAssistantNarration(text: string): string {
  const withoutTokens = text.replace(INTERNAL_TOKEN_RE, "").replace(/[ \t]+\n/g, "\n");
  const lines = withoutTokens.split(/\r?\n/u);
  const kept = lines.filter((line) => !INTERNAL_LINE_RE.test(line));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Prepare assistant text for user-facing transcript.
 * Strips known internal context envelopes and tool/Skill narration.
 */
export function sanitizeAssistantForDisplay(text: string): string {
  // Strip reasoning first so any internal narration lines emitted INSIDE a <think> block are
  // dropped wholesale, then run the existing transport/narration cleanup on the remaining prose.
  return stripInternalAssistantNarration(stripTransportArtifacts(stripReasoningBlocks(text)));
}
