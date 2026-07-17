/**
 * Task 4: `setMs365SessionScope` + `surface` forwarding on create/list conversation routes.
 *
 * Drives {@link createServiceClient} with a stubbed global `fetch` (matching the harness in
 * `service-client.test.ts`) — no real socket, no injected transport param (the real factory
 * takes only `(baseUrl, clientToken)`).
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_PROTOCOL_VERSION } from "@cowork-ghc/contracts";
import { createServiceClient } from "../src/service-client.js";

const BASE = "http://127.0.0.1:65535";
const TOKEN = "abcdef0123456789".repeat(4);

test("setMs365SessionScope POSTs sessionId+enabled to the scope route", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      json: async () => ({ protocol: BOUNDARY_PROTOCOL_VERSION, ok: true, data: { allowed: true } }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const client = createServiceClient(BASE, TOKEN);
    const res = await client.setMs365SessionScope("sess-1", true);
    assert.deepEqual(res, { allowed: true });
    const call = calls.find((c) => c.url.includes("/v1/ms365/session-scope"));
    assert.ok(call, "hit the scope route");
    assert.deepEqual(call!.body, { sessionId: "sess-1", enabled: true });
  } finally {
    globalThis.fetch = prev;
  }
});

test("createConversation forwards surface in the request body", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      json: async () => ({
        protocol: BOUNDARY_PROTOCOL_VERSION,
        ok: true,
        data: {
          conversation: {
            id: "c1",
            title: "t",
            workspacePath: "C:/fixture",
            runtimeSessionId: null,
            status: "draft",
            createdAt: "2026-07-16T00:00:00.000Z",
            updatedAt: "2026-07-16T00:00:00.000Z",
            messageCount: 0,
            surface: "ms365",
            messages: [],
          },
        },
      }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const client = createServiceClient(BASE, TOKEN);
    await client.createConversation({ workspacePath: "C:/fixture", surface: "ms365" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${BASE}/v1/conversations`);
    assert.deepEqual(calls[0]!.body, { workspacePath: "C:/fixture", surface: "ms365" });
  } finally {
    globalThis.fetch = prev;
  }
});

test("listConversations appends surface to the query string when provided", async () => {
  const calls: string[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      json: async () => ({ protocol: BOUNDARY_PROTOCOL_VERSION, ok: true, data: { conversations: [] } }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const client = createServiceClient(BASE, TOKEN);
    await client.listConversations(undefined, "cowork");
    assert.equal(calls.length, 1);
    assert.equal(calls[0], `${BASE}/v1/conversations?surface=cowork`);

    await client.listConversations("hello", "ms365");
    assert.equal(calls.length, 2);
    assert.equal(calls[1], `${BASE}/v1/conversations?q=hello&surface=ms365`);
  } finally {
    globalThis.fetch = prev;
  }
});

test("connectMs365 POSTs the token to /v1/ms365/connect and returns the view", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      json: async () => ({
        protocol: BOUNDARY_PROTOCOL_VERSION,
        ok: true,
        data: { connectionState: "connected", services: [], scopes: ["User.Read"], actionHistory: [] },
      }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const client = createServiceClient(BASE, TOKEN);
    const view = await client.connectMs365("eyJ.fake.token");
    assert.equal(view.connectionState, "connected");
    const call = calls.find((c) => c.url.includes("/v1/ms365/connect"));
    assert.ok(call, "hit the connect route");
    assert.deepEqual(call!.body, { token: "eyJ.fake.token" });
  } finally {
    globalThis.fetch = prev;
  }
});

test("disconnectMs365 POSTs to /v1/ms365/disconnect and returns the view", async () => {
  const calls: string[] = [];
  const prev = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return {
      json: async () => ({
        protocol: BOUNDARY_PROTOCOL_VERSION,
        ok: true,
        data: { connectionState: "disconnected", services: [], scopes: [], actionHistory: [] },
      }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const client = createServiceClient(BASE, TOKEN);
    const view = await client.disconnectMs365();
    assert.equal(view.connectionState, "disconnected");
    assert.ok(calls.some((u) => u.includes("/v1/ms365/disconnect")));
  } finally {
    globalThis.fetch = prev;
  }
});
