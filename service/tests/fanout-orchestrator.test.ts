import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentDefinition, TaskDefinition } from "@cowork-ghc/contracts";
import {
  createFanOutOrchestrator,
  planBranches,
  aggregateStatus,
  type BranchRunResult,
  type BranchView,
} from "../src/dispatchers/fanout.js";

const AGENTS: Record<string, AgentDefinition> = {
  researcher: { id: "researcher", name: "Researcher", source: "built_in", systemPrompt: "research", skillIds: [], permissionPreset: {} },
  reviewer: { id: "reviewer", name: "Reviewer", source: "built_in", systemPrompt: "review", skillIds: [], permissionPreset: {} },
};
const resolve = (id: string) => AGENTS[id];

function fanTask(over: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: "t-fan",
    name: "Fan",
    source: "user_local",
    goal: "review the change",
    loop: { mode: "run_once", maxTurns: 4, maxDurationMs: 60_000 },
    branches: [{ agentId: "researcher", focus: "context" }, { agentId: "reviewer" }],
    maxConcurrency: 2,
    ...over,
  };
}

test("planBranches resolves agents and injects per-branch focus", () => {
  const plans = planBranches(fanTask(), resolve);
  assert.equal(plans.length, 2);
  assert.match(plans[0]!.prompt, /review the change/);
  assert.match(plans[0]!.prompt, /Trọng tâm nhánh này: context/);
  assert.equal(plans[1]!.agentName, "Reviewer");
});

test("planBranches rejects an unknown agent", () => {
  assert.throws(
    () => planBranches(fanTask({ branches: [{ agentId: "ghost" }] }), resolve),
    /unknown agent/,
  );
});

test("all branches complete → group completed; results carry summaries", async () => {
  const orch = createFanOutOrchestrator({
    resolveAgent: resolve,
    runBranch: async (plan) => ({ status: "completed", summary: `done ${plan.agentId}` }),
  });
  const run = orch.start(fanTask());
  const outcome = await run.done;
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.branches.every((b) => b.status === "completed"), true);
  assert.match(outcome.branches[0]!.summary ?? "", /done researcher/);
});

test("one branch failing yields an HONEST partial, never a fake success", async () => {
  const orch = createFanOutOrchestrator({
    resolveAgent: resolve,
    runBranch: async (plan) =>
      plan.agentId === "reviewer"
        ? ({ status: "errored", summary: "boom" } as BranchRunResult)
        : ({ status: "completed" } as BranchRunResult),
  });
  const outcome = await orch.start(fanTask()).done;
  assert.equal(outcome.status, "partial");
});

test("a runner that throws marks that branch errored, not the group succeeded", async () => {
  const orch = createFanOutOrchestrator({
    resolveAgent: resolve,
    runBranch: async (plan) => {
      if (plan.agentId === "reviewer") throw new Error("crash");
      return { status: "completed" };
    },
  });
  const outcome = await orch.start(fanTask()).done;
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.branches.find((b) => b.agentId === "reviewer")?.status, "errored");
});

test("bounded concurrency: never more than maxConcurrency branches run at once", async () => {
  let active = 0;
  let peak = 0;
  const orch = createFanOutOrchestrator({
    resolveAgent: resolve,
    runBranch: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active -= 1;
      return { status: "completed" };
    },
  });
  // 4 branches, concurrency 2 → peak must stay <= 2.
  const task = fanTask({
    branches: [
      { agentId: "researcher" },
      { agentId: "reviewer" },
      { agentId: "researcher" },
      { agentId: "reviewer" },
    ],
    maxConcurrency: 2,
  });
  await orch.start(task).done;
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded 2`);
});

test("cancel stops the group: pending branches never start, status is cancelled", async () => {
  let started = 0;
  const orch = createFanOutOrchestrator({
    resolveAgent: resolve,
    runBranch: async (_plan, signal) => {
      started += 1;
      await new Promise((r) => setTimeout(r, 30));
      return signal.aborted ? { status: "errored" } : { status: "completed" };
    },
  });
  const task = fanTask({
    branches: [
      { agentId: "researcher" },
      { agentId: "reviewer" },
      { agentId: "researcher" },
      { agentId: "reviewer" },
    ],
    maxConcurrency: 1, // serial → later branches are still pending when we cancel
  });
  const run = orch.start(task);
  await new Promise((r) => setTimeout(r, 5));
  run.cancel();
  const outcome = await run.done;
  assert.equal(outcome.status, "cancelled");
  // With concurrency 1, at most the first branch started before cancel.
  assert.ok(started <= 2, `too many branches started after cancel: ${started}`);
  assert.ok(outcome.branches.some((b) => b.status === "cancelled"));
});

test("aggregateStatus: all-failed is errored, mixed with completed is partial", () => {
  const mk = (status: BranchView["status"]): BranchView => ({ branchId: "x", agentId: "a", agentName: "A", status });
  assert.equal(aggregateStatus([mk("errored"), mk("errored")], false), "errored");
  assert.equal(aggregateStatus([mk("completed"), mk("errored")], false), "partial");
  assert.equal(aggregateStatus([mk("completed"), mk("completed")], false), "completed");
  assert.equal(aggregateStatus([mk("running"), mk("completed")], false), "running");
});
