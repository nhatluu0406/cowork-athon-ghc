/**
 * Loop runner + end-loop guardrails (agent-harness-plan.md Task 4.2).
 *
 * Executes a {@link LoopPolicy} over an injected {@link AttemptExecutor} (in composition: one
 * fan-out group run). The runner owns ONLY loop semantics — retry, schedule, guardrails, cancel,
 * honest terminal status. It never fabricates success: `retry_until_verified` reports `completed`
 * only when the injected {@link VerificationHook} returned real evidence, and a guardrail stop
 * without verified success is `exhausted`, never `completed`.
 *
 * Guardrails (all enforced here, not trusted to the executor):
 *  - `maxTurns`   — hard cap on attempts.
 *  - `maxDurationMs` — wall-clock cap; an in-flight attempt is aborted via AbortSignal.
 *  - `cancel()`   — caller cancel aborts the in-flight attempt and ends the loop as `cancelled`.
 */

import type { LoopPolicy } from "@cowork-ghc/contracts";

export type AttemptStatus = "completed" | "errored";

/** What one attempt produced. `summary` must be secret-free (it may be shown on a board). */
export interface AttemptResult {
  readonly status: AttemptStatus;
  readonly summary?: string;
}

/** Runs ONE attempt. Must honor `signal` (guardrail/cancel abort) and should not throw. */
export type AttemptExecutor = (attempt: number, signal: AbortSignal) => Promise<AttemptResult>;

/** Evidence check for verified success. Absent evidence MUST return `verified: false`. */
export type VerificationHook = (
  attempt: number,
  result: AttemptResult,
) => Promise<{ readonly verified: boolean; readonly evidence?: string }>;

export type LoopTerminal = "completed" | "partial" | "errored" | "cancelled" | "exhausted";

export interface LoopOutcome {
  readonly status: LoopTerminal;
  /** Attempts actually started (honest count, includes an aborted in-flight attempt). */
  readonly attempts: number;
  /** True only when a {@link VerificationHook} confirmed evidence. Never inferred. */
  readonly verified: boolean;
  /** Human-readable, secret-free reason for the terminal state. */
  readonly reason: string;
  readonly lastSummary?: string;
  readonly evidence?: string;
}

export interface LoopRun {
  readonly done: Promise<LoopOutcome>;
  /** Abort the in-flight attempt and end the loop as `cancelled`. Idempotent. */
  cancel(): void;
  status(): "running" | LoopTerminal;
  attempts(): number;
}

