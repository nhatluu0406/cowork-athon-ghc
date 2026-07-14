/**
 * `KnowledgeSourceClient` contract test (REQ-205 T1.1) against a MOCKED M365KG backend —
 * success, R3 timeout, R2 401→refresh→retry, and the permission-filtered-empty-result shape.
 * No live network call; `fetch` is injected (matches `runtime/opencode-client.ts`'s convention).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createM365KgClient,
  M365_KNOWLEDGE_QUERY_TIMEOUT_MS,
} from "../../src/knowledge/m365kg-client.js";

const BASE_URL = "http://127.0.0.1:8080";

interface FakeCall {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
}

/** Route table keyed by "METHOD path"; each entry is a queue of responses (consumed in order). */
function fakeFetch(
  routes: Record<string, readonly (() => Response | "hang")[]>,
  calls: FakeCall[],
): typeof fetch {
  const cursors: Record<string, number> = {};
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input as string | URL);
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, authorization: headers["authorization"] ?? null });
    const queue = routes[key];
    if (queue === undefined) throw new Error(`unexpected call: ${key}`);
    const i = cursors[key] ?? 0;
    cursors[key] = i + 1;
    const entry = queue[Math.min(i, queue.length - 1)];
    if (entry === undefined) throw new Error(`no more responses for ${key}`);
    const built = entry();
    if (built === "hang") {
      // Never resolves on its own; only the AbortSignal can end it (models a hung backend, R3).
      // A real hung socket would be an active handle keeping the event loop alive for the
      // client's own (unref'd) timeout to fire; this fake has no real I/O, so a REF'd keep-alive
      // timer stands in for that socket (cleared the instant the abort fires).
      return new Promise<Response>((_resolve, reject) => {
        const keepAlive = setTimeout(() => {}, 5_000);
        const signal = init?.signal;
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(keepAlive);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    }
    return built;
  }) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): () => Response {
  return () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("query(): success maps a 200 answer + sources/entities to answered + citations", async () => {
  const calls: FakeCall[] = [];
  const fetchImpl = fakeFetch(
    {
      "POST /api/knowledge/query": [
        jsonResponse(200, {
          answer: "Nguyễn Văn A là chuyên gia về Kubernetes.",
          sources: [{ chunk_id: 42, file_name: "k8s-guide.docx", heading_path: "Chapter 2" }],
          entities: [{ id: "person-1", type: "Person", name: "Nguyễn Văn A" }],
          intent: "find_expert",
          latency_ms: 120,
        }),
      ],
    },
    calls,
  );
  const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => "tok-abc", fetch: fetchImpl });

  const result = await client.query("Ai biết về Kubernetes?");
  assert.equal(result.outcome, "answered");
  if (result.outcome !== "answered") throw new Error("unreachable");
  assert.equal(result.answer, "Nguyễn Văn A là chuyên gia về Kubernetes.");
  assert.equal(result.citations.length, 2);
  assert.ok(result.citations.some((c) => c.entityType === "Person" && c.entityId === "person-1"));
  assert.ok(result.citations.some((c) => c.entityType === "Document" && c.entityId === "42"));
  assert.equal(calls[0]?.authorization, "Bearer tok-abc");
});

test("query(): permission-filtered-empty-result — 200 with no sources/entities stays answered, empty citations", async () => {
  const calls: FakeCall[] = [];
  const fetchImpl = fakeFetch(
    {
      "POST /api/knowledge/query": [
        jsonResponse(200, { answer: "Không tìm thấy thông tin phù hợp.", sources: [], entities: [] }),
      ],
    },
    calls,
  );
  const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => "tok-abc", fetch: fetchImpl });

  const result = await client.query("Thông tin bí mật của CEO?");
  assert.equal(result.outcome, "answered");
  if (result.outcome !== "answered") throw new Error("unreachable");
  assert.deepEqual(result.citations, []);
});

test("query(): R3 — a hung backend resolves to a clean timeout, not a hang or unhandled rejection", async () => {
  const calls: FakeCall[] = [];
  const fetchImpl = fakeFetch({ "POST /api/knowledge/query": [() => "hang"] }, calls);
  const client = createM365KgClient({
    baseUrl: BASE_URL,
    getToken: async () => "tok-abc",
    fetch: fetchImpl,
    timeoutMs: 25, // bounded for test speed; production default is M365_KNOWLEDGE_QUERY_TIMEOUT_MS
  });

  const result = await client.query("Câu hỏi chậm");
  assert.deepEqual(result, { outcome: "timeout" });
});

test("R3 constant: the production default is 35000ms", () => {
  assert.equal(M365_KNOWLEDGE_QUERY_TIMEOUT_MS, 35_000);
});

test("query(): R2 — a 401 triggers ONE refresh + ONE retry, then succeeds", async () => {
  const calls: FakeCall[] = [];
  const fetchImpl = fakeFetch(
    {
      "POST /api/knowledge/query": [
        jsonResponse(401, { error: "expired" }),
        jsonResponse(200, { answer: "OK sau khi làm mới token.", sources: [], entities: [] }),
      ],
      "POST /api/auth/token/refresh": [jsonResponse(200, { access_token: "tok-refreshed", expires_in: 3600 })],
    },
    calls,
  );
  const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => "tok-stale", fetch: fetchImpl });

  const result = await client.query("Câu hỏi cần refresh");
  assert.equal(result.outcome, "answered");
  const queryCalls = calls.filter((c) => c.path === "/api/knowledge/query");
  assert.equal(queryCalls.length, 2, "exactly one retry after refresh");
  assert.equal(queryCalls[0]?.authorization, "Bearer tok-stale");
  assert.equal(queryCalls[1]?.authorization, "Bearer tok-refreshed");
  const refreshCalls = calls.filter((c) => c.path === "/api/auth/token/refresh");
  assert.equal(refreshCalls.length, 1, "refresh is attempted exactly once");
});

