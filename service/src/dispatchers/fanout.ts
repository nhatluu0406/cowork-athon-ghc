/**
 * Fan-out orchestrator (agent-harness-plan.md Task 5.2, the D1 headline).
 *
 * Runs a {@link TaskDefinition}'s branches as concurrent child sessions with BOUNDED concurrency
 * (default 3, hard cap 5). Each branch runs one {@link AgentDefinition}; results aggregate into an
 * HONEST group status — a failed branch never turns the group into a fabricated success. The whole
 * group cancels together (pending branches never start; running branches receive an AbortSignal).
 *
 * The actual per-branch session run is an injected {@link BranchRunner} seam, so this coordinator
 * is unit-tested with no live child, no network, and no LLM. Wiring the real runner (create
 * session → send prompt → await terminal on the stream hub, ALL through the ONE permission gate)
 * is the composition's job; this module owns only the concurrency + aggregation + cancel logic.
 *
 * The `task` tool stays denied in the child policy (opencode-config), so a branch cannot itself
 * spawn a sub-agent — fan-out is orchestrated HERE, at the service, where one permission gate and
 * honest visibility hold.
 */

import { effectiveConcurrency, type AgentDefinition, type TaskDefinition } from "@cowork-ghc/contracts";

/** A planned branch: which agent runs, and the exact prompt it receives. */
export interface BranchPlan {
  readonly branchId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly systemPrompt: string;
  readonly prompt: string;
}

export type BranchStatus = "pending" | "running" | "completed" | "errored" | "cancelled";

/** Live, secret-free view of one branch (for the dispatch board / tests). */
export interface BranchView {
  readonly branchId: string;
  readonly agentId: string;
  readonly agentName: string;
  status: BranchStatus;
  summary?: string;
}

/** The result a {@link BranchRunner} returns for one branch. */
export interface BranchRunResult {
  readonly status: "completed" | "errored";
  /** Non-secret one-line summary of the branch outcome. */
  readonly summary?: string;
}

/** Injected per-branch runner. Must honor `signal` (cancel) and never throw for a normal error. */
export type BranchRunner = (plan: BranchPlan, signal: AbortSignal) => Promise<BranchRunResult>;

export type FanOutStatus = "running" | "completed" | "partial" | "errored" | "cancelled";

export interface FanOutOutcome {
  readonly taskId: string;
  readonly status: FanOutStatus;
  readonly branches: readonly BranchView[];
}

export interface FanOutRun {
  readonly taskId: string;
  /** Live branch views (mutated as branches progress). */
  readonly branches: readonly BranchView[];
  /** Current aggregate status. */
  status(): FanOutStatus;
  /** Cancel the whole group: pending branches never start; running ones get the AbortSignal. */
  cancel(): void;
  /** Resolves when every branch has settled (or the group was cancelled). */
  readonly done: Promise<FanOutOutcome>;
}

export interface FanOutOrchestratorOptions {
  /** Resolve an agent id to its definition (from the agent catalog). */
  readonly resolveAgent: (agentId: string) => AgentDefinition | undefined;
  readonly runBranch: BranchRunner;
}

export class FanOutPlanError extends Error {
  readonly code = "fanout_plan_invalid";
  constructor(message: string) {
    super(message);
    this.name = "FanOutPlanError";
  }
}

/** Build the branch plans for a task (fan-out branches, or a single-agent run). */
export function planBranches(
  task: TaskDefinition,
  resolveAgent: (id: string) => AgentDefinition | undefined,
): readonly BranchPlan[] {
  const raw =
    task.branches !== undefined && task.branches.length > 0
      ? task.branches
      : task.agentId !== undefined
        ? [{ agentId: task.agentId }]
        : [];
  if (raw.length === 0) throw new FanOutPlanError("task has no agent or branch to run.");

  return raw.map((branch, index) => {
    const agent = resolveAgent(branch.agentId);
    if (agent === undefined) {
      throw new FanOutPlanError(`branch references unknown agent "${branch.agentId}".`);
    }
    const focus = "focus" in branch && branch.focus ? `\n\nTrọng tâm nhánh này: ${branch.focus}` : "";
    return {
      branchId: `${task.id}-b${index + 1}`,
      agentId: agent.id,
      agentName: agent.name,
      systemPrompt: agent.systemPrompt,
      prompt: `${task.goal}${focus}`,
    };
  });
}

/** Aggregate branch views into an honest group status. */
export function aggregateStatus(views: readonly BranchView[], cancelled: boolean): FanOutStatus {
  if (views.some((v) => v.status === "pending" || v.status === "running")) return "running";
  if (cancelled && views.some((v) => v.status === "cancelled")) return "cancelled";
  const completed = views.filter((v) => v.status === "completed").length;
  const failed = views.filter((v) => v.status === "errored").length;
  if (completed === views.length) return "completed";
  if (failed === views.length) return "errored";
  if (completed > 0 && (failed > 0 || views.some((v) => v.status === "cancelled"))) return "partial";
  return "errored";
}

export function createFanOutOrchestrator(options: FanOutOrchestratorOptions) {
  const { resolveAgent, runBranch } = options;

  function start(task: TaskDefinition): FanOutRun {
    const plans = planBranches(task, resolveAgent);
    const concurrency = effectiveConcurrency(task);
    const controller = new AbortController();
    let cancelled = false;

    const views: BranchView[] = plans.map((p) => ({
      branchId: p.branchId,
      agentId: p.agentId,
      agentName: p.agentName,
      status: "pending",
    }));
    const viewByBranch = new Map(views.map((v) => [v.branchId, v]));

    async function runOne(plan: BranchPlan): Promise<void> {
      const view = viewByBranch.get(plan.branchId)!;
      if (cancelled) {
        view.status = "cancelled";
        return;
      }
      view.status = "running";
      try {
        const result = await runBranch(plan, controller.signal);
        // Honesty: if the group was cancelled while this branch ran, record cancelled, not success.
        if (cancelled) {
          view.status = "cancelled";
          return;
        }
        view.status = result.status;
        if (result.summary !== undefined) view.summary = result.summary;
      } catch {
        // A runner that throws is an error branch — never a silent success.
        view.status = cancelled ? "cancelled" : "errored";
      }
    }

    // Bounded worker pool: at most `concurrency` branches run at once; a cancelled group
    // stops pulling new work so pending branches settle as `cancelled`.
    const queue = [...plans];
    async function worker(): Promise<void> {
      for (;;) {
        const next = queue.shift();
        if (next === undefined) return;
        if (cancelled) {
          const v = viewByBranch.get(next.branchId)!;
          if (v.status === "pending") v.status = "cancelled";
          continue;
        }
        await runOne(next);
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, plans.length) }, () => worker());
    const done: Promise<FanOutOutcome> = Promise.all(workers).then(() => {
      // Any branch still pending (never picked up because the group was cancelled) → cancelled.
      for (const v of views) if (v.status === "pending") v.status = "cancelled";
      return { taskId: task.id, status: aggregateStatus(views, cancelled), branches: views };
    });

    return {
      taskId: task.id,
      branches: views,
      status: () => aggregateStatus(views, cancelled),
      cancel: () => {
        cancelled = true;
        controller.abort();
      },
      done,
    };
  }

  return { start, plan: (task: TaskDefinition) => planBranches(task, resolveAgent) };
}
