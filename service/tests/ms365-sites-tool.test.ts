import { test } from "node:test";
import assert from "node:assert/strict";
import { handleToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";

function deps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  return {
    sharepoint: {
      search: async () => [],
      listSiteFiles: async () => [],
      getFileSummaryText: async () => "",
      upload: async () => ({ id: "x", webUrl: "u" }),
    },
    siteScope: {
      listJoinedSites: async () => [
        { id: "s1", displayName: "A", webUrl: "u1", enabled: true },
        { id: "s2", displayName: "B", webUrl: "u2", enabled: false },
      ],
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
    gate: { submit: () => {}, proceed: () => ({ performed: false }) } as unknown as ToolDeps["gate"],
    now: () => "2026-07-14T00:00:00.000Z",
    writeMode: () => "manual" as const,
    ...overrides,
  };
}

test("ms365_list_joined_sites returns the joined sites with enabled flags", async () => {
  const result = await handleToolCall(deps(), {
    name: "ms365_list_joined_sites",
    args: {},
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.data, [
    { id: "s1", displayName: "A", webUrl: "u1", enabled: true },
    { id: "s2", displayName: "B", webUrl: "u2", enabled: false },
  ]);
});

test("ms365_list_joined_sites fails closed when not connected", async () => {
  const result = await handleToolCall(deps({ connectionState: () => "disconnected" }), {
    name: "ms365_list_joined_sites",
    args: {},
    sessionId: "s",
    requestId: "r",
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error.kind, "not_connected");
});
