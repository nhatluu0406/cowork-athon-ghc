import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentDefinition, TaskDefinition } from "@cowork-ghc/contracts";
import {
  createDispatchRunRegistry,
  type DispatchRunRegistry,
} from "../src/dispatchers/run-registry.js";
import { createDispatchRouter } from "../src/dispatchers/router.js";
import { createLiveBranchRunner, composeBranchPrompt } from "../src/dispatchers/live-branch-runner.js";
import type { BranchRunner } from "../src/dispatchers/fanout.js";
import type { TaskStore } from "../src/tasks/store.js";
import type { RouteContext, RouteDefinition } from "../src/boundary/contract.js";

const AGENTS: Record<string, AgentDefinition> = {
  researcher: { id: "researcher", name: "Researcher", source: "built_in", systemPrompt: "research well", skillIds: [], permissionPreset: {} },
  reviewer: { id: "reviewer", name: "Reviewer", source: "built_in", systemPrompt: "review well", skillIds: [], permissionPreset: {} },
};
const resolveAgent = (id: string) => AGENTS[id];

function task(over: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: "t1",
    name: "Fan task",
    source: "user_local",
    goal: "do the work",
    loop: { mode: "run_once", maxTurns: 3, maxDurationMs: 60_000 },
    branches: [{ agentId: "researcher" }, { agentId: "reviewer" }],
    ...over,
  };
}

function registry(runBranch: BranchRunner, over: Partial<Parameters<typeof createDispatchRunRegistry>[0]> = {}): DispatchRunRegistry {
  return createDispatchRunRegistry({ resolveAgent, runBranch, now: () => "2026-07-15T00:00:00Z", ...over });
}

test("run_once dispatch: both branches complete → run completed with honest branch views", async () => {
  const runs = registry(async (plan) => ({ status: "completed", summary: `ok ${plan.agentId}` }));
  const started = runs.start(task());
  assert.equal(started.status, "running");
  assert.equal(started.taskId, "t1");

  // Await terminal by polling the view (the registry owns no exposed done-promise).
  await new Promise((r) => setTimeout(r, 20));
  const view = runs.get(started.runId);
  assert.ok(view);
  assert.equal(view.status, "completed");
  assert.equal(view.attempts, 1);
  assert.equal(view.branches.length, 2);
  assert.equal(view.branches.every((b) => b.status === "completed"), true);
});

test("a failing branch never yields a completed run (honest errored group)", async () => {
  const runs = registry(async (plan) =>
    plan.agentId === "reviewer" ? { status: "errored", summary: "boom" } : { status: "completed" },
  );
  const started = runs.start(task());
  await new Promise((r) => setTimeout(r, 20));
  const view = runs.get(started.runId);
  assert.equal(view?.status, "errored");
  assert.match(view?.reason ?? "", /Attempt failed/);
});

test("retry_until_verified without a verify hook errors immediately (no fabricated retries)", async () => {
  const runs = registry(async () => ({ status: "completed" }));
  const started = runs.start(task({ loop: { mode: "retry_until_verified", maxTurns: 3, maxDurationMs: 60_000 } }));
  await new Promise((r) => setTimeout(r, 20));
  const view = runs.get(started.runId);
  assert.equal(view?.status, "errored");
  assert.match(view?.reason ?? "", /verification hook/);
});

test("retry_until_verified with a verify hook retries the whole group until verified", async () => {
  let groups = 0;
  const runs = registry(
    async () => {
      return { status: "completed" };
    },
    {
      verify: async (attempt) => {
        void groups;
        return attempt >= 2 ? { verified: true, evidence: "disk check" } : { verified: false };
      },
    },
  );
  groups += 1;
  const started = runs.start(task({ loop: { mode: "retry_until_verified", maxTurns: 5, maxDurationMs: 60_000 } }));
  await new Promise((r) => setTimeout(r, 30));
  const view = runs.get(started.runId);
  assert.equal(view?.status, "completed");
  assert.equal(view?.verified, true);
  assert.equal(view?.attempts, 2);
});

test("cancel stops the loop AND the in-flight fan-out group", async () => {
  let abortSeen = false;
  const runs = registry(
    (_plan, signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          abortSeen = true;
          resolve({ status: "errored", summary: "aborted" });
        });
      }),
  );
  const started = runs.start(task());
  const ok = runs.cancel(started.runId);
  assert.equal(ok, true);
  await new Promise((r) => setTimeout(r, 20));
  const view = runs.get(started.runId);
  assert.equal(view?.status, "cancelled");
  assert.equal(abortSeen, true);
  assert.equal(runs.cancel("run-does-not-exist"), false);
});

test("start rejects a task whose plan references an unknown agent", () => {
  const runs = registry(async () => ({ status: "completed" }));
  assert.throws(() => runs.start(task({ branches: [{ agentId: "ghost" }] })), /unknown agent/);
});

test("finished-run history is bounded; running runs are never evicted", async () => {
  const runs = registry(async () => ({ status: "completed" }), { maxFinishedRuns: 2 });
  for (let i = 0; i < 4; i += 1) {
    runs.start(task({ id: `t${i}`, name: `T${i}` }));
    await new Promise((r) => setTimeout(r, 10));
  }
  const list = runs.list();
  assert.ok(list.length <= 2, `expected <= 2 finished runs kept, got ${list.length}`);
});

