/**
 * Skill registry (CGHC-026 RE1) — LIST available skills, ENABLE/disable one, and EXERCISE
 * (invoke) a sample skill through the injectable {@link SkillRunner} seam.
 *
 * Status lives in the ONE {@link ExtensionState} (enabled/disabled/failed). Live execution is
 * delegated to the runner seam; the honest default reports `unavailable` (no fabrication). All
 * fallible work goes through RE5 isolation, so a broken runner becomes a diagnostic + quarantine
 * and NEVER throws out of the registry.
 */

import { createExtensionState, type ExtensionState } from "./extension-state.js";
import { runIsolated, type ExtRedactor } from "./isolation.js";
import { BUILTIN_SKILLS, notAttachedSkillRunner } from "./skills-builtin.js";
import type { ExtensionDiagnostic, ExtOutcome } from "./types.js";
import { err, ok } from "./types.js";

/** A Cowork-GHC skill definition (our shape, not OpenWork's). */
export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Declared input names the skill expects (validated shallowly before a run). */
  readonly inputs: readonly string[];
}

/** The outcome of a live skill run through the seam — success, or an honest `unavailable`. */
export type SkillRunOutcome =
  | { readonly status: "ok"; readonly output: unknown }
  | { readonly status: "unavailable"; readonly detail: string };

/**
 * The injectable execution seam. A real implementation drives OpenCode (Tier 2 / CGHC-028);
 * tests inject a fake. It may resolve `unavailable` (honest not-attached) or REJECT (a genuine
 * runner failure — captured by RE5 isolation).
 */
export interface SkillRunner {
  run(skill: SkillDefinition, input: Readonly<Record<string, unknown>>): Promise<SkillRunOutcome>;
}

/** A skill definition plus its live status (for `list()`). */
export interface SkillView {
  readonly definition: SkillDefinition;
  readonly status: "enabled" | "disabled" | "failed";
}

export interface SkillRegistryOptions {
  /** Shared source of truth. Defaults to a private one (standalone use/tests). */
  readonly state?: ExtensionState;
  /** Execution seam. Default: the honest not-attached runner. */
  readonly runner?: SkillRunner;
  /** Built-in skills to seed. Default: {@link BUILTIN_SKILLS}. */
  readonly skills?: readonly SkillDefinition[];
  /** RE5 redactor for failure reasons. Default: the shared shape sanitizer. */
  readonly redact?: ExtRedactor;
}

export interface SkillRegistry {
  /** All known skills with their current status (RE1 list). */
  list(): readonly SkillView[];
  /** Enable a skill. Unknown id → typed error. A quarantined skill stays quarantined. */
  enable(id: string): ExtOutcome<SkillView>;
  /**
   * Disable a skill. Unknown id → typed error. A QUARANTINED (`failed`) skill is NOT disabled —
   * it returns a typed `quarantined` error so quarantine stays sticky and cannot be silently
   * cleared through the disable path (RE5). Use {@link clearQuarantine} to un-quarantine first.
   */
  disable(id: string): ExtOutcome<SkillView>;
  /**
   * The ONE deliberate un-quarantine route for a skill (RE5): clear a `failed` status back to
   * `disabled` so an operator must then explicitly {@link enable} it. Idempotent for a
   * non-quarantined skill; unknown id → typed error. This is the only intended way a skill
   * leaves quarantine — no accidental resurrection via disable/enable.
   */
  clearQuarantine(id: string): ExtOutcome<SkillView>;
  /**
   * Exercise (invoke) a skill through the runner (RE1). Unknown/disabled/quarantined → typed
   * error (no throw). A runner rejection → diagnostic + quarantine (RE5), returned as a typed
   * `extension_failed`. An honest `unavailable` runner → typed `unavailable` (no quarantine).
   */
  exercise(id: string, input: Readonly<Record<string, unknown>>): Promise<ExtOutcome<unknown>>;
  /** Current RE5 diagnostics for skills (delegates to the shared state, filtered). */
  diagnostics(): readonly ExtensionDiagnostic[];
}

export function createSkillRegistry(options: SkillRegistryOptions = {}): SkillRegistry {
  const state = options.state ?? createExtensionState();
  const runner = options.runner ?? notAttachedSkillRunner();
  const redact = options.redact;
  const definitions = new Map<string, SkillDefinition>();

  for (const skill of options.skills ?? BUILTIN_SKILLS) {
    definitions.set(skill.id, skill);
    // Built-ins start enabled and are the single-source-of-truth status records.
    state.register("skill", skill.id, skill.name, "enabled");
  }

  function viewOf(id: string): SkillView | undefined {
    const definition = definitions.get(id);
    if (definition === undefined) return undefined;
    const status = state.status("skill", id) ?? "disabled";
    return { definition, status };
  }

  function requireKnown(id: string): SkillDefinition | ExtOutcome<never> {
    const definition = definitions.get(id);
    if (definition === undefined) {
      return err<never>("unknown_extension", `Unknown skill "${id}".`);
    }
    return definition;
  }

  return {
    list() {
      const out: SkillView[] = [];
      for (const id of definitions.keys()) {
        const view = viewOf(id);
        if (view) out.push(view);
      }
      return out;
    },

    enable(id) {
      const known = requireKnown(id);
      if ("ok" in known) return known;
      if (state.isQuarantined("skill", id)) {
        return err("quarantined", `Skill "${id}" is quarantined after a failure; not re-enabling.`);
      }
      state.setStatus("skill", id, "enabled");
      return ok(viewOf(id) as SkillView);
    },

    disable(id) {
      const known = requireKnown(id);
      if ("ok" in known) return known;
      if (state.isQuarantined("skill", id)) {
        // Sticky quarantine: refuse to overwrite `failed` with `disabled` (which would erase
        // quarantine and let a later enable() resurrect a known-broken skill). RE5 invariant.
        return err(
          "quarantined",
          `Skill "${id}" is quarantined after a failure; refusing to disable. Use clearQuarantine first.`,
        );
      }
      state.setStatus("skill", id, "disabled");
      return ok(viewOf(id) as SkillView);
    },

    clearQuarantine(id) {
      const known = requireKnown(id);
      if ("ok" in known) return known;
      if (!state.isQuarantined("skill", id)) return ok(viewOf(id) as SkillView); // idempotent
      // Deliberate un-quarantine: reset to `disabled`, never straight to `enabled`, so
      // re-activation stays an explicit, separate operator choice.
      state.setStatus("skill", id, "disabled");
      return ok(viewOf(id) as SkillView);
    },

    async exercise(id, input) {
      const known = requireKnown(id);
      if ("ok" in known) return known;
      const definition = known;
      if (state.isQuarantined("skill", id)) {
        return err("quarantined", `Skill "${id}" is quarantined after a failure; not retried.`);
      }
      if (state.status("skill", id) !== "enabled") {
        return err("extension_disabled", `Skill "${id}" is disabled; enable it before exercising.`);
      }
      const outcome = await runIsolated<SkillRunOutcome>(
        { state, kind: "skill", id, name: definition.name, ...(redact ? { redact } : {}) },
        () => runner.run(definition, input),
      );
      if (!outcome.ok) return outcome; // RE5: runner threw → quarantined + typed error.
      if (outcome.value.status === "unavailable") {
        return err("unavailable", `Skill "${id}" cannot run yet: ${outcome.value.detail}`);
      }
      return ok(outcome.value.output);
    },

    diagnostics: () => state.diagnostics().filter((d) => d.kind === "skill"),
  };
}
