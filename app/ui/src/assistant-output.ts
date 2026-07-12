/**
 * Assistant output cleanup — remove transport artifacts before display/persist.
 */

import { stripTransportArtifacts } from "./transcript-context.js";

/**
 * Prepare assistant text for user-facing transcript.
 * Strips known internal context envelopes; does not rewrite model prose.
 */
export function sanitizeAssistantForDisplay(text: string): string {
  return stripTransportArtifacts(text);
}
