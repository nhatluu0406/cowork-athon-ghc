/**
 * Dispatch run registry (agent-harness-plan.md Task 5.2 wiring) — the live coordinator that turns
 * a stored {@link TaskDefinition} into an observable run: the task's {@link LoopPolicy} executes
 * via the Task 4.2 loop runner, and each loop attempt is ONE fan-out group run through the Task
 * 5.2 orchestrator. The registry owns run identity, live views (for the dispatch board / PWA),
 * group cancel, and a bounded finished-run history. It fabricates nothing: every status shown is
 * derived from the loop runner + branch views.
 *
 * The actual per-branch execution stays behind the injected {@link BranchRunner} seam — Tier 1
 * wires an honest not-attached runner; the live composition wires the real session-backed runner.
 */

import type { AgentDefinition, LoopMode, TaskDefinition } from "@cowork-ghc/contracts";
import {
  startLoopRun,
  type AttemptExecutor,
  type LoopOutcome,
  type LoopRun,
  type LoopTerminal,
  type VerificationHook,
} from "../tasks/loop-runner.js";
import {
  createFanOutOrchestrator,
  type BranchRunner,
  type BranchView,
  type FanOutOutcome,
  type FanOutRun,
} from "./fanout.js";

export type DispatchRunStatus = "running" | LoopTerminal;

/** Secret-free live projection of one dispatch run (board/PWA/tests read this). */
export interface DispatchRunView {
  readonly runId: string;
  readonly taskId: string;
  readonly taskName: string;
  readonly loopMode: LoopMode;
  readonly startedAt: string;
  readonly status: DispatchRunStatus;
  /** Loop attempts started so far (honest count from the loop runner). */
  readonly attempts: number;
  /** True only when the loop's verification hook confirmed evidence. */
  readonly verified: boolean;
  /** Terminal reason once the run finished; absent while running. */
  readonly reason?: string;
  /** Branch views of the CURRENT (or last) fan-out attempt. */
  readonly branches: readonly BranchView[];
}

export interface DispatchRunRegistryOptions {
  readonly resolveAgent: (agentId: string) => AgentDefinition | undefined;
  readonly runBranch: BranchRunner;
  /** Verification hook for `retry_until_verified` / `requireVerifiedEvidence` loops. */
  readonly verify?: VerificationHook;
  /** ISO clock for `startedAt` (deterministic tests). */
  readonly now?: () => string;
  /** Finished runs kept in the listing (oldest evicted first). Default 20. */
  readonly maxFinishedRuns?: number;
}

export interface DispatchRunRegistry {
  /** Validate the task's plan and start its loop. Throws FanOutPlanError for a bad plan. */
  start(task: TaskDefinition): DispatchRunView;
  /** All known runs, newest first. */
  list(): readonly DispatchRunView[];
  get(runId: string): DispatchRunView | undefined;
  /** Cancel a run (loop + in-flight fan-out group). False when the run is unknown. */
  cancel(runId: string): boolean;
}

interface RunState {
  readonly runId: string;
  readonly task: TaskDefinition;
  readonly startedAt: string;
  readonly loop: LoopRun;
  /** Mutable box for the current fan-out group — created BEFORE the loop starts, because the
   * loop runner begins its first attempt synchronously. */
  readonly fan: { current: FanOutRun | null };
  outcome: LoopOutcome | null;
}

function describeGroup(outcome: FanOutOutcome): string {
  const done = outcome.branches.filter((b) => b.status === "completed").length;
  return `${done}/${outcome.branches.length} branch(es) completed (group: ${outcome.status}).`;
}

export function createDispatchRunRegistry(options: DispatchRunRegistryOptions): DispatchRunRegistry {
  const clock = options.now ?? (() => new Date().toISOString());
  const maxFinished = options.maxFinishedRuns ?? 20;
  const orchestrator = createFanOutOrchestrator({
    resolveAgent: options.resolveAgent,
    runBranch: options.runBranch,
  });
  const runs = new Map<string, RunState>();
  let seq = 0;

  function toView(state: RunState): DispatchRunView {
    return {
      runId: state.runId,
      taskId: state.task.id,
      taskName: state.task.name,
      loopMode: state.task.loop.mode,
      startedAt: state.startedAt,
      status: state.loop.status(),
      attempts: state.loop.attempts(),
      verified: state.outcome?.verified === true,
      ...(state.outcome !== null ? { reason: state.outcome.reason } : {}),
      branches: state.fan.current?.branches ?? [],
    };
  }

  /** Evict the oldest FINISHED runs beyond the bound; never evict a running run. */
  function prune(): void {
    const finished = [...runs.values()].filter((r) => r.loop.status() !== "running");
    for (let i = 0; i < finished.length - maxFinished; i += 1) {
      runs.delete(finished[i]!.runId);
    }
  }

  return {
    start(task) {
      // Validate the plan NOW so a bad task 400s at the boundary instead of creating a
      // run doomed to error on its first attempt.
      orchestrator.plan(task);

      seq += 1;
      const runId = `run-${seq}-${task.id}`;
      // One loop attempt = one fan-out group run. Abort (guardrail or cancel) cancels the
      // in-flight group so no branch keeps running after the loop ended. The box exists before
      // startLoopRun because the loop runner begins its first attempt synchronously.
      const fan: RunState["fan"] = { current: null };
      const execute: AttemptExecutor = async (_attempt, signal) => {
        const group = orchestrator.start(task);
        fan.current = group;
        const onAbort = (): void => group.cancel();
        if (signal.aborted) group.cancel();
        else signal.addEventListener("abort", onAbort, { once: true });
        try {
          const outcome = await group.done;
          return {
            status: outcome.status === "completed" ? "completed" : "errored",
            summary: describeGroup(outcome),
          };
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      };
      const loop = startLoopRun(task.loop, {
        execute,
        ...(options.verify !== undefined ? { verify: options.verify } : {}),
      });
      const state: RunState = { runId, task, startedAt: clock(), loop, fan, outcome: null };
      runs.set(runId, state);
      void loop.done.then((outcome) => {
        state.outcome = outcome;
        prune();
      });
      return toView(state);
    },

    list: () => [...runs.values()].reverse().map(toView),
    get: (runId) => {
      const state = runs.get(runId);
      return state === undefined ? undefined : toView(state);
    },
    cancel(runId) {
      const state = runs.get(runId);
      if (state === undefined) return false;
      state.loop.cancel();
      state.fan.current?.cancel();
      return true;
    },
  };
}
