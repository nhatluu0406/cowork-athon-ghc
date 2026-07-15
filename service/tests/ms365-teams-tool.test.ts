/**
 * Dispatch-level tests for the 6 Teams tools (Task 2). 5 reads (`teams_list_chats`,
 * `teams_list_teams`, `teams_list_channels`, `teams_list_members`, `teams_get_messages`) run
 * directly once connected. The 1 write (`teams_post_message`) is routed through the SAME
 * `PermissionGate.proceed` guard as the Planner/Lists/SharePoint writes: the Teams post runs
 * ONLY behind a recorded Allow (`performed: true`) — with no Allow (`performed: false`) the
 * post never runs and the tool returns a `denied` result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";
import type { TeamsChat } from "../src/ms365/teams-service.js";

const CHAT: TeamsChat = { id: "c1", topic: "T", memberNames: ["A", "B"] };

/** Teams stub with a call-counting spy on postMessage so writes-never-ran can be asserted
 * precisely. */
function teamsStub(): ToolDeps["teams"] & { postMessageCalls: number } {
  const state = { postMessageCalls: 0 };
  return {
    get postMessageCalls() {
      return state.postMessageCalls;
    },
    async listChats() {
      return [CHAT];
    },
    async listTeams() {
      return [];
    },
    async listChannels() {
      return [];
    },
    async listMembers() {
      return [];
    },
    async getMessages() {
      return [];
    },
    async postMessage() {
      state.postMessageCalls += 1;
      return { id: "msg1" };
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
    lists: {
      getLists: async () => [],
      getItems: async () => [],
      addItem: async () => ({ id: "i1", fields: {} }),
      editItem: async () => {},
      deleteItem: async () => {},
    },
    teams: teamsStub(),
    connectionState: () => "connected",
    sessionAllowed: () => true,
    gate: denyGate(),
    now: () => "2026-07-14T00:00:00.000Z",
    writeMode: () => "manual" as const,
    wait: () => Promise.resolve(),
    ...overrides,
  };
}

test("teams_list_chats read runs directly", async () => {
  const r = await handleToolCall(deps(), { name: "teams_list_chats", args: {}, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.data, [CHAT]);
});

test("teams_get_messages with BOTH chatId and teamId+channelId → invalid_input", async () => {
  const r = await handleToolCall(deps(), {
    name: "teams_get_messages",
    args: { chatId: "c1", teamId: "t1", channelId: "ch1" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
});

test("teams_get_messages with neither chatId nor teamId/channelId → invalid_input", async () => {
  const r = await handleToolCall(deps(), {
    name: "teams_get_messages",
    args: {},
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
});

test("teams_post_message runs ONLY behind Allow (gate.proceed performed:true)", async () => {
  const teams = teamsStub();
  const r = await handleToolCall(deps({ teams, gate: allowGate() }), {
    name: "teams_post_message",
    args: { chatId: "c1", content: "hello" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.data, { id: "msg1" });
  assert.equal(teams.postMessageCalls, 1);
});

test("teams_post_message denied when no Allow (performed:false) → kind 'denied', postMessage NEVER called", async () => {
  const teams = teamsStub();
  const r = await handleToolCall(deps({ teams, gate: denyGate() }), {
    name: "teams_post_message",
    args: { chatId: "c1", content: "hello" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "denied");
  assert.equal(teams.postMessageCalls, 0);
});

test("teams_post_message missing content → invalid_input", async () => {
  const teams = teamsStub();
  const r = await handleToolCall(deps({ teams, gate: allowGate() }), {
    name: "teams_post_message",
    args: { chatId: "c1" },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
  assert.equal(teams.postMessageCalls, 0);
});

test("teams_post_message mentions entry missing userId → invalid_input", async () => {
  const teams = teamsStub();
  const r = await handleToolCall(deps({ teams, gate: allowGate() }), {
    name: "teams_post_message",
    args: { chatId: "c1", content: "hello @{0}", mentions: [{ displayName: "A" }] },
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
  assert.equal(teams.postMessageCalls, 0);
});

test("teams tools fail closed when not connected", async () => {
  const r = await handleToolCall(deps({ connectionState: () => "disconnected" }), {
    name: "teams_list_chats",
    args: {},
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "not_connected");
});
