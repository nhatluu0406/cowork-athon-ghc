/**
 * planner_create_tasks batch tool: cap/empty validation, manual-mode refusal (no permission
 * request), ONE gate request per batch, Deny blocks all Graph calls, per-item honest results,
 * and the bounded permission description.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { handleToolCall, type ToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";
import { buildBatchDescription } from "../src/ms365/ms365-batch-tools.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";
import type { PlannerTask } from "../src/ms365/planner-service.js";
import type { Ms365WriteMode } from "../src/ms365/write-mode-store.js";

function batchCall(args: Record<string, unknown>): ToolCall {
  return { name: "planner_create_tasks", args, sessionId: "s1", requestId: "r1" };
}

function tasksOf(n: number): Array<{ title: string }> {
  return Array.from({ length: n }, (_, i) => ({ title: `Task ${i + 1}` }));
}

interface BuildDepsOptions {
  writeMode: Ms365WriteMode;
  decision?: "allow" | "deny";
  failOn?: { index: number; error: Ms365Error };
}

function buildDeps(opts: BuildDepsOptions): ToolDeps & {
  spies: { submitCount: number; createTaskCalls: unknown[] };
} {
  const spies = { submitCount: 0, createTaskCalls: [] as unknown[] };

  const gate: ToolDeps["gate"] = {
    submit: () => {
      spies.submitCount += 1;
    },
    // Seeded so `awaitGateDecision` resolves on its FIRST poll (no real wait): "allow" is
    // already-allowed, "deny" (or unset) is neither pending nor allowed (already resolved).
    isAllowed: () => opts.decision === "allow",
    pending: () => [],
    proceed: (_id: string, perform: () => unknown) => {
      if (opts.decision === "allow") {
        return { performed: true, result: perform() };
      }
      return { performed: false, reason: "not_allowed" };
    },
  } as unknown as ToolDeps["gate"];

  const planner: ToolDeps["planner"] = {
    listPlans: async () => [],
    listTasks: async () => [],
    async createTask(input) {
      const index = spies.createTaskCalls.length;
      spies.createTaskCalls.push(input);
      if (opts.failOn !== undefined && opts.failOn.index === index) {
        throw opts.failOn.error;
      }
      const task: PlannerTask = {
        id: `t${index + 1}`,
        title: input.title,
        planId: input.planId,
        percentComplete: 0,
        dueDateTime: "",
        etag: "",
      };
      return task;
    },
    editTask: async () => {},
    deleteTask: async () => {},
  };

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
    planner,
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
    gate,
    now: () => "2026-07-14T00:00:00.000Z",
    writeMode: () => opts.writeMode,
    wait: () => Promise.resolve(),
    spies,
  };
}

test("empty tasks array → invalid_input", async () => {
  const deps = buildDeps({ writeMode: "auto" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: [] }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "invalid_input");
});

test("21 tasks → invalid_input asking to split", async () => {
  const deps = buildDeps({ writeMode: "auto" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(21) }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "invalid_input");
});

test("manual mode → manual_mode error, NO permission request submitted, no Graph call", async () => {
  const deps = buildDeps({ writeMode: "manual" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(3) }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "manual_mode");
  assert.equal(deps.spies.submitCount, 0);
  assert.equal(deps.spies.createTaskCalls.length, 0);
});

test("auto + Deny → zero Graph calls, denied result", async () => {
  const deps = buildDeps({ writeMode: "auto", decision: "deny" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(3) }));
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.kind, "denied");
  assert.equal(deps.spies.createTaskCalls.length, 0);
});

test("auto + Allow → ONE submit, N sequential creates, all in created[]", async () => {
  const deps = buildDeps({ writeMode: "auto", decision: "allow" });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(3) }));
  assert.equal(result.ok, true);
  assert.equal(deps.spies.submitCount, 1);
  assert.equal(deps.spies.createTaskCalls.length, 3);
  const data = result.ok ? (result.data as { created: unknown[]; failed: unknown[] }) : { created: [], failed: [] };
  assert.equal(data.created.length, 3);
  assert.equal(data.failed.length, 0);
});

test("middle item failing does not break the batch; failed[] carries index/title/kind", async () => {
  const deps = buildDeps({
    writeMode: "auto",
    decision: "allow",
    failOn: { index: 1, error: new Ms365Error("graph_error", "boom", "Thử lại.", true) },
  });
  const result = await handleToolCall(deps, batchCall({ planId: "p1", tasks: tasksOf(3) }));
  assert.equal(result.ok, true);
  const data = result.ok
    ? (result.data as { created: unknown[]; failed: Array<{ index: number; title: string; error: { kind: string } }> })
    : { created: [], failed: [] };
  assert.equal(data.created.length, 2);
  assert.deepEqual(
    data.failed.map((f) => ({ index: f.index, title: f.title, kind: f.error.kind })),
    [{ index: 1, title: "Task 2", kind: "graph_error" }],
  );
  assert.equal(deps.spies.createTaskCalls.length, 3);
});

test("description carries total count and bounded titles", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `Một tiêu đề task khá dài số ${i + 1} để vượt ngân sách mô tả` }));
  const desc = buildBatchDescription("plan-1", many);
  assert.ok(desc.includes("Tạo 20 task trong Planner"));
  assert.ok(desc.length < 700);
  assert.ok(desc.includes("…") || desc.includes("khác"));
  const short = buildBatchDescription("plan-1", [{ title: "A" }, { title: "B" }]);
  assert.ok(short.includes('"A"') && short.includes('"B"'));
  assert.ok(short.includes("Tạo 2 task"));
});
