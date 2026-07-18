/**
 * `/v1/knowledge/*` router test (REQ-205 T1.2) — each route's happy path plus the
 * `not_configured` / `unreachable` / `auth_failed` status branches. Routes are invoked
 * directly via `router.routes.find(...).handler(ctx)`, matching
 * `provider-test-connection-route.test.ts`'s lightweight convention (no real HTTP socket
 * needed to exercise route logic).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RouteContext } from "../../src/boundary/contract.js";
import { createCredentialService, createMemoryStore } from "../../src/credential/index.js";
import { createKnowledgeSourceConfigStore } from "../../src/knowledge/store.js";
import { createKnowledgeService } from "../../src/knowledge/knowledge-service.js";
import {
  createKnowledgeRouter,
  KNOWLEDGE_STATUS_PATH,
  KNOWLEDGE_CONFIGURE_PATH,
  KNOWLEDGE_TEST_CONNECTION_PATH,
  KNOWLEDGE_CONNECTION_PATH,
  KNOWLEDGE_QUERY_PATH,
  KNOWLEDGE_GRAPH_PATH,
} from "../../src/knowledge/router.js";
import type { KnowledgeSourceClient } from "../../src/knowledge/m365kg-client.js";
import type { KnowledgeHealthStatus, KnowledgeQueryOutcome } from "../../src/knowledge/types.js";

const TOKEN = "m365kg-router-DO-NOT-LEAK-token";

function ctx(method: RouteContext["method"], path: string, body?: unknown, search?: string): RouteContext {
  return {
    method,
    url: new URL(`http://127.0.0.1${path}${search ?? ""}`),
    params: {},
    body,
  };
}

interface Harness {
  readonly router: ReturnType<typeof createKnowledgeRouter>;
  readonly dir: string;
  setHealth(status: KnowledgeHealthStatus): void;
  setQueryOutcome(outcome: KnowledgeQueryOutcome): void;
}

async function buildHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "cghc-knowledge-"));
  const configStore = createKnowledgeSourceConfigStore({ filePath: join(dir, "knowledge-source.json") });
  const credentialService = createCredentialService({ store: createMemoryStore() });

  let health: KnowledgeHealthStatus = "connected";
  let queryOutcome: KnowledgeQueryOutcome = { outcome: "answered", answer: "OK", citations: [], syncedAt: null };

  const fakeClient: KnowledgeSourceClient = {
    async query() {
      return queryOutcome;
    },
    async getGraph() {
      return { nodes: [{ id: "n1", label: "Person", properties: {} }], edges: [], truncated: false };
    },
    async checkHealth() {
      return health;
    },
    async refreshToken() {
      return true;
    },
  };

  const service = createKnowledgeService({
    configStore,
    credentialService,
    now: () => "2026-07-12T10:00:00.000Z",
    createClient: () => fakeClient,
  });

  return {
    router: createKnowledgeRouter(service),
    dir,
    setHealth: (s) => (health = s),
    setQueryOutcome: (o) => (queryOutcome = o),
  };
}

function route(router: ReturnType<typeof createKnowledgeRouter>, method: string, path: string) {
  const found = router.routes.find((r) => r.path === path && r.method === method);
  assert.ok(found, `route not found: ${method} ${path}`);
  return found!;
}

test("GET /v1/knowledge/status — not_configured before any configure call", async () => {
  const h = await buildHarness();
  try {
    const result = (await route(h.router, "GET", KNOWLEDGE_STATUS_PATH).handler(ctx("GET", KNOWLEDGE_STATUS_PATH))) as {
      data: { status: string; baseUrl: string | null };
    };
    assert.equal(result.data.status, "not_configured");
    assert.equal(result.data.baseUrl, null);
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("POST /v1/knowledge/configure — happy path stores token, health-checks, returns status (no token echoed)", async () => {
  const h = await buildHarness();
  try {
    h.setHealth("connected");
    const res = (await route(h.router, "POST", KNOWLEDGE_CONFIGURE_PATH).handler(
      ctx("POST", KNOWLEDGE_CONFIGURE_PATH, { baseUrl: "http://localhost:8080", token: TOKEN }),
    )) as { status: number; data: { status: string; baseUrl: string | null } };
    assert.equal(res.status, 200);
    assert.equal(res.data.status, "connected");
    assert.equal(res.data.baseUrl, "http://localhost:8080");
    assert.ok(!JSON.stringify(res).includes(TOKEN), "configure response must never echo the token");

    // Persisted file holds a credentialRef handle only, never the raw token.
    const persisted = await readFile(join(h.dir, "knowledge-source.json"), "utf8");
    assert.ok(!persisted.includes(TOKEN), "persisted config must never contain the raw token");
    assert.ok(persisted.includes('"account"'));
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("POST /v1/knowledge/configure — rejects a malformed body with a knowledge request error", async () => {
  const h = await buildHarness();
  try {
    await assert.rejects(() =>
      route(h.router, "POST", KNOWLEDGE_CONFIGURE_PATH).handler(ctx("POST", KNOWLEDGE_CONFIGURE_PATH, { baseUrl: "" })),
    );
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("POST /v1/knowledge/test-connection — reflects unreachable and auth_failed honestly (no cached 'connected')", async () => {
  const h = await buildHarness();
  try {
    h.setHealth("connected");
    await route(h.router, "POST", KNOWLEDGE_CONFIGURE_PATH).handler(
      ctx("POST", KNOWLEDGE_CONFIGURE_PATH, { baseUrl: "http://localhost:8080", token: TOKEN }),
    );

    h.setHealth("unreachable");
    const unreachable = (await route(h.router, "POST", KNOWLEDGE_TEST_CONNECTION_PATH).handler(
      ctx("POST", KNOWLEDGE_TEST_CONNECTION_PATH),
    )) as { data: { status: string } };
    assert.equal(unreachable.data.status, "unreachable");

    h.setHealth("auth_failed");
    const authFailed = (await route(h.router, "POST", KNOWLEDGE_TEST_CONNECTION_PATH).handler(
      ctx("POST", KNOWLEDGE_TEST_CONNECTION_PATH),
    )) as { data: { status: string } };
    assert.equal(authFailed.data.status, "auth_failed");
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("POST /v1/knowledge/test-connection — not_configured when nothing was ever configured", async () => {
  const h = await buildHarness();
  try {
    const result = (await route(h.router, "POST", KNOWLEDGE_TEST_CONNECTION_PATH).handler(
      ctx("POST", KNOWLEDGE_TEST_CONNECTION_PATH),
    )) as { data: { status: string } };
    assert.equal(result.data.status, "not_configured");
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("DELETE /v1/knowledge/connection — clears config and removes the credential (R6 Disconnect)", async () => {
  const h = await buildHarness();
  try {
    await route(h.router, "POST", KNOWLEDGE_CONFIGURE_PATH).handler(
      ctx("POST", KNOWLEDGE_CONFIGURE_PATH, { baseUrl: "http://localhost:8080", token: TOKEN }),
    );
    const res = (await route(h.router, "DELETE", KNOWLEDGE_CONNECTION_PATH).handler(
      ctx("DELETE", KNOWLEDGE_CONNECTION_PATH),
    )) as { data: { status: string } };
    assert.equal(res.data.status, "not_configured");

    const status = (await route(h.router, "GET", KNOWLEDGE_STATUS_PATH).handler(ctx("GET", KNOWLEDGE_STATUS_PATH))) as {
      data: { status: string; baseUrl: string | null };
    };
    assert.equal(status.data.status, "not_configured");
    assert.equal(status.data.baseUrl, null);
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("POST /v1/knowledge/query — happy path returns answered + citations", async () => {
  const h = await buildHarness();
  try {
    await route(h.router, "POST", KNOWLEDGE_CONFIGURE_PATH).handler(
      ctx("POST", KNOWLEDGE_CONFIGURE_PATH, { baseUrl: "http://localhost:8080", token: TOKEN }),
    );
    h.setQueryOutcome({
      outcome: "answered",
      answer: "Trả lời mẫu",
      citations: [{ entityType: "Person", entityId: "p1", displayName: "Người dùng A", sourceRef: null }],
      syncedAt: "2026-07-12T09:55:00Z",
    });
    const res = (await route(h.router, "POST", KNOWLEDGE_QUERY_PATH).handler(
      ctx("POST", KNOWLEDGE_QUERY_PATH, { query: "Ai là chuyên gia?" }),
    )) as { data: { outcome: string; answer: string | null; citations: unknown[] } };
    assert.equal(res.data.outcome, "answered");
    assert.equal(res.data.answer, "Trả lời mẫu");
    assert.equal(res.data.citations.length, 1);
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("POST /v1/knowledge/query — degraded outcomes stay HTTP 200 domain values, and auth_failed folds into unavailable", async () => {
  const h = await buildHarness();
  try {
    await route(h.router, "POST", KNOWLEDGE_CONFIGURE_PATH).handler(
      ctx("POST", KNOWLEDGE_CONFIGURE_PATH, { baseUrl: "http://localhost:8080", token: TOKEN }),
    );

    h.setQueryOutcome({ outcome: "timeout" });
    const timeout = (await route(h.router, "POST", KNOWLEDGE_QUERY_PATH).handler(
      ctx("POST", KNOWLEDGE_QUERY_PATH, { query: "chậm" }),
    )) as { status: number; data: { outcome: string; answer: null; citations: unknown[] } };
    assert.equal(timeout.status, 200);
    assert.equal(timeout.data.outcome, "timeout");
    assert.equal(timeout.data.answer, null);
    assert.deepEqual(timeout.data.citations, []);

    h.setQueryOutcome({ outcome: "auth_failed" });
    const authFailed = (await route(h.router, "POST", KNOWLEDGE_QUERY_PATH).handler(
      ctx("POST", KNOWLEDGE_QUERY_PATH, { query: "hết hạn" }),
    )) as { data: { outcome: string } };
    assert.equal(authFailed.data.outcome, "unavailable", "auth_failed folds into unavailable at this API surface");
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("POST /v1/knowledge/query — not configured returns unavailable, never throws", async () => {
  const h = await buildHarness();
  try {
    const res = (await route(h.router, "POST", KNOWLEDGE_QUERY_PATH).handler(
      ctx("POST", KNOWLEDGE_QUERY_PATH, { query: "bất kỳ" }),
    )) as { data: { outcome: string } };
    assert.equal(res.data.outcome, "unavailable");
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});

test("GET /v1/knowledge/graph — pass-through with entityId query param", async () => {
  const h = await buildHarness();
  try {
    await route(h.router, "POST", KNOWLEDGE_CONFIGURE_PATH).handler(
      ctx("POST", KNOWLEDGE_CONFIGURE_PATH, { baseUrl: "http://localhost:8080", token: TOKEN }),
    );
    const res = (await route(h.router, "GET", KNOWLEDGE_GRAPH_PATH).handler(
      ctx("GET", KNOWLEDGE_GRAPH_PATH, undefined, "?entityId=person-1"),
    )) as { data: { nodes: unknown[] } };
    assert.equal(res.data.nodes.length, 1);
  } finally {
    await rm(h.dir, { recursive: true, force: true });
  }
});
