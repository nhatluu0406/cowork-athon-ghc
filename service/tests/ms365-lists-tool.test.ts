/**
 * Dispatch-level tests for the 5 Lists tools (Task 2). `lists_get_lists` and
 * `lists_get_items` are reads that run directly once connected. The 3 writes
 * (`lists_add_item`, `lists_edit_item`, `lists_delete_item`) are routed through the SAME
 * `PermissionGate.proceed` guard as the Planner/SharePoint writes: the Lists mutation runs
 * ONLY behind a recorded Allow (`performed: true`) — with no Allow (`performed: false`) the
 * mutation never runs and the tool returns a `denied` result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";
import type { ListInfo, ListItem } from "../src/ms365/lists-service.js";

const LIST: ListInfo = { id: "l1", displayName: "List A" };
const ITEM: ListItem = { id: "i1", fields: { Title: "Item A" } };

/** Lists stub with call-counting spies so writes-never-ran can be asserted precisely. */
function listsStub(): ToolDeps["lists"] & {
  addItemCalls: number;
  editItemCalls: number;
  deleteItemCalls: number;
} {
  const state = { addItemCalls: 0, editItemCalls: 0, deleteItemCalls: 0 };
  return {
    get addItemCalls() {
      return state.addItemCalls;
    },
    get editItemCalls() {
      return state.editItemCalls;
    },
    get deleteItemCalls() {
      return state.deleteItemCalls;
    },
    async getLists() {
      return [LIST];
    },
    async getItems() {
      return [ITEM];
    },
    async addItem() {
      state.addItemCalls += 1;
      return ITEM;
    },
    async editItem() {
      state.editItemCalls += 1;
    },
    async deleteItem() {
      state.deleteItemCalls += 1;
    },
  };
}

/** Matches the real `PermissionGate.proceed` shape: `perform` runs SYNCHRONOUSLY and returns
 * `{ performed, result }`; `performed: false` never calls `perform`. `isAllowed`/`pending` are
 * seeded so `awaitGateDecision` resolves on its FIRST poll (no real wait). */
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
    planner: {
      listPlans: async () => [],
      listTasks: async () => [],
      createTask: async () => ({ id: "t1", title: "T", planId: "p1", percentComplete: 0, dueDateTime: "", etag: "" }),
      editTask: async () => {},
      deleteTask: async () => {},
    },
    lists: listsStub(),
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

test("lists_get_lists read runs directly", async () => {
  const r = await handleToolCall(deps(), { name: "lists_get_lists", args: { siteId: "s1" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.data, [LIST]);
});

test("lists_get_items missing listId → invalid_input", async () => {
  const r = await handleToolCall(deps(), { name: "lists_get_items", args: { siteId: "s1" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
});

test("lists_get_items with a non-string filter → invalid_input", async () => {
  const r = await handleToolCall(deps(), {
    name: "lists_get_items",
    args: { siteId: "s1", listId: "l1", filter: 42 },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
});

test("lists_add_item runs ONLY behind Allow (gate.proceed performed:true)", async () => {
  const lists = listsStub();
  const r = await handleToolCall(deps({ lists, gate: allowGate() }), {
    name: "lists_add_item",
    args: { siteId: "s1", listId: "l1", fields: { Title: "Item A" } },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, true);
  assert.equal(lists.addItemCalls, 1);
});

test("lists_add_item denied when no Allow (performed:false) → kind 'denied', addItem NEVER called", async () => {
  const lists = listsStub();
  const r = await handleToolCall(deps({ lists, gate: denyGate() }), {
    name: "lists_add_item",
    args: { siteId: "s1", listId: "l1", fields: { Title: "Item A" } },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "denied");
  assert.equal(lists.addItemCalls, 0);
});

test("lists_add_item with fields as an array → invalid_input", async () => {
  const lists = listsStub();
  const r = await handleToolCall(deps({ lists, gate: allowGate() }), {
    name: "lists_add_item",
    args: { siteId: "s1", listId: "l1", fields: [1, 2] },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
  assert.equal(lists.addItemCalls, 0);
});

test("lists_delete_item denied path blocks deleteItem", async () => {
  const lists = listsStub();
  const r = await handleToolCall(deps({ lists, gate: denyGate() }), {
    name: "lists_delete_item",
    args: { siteId: "s1", listId: "l1", itemId: "i1" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "denied");
  assert.equal(lists.deleteItemCalls, 0);
});

test("lists tools fail closed when not connected", async () => {
  const r = await handleToolCall(deps({ connectionState: () => "disconnected" }), {
    name: "lists_get_lists",
    args: { siteId: "s1" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "not_connected");
});
