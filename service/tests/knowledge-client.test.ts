/**
 * T1.1 Contract test for KnowledgeSourceClient (m365kg-client.ts).
 *
 * Validates the REST client against the M365KG backend contract:
 * - R1: Successful query with citations
 * - R2: 401 triggers refresh-then-retry (only once)
 * - Unavailable backend, network errors, malformed responses
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createM365KgClient } from "../src/knowledge/m365kg-client.js";

/** Fake fetch for testing; records calls and returns configured responses. */
function createFakeFetch() {
  const calls: { readonly url: string; readonly init: RequestInit }[] = [];
  let responses: { status: number; body?: unknown }[] = [];

  const fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init: init ?? {} });
    const response = responses[calls.length - 1];
    if (!response) {
      throw new Error("Unexpected fetch call (no response configured)");
    }
    return {
      status: response.status,
      json: async () => response.body ?? {},
      text: async () => JSON.stringify(response.body ?? {}),
    } as Response;
  };

  return {
    fetch: fetch as typeof window.fetch,
    calls,
    enqueue: (status: number, body?: unknown) => {
      responses.push({ status, body });
    },
  };
}

test("T1.1a: query succeeds and maps citations", async () => {
  const fakeHttp = createFakeFetch();
  fakeHttp.enqueue(200, {
    answer: "The answer is 42",
    entities: [
      { id: "p1", type: "Person", name: "Alice" },
      { id: "proj1", type: "Project", name: "Project X" },
    ],
    sources: [{ chunk_id: 1, file_name: "doc.md", heading_path: "§2" }],
  });

  const client = createM365KgClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "test-token",
    fetch: fakeHttp.fetch,
  });

  const result = await client.query("What is the answer?");
  assert.deepEqual(result.outcome, "answered");
  assert.equal((result as any).answer, "The answer is 42");
  assert.equal((result as any).citations.length, 3);
  assert.equal(fakeHttp.calls.length, 1);
  assert.ok(fakeHttp.calls[0].init.headers?.["authorization"]?.includes("Bearer test-token"));
});

test("T1.1b: 401 triggers refresh-then-retry (R2)", async () => {
  const fakeHttp = createFakeFetch();
  // First call: 401
  fakeHttp.enqueue(401, { error: "Unauthorized" });
  // Refresh call: 200 with new token
  fakeHttp.enqueue(200, { access_token: "refreshed-token", expires_in: 3600 });
  // Retry: 200 with answer
  fakeHttp.enqueue(200, {
    answer: "Refreshed answer",
    entities: [],
    sources: [],
  });

  const client = createM365KgClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "original-token",
    fetch: fakeHttp.fetch,
  });

  const result = await client.query("test");
  assert.deepEqual(result.outcome, "answered");

  // Should have made 3 calls: query (401), refresh, query retry
  assert.equal(fakeHttp.calls.length, 3);
  // First call: query with original token
  assert.ok(fakeHttp.calls[0].url.includes("/api/knowledge/query"));
  // Second call: refresh (no bearer header)
  assert.ok(fakeHttp.calls[1].url.includes("/api/auth/token/refresh"));
  // Third call: retry with refreshed token
  assert.ok(fakeHttp.calls[2].url.includes("/api/knowledge/query"));
});

test("T1.1c: 401 after refresh still fails (no infinite retry)", async () => {
  const fakeHttp = createFakeFetch();
  // First query: 401
  fakeHttp.enqueue(401, {});
  // Refresh: also returns 401 or failure
  fakeHttp.enqueue(401, {});

  const client = createM365KgClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "bad-token",
    fetch: fakeHttp.fetch,
  });

  const result = await client.query("test");
  assert.deepEqual(result.outcome, "auth_failed");
  // Exactly 2 calls: query, refresh (no second retry after refresh failure)
  assert.equal(fakeHttp.calls.length, 2);
});

test("T1.1d: network error returns unavailable", async () => {
  const client = createM365KgClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "test-token",
    fetch: async () => {
      throw new Error("Network is down");
    },
  });

  const result = await client.query("test");
  assert.deepEqual(result.outcome, "unavailable");
});

test("T1.1e: getGraph truncates results at KNOWLEDGE_PANEL_MAX_NODES", async () => {
  const fakeHttp = createFakeFetch();
  // Create 60 nodes (should be truncated at 50)
  const nodes = Array.from({ length: 60 }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
    properties: {},
  }));
  const edges = [
    { from: "n0", to: "n1", type: "links" },
    { from: "n49", to: "n50", type: "links" }, // This edge should be filtered out (n50 not in kept set)
  ];

  // Note: getGraph makes two separate rawCall requests, each returning its own body
  fakeHttp.enqueue(200, nodes);  // First call returns the array of nodes directly
  fakeHttp.enqueue(200, edges);  // Second call returns the array of edges directly

  const client = createM365KgClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "test-token",
    fetch: fakeHttp.fetch,
  });

  const result = await client.getGraph();
  assert.equal((result as any).nodes.length, 50);
  assert.equal((result as any).truncated, true);
  // Only edges between kept nodes should be returned (the edge to n50 is filtered)
  assert.equal((result as any).edges.length, 1);
});

test("T1.1f: checkHealth returns auth_failed on 401", async () => {
  const fakeHttp = createFakeFetch();
  fakeHttp.enqueue(401, {});

  const client = createM365KgClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "bad-token",
    fetch: fakeHttp.fetch,
  });

  const health = await client.checkHealth();
  assert.equal(health, "auth_failed");
});

test("T1.1g: refreshToken succeeds with valid refresh token", async () => {
  const fakeHttp = createFakeFetch();
  fakeHttp.enqueue(200, {
    access_token: "new-access-token",
    expires_in: 3600,
  });

  const client = createM365KgClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "refresh-token",
    fetch: fakeHttp.fetch,
  });

  const success = await client.refreshToken();
  assert.equal(success, true);
});

test("T1.1h: refreshToken fails when no token stored", async () => {
  const client = createM365KgClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => null, // No token
    fetch: async () => ({ status: 200 } as Response),
  });

  const success = await client.refreshToken();
  assert.equal(success, false);
});
