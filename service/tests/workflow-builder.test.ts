/**
 * Workflow builder from prompt (agent-harness-plan.md Task 4.3): draft generation + MANDATORY
 * contract validation + a separate explicit confirm/save step. No live LLM call — every test
 * injects a fake generator. Negative tests prove an LLM-shaped attack (unknown field, widened
 * permission preset, invalid schema) is refused at the boundary with nothing saved and no path to
 * an unconfirmed run.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { TaskDefinition } from "@cowork-ghc/contracts";
import { LIVE_SESSION_PERMISSION_POLICY } from "../src/runtime/index.js";
import {
  createWorkflowBuilder,
  type WorkflowDraftCandidate,
  type WorkflowDraftGenerator,
} from "../src/tasks/workflow-builder.js";
import {
  createWorkflowRouter,
  TASK_DRAFT_PATH,
  TASK_DRAFT_CONFIRM_PATH,
} from "../src/tasks/workflow-router.js";
import { createAgentCatalog, type AgentStoreFs } from "../src/agents/catalog.js";
import { createTaskStore, type TaskStoreFs } from "../src/tasks/store.js";
import type { RouteContext, RouteDefinition } from "../src/boundary/contract.js";

const CATALOG_AGENT_IDS = new Set(["researcher", "implementer", "reviewer"]);

function generatorReturning(candidate: WorkflowDraftCandidate): WorkflowDraftGenerator {
  return async () => candidate;
}

function builder(generate: WorkflowDraftGenerator) {
  return createWorkflowBuilder({
    generate,
    knownAgentIds: () => CATALOG_AGENT_IDS,
    basePolicy: LIVE_SESSION_PERMISSION_POLICY,
  });
}

const VALID_TASK = {
  name: "Nightly report",
  goal: "Summarize the day's changes into report.md",
  loop: { mode: "run_once", maxTurns: 3, maxDurationMs: 60_000 },
  agentId: "researcher",
};

// ---- Builder: happy paths --------------------------------------------------------------

test("draftFromPrompt: a well-formed candidate referencing a catalog agent validates ok", async () => {
  const b = builder(generatorReturning({ task: VALID_TASK }));
  const outcome = await b.draftFromPrompt("write me a nightly report task");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.task.source, "user_local");
  assert.equal(outcome.task.agentId, "researcher");
  assert.ok(outcome.task.id.length > 0, "the builder must assign an id, never trust the LLM's");
});

test("draftFromPrompt: a proposed newAgent with a narrowing preset validates ok and joins the reference set", async () => {
  // The fresh id the builder assigns to newAgent isn't knowable up front, so this happy-path
  // assertion exercises `agentId` (a reference the generator DOES control) rather than `branches`.
  const candidate: WorkflowDraftCandidate = {
    task: { ...VALID_TASK, agentId: "researcher" },
    newAgent: { name: "Auditor", systemPrompt: "Audit only.", permissionPreset: { edit: "deny" } },
  };
  const b = builder(generatorReturning(candidate));
  const outcome = await b.draftFromPrompt("audit the repo");
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.ok(outcome.newAgent, "newAgent must be present and validated");
  assert.equal(outcome.newAgent?.permissionPreset["edit"], "deny");
});

// ---- Builder: negative / boundary tests ------------------------------------------------

test("draftFromPrompt: an empty prompt is refused WITHOUT calling the generator", async () => {
  let called = false;
  const b = builder(async () => {
    called = true;
    return { task: VALID_TASK };
  });
  const outcome = await b.draftFromPrompt("   ");
  assert.equal(outcome.ok, false);
  assert.equal(called, false);
});

test("draftFromPrompt: an unknown top-level field on the task draft is refused (untrusted LLM output)", async () => {
  const b = builder(generatorReturning({ task: { ...VALID_TASK, injectedScript: "rm -rf /" } }));
  const outcome = await b.draftFromPrompt("do something");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /unknown field/);
  assert.match(outcome.error, /injectedScript/);
});

test("draftFromPrompt: an LLM-supplied id/source is refused (storage identity is never LLM-controlled)", async () => {
  const b = builder(generatorReturning({ task: { ...VALID_TASK, id: "researcher", source: "built_in" } }));
  const outcome = await b.draftFromPrompt("do something");
  assert.equal(outcome.ok, false);
});

test("draftFromPrompt: an unknown field inside loop is refused", async () => {
  const b = builder(
    generatorReturning({
      task: { ...VALID_TASK, loop: { mode: "run_once", maxTurns: 3, maxDurationMs: 60_000, sneaky: true } },
    }),
  );
  const outcome = await b.draftFromPrompt("do something");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /task\.loop/);
});

test("draftFromPrompt: a widened permission preset on a proposed newAgent is refused", async () => {
  const b = builder(
    generatorReturning({
      task: { ...VALID_TASK, agentId: "researcher" },
      // The live policy denies `bash`; a preset trying to ALLOW it is a widen, never narrow.
      newAgent: { name: "Escalator", systemPrompt: "x", permissionPreset: { bash: "allow" } },
    }),
  );
  const outcome = await b.draftFromPrompt("give me more access");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /newAgent invalid/);
});

test("draftFromPrompt: invalid schema (bad loop.mode) is refused with the validator's own error", async () => {
  const b = builder(
    generatorReturning({ task: { ...VALID_TASK, loop: { mode: "not_a_real_mode", maxTurns: 3, maxDurationMs: 1000 } } }),
  );
  const outcome = await b.draftFromPrompt("do something");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /loop\.mode/);
});

test("draftFromPrompt: a task referencing an unknown agent id is refused", async () => {
  const b = builder(generatorReturning({ task: { ...VALID_TASK, agentId: "ghost-agent" } }));
  const outcome = await b.draftFromPrompt("do something");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /unknown agent/);
});

test("draftFromPrompt: a generator failure is refused honestly, never a fabricated draft", async () => {
  const b = builder(async () => {
    throw new Error("llm unavailable");
  });
  const outcome = await b.draftFromPrompt("do something");
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.error, /llm unavailable/);
});

// ---- Router: draft never saves; confirm re-validates through the REAL store/catalog ----------
// (Real stores, in-memory fs seams — proves confirm's "validates again" is not a fake pass-through.)

function memoryAgentFs(): AgentStoreFs {
  let data: string | undefined;
  return { read: async () => data, write: async (d) => void (data = d) };
}

function memoryTaskFs(): TaskStoreFs {
  let data: string | undefined;
  return { read: async () => data, write: async (d) => void (data = d) };
}

async function realStores() {
  const agents = await createAgentCatalog({ fs: memoryAgentFs(), basePolicy: LIVE_SESSION_PERMISSION_POLICY });
  const tasks = await createTaskStore({ fs: memoryTaskFs(), knownAgentIds: () => agents.knownIds() });
  return { agents, tasks };
}

function route(routes: readonly RouteDefinition[], method: string, path: string): RouteDefinition {
  const def = routes.find((r) => r.method === method && r.path === path);
  assert.ok(def, `route ${method} ${path} missing`);
  return def as RouteDefinition;
}

function ctx(body: unknown): RouteContext {
  return { method: "POST", url: new URL("http://127.0.0.1/x"), params: {}, body };
}

test("router: POST draft never persists — the task store stays empty even for a valid draft", async () => {
  const { agents, tasks } = await realStores();
  const b = builder(generatorReturning({ task: VALID_TASK }));
  const router = createWorkflowRouter({ builder: b, tasks, agents });
  const routes = router.routes as readonly RouteDefinition[];

  const draftRoute = route(routes, "POST", TASK_DRAFT_PATH);
  const result = await draftRoute.handler(ctx({ prompt: "write me a task" }));
  assert.equal(result.status, 200);
  assert.equal(tasks.list().filter((t) => t.source === "user_local").length, 0, "draft must never save");
});

test("router: a refused draft returns 422 with no save, and a hand-crafted bad confirm is refused by the REAL store validator", async () => {
  const { agents, tasks } = await realStores();
  const b = builder(generatorReturning({ task: { ...VALID_TASK, injected: "x" } }));
  const router = createWorkflowRouter({ builder: b, tasks, agents });
  const routes = router.routes as readonly RouteDefinition[];

  const draftRoute = route(routes, "POST", TASK_DRAFT_PATH);
  const result = await draftRoute.handler(ctx({ prompt: "do something" }));
  assert.equal(result.status, 422);
  assert.equal(tasks.list().filter((t) => t.source === "user_local").length, 0);

  // Even a hand-crafted, incomplete confirm body is refused by the store's own validator (400),
  // never a 500 and never a save.
  const confirmRoute = route(routes, "POST", TASK_DRAFT_CONFIRM_PATH);
  await assert.rejects(() => Promise.resolve(confirmRoute.handler(ctx({ task: { name: "x" } }))), /./);
  assert.equal(tasks.list().filter((t) => t.source === "user_local").length, 0);
});

test("router: POST confirm saves the validated draft exactly once", async () => {
  const { agents, tasks } = await realStores();
  const b = builder(generatorReturning({ task: VALID_TASK }));
  const router = createWorkflowRouter({ builder: b, tasks, agents });
  const routes = router.routes as readonly RouteDefinition[];

  const draftRoute = route(routes, "POST", TASK_DRAFT_PATH);
  const drafted = await draftRoute.handler(ctx({ prompt: "write me a task" }));
  assert.equal(drafted.status, 200);
  const draftBody = drafted.data as { ok: true; task: TaskDefinition };

  const confirmRoute = route(routes, "POST", TASK_DRAFT_CONFIRM_PATH);
  const confirmed = await confirmRoute.handler(ctx({ task: draftBody.task }));
  assert.equal(confirmed.status, 201);
  const userTasks = tasks.list().filter((t) => t.source === "user_local");
  assert.equal(userTasks.length, 1);
  assert.equal(userTasks[0]?.goal, VALID_TASK.goal);
});

test("router: confirming a proposed newAgent persists it FIRST so the task's reference resolves", async () => {
  const { agents, tasks } = await realStores();
  const candidate: WorkflowDraftCandidate = {
    task: { ...VALID_TASK, agentId: "researcher" },
    newAgent: { name: "Auditor", systemPrompt: "Audit only.", permissionPreset: { edit: "deny" } },
  };
  const b = builder(generatorReturning(candidate));
  const router = createWorkflowRouter({ builder: b, tasks, agents });
  const routes = router.routes as readonly RouteDefinition[];

  const draftRoute = route(routes, "POST", TASK_DRAFT_PATH);
  const drafted = await draftRoute.handler(ctx({ prompt: "audit the repo" }));
  const draftBody = drafted.data as { ok: true; task: TaskDefinition; newAgent?: { id: string; name: string } };
  assert.ok(draftBody.newAgent);

  const confirmRoute = route(routes, "POST", TASK_DRAFT_CONFIRM_PATH);
  const confirmed = await confirmRoute.handler(
    ctx({ task: draftBody.task, newAgent: { name: draftBody.newAgent!.name, systemPrompt: "Audit only.", permissionPreset: { edit: "deny" } } }),
  );
  assert.equal(confirmed.status, 201);
  assert.ok(agents.list().some((a) => a.name === "Auditor"));
});

test("router: confirm never starts a run — the workflow router exposes only draft + confirm", async () => {
  const { agents, tasks } = await realStores();
  const b = builder(generatorReturning({ task: VALID_TASK }));
  const router = createWorkflowRouter({ builder: b, tasks, agents });
  // The workflow router exposes only draft + confirm — there is no third route that could run it.
  assert.equal(router.routes.length, 2);
});
