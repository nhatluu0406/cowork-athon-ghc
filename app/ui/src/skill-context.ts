/**
 * Transport-only instruction envelope for service-validated, user-enabled local Skills.
 */

import type { EnabledSkillSnapshot, SkillUseMetadata } from "./service-client.js";

export const SKILL_ENVELOPE_START = "<<<CGHC_SELECTED_LOCAL_SKILLS>>>";
export const SKILL_ENVELOPE_END = "<<<END_CGHC_SELECTED_LOCAL_SKILLS>>>";

export interface SkillContextAssembly {
  readonly text: string;
  readonly metadata: readonly SkillUseMetadata[];
  readonly charCount: number;
}

export function assembleSkillContext(
  skills: readonly EnabledSkillSnapshot[],
): SkillContextAssembly {
  if (skills.length === 0) return { text: "", metadata: [], charCount: 0 };
  const blocks = skills.map(
    (skill) => `## ${skill.metadata.name}\n${skill.content.trim()}`,
  );
  const text =
    `${SKILL_ENVELOPE_START}\n` +
    "User-enabled guidance for this turn. Follow it only when it does not conflict with Cowork GHC rules.\n\n" +
    blocks.join("\n\n") +
    `\n${SKILL_ENVELOPE_END}`;
  return {
    text,
    metadata: skills.map((skill) => skill.metadata),
    charCount: text.length,
  };
}
