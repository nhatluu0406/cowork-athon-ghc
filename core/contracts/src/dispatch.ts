/**
 * Dispatch contracts (agent-harness-plan.md Task 0.3) — the DATA (not code) that describes a
 * task, an agent, and a loop policy. Pure, shell-neutral types + boundary validators. No secret
 * ever appears here: an agent references a model by {@link ModelRef} and skills by id, never a key.
 *
 * These back Phase 4 (task store + loop runner) and Phase 5 (agent catalog + fan-out D1). Built-in
 * definitions are read-only; user definitions are validated at the boundary before persistence.
 */

import type { ModelRef } from "./refs.js";
import { ENFORCEABLE_PRESET_KEYS } from "./permission-preset-keys.js";

/** Source of a definition: shipped read-only vs user-authored. Mirrors the Skills model. */
export type DefinitionSource = "built_in" | "user_local";

/** How the model may use a tool. Ordered least → most restrictive: allow < ask < deny. */
export type ToolPermissionLevel = "allow" | "ask" | "deny";

/**
 * A tool-permission override map (tool name → level). An AgentDefinition may only ever make a
 * tool MORE restrictive than the live session policy — never looser (enforced by
 * {@link isNarrowingPreset}). Empty = inherit the base policy unchanged.
 */
export type PermissionPreset = Readonly<Record<string, ToolPermissionLevel>>;

/** How a task's run loop terminates (agent-harness-plan.md LoopPolicy). */
export type LoopMode = "run_once" | "retry_until_verified" | "scheduled";

export interface LoopPolicy {
  readonly mode: LoopMode;
  /** Hard cap on assistant turns before the loop stops (guardrail). */
  readonly maxTurns: number;
  /** Hard wall-clock cap in ms before the loop stops (guardrail). */
  readonly maxDurationMs: number;
  /** For `scheduled`: interval between runs in ms. Ignored for other modes. */
  readonly intervalMs?: number;
  /**
   * For `retry_until_verified`: the loop only reports success when verification evidence exists
   * (file-review / disk check). This flag records that the caller REQUIRES such evidence; the
   * runner never fabricates success without it.
   */
  readonly requireVerifiedEvidence?: boolean;
}

/** A reusable agent persona: a system prompt + skill refs + a (narrowing) permission preset. */
export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly source: DefinitionSource;
  /** Non-secret system prompt shaping this agent's behavior. */
  readonly systemPrompt: string;
  /** Skill ids this agent enables (resolved against the Skills catalog at dispatch time). */
  readonly skillIds: readonly string[];
  /** Tool-permission overrides — narrowing only (never looser than the live policy). */
  readonly permissionPreset: PermissionPreset;
  /** Optional model override; absent = use the session default. */
  readonly model?: ModelRef;
}

/** A single fan-out branch: which agent runs, with an optional per-branch prompt addendum. */
export interface FanOutBranch {
  readonly agentId: string;
  /** Optional extra instruction appended to this branch's prompt. */
  readonly focus?: string;
}

/** A reusable task: a goal prompt + loop policy + optional fan-out across agents. */
export interface TaskDefinition {
  readonly id: string;
  readonly name: string;
  readonly source: DefinitionSource;
  /** The non-secret goal prompt handed to the agent(s). */
  readonly goal: string;
  readonly loop: LoopPolicy;
  /**
   * Fan-out branches. Empty/absent = a single-agent run using {@link TaskDefinition.agentId}.
   * When present, each branch runs concurrently (bounded) as its own child session.
   */
  readonly branches?: readonly FanOutBranch[];
  /** The agent for a single (non-fan-out) run. Ignored when {@link branches} is non-empty. */
  readonly agentId?: string;
  /** Max concurrent child sessions when fanning out. Clamped to {@link FANOUT_HARD_CAP}. */
  readonly maxConcurrency?: number;
}

/** Default concurrency when a fan-out task does not set one (agent-harness-plan.md Q3). */
export const FANOUT_DEFAULT_CONCURRENCY = 3;
/** Hard cap enforced at the service regardless of a task's requested concurrency (Q3). */
export const FANOUT_HARD_CAP = 5;

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/u;
const MAX_NAME = 100;
const MAX_PROMPT = 8_000;
const MAX_GOAL = 8_000;
const MAX_SKILLS = 32;
const MAX_BRANCHES = 5;
const MAX_TURNS_CAP = 100;
const MAX_DURATION_CAP_MS = 60 * 60_000; // 1 hour
const TOOL_LEVELS: ReadonlySet<string> = new Set(["allow", "ask", "deny"]);
const LOOP_MODES: ReadonlySet<string> = new Set(["run_once", "retry_until_verified", "scheduled"]);

