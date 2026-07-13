import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpGraphClient } from "../src/ms365/graph-client.js";
import { createSsrfPolicy, type ResolvedAddress } from "../src/provider/index.js";

function createTestSsrf(allowedHosts: Set<string>): ReturnType<typeof createSsrfPolicy> {
  return createSsrfPolicy({
    resolver: async (hostname: string) => {
      if (allowedHosts.has(hostname)) {
        return [{ address: "1.2.3.4", port: 443, family: 4 as const }];
      }
      // Return a private/blocked IP to trigger SSRF block
      return [{ address: "127.0.0.1", port: 443, family: 4 as const }];
    },
  });
}

test("GraphClient: SSRF validation before fetch", async () => {
  const allowedHosts = new Set<string>();
  const ssrf = createTestSsrf(allowedHosts);

  let fetchCalled = false;
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("mock-token"),
    fetchFn: async () => {
      fetchCalled = true;
      return new Response("OK", { status: 200 });
    },
  });

  try {
    await client.json({ path: "/me" });
    assert.fail("Expected SsrfBlockedError");
  } catch (error) {
    assert(error instanceof Error);
    assert(error.name === "SsrfBlockedError", "Should throw SsrfBlockedError");
  }

  assert.equal(fetchCalled, false, "fetch must not be called when SSRF blocks");
});

test("GraphClient: sets Authorization bearer token", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  let capturedAuth = "";
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("test-token-xyz"),
    fetchFn: async (url: string | URL, init?: RequestInit) => {
      capturedAuth = init?.headers && typeof init.headers === "object" ? String((init.headers as Record<string, string>).authorization) : "";
      return new Response(JSON.stringify({ value: [] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  await client.json({ path: "/sites" });

  assert.equal(capturedAuth, "Bearer test-token-xyz", "Authorization header must set Bearer token");
});

test("GraphClient: json<T>() with response parsing", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const mockData = { id: "user-123", displayName: "Test User" };
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async () => new Response(JSON.stringify(mockData), { status: 200, headers: { "content-type": "application/json" } }),
  });

  const result = await client.json<typeof mockData>({ path: "/me" });

  assert.deepEqual(result, mockData, "Should parse and return JSON response");
});

test("GraphClient: bytes() for binary responses", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async () => new Response(binaryData, { status: 200, headers: { "content-type": "image/png" } }),
  });

  const result = await client.bytes({ path: "/me/photo/$value" });

  assert(result instanceof Uint8Array, "Should return Uint8Array for bytes()");
  assert.deepEqual(Array.from(result), Array.from(binaryData), "Should return exact binary content");
});

test("GraphClient: query params in path", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  let capturedUrl = "";
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });

  await client.json({ path: "/me", query: { $select: "displayName,mail" } });

  // URLSearchParams encodes $ as %24, and commas as %2C
  assert(capturedUrl.includes("%24select="), "Query param should be URL-encoded");
  assert(capturedUrl.includes("displayName%2Cmail"), "Query value should be URL-encoded");
});

test("GraphClient: throws Ms365Error on non-2xx status", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async () => new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } }),
  });

  try {
    await client.json({ path: "/me" });
    assert.fail("Expected Ms365Error");
  } catch (error) {
    assert(error instanceof Error);
    assert.equal(error.name, "Ms365Error", "Should throw Ms365Error on non-2xx");
    assert.equal((error as any).kind, "auth_expired", "Should map 401 to auth_expired");
  }
});

test("GraphClient: default baseUrl is graph.microsoft.com/v1.0", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  let capturedUrl = "";
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });

  await client.json({ path: "/me" });

  assert.equal(capturedUrl, "https://graph.microsoft.com/v1.0/me", "Default baseUrl should be graph.microsoft.com/v1.0");
});

test("GraphClient: custom baseUrl", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  let capturedUrl = "";
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    baseUrl: "https://graph.microsoft.com/beta",
    fetchFn: async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });

  await client.json({ path: "/me" });

  assert.equal(capturedUrl, "https://graph.microsoft.com/beta/me", "Should use custom baseUrl");
});

test("GraphClient: token must not be logged", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    capturedLogs.push(String(args.join(" ")));
  };

  try {
    const client = createHttpGraphClient({
      ssrf,
      getToken: () => Promise.resolve("secret-token-12345"),
      fetchFn: async () => new Response(JSON.stringify({}), { status: 200 }),
    });

    await client.json({ path: "/me" });

    const logContent = capturedLogs.join("\n");
    assert.ok(!logContent.includes("secret-token"), "Token must never appear in logs");
  } finally {
    console.log = originalLog;
  }
});
