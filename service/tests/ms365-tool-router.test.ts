/**
 * Dispatch-level tests for the MS365 tool router (Task 9). Verifies the load-bearing
 * security guarantee: a SharePoint upload runs ONLY behind a recorded Allow on the real
 * PermissionGate — with no Allow, `proceed` returns not_allowed and the upload never runs.
 * Reads run directly when connected; a disconnected connector fails closed (no throw); bad
 * args are rejected as invalid_input. NO live network / LLM call, NO real timers.
 *
 * The brief's "upload with an Allow proceeds" case is intentionally DROPPED: submitting then
 * resolving in the same tick to make proceed observe the Allow is racy as a unit test. The
 * deterministic guarantee kept here is "upload without an Allow is blocked".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { SharePointHit, SharePointService } from "../src/ms365/sharepoint-service.js";
import { handleToolCall, type ToolResult } from "../src/ms365/ms365-tools.js";
import { createPermissionGate, createInMemoryAuditSink } from "../src/permission/index.js";
import type { PermissionGate } from "../src/permission/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";
import type { RouteContext } from "../src/boundary/contract.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";
import { createMs365Router, MS365_CONNECT_PATH, MS365_TOOL_CALL_PATH, MS365_VIEW_PATH } from "../src/ms365/index.js";
import { createMs365SessionScope } from "../src/ms365/ms365-session-scope.js";

function gateFixture(): PermissionGate {
  const time = createFakeTime();
  return createPermissionGate({
    reply: recordingReplyPort(),
    audit: createInMemoryAuditSink(),
    session: recordingDenialSink(),
    scheduler: { schedule: () => ({}) as never, cancel: () => {} },
    timeoutMs: 1000,
    now: time.now,
  });
}

/** A SharePoint fake that records whether `upload` was ever invoked. */
function recordingSharePoint(): SharePointService & { uploadCalls: number } {
  const state = { uploadCalls: 0 };
  const hit: SharePointHit = { id: "1", name: "A", webUrl: "u" };
  return {
    uploadCalls: 0,
    async search(): Promise<SharePointHit[]> {
      return [hit];
    },
    async listSiteFiles(): Promise<SharePointHit[]> {
      return [];
    },
    async getFileSummaryText(): Promise<string> {
      return "text";
    },
    async upload(): Promise<{ id: string; webUrl: string }> {
      state.uploadCalls += 1;
      this.uploadCalls += 1;
      return { id: "up", webUrl: "u" };
    },
  };
}

function errorKind(res: ToolResult): string {
  assert.equal(res.ok, false);
  return (res as Extract<ToolResult, { ok: false }>).error.kind;
}

test("read tool runs directly when connected", async () => {
  const res = await handleToolCall(
    { sharepoint: recordingSharePoint(), connectionState: () => "connected", gate: gateFixture(), now: () => "t", writeMode: () => "manual" as const, sessionAllowed: () => true },
    { name: "sharepoint_search", args: { query: "x" }, sessionId: "s", requestId: "r1" },
  );
  assert.equal(res.ok, true);
});

test("not connected → not_connected error, no throw", async () => {
  const res = await handleToolCall(
    { sharepoint: recordingSharePoint(), connectionState: () => "disconnected", gate: gateFixture(), now: () => "t", writeMode: () => "manual" as const, sessionAllowed: () => true },
    { name: "sharepoint_search", args: { query: "x" }, sessionId: "s", requestId: "r2" },
  );
  assert.equal(errorKind(res), "not_connected");
});

test("upload without an Allow is blocked (proceed not_allowed → denied), upload never runs", async () => {
  const gate = gateFixture();
  const sp = recordingSharePoint();
  const res = await handleToolCall(
    {
      sharepoint: sp,
      connectionState: () => "connected",
      gate,
      now: () => "t",
      writeMode: () => "manual" as const,
      sessionAllowed: () => true,
      // Real gate never resolved for this requestId → awaitGateDecision's first poll already
      // finds it out of `pending()` (never submitted-and-left-pending across a real tick), so
      // an instant wait keeps this test synchronous instead of paying the real 1s fail-closed
      // timeout window.
      wait: () => Promise.resolve(),
    },
    {
      name: "sharepoint_upload_file",
      args: { siteId: "S", relativeLocalPath: "n.txt", targetName: "n.txt" },
      sessionId: "s",
      requestId: "r3",
    },
  );
  // No resolve() Allow was recorded, so proceed blocks — the mutation must not have run.
  assert.equal(errorKind(res), "denied");
  assert.equal(sp.uploadCalls, 0);
});

test("invalid args → invalid_input (missing query)", async () => {
  const res = await handleToolCall(
    { sharepoint: recordingSharePoint(), connectionState: () => "connected", gate: gateFixture(), now: () => "t", writeMode: () => "manual" as const, sessionAllowed: () => true },
    { name: "sharepoint_search", args: {}, sessionId: "s", requestId: "r4" },
  );
  assert.equal(errorKind(res), "invalid_input");
});