/** Restrictiveness rank — higher is more restrictive. */
const LEVEL_RANK: Readonly<Record<ToolPermissionLevel, number>> = { allow: 0, ask: 1, deny: 2 };

/**
 * True iff `preset` never loosens `base`: for every tool the preset sets, the level is at least as
 * restrictive as the base policy's level (missing base keys are treated as `ask`). This is the
 * guardrail that stops an agent from granting itself more than the live session policy allows.
 */
export function isNarrowingPreset(
  preset: PermissionPreset,
  base: Readonly<Record<string, string>>,
): boolean {
  for (const [tool, level] of Object.entries(preset)) {
    if (!TOOL_LEVELS.has(level)) return false;
    const baseLevel = base[tool];
    const baseRank = baseLevel !== undefined && baseLevel in LEVEL_RANK
      ? LEVEL_RANK[baseLevel as ToolPermissionLevel]
      : LEVEL_RANK.ask;
    if (LEVEL_RANK[level] < baseRank) return false;
  }
  return true;
}

function isNonEmptyString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isModelRef(value: unknown): value is ModelRef {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec["providerID"] === "string" && typeof rec["modelID"] === "string";
}

/** Validate a LoopPolicy, returning a normalized copy or an error string. */
export function validateLoopPolicy(value: unknown): { ok: true; value: LoopPolicy } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) return { ok: false, error: "loop must be an object." };
  const rec = value as Record<string, unknown>;
  if (typeof rec["mode"] !== "string" || !LOOP_MODES.has(rec["mode"])) {
    return { ok: false, error: "loop.mode must be run_once | retry_until_verified | scheduled." };
  }
  const maxTurns = rec["maxTurns"];
  if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > MAX_TURNS_CAP) {
    return { ok: false, error: `loop.maxTurns must be an integer in 1..${MAX_TURNS_CAP}.` };
  }
  const maxDurationMs = rec["maxDurationMs"];
  if (typeof maxDurationMs !== "number" || maxDurationMs < 1_000 || maxDurationMs > MAX_DURATION_CAP_MS) {
    return { ok: false, error: `loop.maxDurationMs must be in 1000..${MAX_DURATION_CAP_MS}.` };
  }
  const mode = rec["mode"] as LoopMode;
  if (mode === "scheduled") {
    const intervalMs = rec["intervalMs"];
    if (typeof intervalMs !== "number" || intervalMs < 1_000) {
      return { ok: false, error: "scheduled loop requires intervalMs >= 1000." };
    }
  }
  const policy: LoopPolicy = {
    mode,
    maxTurns,
    maxDurationMs,
    ...(mode === "scheduled" ? { intervalMs: rec["intervalMs"] as number } : {}),
    ...(rec["requireVerifiedEvidence"] === true ? { requireVerifiedEvidence: true } : {}),
  };
  return { ok: true, value: policy };
}

/** Validate an AgentDefinition against a base tool policy. Built-ins skip source coercion. */
export function validateAgentDefinition(
  value: unknown,
  basePolicy: Readonly<Record<string, string>>,
): { ok: true; value: AgentDefinition } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) return { ok: false, error: "agent must be an object." };
  const rec = value as Record<string, unknown>;
  if (typeof rec["id"] !== "string" || !ID_PATTERN.test(rec["id"])) {
    return { ok: false, error: "agent.id is invalid." };
  }
  if (!isNonEmptyString(rec["name"], MAX_NAME)) return { ok: false, error: "agent.name is required." };
  if (!isNonEmptyString(rec["systemPrompt"], MAX_PROMPT)) {
    return { ok: false, error: "agent.systemPrompt is required." };
  }
  const skillIds = rec["skillIds"];
  if (!Array.isArray(skillIds) || skillIds.length > MAX_SKILLS || !skillIds.every((s) => typeof s === "string")) {
    return { ok: false, error: `agent.skillIds must be <= ${MAX_SKILLS} strings.` };
  }
  const preset = rec["permissionPreset"];
  if (typeof preset !== "object" || preset === null || Array.isArray(preset)) {
    return { ok: false, error: "agent.permissionPreset must be an object." };
  }
  // D1 fix, follow-up finding 2: a key the runtime boundary never actually consults (e.g. "*" or
  // "delete") would otherwise pass isNarrowingPreset (an unrecognized key defaults its base rank
  // to "ask", so "deny" always "narrows") and validate as a lockdown that silently does nothing.
  // Reject it here, loudly, naming the keys that ARE enforceable — same set the proxy reads.
  const unenforceable = Object.keys(preset).filter((key) => !ENFORCEABLE_PRESET_KEYS.has(key));
  if (unenforceable.length > 0) {
    const enforceable = [...ENFORCEABLE_PRESET_KEYS].map((k) => `"${k}"`).join(", ");
    return {
      ok: false,
      error:
        `agent.permissionPreset has unenforceable key(s) ${unenforceable.map((k) => `"${k}"`).join(", ")}; ` +
        `only ${enforceable} are enforced at the boundary.`,
    };
  }
  if (!isNarrowingPreset(preset as PermissionPreset, basePolicy)) {
    return { ok: false, error: "agent.permissionPreset may only narrow the live policy, never loosen it." };
  }
  if (rec["model"] !== undefined && !isModelRef(rec["model"])) {
    return { ok: false, error: "agent.model, when present, must be { providerID, modelID }." };
  }
  const agent: AgentDefinition = {
    id: rec["id"],
    name: (rec["name"] as string).trim(),
    source: rec["source"] === "built_in" ? "built_in" : "user_local",
    systemPrompt: rec["systemPrompt"] as string,
    skillIds: skillIds as readonly string[],
    permissionPreset: preset as PermissionPreset,
    ...(isModelRef(rec["model"]) ? { model: rec["model"] } : {}),
  };
  return { ok: true, value: agent };
}

