/**
 * Workflow builder from prompt (agent-harness-plan.md Task 4.3 /
 * `task-4.3-workflow-builder-from-prompt`).
 *
 * Natural-language prompt -> an injected generator (the LLM seam) drafts a TaskDefinition
 * (optionally proposing a NEW AgentDefinition when no catalog agent fits) -> MANDATORY validation
 * through the shared `core/contracts` validators (Task 0.3) -> the validated draft is returned for
 * user review. NOTHING is persisted here: {@link createWorkflowBuilder}'s `draftFromPrompt` never
 * touches the task store or the dispatch run registry, so there is no path from a draft straight to
 * a run. Saving is a SEPARATE, explicit step (the confirm route, `workflow-router.ts`), which
 * re-validates through the SAME store/catalog boundaries used everywhere else.
 *
 * The generator's output is UNTRUSTED input (same rule as any third-party response — see
 * `api-and-interface-design`): before the shared validators even run, this module refuses any
 * top-level field the schema does not know about (defense-in-depth on top of the validators' own
 * shape checks, which silently drop unknown keys rather than reject them).
 *
 * No live LLM call happens in this module or its tests: `generate` is an injected seam, honoring
 * the same Tier 1 "not-attached" discipline as `sendPrompt`/`branchRunner` in `tier2-seams.ts`.
 */

import {
  validateAgentDefinition,
  validateTaskDefinition,
  type AgentDefinition,
  type TaskDefinition,
} from "@cowork-ghc/contracts";

/** Context handed to the generator: the agent ids a drafted task's references may resolve to. */
export interface WorkflowDraftContext {
  readonly knownAgentIds: readonly string[];
}

/** The RAW (untrusted) shape asked of the generator: a task draft, optionally a new agent. */
export interface WorkflowDraftCandidate {
  readonly task: unknown;
  readonly newAgent?: unknown;
}

/** Injected LLM seam. Tier 1 wires an honest not-attached default (see `tier2-seams.ts`). */
export type WorkflowDraftGenerator = (
  prompt: string,
  context: WorkflowDraftContext,
) => Promise<WorkflowDraftCandidate>;

export type WorkflowDraftOutcome =
  | { readonly ok: true; readonly task: TaskDefinition; readonly newAgent?: AgentDefinition }
  | { readonly ok: false; readonly error: string };

export class WorkflowBuilderError extends Error {
  readonly code = "workflow_draft_invalid";
  constructor(message: string) {
    super(message);
    this.name = "WorkflowBuilderError";
  }
}

export interface WorkflowBuilderOptions {
  readonly generate: WorkflowDraftGenerator;
  readonly knownAgentIds: () => ReadonlySet<string>;
  /** The live session tool policy a proposed newAgent must not loosen (mirrors the agent catalog). */
  readonly basePolicy: Readonly<Record<string, string>>;
  readonly maxPromptLength?: number;
}

export interface WorkflowBuilder {
  draftFromPrompt(prompt: string): Promise<WorkflowDraftOutcome>;
}

const DEFAULT_MAX_PROMPT = 4_000;

// The LLM never dictates storage identity or provenance: `id` is assigned by this module, and
// `source` is force-set before validation — see `draftFromPrompt` below. Both are therefore
// deliberately EXCLUDED from the allowed key sets: an LLM that includes either is an untrusted
// field and is refused, the same way any other unrecognized field is refused.
const TASK_KEYS = new Set(["name", "goal", "loop", "branches", "agentId", "maxConcurrency"]);
const LOOP_KEYS = new Set(["mode", "maxTurns", "maxDurationMs", "intervalMs", "requireVerifiedEvidence"]);
const BRANCH_KEYS = new Set(["agentId", "focus"]);
const AGENT_KEYS = new Set(["name", "systemPrompt", "skillIds", "permissionPreset", "model"]);

function rejectUnknownKeys(value: unknown, allowed: ReadonlySet<string>, label: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return; // shape checked below
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!allowed.has(key)) throw new WorkflowBuilderError(`${label} has an unknown field: "${key}".`);
  }
}

/** Defense-in-depth: refuse any field the schema does not know about BEFORE validating shape. */
function rejectUnknownShape(candidate: WorkflowDraftCandidate): void {
  rejectUnknownKeys(candidate.task, TASK_KEYS, "task draft");
  if (typeof candidate.task === "object" && candidate.task !== null) {
    const rec = candidate.task as Record<string, unknown>;
    rejectUnknownKeys(rec["loop"], LOOP_KEYS, "task.loop");
    if (Array.isArray(rec["branches"])) {
      for (const branch of rec["branches"] as readonly unknown[]) {
        rejectUnknownKeys(branch, BRANCH_KEYS, "task.branches[]");
      }
    }
  }
  if (candidate.newAgent !== undefined) rejectUnknownKeys(candidate.newAgent, AGENT_KEYS, "newAgent");
}

function freshDraftId(): string {
  return `wf-${Math.random().toString(36).slice(2, 10)}`;
}

export function createWorkflowBuilder(options: WorkflowBuilderOptions): WorkflowBuilder {
  const maxPrompt = options.maxPromptLength ?? DEFAULT_MAX_PROMPT;

  async function draftFromPrompt(prompt: string): Promise<WorkflowDraftOutcome> {
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return { ok: false, error: "prompt is required." };
    }
    if (prompt.length > maxPrompt) {
      return { ok: false, error: `prompt exceeds ${maxPrompt} characters.` };
    }

    let candidate: WorkflowDraftCandidate;
    try {
      candidate = await options.generate(prompt, { knownAgentIds: [...options.knownAgentIds()] });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "workflow generation failed." };
    }

    try {
      rejectUnknownShape(candidate);
    } catch (err) {
      return { ok: false, error: err instanceof WorkflowBuilderError ? err.message : "invalid draft shape." };
    }

    // A proposed new agent validates FIRST (narrowing-only, enforced by validateAgentDefinition)
    // so its fresh id can join the known-agent set the task's agentId/branches are checked against.
    let newAgent: AgentDefinition | undefined;
    if (candidate.newAgent !== undefined) {
      const rawAgent =
        typeof candidate.newAgent === "object" && candidate.newAgent !== null
          ? (candidate.newAgent as Record<string, unknown>)
          : undefined;
      // Mirror the agent catalog's own draft defaulting (catalog.ts `validate()`): skillIds and
      // permissionPreset are optional on the LLM's proposal but required-shape for the validator.
      const agentCandidate =
        rawAgent !== undefined
          ? {
              ...rawAgent,
              id: freshDraftId(),
              source: "user_local",
              skillIds: rawAgent["skillIds"] ?? [],
              permissionPreset: rawAgent["permissionPreset"] ?? {},
            }
          : candidate.newAgent;
      const agentCheck = validateAgentDefinition(agentCandidate, options.basePolicy);
      if (!agentCheck.ok) return { ok: false, error: `newAgent invalid: ${agentCheck.error}` };
      newAgent = agentCheck.value;
    }

    const knownAgentIds = new Set(options.knownAgentIds());
    if (newAgent !== undefined) knownAgentIds.add(newAgent.id);

    const taskCandidate =
      typeof candidate.task === "object" && candidate.task !== null
        ? { ...(candidate.task as Record<string, unknown>), id: freshDraftId(), source: "user_local" }
        : candidate.task;
    const taskCheck = validateTaskDefinition(taskCandidate, knownAgentIds);
    if (!taskCheck.ok) return { ok: false, error: `task invalid: ${taskCheck.error}` };

    return { ok: true, task: taskCheck.value, ...(newAgent !== undefined ? { newAgent } : {}) };
  }

  return { draftFromPrompt };
}
