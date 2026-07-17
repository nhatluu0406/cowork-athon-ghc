/**
 * TDD tests for device-code begin/poll routes (Task 2). Verifies:
 * 1. begin route returns prompt when connector is configured
 * 2. begin route returns { error: "not_configured" } when not configured (200 not 400)
 * 3. poll route returns status with view when status is "connected"
 * 4. poll route returns status without view when pending/expired
 * 5. both routes are token-guarded
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import type { RouteContext } from "../src/boundary/contract.js";
import type { Ms365Connector } from "../src/ms365/ms365-connector.js";
import type { DeviceCodePrompt } from "../src/ms365/device-code-provider.js";
import {
  createMs365Router,
  MS365_DEVICE_BEGIN_PATH,
  MS365_DEVICE_POLL_PATH,
  MS365_DISCONNECT_PATH,
} from "../src/ms365/index.js";
import { createPermissionGate, createInMemoryAuditSink } from "../src/permission/index.js";
import type { PermissionGate } from "../src/permission/index.js";
import { createFakeTime, recordingDenialSink, recordingReplyPort } from "./permission-fakes.js";

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
    deviceConfigured: () => false,
    beginDeviceCode: async () => ({
      userCode: "ABC-1234",
      verificationUri: "https://microsoft.com/devicelogin",
      expiresInSec: 900,
    }),
    pollDeviceCode: async () => "pending",
    grantedScopes: () => [],
    ...overrides,
  };
}

function router(overrides?: Partial<Ms365Connector>) {
  return createMs365Router({
    tools: {
      sharepoint: {
        uploadCalls: 0,
        async search() {
          return [];
        },
        async listSiteFiles() {
          return [];
        },
        async getFileSummaryText() {
          return "";
        },
        async upload() {
          return { id: "", webUrl: "" };
        },
      },
      connectionState: () => "connected",
      gate: gateFixture(),
      now: () => "t",
    },
    connector: fakeConnector(overrides),
    scopes: ["Sites.Read.All"],
    siteScope: {
      listJoinedSites: async () => [],
      setSiteEnabled: async () => {},
      enabledSiteIds: () => [],
      isEnabled: () => true,
    },
    writeMode: { mode: () => "manual" as const, setMode: async () => {} },
  });
}

test("device/begin returns prompt when configured", async () => {
  const prompt: DeviceCodePrompt = {
    userCode: "ABC-1234",
    verificationUri: "https://microsoft.com/devicelogin",
    expiresInSec: 900,
  };
  const r = router({
    deviceConfigured: () => true,
    beginDeviceCode: async () => prompt,
  });
  const route = r.routes.find((route) => "path" in route && route.path === MS365_DEVICE_BEGIN_PATH);
  assert.ok(route && "handler" in route);
  const result = await route.handler(ctx("POST", MS365_DEVICE_BEGIN_PATH, {}));
  assert.equal(result.status, 200);
  const data = result.data as { userCode?: string; error?: string };
  assert.equal(data.userCode, "ABC-1234");
  assert.equal(data.verificationUri, "https://microsoft.com/devicelogin");
  assert.equal(data.expiresInSec, 900);
  assert.equal(data.error, undefined);
});

test("device/begin returns { error: 'not_configured' } when not configured (200 not 400)", async () => {
  const r = router({
    deviceConfigured: () => false,
  });
  const route = r.routes.find((route) => "path" in route && route.path === MS365_DEVICE_BEGIN_PATH);
  assert.ok(route && "handler" in route);
  const result = await route.handler(ctx("POST", MS365_DEVICE_BEGIN_PATH, {}));
  assert.equal(result.status, 200);
  const data = result.data as { error?: string; userCode?: string };
  assert.equal(data.error, "not_configured");
  assert.equal(data.userCode, undefined);
});

test("device/poll returns { status, view } when connected", async () => {
  const r = router({
    pollDeviceCode: async () => "connected",
  });
  const route = r.routes.find((route) => "path" in route && route.path === MS365_DEVICE_POLL_PATH);
  assert.ok(route && "handler" in route);
  const result = await route.handler(ctx("POST", MS365_DEVICE_POLL_PATH, {}));
  assert.equal(result.status, 200);
  const data = result.data as { status?: string; view?: object };
  assert.equal(data.status, "connected");
  assert.ok(data.view !== undefined);
});

test("device/poll returns { status } when pending", async () => {
  const r = router({
    pollDeviceCode: async () => "pending",
  });
  const route = r.routes.find((route) => "path" in route && route.path === MS365_DEVICE_POLL_PATH);
  assert.ok(route && "handler" in route);
  const result = await route.handler(ctx("POST", MS365_DEVICE_POLL_PATH, {}));
  assert.equal(result.status, 200);
  const data = result.data as { status?: string; view?: object };
  assert.equal(data.status, "pending");
  assert.equal(data.view, undefined);
});

test("device/poll returns { status } when expired", async () => {
  const r = router({
    pollDeviceCode: async () => "expired",
  });
  const route = r.routes.find((route) => "path" in route && route.path === MS365_DEVICE_POLL_PATH);
  assert.ok(route && "handler" in route);
  const result = await route.handler(ctx("POST", MS365_DEVICE_POLL_PATH, {}));
  assert.equal(result.status, 200);
  const data = result.data as { status?: string; view?: object };
  assert.equal(data.status, "expired");
  assert.equal(data.view, undefined);
});

test("device/begin and device/poll routes are token-guarded", () => {
  const r = router();
  assert.equal(r.name, "ms365");
  for (const route of r.routes) {
    if ("path" in route && (route.path === MS365_DEVICE_BEGIN_PATH || route.path === MS365_DEVICE_POLL_PATH)) {
      assert.notEqual((route as { publicUnauthenticated?: true }).publicUnauthenticated, true);
    }
  }
});

test("disconnect route calls connector.disconnect and returns the fresh view", async () => {
  let disconnectCalled = false;
  const r = router({
    connectionState: () => (disconnectCalled ? "disconnected" : "connected"),
    disconnect: async () => {
      disconnectCalled = true;
    },
  });
  const route = r.routes.find((rt) => "path" in rt && rt.path === MS365_DISCONNECT_PATH);
  assert.ok(route && "handler" in route);
  const res = (await route.handler(ctx("POST", MS365_DISCONNECT_PATH, {}))) as {
    status: number;
    data: { connectionState: string };
  };
  assert.equal(disconnectCalled, true);
  assert.equal(res.status, 200);
  assert.equal(res.data.connectionState, "disconnected");
});

test("disconnect route is token-guarded", () => {
  const r = router();
  const route = r.routes.find((rt) => "path" in rt && rt.path === MS365_DISCONNECT_PATH);
  assert.ok(route);
  assert.notEqual((route as { publicUnauthenticated?: true }).publicUnauthenticated, true);
});
