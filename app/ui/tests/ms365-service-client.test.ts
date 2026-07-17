/**
 * MS365 service-client methods test (Task 4: MS365 UI wiring + device-code, D2 slice 2).
 *
 * Tests the four typed methods that call the MS365 routes:
 * - connectMs365Token: POST /v1/ms365/connect with token
 * - fetchMs365View: GET /v1/ms365/view
 * - beginMs365Device: POST /v1/ms365/device/begin
 * - pollMs365Device: POST /v1/ms365/device/poll
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_PROTOCOL_VERSION } from "@cowork-ghc/contracts";
import { createServiceClient } from "../src/service-client.js";

const BASE = "http://127.0.0.1:9";
const TOKEN = "test-token";

/** Stub fetch to return a canned response for a specific route. */
function stubFetch(routes: Record<string, unknown>) {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string, init?: { method?: string }) => {
    const path = new URL(url).pathname;
    seen.push(`${init?.method ?? "GET"} ${path}`);
    return {
      json: async () => ({
        protocol: BOUNDARY_PROTOCOL_VERSION,
        ok: true,
        data: routes[path],
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return seen;
}

test("beginMs365Device posts to device/begin and returns prompt", async () => {
  const seen = stubFetch({
    "/v1/ms365/device/begin": {
      userCode: "AB",
      verificationUri: "u",
      expiresInSec: 900,
    },
  });
  const client = createServiceClient(BASE, TOKEN);
  const r = await client.beginMs365Device();
  assert.deepEqual(r, {
    userCode: "AB",
    verificationUri: "u",
    expiresInSec: 900,
  });
  assert.ok(seen.includes("POST /v1/ms365/device/begin"));
});

test("pollMs365Device returns status", async () => {
  stubFetch({ "/v1/ms365/device/poll": { status: "pending" } });
  const client = createServiceClient(BASE, TOKEN);
  assert.deepEqual(await client.pollMs365Device(), { status: "pending" });
});

test("connectMs365Token posts token to connect route", async () => {
  const seen = stubFetch({
    "/v1/ms365/connect": {
      connectionState: "token_provided",
      services: [],
      scopes: [],
      actionHistory: [],
    },
  });
  const client = createServiceClient(BASE, TOKEN);
  const result = await client.connectMs365Token("mytoken");
  assert.equal(result.connectionState, "token_provided");
  assert.ok(seen.includes("POST /v1/ms365/connect"));
});

test("fetchMs365View gets current view", async () => {
  stubFetch({
    "/v1/ms365/view": {
      connectionState: "connected",
      services: [
        {
          id: "teams",
          label: "Teams",
          connected: true,
        },
      ],
      scopes: ["files"],
      actionHistory: [],
    },
  });
  const client = createServiceClient(BASE, TOKEN);
  const result = await client.fetchMs365View();
  assert.equal(result.connectionState, "connected");
  assert.equal(result.services.length, 1);
  assert.equal(result.services[0]?.id, "teams");
});

test("listMs365Sites GETs /v1/ms365/sites and returns sites", async () => {
  const seen = stubFetch({
    "/v1/ms365/sites": {
      sites: [{ id: "s1", displayName: "A", webUrl: "u", enabled: true }],
    },
  });
  const client = createServiceClient(BASE, TOKEN);
  const sites = await client.listMs365Sites();
  assert.equal(sites.length, 1);
  assert.equal(sites[0]?.id, "s1");
  assert.ok(seen.includes("GET /v1/ms365/sites"));
});

test("setMs365SiteEnabled POSTs the toggle body", async () => {
  const seen = stubFetch({
    "/v1/ms365/sites/toggle": { sites: [] },
  });
  let capturedBody: string | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    capturedBody = init?.body;
    return (originalFetch as unknown as (u: string, i?: unknown) => Promise<Response>)(url, init);
  }) as unknown as typeof fetch;
  const client = createServiceClient(BASE, TOKEN);
  await client.setMs365SiteEnabled("s1", false);
  assert.ok(seen.includes("POST /v1/ms365/sites/toggle"));
  assert.deepEqual(JSON.parse(String(capturedBody)), { siteId: "s1", enabled: false });
});
