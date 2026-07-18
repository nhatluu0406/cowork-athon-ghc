import { test } from "node:test";
import assert from "node:assert/strict";
import { createHttpGraphClient } from "../src/ms365/graph-client.js";
import { createSsrfPolicy, type ResolvedAddress } from "../src/provider/index.js";
import { Ms365Error } from "../src/ms365/ms365-errors.js";

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
    await client.json({ method: "GET", path: "/me" });
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

  await client.json({ method: "GET", path: "/sites" });

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

  const result = await client.json<typeof mockData>({ method: "GET", path: "/me" });

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

  const result = await client.bytes({ method: "GET", path: "/me/photo/$value" });

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

  await client.json({ method: "GET", path: "/me", query: { $select: "displayName,mail" } });

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
    await client.json({ method: "GET", path: "/me" });
    assert.fail("Expected Ms365Error");
  } catch (error) {
    assert(error instanceof Ms365Error, "Should throw Ms365Error on non-2xx");
    assert.equal(error.kind, "auth_expired", "Should map 401 to auth_expired");
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

  await client.json({ method: "GET", path: "/me" });

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

  await client.json({ method: "GET", path: "/me" });

  assert.equal(capturedUrl, "https://graph.microsoft.com/beta/me", "Should use custom baseUrl");
});

test("GraphClient: token must not be logged", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const capturedLogs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    capturedLogs.push(String(args.join(" ")));
  };

  try {
    const client = createHttpGraphClient({
      ssrf,
      getToken: () => Promise.resolve("secret-token-12345"),
      fetchFn: async () => new Response(JSON.stringify({}), { status: 200 }),
    });

    await client.json({ method: "GET", path: "/me" });

    const logContent = capturedLogs.join("\n");
    assert.ok(!logContent.includes("secret-token"), "Token must never appear in logs");
  } finally {
    console.log = originalLog;
  }
});

test("GraphClient: json body sends content-type application/json and serialized payload", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  let capturedContentType = "";
  let capturedBody = "";
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async (url: string | URL, init?: RequestInit) => {
      capturedContentType = init?.headers && typeof init.headers === "object" ? String((init.headers as Record<string, string>)["content-type"]) : "";
      capturedBody = String(init?.body ?? "");
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });

  const payload = { displayName: "New Site" };
  await client.json({ method: "POST", path: "/sites", body: payload });

  assert.equal(capturedContentType, "application/json", "Should set content-type to application/json");
  assert.equal(capturedBody, JSON.stringify(payload), "Should serialize the body payload as JSON");
});

test("GraphClient: bodyBytes sends content-type application/octet-stream and raw bytes", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  let capturedContentType = "";
  let capturedBody: unknown;
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async (url: string | URL, init?: RequestInit) => {
      capturedContentType = init?.headers && typeof init.headers === "object" ? String((init.headers as Record<string, string>)["content-type"]) : "";
      capturedBody = init?.body;
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });

  await client.json({ method: "PUT", path: "/sites/contoso/drive/root:/file.bin:/content", bodyBytes: bytes });

  assert.equal(capturedContentType, "application/octet-stream", "Should set content-type to application/octet-stream");
  assert(capturedBody instanceof Uint8Array, "Body should be passed through as raw bytes");
  assert.deepEqual(Array.from(capturedBody), Array.from(bytes), "Raw bytes should be passed through unchanged");
});

test("GraphClient: 429 response maps to rate_limited via mapGraphStatus", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async () => new Response("Too Many Requests", { status: 429, headers: { "retry-after": "3" } }),
  });

  try {
    await client.json({ method: "GET", path: "/me" });
    assert.fail("Expected Ms365Error");
  } catch (error) {
    assert(error instanceof Ms365Error, "Should throw Ms365Error on 429");
    assert.equal(error.kind, "rate_limited", "Should map 429 to rate_limited");
    assert.equal(error.retryAfterMs, 3000, "Should propagate retry-after in milliseconds");
  }
});

test("GraphClient: PATCH via noContent sends If-Match header from ifMatch", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const calls: Array<{ url: string | URL; init?: RequestInit }> = [];
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async (url: string | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    },
  });

  await client.noContent({ method: "PATCH", path: "/planner/tasks/t1", ifMatch: 'W/"etag1"', body: { title: "x" } });

  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal((calls[0].init?.headers as Record<string, string>)["if-match"], 'W/"etag1"');
});

test("GraphClient: DELETE via noContent accepts a 204 empty body", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async () => new Response(null, { status: 204 }),
  });

  await client.noContent({ method: "DELETE", path: "/planner/tasks/t1", ifMatch: 'W/"e"' });
  // Should not throw.
});

test("GraphClient: existing json() GET behaviour unchanged (no if-match header when ifMatch absent)", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const calls: Array<{ url: string | URL; init?: RequestInit }> = [];
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async (url: string | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });

  await client.json({ method: "GET", path: "/me" });

  assert.equal((calls[0].init?.headers as Record<string, string>)["if-match"], undefined);
});

test("GraphClient: prefer field is sent as the prefer header through the single send path", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const calls: Array<{ url: string | URL; init?: RequestInit }> = [];
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async (url: string | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    },
  });

  await client.json({
    method: "GET",
    path: "/sites/s/lists/l/items",
    prefer: "HonorNonIndexedQueriesWarningMayFailRandomly",
  });

  assert.equal((calls[0].init?.headers as Record<string, string>)["prefer"], "HonorNonIndexedQueriesWarningMayFailRandomly");
});

test("GraphClient: no prefer field -> no prefer header", async () => {
  const allowedHosts = new Set(["graph.microsoft.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  const calls: Array<{ url: string | URL; init?: RequestInit }> = [];
  const client = createHttpGraphClient({
    ssrf,
    getToken: () => Promise.resolve("token"),
    fetchFn: async (url: string | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({}), { status: 200 });
    },
  });

  await client.json({ method: "GET", path: "/me" });

  assert.equal((calls[0].init?.headers as Record<string, string>)["prefer"], undefined);
});

test("GraphClient: non-allowlisted baseUrl host is blocked before fetch is called", async () => {
  const allowedHosts = new Set(["evil.example.com"]);
  const ssrf = createTestSsrf(allowedHosts);

  let fetchCalled = false;
  let client: ReturnType<typeof createHttpGraphClient> | undefined;

  try {
    client = createHttpGraphClient({
      ssrf,
      getToken: () => Promise.resolve("token"),
      baseUrl: "https://evil.example.com/v1.0",
      fetchFn: async () => {
        fetchCalled = true;
        return new Response("OK", { status: 200 });
      },
    });
    if (client) {
      await client.json({ method: "GET", path: "/me" });
    }
    assert.fail("Expected endpoint_blocked error");
  } catch (error) {
    assert(error instanceof Ms365Error, "Should throw Ms365Error");
    assert.equal(error.kind, "endpoint_blocked", "Should map to endpoint_blocked");
  }

  assert.equal(fetchCalled, false, "fetch must not be called when host is blocked");
});
