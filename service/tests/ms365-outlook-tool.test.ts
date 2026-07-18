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
    siteScope: { listJoinedSites: async () => [] },
    outlook: {
      searchMessages: async () => [
        { id: "m1", subject: "S", from: "a@x.com", receivedDateTime: "2026-07-01T00:00:00Z", bodyPreview: "p" },
      ],
      getMessage: async () => ({ id: "m1", subject: "S", from: "a@x.com", receivedDateTime: "d", bodyPreview: "p", body: "full" }),
      getMessageSummaryText: async () => "summary text",
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

test("outlook_search_messages returns hits (read, no gate)", async () => {
  const r = await handleToolCall(deps(), { name: "outlook_search_messages", args: { query: "q" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && Array.isArray(r.data) && (r.data as unknown[]).length, 1);
});

test("outlook_search_messages without query → invalid_input", async () => {
  const r = await handleToolCall(deps(), { name: "outlook_search_messages", args: {}, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "invalid_input");
});

test("outlook_get_message returns detail", async () => {
  const r = await handleToolCall(deps(), { name: "outlook_get_message", args: { id: "m1" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
});

test("outlook_summarize_message returns text", async () => {
  const r = await handleToolCall(deps(), { name: "outlook_summarize_message", args: { id: "m1" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.data, "summary text");
});

test("outlook tools fail closed when not connected", async () => {
  const r = await handleToolCall(deps({ connectionState: () => "disconnected" }), { name: "outlook_search_messages", args: { query: "q" }, sessionId: "s", requestId: "r" });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error.kind, "not_connected");
});