// ---- Router boundary ----------------------------------------------------------------

function fakeTaskStore(tasks: readonly TaskDefinition[]): TaskStore {
  return {
    list: () => tasks,
    get: (id) => tasks.find((t) => t.id === id),
    createTask: () => Promise.reject(new Error("unused")),
    updateTask: () => Promise.reject(new Error("unused")),
    deleteTask: () => Promise.reject(new Error("unused")),
    instantiate: () => Promise.reject(new Error("unused")),
  };
}

function route(router: ReturnType<typeof createDispatchRouter>, method: string, path: string): RouteDefinition {
  const def = router.routes.find((r) => r.method === method && r.path === path);
  assert.ok(def, `route ${method} ${path} missing`);
  return def as RouteDefinition;
}

function ctx(params: Record<string, string>): RouteContext {
  return { method: "POST", url: new URL("http://127.0.0.1/x"), params, body: undefined };
}

test("router: run a stored task → 201 with a live run view; unknown task → 404", async () => {
  const runs = registry(async () => ({ status: "completed" }));
  const router = createDispatchRouter({ runs, tasks: fakeTaskStore([task()]) });
  const start = route(router, "POST", "/v1/dispatch/tasks/{id}/run");

  const created = await start.handler(ctx({ id: "t1" }));
  assert.equal(created.status, 201);
  const run = (created.data as { run: { runId: string } }).run;
  assert.ok(run.runId.length > 0);

  const missing = await start.handler(ctx({ id: "nope" }));
  assert.equal(missing.status, 404);

  const item = route(router, "GET", "/v1/dispatch/runs/{id}");
  const got = await item.handler(ctx({ id: run.runId }));
  assert.equal(got.status, 200);
  const gone = await item.handler(ctx({ id: "run-x" }));
  assert.equal(gone.status, 404);

  const cancel = route(router, "POST", "/v1/dispatch/runs/{id}/cancel");
  const cancelled = await cancel.handler(ctx({ id: run.runId }));
  assert.equal(cancelled.status, 200);
  const cancelMissing = await cancel.handler(ctx({ id: "run-x" }));
  assert.equal(cancelMissing.status, 404);
});

test("router: a task with a bad plan maps to 400, not 500", async () => {
  const runs = registry(async () => ({ status: "completed" }));
  const bad = task({ id: "t-bad", branches: [{ agentId: "ghost" }] });
  const router = createDispatchRouter({ runs, tasks: fakeTaskStore([bad]) });
  const start = route(router, "POST", "/v1/dispatch/tasks/{id}/run");
  await assert.rejects(async () => start.handler(ctx({ id: "t-bad" })), /unknown agent/);
});

// ---- Live branch runner (fake seams — no child, no network) ---------------------------

test("live branch runner: create → prompt (persona prepended) → terminal completed", async () => {
  const prompts: string[] = [];
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s1" }),
    sendPrompt: async (_id, text) => {
      prompts.push(text);
    },
    terminal: () => ({ state: "completed" }),
    cancelSession: async () => undefined,
    pollIntervalMs: 1,
  });
  const plan = { branchId: "b1", agentId: "researcher", agentName: "Researcher", systemPrompt: "research well", prompt: "do the work" };
  const result = await runner(plan, new AbortController().signal);
  assert.equal(result.status, "completed");
  assert.equal(prompts[0], composeBranchPrompt(plan));
  assert.match(prompts[0]!, /research well/);
  assert.match(prompts[0]!, /do the work/);
});

test("live branch runner: a non-completed terminal is an errored branch (honest)", async () => {
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s1" }),
    sendPrompt: async () => undefined,
    terminal: () => ({ state: "errored" }),
    cancelSession: async () => undefined,
    pollIntervalMs: 1,
  });
  const result = await runner(
    { branchId: "b1", agentId: "a", agentName: "A", systemPrompt: "x", prompt: "y" },
    new AbortController().signal,
  );
  assert.equal(result.status, "errored");
  assert.match(result.summary ?? "", /errored/);
});

test("live branch runner: abort mid-wait cancels the child session", async () => {
  let cancelledSession: string | null = null;
  const controller = new AbortController();
  const runner = createLiveBranchRunner({
    createSession: async () => ({ id: "s9" }),
    sendPrompt: async () => undefined,
    terminal: () => null, // never terminal → only abort ends the wait
    cancelSession: async (id) => {
      cancelledSession = id;
    },
    pollIntervalMs: 5,
  });
  const pending = runner(
    { branchId: "b1", agentId: "a", agentName: "A", systemPrompt: "x", prompt: "y" },
    controller.signal,
  );
  setTimeout(() => controller.abort(), 10);
  const result = await pending;
  assert.equal(result.status, "errored");
  assert.equal(cancelledSession, "s9");
});

test("live branch runner: session create failure is an errored branch, never a crash", async () => {
  const runner = createLiveBranchRunner({
    createSession: async () => {
      throw new Error("no runtime");
    },
    sendPrompt: async () => undefined,
    terminal: () => null,
    cancelSession: async () => undefined,
  });
  const result = await runner(
    { branchId: "b1", agentId: "a", agentName: "A", systemPrompt: "x", prompt: "y" },
    new AbortController().signal,
  );
  assert.equal(result.status, "errored");
  assert.equal(result.summary, "no runtime");
});
