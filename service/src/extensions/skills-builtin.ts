/**
 * Cowork-GHC-defined built-in sample skills + the honest default {@link SkillRunner} (CGHC-026
 * RE1). These are OUR sample skills, not inherited from / cloned from OpenWork.
 *
 * The default runner is NOT-ATTACHED: it never fabricates a live execution result. Real skill
 * execution runs through OpenCode and is Tier 2 (CGHC-028); until a live runner is injected,
 * exercising a skill honestly reports `unavailable` (no crash, no quarantine).
 */

import type { SkillDefinition, SkillRunner } from "./skill-registry.js";

/**
 * At least one built-in sample skill (RE1). Two are provided so `list()` is non-trivial. The
 * shape is Cowork-GHC's own: id + name + description + declared input names.
 */
export const BUILTIN_SKILLS: readonly SkillDefinition[] = Object.freeze([
  Object.freeze({
    id: "cowork.summarize",
    name: "Summarize Selection",
    description: "Summarize the provided text into a short paragraph.",
    inputs: Object.freeze(["text"]),
  }),
  Object.freeze({
    id: "cowork.draft-reply",
    name: "Draft Reply",
    description: "Draft a reply to a message given a tone and the original message.",
    inputs: Object.freeze(["message", "tone"]),
  }),
]) as readonly SkillDefinition[];

/**
 * The honest default runner: no live skill runtime is attached, so it reports `unavailable`
 * rather than inventing an output. This is NOT a failure (not quarantined) — it is an honest
 * "not wired to OpenCode yet" (Tier 2 / CGHC-028).
 */
export function notAttachedSkillRunner(): SkillRunner {
  return {
    run: () =>
      Promise.resolve({
        status: "unavailable",
        detail: "No skill runtime is attached (live execution is Tier 2 / CGHC-028).",
      }),
  };
}
