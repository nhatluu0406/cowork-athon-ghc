/**
 * Dispatch-level tests for the 5 Planner tools (Task 3). `planner_list_plans` and
 * `planner_list_tasks` are reads that run directly once connected. The 3 writes
 * (`planner_create_task`, `planner_edit_task`, `planner_delete_task`) are routed through the
 * SAME `PermissionGate.proceed` guard as `sharepoint_upload_file`: the Planner mutation runs
 * ONLY behind a recorded Allow (`performed: true`) — with no Allow (`performed: false`) the
 * mutation never runs and the tool returns a `denied` result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";
import type { PlannerPlan, PlannerTask } from "../src/ms365/planner-service.js";

const PLAN: PlannerPlan = { id: "p1", title: "Plan A" };
const TASK: PlannerTask = {
  id: "t1",
  title: "Task A",
  planId: "p1",
  percentComplete: 0,
  dueDateTime: "2026-08-01T00:00:00Z",
  etag: "W/\"etag1\"",
};

/** Planner stub with call-counting spies so writes-never-ran can be asserted precisely. */
function plannerStub(): ToolDeps["planner"] & {
  createTaskCalls: number;
  editTaskCalls: number;
  deleteTaskCalls: number;
} {
  const state = { createTaskCalls: 0, editTaskCalls: 0, deleteTaskCalls: 0 };
  return {
    get createTaskCalls() {
      return state.createTaskCalls;
    },
    get editTaskCalls() {
      return state.editTaskCalls;
    },
    get deleteTaskCalls() {
      return state.deleteTaskCalls;
    },
    async listPlans() {
      return [PLAN];
    },
    async listTasks() {
      return [TASK];
    },
    async createTask() {
      state.createTaskCalls += 1;
      return TASK;
    },
    async editTask() {
      state.editTaskCalls += 1;
    },
    async deleteTask() {
      state.deleteTaskCalls += 1;
    },
  };
}

/** Matches the real `PermissionGate.proceed` shape (see permission-gate.ts): `perform` runs
 * SYNCHRONOUSLY and returns `{ performed, result }`; `performed: false` never calls `perform`.
 * `isAllowed`/`pending` are seeded so `awaitGateDecision` resolves on its FIRST poll (no real
 * wait): allowGate already reports the request as allowed; denyGate reports it as neither
 * pending nor allowed (as if already resolved/denied). */
function allowGate(): ToolDeps["gate"] {
  return {
    submit: () => {},
    isAllowed: () => true,
    pending: () => [],
    proceed: (_id: string, perform: () => unknown) => ({ performed: true, result: perform() }),
  } as unknown as ToolDeps["gate"];
}
function denyGate(): ToolDeps["gate"] {
  return {
    submit: () => {},
    isAllowed: () => false,
    pending: () => [],
    proceed: () => ({ performed: false, reason: "not_allowed" }),
  } as unknown as ToolDeps["gate"];
}

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    sharepoint: {
      search: async () => [],
      listSiteFiles: async () => [],
      getFileSummaryText: async () => "",
      upload: async () => ({ id: "x", webUrl: "u" }),
    },
    siteScope: { listJoinedSites: async () => [] },
    outlook: {
      searchMessages: async () => [],
      getMessage: async () => ({ id: "m1", subject: "S", from: "a@x.com", receivedDateTime: "d", bodyPreview: "p", body: "full" }),
      getMessageSummaryText: async () => "",
    },
    planner: plannerStub(),
    lists: {
      getLists: async () => [],
      getItems: async () => [],
      addItem: async () => ({ id: "i1", fields: {} }),
      editItem: async () => {},
      deleteItem: async () => {},
    },
    teams: {
      listChats: async () => [],
      listTeams: async () => [],
      listChannels: async () => [],
      listMembers: async () => [],
      getMessages: async () => [],
      postMessage: async () => ({ id: "msg1" }),
    },
    connectionState: () => "connected",
    sessionAllowed: () => true,
    gate: denyGate(),
    now: () => "2026-07-14T00:00:00.000Z",
    writeMode: () => "manual" as const,
    wait: () => Promise.resolve(),
    ...overrides,
  };
}

test("planner_list_plans read runs directly", async () => {
  const r = await handleToolCall(deps(), { name: "planner_list_plans", args: {}, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.data, [PLAN]);
});

test("planner_list_tasks requires planId → invalid_input", async () => {
  const r = await handleToolCall(deps(), { name: "planner_list_tasks", args: {}, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
});

test("planner_create_task runs ONLY behind Allow (gate.proceed performed:true)", async () => {
  const planner = plannerStub();
  const r = await handleToolCall(deps({ planner, gate: allowGate() }), {
    name: "planner_create_task",
    args: { planId: "p1", title: "Task A" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, true);
  assert.equal(planner.createTaskCalls, 1);
});

test("planner_create_task denied when no Allow (performed:false) → kind 'denied', createTask NEVER called", async () => {
  const planner = plannerStub();
  const r = await handleToolCall(deps({ planner, gate: denyGate() }), {
    name: "planner_create_task",
    args: { planId: "p1", title: "Task A" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "denied");
  assert.equal(planner.createTaskCalls, 0);
});

test("planner_edit_task requires etag → invalid_input", async () => {
  const r = await handleToolCall(deps({ gate: allowGate() }), {
    name: "planner_edit_task",
    args: { taskId: "t1", title: "New title" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
});

test("planner_delete_task denied path blocks deleteTask", async () => {
  const planner = plannerStub();
  const r = await handleToolCall(deps({ planner, gate: denyGate() }), {
    name: "planner_delete_task",
    args: { taskId: "t1", etag: "W/\"etag1\"" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "denied");
  assert.equal(planner.deleteTaskCalls, 0);
});

test("planner tools fail closed when not connected", async () => {
  const r = await handleToolCall(deps({ connectionState: () => "disconnected" }), {
    name: "planner_list_plans",
    args: {},
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "not_connected");
});