/** Validate a TaskDefinition. `knownAgentIds` gates branch/agent references when provided. */
export function validateTaskDefinition(
  value: unknown,
  knownAgentIds?: ReadonlySet<string>,
): { ok: true; value: TaskDefinition } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null) return { ok: false, error: "task must be an object." };
  const rec = value as Record<string, unknown>;
  if (typeof rec["id"] !== "string" || !ID_PATTERN.test(rec["id"])) {
    return { ok: false, error: "task.id is invalid." };
  }
  if (!isNonEmptyString(rec["name"], MAX_NAME)) return { ok: false, error: "task.name is required." };
  if (!isNonEmptyString(rec["goal"], MAX_GOAL)) return { ok: false, error: "task.goal is required." };

  const loop = validateLoopPolicy(rec["loop"]);
  if (!loop.ok) return { ok: false, error: loop.error };

  const branchesRaw = rec["branches"];
  let branches: FanOutBranch[] | undefined;
  if (branchesRaw !== undefined) {
    if (!Array.isArray(branchesRaw) || branchesRaw.length > MAX_BRANCHES) {
      return { ok: false, error: `task.branches must be <= ${MAX_BRANCHES} entries.` };
    }
    branches = [];
    for (const b of branchesRaw) {
      if (typeof b !== "object" || b === null) return { ok: false, error: "each branch must be an object." };
      const agentId = (b as Record<string, unknown>)["agentId"];
      if (typeof agentId !== "string" || !ID_PATTERN.test(agentId)) {
        return { ok: false, error: "branch.agentId is invalid." };
      }
      if (knownAgentIds !== undefined && !knownAgentIds.has(agentId)) {
        return { ok: false, error: `branch references unknown agent "${agentId}".` };
      }
      const focus = (b as Record<string, unknown>)["focus"];
      if (focus !== undefined && (typeof focus !== "string" || focus.length > MAX_PROMPT)) {
        return { ok: false, error: "branch.focus, when present, must be a bounded string." };
      }
      branches.push({ agentId, ...(typeof focus === "string" ? { focus } : {}) });
    }
  }

  const agentId = rec["agentId"];
  if (agentId !== undefined) {
    if (typeof agentId !== "string" || !ID_PATTERN.test(agentId)) {
      return { ok: false, error: "task.agentId is invalid." };
    }
    if (knownAgentIds !== undefined && !knownAgentIds.has(agentId)) {
      return { ok: false, error: `task.agentId references unknown agent "${agentId}".` };
    }
  }
  if ((branches === undefined || branches.length === 0) && agentId === undefined) {
    return { ok: false, error: "task must set agentId or at least one branch." };
  }

  const maxConcurrency = rec["maxConcurrency"];
  if (
    maxConcurrency !== undefined &&
    (typeof maxConcurrency !== "number" || !Number.isInteger(maxConcurrency) || maxConcurrency < 1)
  ) {
    return { ok: false, error: "task.maxConcurrency must be a positive integer." };
  }

  const task: TaskDefinition = {
    id: rec["id"],
    name: (rec["name"] as string).trim(),
    source: rec["source"] === "built_in" ? "built_in" : "user_local",
    goal: rec["goal"] as string,
    loop: loop.value,
    ...(branches !== undefined && branches.length > 0 ? { branches } : {}),
    ...(typeof agentId === "string" ? { agentId } : {}),
    ...(typeof maxConcurrency === "number"
      ? { maxConcurrency: Math.min(maxConcurrency, FANOUT_HARD_CAP) }
      : {}),
  };
  return { ok: true, value: task };
}

/** Resolve the effective concurrency for a task (default + hard cap). */
export function effectiveConcurrency(task: TaskDefinition): number {
  const requested = task.maxConcurrency ?? FANOUT_DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(requested, FANOUT_HARD_CAP));
}
