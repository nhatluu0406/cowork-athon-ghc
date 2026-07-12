/**
 * T1.2 Router test for /v1/knowledge/* routes (router.ts).
 *
 * Validates:
 * - All routes are token-guarded (no public unauthenticated access)
 * - GET /v1/knowledge/status returns secret-free projection
 * - POST /v1/knowledge/configure validates input and calls service
 * - POST /v1/knowledge/test-connection
 * - DELETE /v1/knowledge/connection
 * - POST /v1/knowledge/query (internal, called by tool after permission gate)
 * - GET /v1/knowledge/graph
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeService } from "../src/knowledge/knowledge-service.js";
import { createKnowledgeRouter } from "../src/knowledge/router.js";
import { startService } from "../src/index.js";

/** Fake KnowledgeService for testing. */
function createFakeKnowledgeService(): KnowledgeService {
  return {
    status: async () => ({
      status: "connected",
      baseUrl: "http://localhost:3000",
      lastHealthCheckAt: "2025-01-01T00:00:00Z",
    }),
    configure: async (input) => {
      assert.equal(input.baseUrl, "http://localhost:3000");
      return {
        status: "connected",
        baseUrl: input.baseUrl,
        lastHealthCheckAt: "2025-01-01T00:00:00Z",
      };
    },
    testConnection: async () => ({
      status: "connected",
      baseUrl: "http://localhost:3000",
      lastHealthCheckAt: "2025-01-01T00:00:00Z",
    }),
    disconnect: async () => ({ status: "not_configured" }),
    query: async (query) => ({
      outcome: "answered",
      answer: `Answer to: ${query}`,
      citations: [],
      syncedAt: null,
    }),
    getGraph: async () => ({
      nodes: [],
      edges: [],
      truncated: false,
    }),
  };
}

test("T1.2a: GET /v1/knowledge/status requires token and returns secret-free projection", async () => {
  const service = createFakeKnowledgeService();
  const running = await startService({
    routers: [createKnowledgeRouter(service)],
  });

  try {
    // Without token: 401
    const unauth = await fetch(`${running.baseUrl}/v1/knowledge/status`);
    assert.equal(unauth.status, 401);

    // With token: 200 with status view
    const res = await fetch(`${running.baseUrl}/v1/knowledge/status`, {
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { status: string; baseUrl: string | null } };
    assert.equal(body.data.status, "connected");
    assert.equal(body.data.baseUrl, "http://localhost:3000");
  } finally {
    await running.service.stop();
  }
});

test("T1.2b: POST /v1/knowledge/configure validates baseUrl and token", async () => {
  const service = createFakeKnowledgeService();
  const running = await startService({
    routers: [createKnowledgeRouter(service)],
  });

  try {
    // Missing baseUrl: 400
    const noUrl = await fetch(`${running.baseUrl}/v1/knowledge/configure`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: "test-token" }),
    });
    assert.equal(noUrl.status, 400);

    // Missing token: 400
    const noToken = await fetch(`${running.baseUrl}/v1/knowledge/configure`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ baseUrl: "http://localhost:3000" }),
    });
    assert.equal(noToken.status, 400);

    // Valid: 200
    const valid = await fetch(`${running.baseUrl}/v1/knowledge/configure`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        baseUrl: "http://localhost:3000",
        token: "valid-token",
      }),
    });
    assert.equal(valid.status, 200);
    const data = await valid.json();
    assert.equal(data.data.status, "connected");
  } finally {
    await running.service.stop();
  }
});

test("T1.2c: POST /v1/knowledge/configure raw token crosses boundary inbound only", async () => {
  let configureInput: { baseUrl: string; token?: string } | null = null;

  const service: KnowledgeService = {
    ...createFakeKnowledgeService(),
    configure: async (input) => {
      configureInput = input;
      return {
        status: "connected",
        baseUrl: input.baseUrl,
        lastHealthCheckAt: "2025-01-01T00:00:00Z",
      };
    },
  };

  const running = await startService({
    routers: [createKnowledgeRouter(service)],
  });

  try {
    const res = await fetch(`${running.baseUrl}/v1/knowledge/configure`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        baseUrl: "http://localhost:3000",
        token: "SECRET-DO-NOT-LEAK-12345",
      }),
    });

    assert.equal(res.status, 200);
    const bodyText = await res.text();
    // Token must NOT appear in response body
    assert.ok(!bodyText.includes("SECRET-DO-NOT-LEAK"), "token must not leak in response");
    assert.ok(!bodyText.includes("12345"), "token parts must not leak in response");
  } finally {
    await running.service.stop();
  }
});

test("T1.2d: POST /v1/knowledge/test-connection", async () => {
  const service = createFakeKnowledgeService();
  const running = await startService({
    routers: [createKnowledgeRouter(service)],
  });

  try {
    const res = await fetch(`${running.baseUrl}/v1/knowledge/test-connection`, {
      method: "POST",
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { status: string } };
    assert.equal(body.data.status, "connected");
  } finally {
    await running.service.stop();
  }
});

test("T1.2e: DELETE /v1/knowledge/connection", async () => {
  const service = createFakeKnowledgeService();
  const running = await startService({
    routers: [createKnowledgeRouter(service)],
  });

  try {
    const res = await fetch(`${running.baseUrl}/v1/knowledge/connection`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { status: string } };
    assert.equal(body.data.status, "not_configured");
  } finally {
    await running.service.stop();
  }
});

test("T1.2f: POST /v1/knowledge/query validates input and returns ApiQueryResult", async () => {
  const service = createFakeKnowledgeService();
  const running = await startService({
    routers: [createKnowledgeRouter(service)],
  });

  try {
    // Missing query: 400
    const noQuery = await fetch(`${running.baseUrl}/v1/knowledge/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(noQuery.status, 400);

    // Valid: 200
    const res = await fetch(`${running.baseUrl}/v1/knowledge/query`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "What is X?" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { outcome: string; answer: string | null } };
    assert.equal(body.data.outcome, "answered");
    assert.ok(body.data.answer?.includes("What is X?"));
  } finally {
    await running.service.stop();
  }
});

test("T1.2g: GET /v1/knowledge/graph with optional entityId", async () => {
  const service = createFakeKnowledgeService();
  const running = await startService({
    routers: [createKnowledgeRouter(service)],
  });

  try {
    // Without entityId
    const noId = await fetch(`${running.baseUrl}/v1/knowledge/graph`, {
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(noId.status, 200);
    const body1 = await noId.json();
    assert.ok(Array.isArray(body1.data.nodes));
    assert.ok(Array.isArray(body1.data.edges));
    assert.ok(typeof body1.data.truncated === "boolean");

    // With entityId
    const withId = await fetch(`${running.baseUrl}/v1/knowledge/graph?entityId=node-42`, {
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(withId.status, 200);
  } finally {
    await running.service.stop();
  }
});

test("T1.2h: KnowledgeRequestError (bad input) becomes 400", async () => {
  const service = createFakeKnowledgeService();
  const running = await startService({
    routers: [createKnowledgeRouter(service)],
  });

  try {
    // Malformed JSON
    const malformed = await fetch(`${running.baseUrl}/v1/knowledge/configure`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: "not json",
    });
    assert.equal(malformed.status, 400);
  } finally {
    await running.service.stop();
  }
});
