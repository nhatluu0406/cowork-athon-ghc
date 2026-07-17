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
  return stripInternalAssistantNarration(stripTransportArtifacts(text));
}