test("invalid args → invalid_input (upload missing targetName)", async () => {
  const sp = recordingSharePoint();
  const res = await handleToolCall(
    { sharepoint: sp, connectionState: () => "connected", gate: gateFixture(), now: () => "t", writeMode: () => "manual" as const, sessionAllowed: () => true },
    {
      name: "sharepoint_upload_file",
      args: { siteId: "S", relativeLocalPath: "n.txt" },
      sessionId: "s",
      requestId: "r5",
    },
  );
  assert.equal(errorKind(res), "invalid_input");
  assert.equal(sp.uploadCalls, 0);
});

// ---- Router-shape tests (Task 10) -------------------------------------------

function ctx(method: RouteContext["method"], path: string, body?: unknown): RouteContext {
  return { method, url: new URL(`http://127.0.0.1${path}`), params: {}, body };
}

function fakeConnector(overrides?: Partial<Ms365Connector>): Ms365Connector {
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
    ...overrides,
  };
}

function fakeSiteScope() {
  return {
    listJoinedSites: async () => [],
    setSiteEnabled: async () => {},
    enabledSiteIds: () => [],
    isEnabled: () => true,
  };
}

function fakeWriteMode() {
  return { mode: () => "manual" as const, setMode: async () => {} };
}

function fakeSessionScope() {
  return createMs365SessionScope();
}

function router(overrides?: Partial<Ms365Connector>) {
  return createMs365Router({
    tools: { sharepoint: recordingSharePoint(), connectionState: () => "connected", gate: gateFixture(), now: () => "t", writeMode: () => "manual" as const, sessionAllowed: () => true },
    connector: fakeConnector(overrides),
    scopes: ["Sites.Read.All"],
    siteScope: fakeSiteScope(),
    writeMode: fakeWriteMode(),
    sessionScope: fakeSessionScope(),
  });
}

test("router is token-guarded and mounts the tool-call route", () => {
  const r = router();
  assert.equal(r.name, "ms365");
  for (const route of r.routes) {
    assert.notEqual((route as { publicUnauthenticated?: true }).publicUnauthenticated, true);
  }
  assert.ok(r.routes.some((route) => "path" in route && route.path === MS365_TOOL_CALL_PATH));
});

test("GET view returns the view data", async () => {
  const r = router();
  const route = r.routes.find((route) => route.method === "GET" && "path" in route && route.path === MS365_VIEW_PATH);
  assert.ok(route && "handler" in route);
  const result = await route.handler(ctx("GET", MS365_VIEW_PATH));
  assert.equal(result.status, 200);
  const data = result.data as { connectionState: string };
  assert.equal(data.connectionState, "connected");
});

test("POST connect with a missing token → status 400", async () => {
  const r = router();
  const route = r.routes.find((route) => route.method === "POST" && "path" in route && route.path === MS365_CONNECT_PATH);
  assert.ok(route && "handler" in route);
  await assert.rejects(() => route.handler(ctx("POST", MS365_CONNECT_PATH, {})));
});

test("POST connect with a valid token connects and returns the fresh view", async () => {
  let connected: string | null = null;
  const r = router({
    connectWithToken: async (token: string) => {
      connected = token;
    },
  });
  const route = r.routes.find((route) => route.method === "POST" && "path" in route && route.path === MS365_CONNECT_PATH);
  assert.ok(route && "handler" in route);
  const result = await route.handler(ctx("POST", MS365_CONNECT_PATH, { token: "abc" }));
  assert.equal(result.status, 200);
  assert.equal(connected, "abc");
});

test("POST tool-call with an invalid body (bad tool name) → status 400", async () => {
  const r = router();
  const route = r.routes.find((route) => route.method === "POST" && "path" in route && route.path === MS365_TOOL_CALL_PATH);
  assert.ok(route && "handler" in route);
  await assert.rejects(() =>
    route.handler(
      ctx("POST", MS365_TOOL_CALL_PATH, {
        name: "not_a_real_tool",
        args: {},
        sessionId: "s",
        requestId: "r",
      }),
    ),
  );
});

test("POST tool-call with a valid read call dispatches through handleToolCall", async () => {
  const r = router();
  const route = r.routes.find((route) => route.method === "POST" && "path" in route && route.path === MS365_TOOL_CALL_PATH);
  assert.ok(route && "handler" in route);
  const result = await route.handler(
    ctx("POST", MS365_TOOL_CALL_PATH, {
      name: "sharepoint_search",
      args: { query: "x" },
      sessionId: "s",
      requestId: "r",
    }),
  );
  assert.equal(result.status, 200);
  const data = result.data as ToolResult;
  assert.equal(data.ok, true);
});
