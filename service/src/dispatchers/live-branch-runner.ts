/**
 * Live branch runner — the real {@link BranchRunner} the composition wires when a supervised
 * OpenCode child is attached. One branch = one REAL child session: create it, send the branch
 * prompt (the agent's system prompt is prepended — the child seam has no per-session system
 * slot), then wait for the session's authoritative view to reach a terminal state. Every
 * permission the branch triggers flows through the ONE existing gate (permission bridge on the
 * event pump); this runner adds no second permission path and never fabricates a terminal.
 *
 * All wire calls sit behind narrow injected seams so the unit suite runs with no child, no
 * network, and no LLM (the same discipline as the session service).
 *
 * D1 fix (ADR 0011 Open item): the branch's {@link BranchPlan.preset} is bound to the child
 * session id (via {@link LiveBranchRunnerSeams.bindPreset}) BEFORE `sendPrompt`, so every
 * tool-permission event this session raises can be checked against it at the ONE execution
 * boundary (`files/tool-permission-proxy.ts`). The binding is ALWAYS released
 * ({@link LiveBranchRunnerSeams.releasePreset}) once bound — on a completed/errored terminal, an
 * abort/cancel, or a prompt-dispatch failure — so a session id never keeps an enforced preset (or
 * lack of one) past its own branch. If binding itself fails, the branch fails honestly (errored)
 * and the prompt is NEVER sent — never running a branch with an unenforced (wider) preset.
 */

import type { PermissionPreset } from "@cowork-ghc/contracts";
import type { BranchPlan, BranchRunner, BranchRunResult } from "./fanout.js";

/** The terminal slice of the authoritative session view this runner needs. */
export interface BranchTerminal {
  readonly state: string;
  readonly message?: string;
}

export interface LiveBranchRunnerSeams {
  /** Create a real child session; returns its id. */
  readonly createSession: (input: { readonly title: string }) => Promise<{ readonly id: string }>;
  /** POST the prompt to the child session (the live SendPrompt seam). */
  readonly sendPrompt: (sessionId: string, text: string) => Promise<void>;
  /**
   * The session's terminal from the authoritative view: `undefined` = session unknown,
   * `null` = still running, object = terminal reached.
   */
  readonly terminal: (sessionId: string) => BranchTerminal | null | undefined;
  /** Cancel the child session (S3 path) — used when the group is aborted. */
  readonly cancelSession: (sessionId: string) => Promise<void>;
  /**
   * D1 fix: bind the branch's {@link BranchPlan.preset} to the just-created session id, called
   * BEFORE `sendPrompt`. Required (not optional) so a live composition can never wire this
   * runner without also wiring enforcement — a missing/failing bind fails the branch honestly
   * rather than silently running it unbound (fail closed, never fail open).
   */
  readonly bindPreset: (sessionId: string, preset: PermissionPreset) => void;
  /**
   * D1 fix: release the binding registered by {@link bindPreset}. Called exactly once per
   * successful bind, on every exit path, so a session id never outlives its branch's preset.
   */
  readonly releasePreset: (sessionId: string) => void;
  /**
   * Optional: workspace-relative paths the session's authoritative view recorded as mutated
   * (real EV `file_mutation` events, not an LLM claim). Read ONLY on a completed terminal and
   * attached to the {@link BranchRunResult} as the run's declared evidence for the
   * `retry_until_verified` disk-evidence hook. Absent/empty = no evidence claimed.
   */
  readonly fileMutationPaths?: (sessionId: string) => readonly string[];
  /** Poll interval while waiting for the terminal. Default 500ms. */
  readonly pollIntervalMs?: number;
}

/** The prompt actually sent: agent persona first, then the task goal. Secret-free by contract. */
export function composeBranchPrompt(plan: BranchPlan): string {
  return `[Agent: ${plan.agentName}]\n${plan.systemPrompt}\n\n---\n\n${plan.prompt}`;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function createLiveBranchRunner(seams: LiveBranchRunnerSeams): BranchRunner {
  const interval = seams.pollIntervalMs ?? 500;

  return async (plan, signal): Promise<BranchRunResult> => {
    if (signal.aborted) return { status: "errored", summary: "Branch aborted before start." };

    let sessionId: string;
    try {
      const created = await seams.createSession({ title: `Dispatch ${plan.branchId}: ${plan.agentName}` });
      sessionId = created.id;
    } catch (err) {
      return { status: "errored", summary: err instanceof Error ? err.message : "Session create failed." };
    }

    // D1 fix: bind BEFORE any prompt reaches the session. A bind failure fails the branch
    // honestly — the prompt is never sent with an unenforced (wider) preset (fail closed).
    try {
      seams.bindPreset(sessionId, plan.preset);
    } catch (err) {
      return {
        status: "errored",
        summary: `Preset binding failed for session ${sessionId}: ${err instanceof Error ? err.message : "unknown error"}.`,
      };
    }

    try {
      return await runBoundSession(seams, plan, sessionId, signal, interval);
    } finally {
      // Released on EVERY exit path from here — a session id never keeps a stale binding.
      seams.releasePreset(sessionId);
    }
  };
}

/** The bound-session lifecycle: send the prompt, then wait for the authoritative terminal. */
async function runBoundSession(
  seams: LiveBranchRunnerSeams,
  plan: BranchPlan,
  sessionId: string,
  signal: AbortSignal,
  interval: number,
): Promise<BranchRunResult> {
  try {
    await seams.sendPrompt(sessionId, composeBranchPrompt(plan));
  } catch (err) {
    return { status: "errored", summary: err instanceof Error ? err.message : "Prompt dispatch failed." };
  }

  // Wait for the AUTHORITATIVE terminal. The loop guardrails (maxDurationMs) own the overall
  // time budget and abort this signal — the runner itself imposes no second timeout.
  for (;;) {
    if (signal.aborted) {
      // Best-effort child cancel so no branch keeps consuming the endpoint after group cancel.
      await seams.cancelSession(sessionId).catch(() => undefined);
      return { status: "errored", summary: `Branch cancelled (session ${sessionId}).` };
    }
    const terminal = seams.terminal(sessionId);
    if (terminal === undefined) {
      return { status: "errored", summary: `Session ${sessionId} disappeared before a terminal.` };
    }
    if (terminal !== null) {
      if (terminal.state !== "completed") {
        return { status: "errored", summary: `Session ${sessionId} ended: ${terminal.state}.` };
      }
      const mutated = seams.fileMutationPaths?.(sessionId) ?? [];
      return {
        status: "completed",
        summary: `Session ${sessionId} completed.`,
        ...(mutated.length > 0 ? { mutatedPaths: mutated } : {}),
      };
    }
    await sleep(interval, signal);
  }
}