test("query(): R2 — refresh succeeds but retry is STILL 401 -> auth_failed (no infinite retry)", async () => {
  const calls: FakeCall[] = [];
  const fetchImpl = fakeFetch(
    {
      "POST /api/knowledge/query": [jsonResponse(401, {}), jsonResponse(401, {})],
      "POST /api/auth/token/refresh": [jsonResponse(200, { access_token: "tok-refreshed" })],
    },
    calls,
  );
  const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => "tok-stale", fetch: fetchImpl });

  const result = await client.query("Vẫn hết hạn");
  assert.deepEqual(result, { outcome: "auth_failed" });
  assert.equal(calls.filter((c) => c.path === "/api/knowledge/query").length, 2);
  assert.equal(calls.filter((c) => c.path === "/api/auth/token/refresh").length, 1);
});

test("query(): R2 — refresh itself fails -> auth_failed without a second query attempt", async () => {
  const calls: FakeCall[] = [];
  const fetchImpl = fakeFetch(
    {
      "POST /api/knowledge/query": [jsonResponse(401, {})],
      "POST /api/auth/token/refresh": [jsonResponse(401, { error: "invalid refresh token" })],
    },
    calls,
  );
  const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => "tok-stale", fetch: fetchImpl });

  const result = await client.query("Refresh hỏng");
  assert.deepEqual(result, { outcome: "auth_failed" });
  assert.equal(calls.filter((c) => c.path === "/api/knowledge/query").length, 1, "no second attempt without a fresh token");
});

test("query(): a network error (no HTTP response at all) maps to unavailable, not a throw", async () => {
  const calls: FakeCall[] = [];
  const fetchImpl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  const client = createM365KgClient({ baseUrl: BASE_URL, getToken: async () => "tok-abc", fetch: fetchImpl });
  const result = await client.query("Backend is down");
  assert.deepEqual(result, { outcome: "unavailable" });
  void calls;
});

test("checkHealth(): 200 -> connected, non-2xx -> unreachable, 401-then-still-401 -> auth_failed", async () => {
  const calls1: FakeCall[] = [];
  const okClient = createM365KgClient({
    baseUrl: BASE_URL,
    getToken: async () => "tok",
    fetch: fakeFetch({ "GET /api/stats/overview": [jsonResponse(200, { documents: 1 })] }, calls1),
  });
  assert.equal(await okClient.checkHealth(), "connected");

  const calls2: FakeCall[] = [];
  const downClient = createM365KgClient({
    baseUrl: BASE_URL,
    getToken: async () => "tok",
    fetch: fakeFetch({ "GET /api/stats/overview": [jsonResponse(500, {})] }, calls2),
  });
  assert.equal(await downClient.checkHealth(), "unreachable");

  const calls3: FakeCall[] = [];
  const authFailClient = createM365KgClient({
    baseUrl: BASE_URL,
    getToken: async () => "tok",
    fetch: fakeFetch(
      {
        "GET /api/stats/overview": [jsonResponse(401, {}), jsonResponse(401, {})],
        "POST /api/auth/token/refresh": [jsonResponse(200, { access_token: "tok2" })],
      },
      calls3,
    ),
  });
  assert.equal(await authFailClient.checkHealth(), "auth_failed");
});

test("refreshToken(): reports success/failure without throwing", async () => {
  const calls: FakeCall[] = [];
  const ok = createM365KgClient({
    baseUrl: BASE_URL,
    getToken: async () => "tok",
    fetch: fakeFetch({ "POST /api/auth/token/refresh": [jsonResponse(200, { access_token: "new" })] }, calls),
  });
  assert.equal(await ok.refreshToken(), true);

  const fail = createM365KgClient({
    baseUrl: BASE_URL,
    getToken: async () => "tok",
    fetch: fakeFetch({ "POST /api/auth/token/refresh": [jsonResponse(401, {})] }, calls),
  });
  assert.equal(await fail.refreshToken(), false);
});

test("getGraph(): truncates nodes at KNOWLEDGE_PANEL_MAX_NODES and drops dangling edges (R4)", async () => {
  const calls: FakeCall[] = [];
  const nodes = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, label: "Person", properties: {} }));
  const edges = [
    { from: "n0", to: "n1", type: "KNOWS" },
    { from: "n0", to: "n59", type: "KNOWS" }, // n59 will be truncated away
  ];
  const client = createM365KgClient({
    baseUrl: BASE_URL,
    getToken: async () => "tok",
    fetch: fakeFetch(
      {
        "GET /api/graph/nodes": [jsonResponse(200, nodes)],
        "GET /api/graph/edges": [jsonResponse(200, edges)],
      },
      calls,
    ),
  });
  const result = await client.getGraph();
  assert.equal(result.nodes.length, 50);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.edges, [{ from: "n0", to: "n1", type: "KNOWS" }]);
});