export interface LoopRunnerOptions {
  readonly execute: AttemptExecutor;
  /**
   * Required for `retry_until_verified` and for any policy with `requireVerifiedEvidence` —
   * without a hook such a loop errors immediately instead of burning turns it can never verify.
   */
  readonly verify?: VerificationHook;
  /** Injectable clock (ms epoch) for the wall-clock guardrail. */
  readonly now?: () => number;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
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

export function startLoopRun(policy: LoopPolicy, options: LoopRunnerOptions): LoopRun {
  const clock = options.now ?? (() => Date.now());
  const controller = new AbortController();
  let cancelled = false;
  let deadlineHit = false;
  let attemptsMade = 0;
  let lastSummary: string | undefined;
  let state: "running" | LoopTerminal = "running";

  const startedAt = clock();
  const remaining = (): number => startedAt + policy.maxDurationMs - clock();
  const deadlineTimer = setTimeout(() => {
    deadlineHit = true;
    controller.abort();
  }, policy.maxDurationMs);

  function outcome(status: LoopTerminal, reason: string, extra: Partial<LoopOutcome> = {}): LoopOutcome {
    return {
      status,
      attempts: attemptsMade,
      verified: extra.verified === true,
      reason,
      ...(lastSummary !== undefined ? { lastSummary } : {}),
      ...(extra.evidence !== undefined ? { evidence: extra.evidence } : {}),
    };
  }

  /** One attempt; a throwing executor is an errored attempt, never an unhandled rejection. */
  async function execAttempt(): Promise<AttemptResult> {
    attemptsMade += 1;
    try {
      const result = await options.execute(attemptsMade, controller.signal);
      if (result.summary !== undefined) lastSummary = result.summary;
      return result;
    } catch (err) {
      lastSummary = err instanceof Error ? err.message : "attempt failed";
      return { status: "errored", summary: lastSummary };
    }
  }

  /** The guardrail/cancel terminal for the CURRENT moment, or null when the loop may continue. */
  function stopNow(): LoopOutcome | null {
    if (cancelled) return outcome("cancelled", "Cancelled by caller.");
    if (deadlineHit || remaining() <= 0) {
      return outcome("exhausted", `maxDurationMs (${policy.maxDurationMs}) reached.`);
    }
    return null;
  }

  async function runOnce(): Promise<LoopOutcome> {
    const result = await execAttempt();
    const stopped = stopNow();
    if (stopped !== null) return stopped;
    if (result.status === "errored") return outcome("errored", "Attempt failed.");
    if (policy.requireVerifiedEvidence === true) {
      if (options.verify === undefined) {
        return outcome("errored", "requireVerifiedEvidence is set but no verification hook is configured.");
      }
      const v = await options.verify(attemptsMade, result);
      if (!v.verified) {
        return outcome("exhausted", "Completed without the required verification evidence.");
      }
      return outcome("completed", "Verified success.", { verified: true, ...(v.evidence !== undefined ? { evidence: v.evidence } : {}) });
    }
    return outcome("completed", "Attempt completed.");
  }

  async function retryUntilVerified(): Promise<LoopOutcome> {
    const verify = options.verify;
    if (verify === undefined) {
      return outcome("errored", "retry_until_verified requires a verification hook.");
    }
    for (;;) {
      const stopped = stopNow();
      if (stopped !== null) return stopped;
      if (attemptsMade >= policy.maxTurns) {
        return outcome("exhausted", `maxTurns (${policy.maxTurns}) reached without verified success.`);
      }
      const result = await execAttempt();
      const stoppedAfter = stopNow();
      if (stoppedAfter !== null) return stoppedAfter;
      if (result.status !== "completed") continue;
      const v = await verify(attemptsMade, result);
      if (v.verified) {
        return outcome("completed", "Verified success.", { verified: true, ...(v.evidence !== undefined ? { evidence: v.evidence } : {}) });
      }
    }
  }

  async function scheduled(): Promise<LoopOutcome> {
    const interval = policy.intervalMs ?? 1_000;
    const statuses: AttemptStatus[] = [];
    for (;;) {
      if (cancelled || deadlineHit || remaining() <= 0 || attemptsMade >= policy.maxTurns) break;
      const result = await execAttempt();
      statuses.push(result.status);
      if (cancelled || deadlineHit || attemptsMade >= policy.maxTurns || remaining() <= 0) break;
      await abortableSleep(Math.min(interval, remaining()), controller.signal);
    }
    if (cancelled) return outcome("cancelled", "Cancelled by caller.");
    if (statuses.length === 0) return outcome("exhausted", "No attempt ran before the guardrails stopped the loop.");
    const completed = statuses.filter((s) => s === "completed").length;
    const reason = `Schedule ended after ${statuses.length} attempt(s): ${completed} completed, ${statuses.length - completed} errored.`;
    if (completed === statuses.length) return outcome("completed", reason);
    if (completed === 0) return outcome("errored", reason);
    return outcome("partial", reason);
  }

  const done = (async () => {
    try {
      if (policy.mode === "run_once") return await runOnce();
      if (policy.mode === "retry_until_verified") return await retryUntilVerified();
      return await scheduled();
    } finally {
      clearTimeout(deadlineTimer);
    }
  })().then((result) => {
    state = result.status;
    return result;
  });

  return {
    done,
    cancel: () => {
      if (state !== "running") return;
      cancelled = true;
      controller.abort();
    },
    status: () => state,
    attempts: () => attemptsMade,
  };
}
