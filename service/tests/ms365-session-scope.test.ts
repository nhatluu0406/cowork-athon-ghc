/**
 * Session gating (P5.5 Task 5, PO decision 2026-07-14): ONLY sessions registered by the
 * Microsoft 365 tab may call MS365 tools. Covers the store itself (allow/revoke/isAllowed,
 * fail-closed default), the `handleToolCall` gate (checked BEFORE connectionState — 0 calls
 * downstream when blocked), and the `/v1/ms365/session-scope` route (parse/validate + real
 * register/revoke). The scoped tool-call token (Task 2) only ever passes `/v1/ms365/tool-call`,
 * so the child process cannot reach this route to self-register — proven at the boundary layer
 * in `ms365-scoped-token.test.ts`; this file focuses on the route's own parse/dispatch behavior.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createMs365SessionScope } from "../src/ms365/ms365-session-scope.js";
import { handleToolCall, type ToolDeps } from "../src/ms365/ms365-tools.js";
import {
  createMs365Router,
  MS365_SESSION_SCOPE_PATH,
  Ms365RouterRequestError,
  type Ms365RouterDeps,
} from "../src/ms365/ms365-tool-router.js";
import type { RouteContext } from "../src/boundary/contract.js";

function ctx(method: RouteContext["method"], path: string, body?: unknown): RouteContext {
  return { method, url: new URL(`http://127.0.0.1${path}`), params: {}, body };
}

// ---- Store ------------------------------------------------------------------

test("store: unknown session id is not allowed by default (fail-closed)", () => {
  const scope = createMs365SessionScope();
  assert.equal(scope.isAllowed("s1"), false);
});

test("store: allow() registers, isAllowed() reflects it", () => {
  const scope = createMs365SessionScope();
  scope.allow("s1");
  assert.equal(scope.isAllowed("s1"), true);
  assert.equal(scope.isAllowed("s2"), false);
});

test("store: revoke() removes registration", () => {
  const scope = createMs365SessionScope();
  scope.allow("s1");
  scope.revoke("s1");
  assert.equal(scope.isAllowed("s1"), false);
});

// ---- handleToolCall gate ------------------------------------------------------

function connectionStateSpy() {
  let calls = 0;
  return { calls: () => calls, fn: () => { calls += 1; return "connected" as const; } };
}

function baseDeps(overrides: Partial<ToolDeps> = {}): ToolDeps {
  const conn = connectionStateSpy();
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
    teams: {
      listChats: async () => [],
      listTeams: async () => [],
      listChannels: async () => [],
      listMembers: async () => [],
      getMessages: async () => [],
      postMessage: async () => ({ id: "msg1" }),
    },
    connectionState: conn.fn,
    gate: { submit: () => {}, proceed: () => ({ performed: false }) } as unknown as ToolDeps["gate"],
    now: () => "2026-07-14T00:00:00.000Z",
    writeMode: () => "manual" as const,
    sessionAllowed: () => true,
    ...overrides,
  };
}

test("handleToolCall: unregistered session -> session_not_allowed, BEFORE connectionState is even read", async () => {
  const conn = connectionStateSpy();
  const deps = baseDeps({ connectionState: conn.fn, sessionAllowed: () => false });
  const res = await handleToolCall(deps, {
    name: "sharepoint_search",
    args: { query: "x" },
    sessionId: "blocked-session",
    requestId: "r1",
  });
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.error.kind, "session_not_allowed");
  assert.equal(!res.ok && res.error.message, "Tool Microsoft 365 chỉ dùng được trong tab Microsoft 365.");
  assert.equal(!res.ok && res.error.recovery, "Mở tab Microsoft 365 và chat từ đó.");
  assert.equal(conn.calls(), 0, "connectionState must not be called when the session is blocked");
});

test("handleToolCall: registered session -> falls through to prior behavior (connected read runs)", async () => {
  const deps = baseDeps({ sessionAllowed: () => true });
  const res = await handleToolCall(deps, {
    name: "sharepoint_search",
    args: { query: "x" },
    sessionId: "allowed-session",
    requestId: "r2",
  });
  assert.equal(res.ok, true);
});

// ---- Route ---------------------------------------------------------------------

function fakeConnector(): Ms365RouterDeps["connector"] {
  return {
    connectionState: () => "connected",
    connectWithToken: async () => {},
    disconnect: async () => {},
    graph: () => ({ json: async () => ({}) as never, bytes: async () => new Uint8Array() }),
    source: () => "manual_token",
    lastError: () => null,
    beginDeviceCode: async () => ({ userCode: "x", verificationUri: "u", expiresInSec: 900 }),
    pollDeviceCode: async () => "pending",
    deviceConfigured: () => false,
    grantedScopes: () => [],
  } as unknown as Ms365RouterDeps["connector"];
}

function routerDeps(sessionScope = createMs365SessionScope()): Ms365RouterDeps {
  return {
    tools: baseDeps(),
    connector: fakeConnector(),
    scopes: [],
    siteScope: {
      listJoinedSites: async () => [],
      setSiteEnabled: async () => {},
      enabledSiteIds: () => [],
      isEnabled: () => true,
    },
    writeMode: { mode: () => "manual" as const, setMode: async () => {} },
    sessionScope,
  };
}

function findRoute(router: ReturnType<typeof createMs365Router>, method: string, path: string) {
  const route = router.routes.find((r) => r.method === method && r.path === path);
  assert.ok(route, `route ${method} ${path} must exist`);
  return route!;
}

test("POST /v1/ms365/session-scope with missing sessionId -> 400", async () => {
  const router = createMs365Router(routerDeps());
  const route = findRoute(router, "POST", MS365_SESSION_SCOPE_PATH);
  await assert.rejects(
    () => route.handler(ctx("POST", MS365_SESSION_SCOPE_PATH, { enabled: true })),
    Ms365RouterRequestError,
  );
});

test("POST /v1/ms365/session-scope with missing enabled -> 400", async () => {
  const router = createMs365Router(routerDeps());
  const route = findRoute(router, "POST", MS365_SESSION_SCOPE_PATH);
  await assert.rejects(
    () => route.handler(ctx("POST", MS365_SESSION_SCOPE_PATH, { sessionId: "s1" })),
    Ms365RouterRequestError,
  );
});

test("POST /v1/ms365/session-scope enabled=true registers the session", async () => {
  const scope = createMs365SessionScope();
  const router = createMs365Router(routerDeps(scope));
  const route = findRoute(router, "POST", MS365_SESSION_SCOPE_PATH);
  const result = await route.handler(ctx("POST", MS365_SESSION_SCOPE_PATH, { sessionId: "s1", enabled: true }));
  assert.deepEqual(result.data, { allowed: true });
  assert.equal(scope.isAllowed("s1"), true);
});

test("POST /v1/ms365/session-scope enabled=false revokes the session", async () => {
  const scope = createMs365SessionScope();
  scope.allow("s1");
  const router = createMs365Router(routerDeps(scope));
  const route = findRoute(router, "POST", MS365_SESSION_SCOPE_PATH);
  const result = await route.handler(ctx("POST", MS365_SESSION_SCOPE_PATH, { sessionId: "s1", enabled: false }));
  assert.deepEqual(result.data, { allowed: false });
  assert.equal(scope.isAllowed("s1"), false);
});
