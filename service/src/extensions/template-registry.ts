/**
 * Workflow templates (CGHC-026 RE4) — SAVE a Cowork-GHC-defined template (name + ordered
 * steps/params) and RE-RUN it to produce the concrete run steps from the template + inputs.
 *
 * The template shape is OUR own (NOT an OpenWork template format): declared inputs + ordered
 * steps whose param values may reference an input via a `${input.NAME}` placeholder. `run`
 * resolves placeholders deterministically, so re-running with the same inputs is repeatable.
 *
 * One source of truth for saved templates: the injectable {@link TemplateStore} (in-memory
 * default). Failure isolation (RE5): a missing required input is a clean typed `invalid_input`
 * error (retryable, NOT quarantine); an unexpected resolver throw is captured as a diagnostic
 * and quarantines the template — neither ever throws out of the registry.
 */

import { createExtensionState, type ExtensionState } from "./extension-state.js";
import { runIsolated, runIsolatedSync, type ExtRedactor } from "./isolation.js";
import { createInMemoryTemplateStore, type TemplateStore } from "./template-store.js";
import type { ExtensionDiagnostic, ExtOutcome } from "./types.js";
import { err, ok } from "./types.js";

/** A declared template input. */
export interface TemplateInputSpec {
  readonly name: string;
  readonly required: boolean;
}

/** One ordered step. `params` values may be a literal or a `${input.NAME}` reference. */
export interface TemplateStepSpec {
  readonly id: string;
  readonly action: string;
  readonly params: Readonly<Record<string, string>>;
}

/** A Cowork-GHC workflow template (our shape). */
export interface WorkflowTemplate {
  readonly id: string;
  readonly name: string;
  readonly inputs: readonly TemplateInputSpec[];
  readonly steps: readonly TemplateStepSpec[];
}

/** A concrete run step: the same action with every `${input.NAME}` placeholder resolved. */
export interface RunStep {
  readonly stepId: string;
  readonly action: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface TemplateRegistryOptions {
  readonly store?: TemplateStore;
  readonly state?: ExtensionState;
  readonly redact?: ExtRedactor;
}

export interface TemplateRegistry {
  save(template: WorkflowTemplate): ExtOutcome<WorkflowTemplate>;
  get(id: string): WorkflowTemplate | undefined;
  list(): readonly WorkflowTemplate[];
  /** Re-run a saved template with inputs → the concrete run steps (RE4). */
  run(id: string, inputs: Readonly<Record<string, string>>): Promise<ExtOutcome<readonly RunStep[]>>;
  diagnostics(): readonly ExtensionDiagnostic[];
}

const INPUT_REF = /^\$\{input\.([A-Za-z0-9_-]+)\}$/;

/** Resolve one param value: a `${input.NAME}` reference → the input, else the literal. */
function resolveValue(value: string, inputs: Readonly<Record<string, string>>): string {
  const match = INPUT_REF.exec(value);
  if (match === null) return value;
  const name = match[1] as string;
  const provided = inputs[name];
  if (provided === undefined) throw new Error(`Missing input "${name}".`);
  return provided;
}

/** Shallow shape validation of a template before it is saved. */
function validateTemplate(template: WorkflowTemplate): string | undefined {
  if (typeof template.id !== "string" || template.id.length === 0) return "A template needs a non-empty id.";
  if (typeof template.name !== "string" || template.name.length === 0) return "A template needs a non-empty name.";
  if (!Array.isArray(template.steps) || template.steps.length === 0) return "A template needs at least one step.";
  return undefined;
}

export function createTemplateRegistry(options: TemplateRegistryOptions = {}): TemplateRegistry {
  const store = options.store ?? createInMemoryTemplateStore();
  const state = options.state ?? createExtensionState();
  const redact = options.redact;

  /** Check every required input is present; return the missing name if any. */
  function firstMissingRequired(
    template: WorkflowTemplate,
    inputs: Readonly<Record<string, string>>,
  ): string | undefined {
    for (const spec of template.inputs) {
      if (spec.required && inputs[spec.name] === undefined) return spec.name;
    }
    return undefined;
  }

  return {
    save(template) {
      const invalid = validateTemplate(template);
      if (invalid !== undefined) return err("invalid_input", invalid);
      // The injectable store may be a real persistent one (disk full/locked → throw). Route it
      // through sync isolation so a throwing store becomes a diagnostic + typed error, never an
      // escape — consistent with the resolver step in run() (FIX-4).
      const stored = runIsolatedSync<void>(
        { state, kind: "template", id: template.id, name: template.name, ...(redact ? { redact } : {}) },
        () => store.save(template),
      );
      if (!stored.ok) return stored;
      // Register in the one source of truth so a broken run can quarantine it. Re-saving an
      // existing template resets it to `enabled` — the ONE intended un-quarantine route for a
      // template (see ExtensionState un-quarantine rules).
      state.register("template", template.id, template.name, "enabled");
      return ok(template);
    },

    get: (id) => store.get(id),
    list: () => store.list(),

    async run(id, inputs) {
      // Reading from the store is isolated too: a throwing persistent store on load becomes a
      // typed failure + diagnostic, not an escape (FIX-4).
      const loaded = await runIsolated<WorkflowTemplate | undefined>(
        { state, kind: "template", id, name: id, ...(redact ? { redact } : {}) },
        () => store.get(id),
      );
      if (!loaded.ok) return loaded;
      const template = loaded.value;
      if (template === undefined) return err("unknown_extension", `Unknown template "${id}".`);
      if (state.isQuarantined("template", id)) {
        return err("quarantined", `Template "${id}" is quarantined after a failure; not retried.`);
      }
      // A missing required input is a CLEAN, retryable user error — not a quarantine (RE5 reserves
      // quarantine for genuine broken-extension failures, not normal input validation).
      const missing = firstMissingRequired(template, inputs);
      if (missing !== undefined) {
        return err("invalid_input", `Template "${id}" is missing required input "${missing}".`);
      }
      // Resolution is wrapped in RE5 isolation: an unexpected throw becomes a diagnostic +
      // quarantine and a typed error, never an exception that escapes into the session.
      return runIsolated<readonly RunStep[]>(
        { state, kind: "template", id, name: template.name, ...(redact ? { redact } : {}) },
        () =>
          template.steps.map((step): RunStep => {
            const params: Record<string, string> = {};
            for (const [k, v] of Object.entries(step.params)) params[k] = resolveValue(v, inputs);
            return { stepId: step.id, action: step.action, params };
          }),
      );
    },

    diagnostics: () => state.diagnostics().filter((d) => d.kind === "template"),
  };
}
