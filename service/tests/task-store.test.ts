import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskStore, type TaskStoreFs } from "../src/tasks/store.js";

const AGENTS = new Set(["researcher", "implementer", "reviewer"]);

function memoryFs(seed?: string): TaskStoreFs & { readonly data: string | undefined } {
  const state = { data: seed };
  return {
    get data() {
      return state.data;
    },
    read: async () => state.data,
    write: async (d: string) => {
      state.data = d;
    },
  };
}

const RUN_ONCE = { mode: "run_once" as const, maxTurns: 5, maxDurationMs: 60_000 };

test("built-in templates are present and read-only", async () => {
  const store = await createTaskStore({ fs: memoryFs(), knownAgentIds: () => AGENTS });
  const ids = store.list().map((t) => t.id);
  assert.ok(ids.includes("tpl-investigate"));
  assert.ok(ids.includes("tpl-fanout-review"));
  await assert.rejects(() => store.deleteTask("tpl-investigate"), /read-only/);
  await assert.rejects(
    () => store.updateTask("tpl-investigate", { name: "x", goal: "y", loop: RUN_ONCE, agentId: "researcher" }),
    /read-only/,
  );
});

test("create a user task, validate references, persist", async () => {
  const fs = memoryFs();
  const store = await createTaskStore({ fs, knownAgentIds: () => AGENTS });
  const task = await store.createTask({
    name: "Điều tra bug",
    goal: "tìm nguyên nhân crash",
    loop: RUN_ONCE,
    agentId: "researcher",
  });
  assert.match(task.id, /^task-/);
  assert.equal(task.source, "user_local");
  assert.ok(fs.data && fs.data.includes(task.id));

  // Unknown agent reference is rejected at the boundary.
  await assert.rejects(
    () => store.createTask({ name: "x", goal: "y", loop: RUN_ONCE, agentId: "ghost" }),
    /unknown agent/,
  );
});

test("1-touch instantiate clones a template into a fresh user task", async () => {
  const store = await createTaskStore({ fs: memoryFs(), knownAgentIds: () => AGENTS });
  const instance = await store.instantiate("tpl-fanout-review", { goal: "review PR #42" });
  assert.match(instance.id, /^task-/);
  assert.equal(instance.source, "user_local");
  assert.equal(instance.goal, "review PR #42");
  assert.equal(instance.branches?.length, 2);
  // The original template is untouched and still read-only.
  assert.ok(store.get("tpl-fanout-review"));
  await assert.rejects(() => store.instantiate("does-not-exist"), /no task/);
});

test("fan-out concurrency is clamped to the hard cap on create", async () => {
  const store = await createTaskStore({ fs: memoryFs(), knownAgentIds: () => AGENTS });
  const task = await store.createTask({
    name: "Fan lớn",
    goal: "nhiều nhánh",
    loop: RUN_ONCE,
    branches: [{ agentId: "researcher" }, { agentId: "reviewer" }],
    maxConcurrency: 50,
  });
  assert.equal(task.maxConcurrency, 5);
});

test("corrupt store loads as templates-only without throwing", async () => {
  const store = await createTaskStore({ fs: memoryFs("{bad json"), knownAgentIds: () => AGENTS });
  // Only the built-in templates remain.
  assert.ok(store.list().every((t) => t.source === "built_in"));
});
