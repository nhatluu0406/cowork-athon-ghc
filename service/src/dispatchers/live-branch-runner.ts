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
 */

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
        return terminal.state === "completed"
          ? { status: "completed", summary: `Session ${sessionId} completed.` }
          : { status: "errored", summary: `Session ${sessionId} ended: ${terminal.state}.` };
      }
      await sleep(interval, signal);
    }
  };
}
