/**
 * Boundary contract + mount-seam tests: the versioned envelope, the typed router mount
 * seam downstream tasks use, duplicate-route protection, and unknown-route handling.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOUNDARY_PROTOCOL_VERSION,
  createService,
  startService,
  type BoundaryAuditEvent,
  type BoundaryRouter,
} from "../src/index.js";

function echoRouter(): BoundaryRouter {
  return {
    name: "echo-test",
    routes: [
      {
        method: "POST",
        path: "/v1/echo",
        handler: (ctx) => ({ status: 200, data: { echoed: ctx.body } }),
      },
      {
        method: "GET",
        path: "/v1/open",
        publicUnauthenticated: true,
        handler: () => ({ status: 200, data: { open: true } }),
      },
    ],
  };
}

test("a mounted router is reachable and wraps results in the versioned envelope", async () => {
  const running = await startService({ routers: [echoRouter()] });
  try {
    const res = await fetch(`${running.baseUrl}/v1/echo`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ hello: "world" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      protocol: string;
      ok: boolean;
      data: { echoed: { hello: string } };
    };
    assert.equal(body.protocol, BOUNDARY_PROTOCOL_VERSION);
    assert.equal(body.ok, true);
    assert.deepEqual(body.data.echoed, { hello: "world" });
  } finally {
    await running.service.stop();
  }
});

test("a route may opt out of the token guard ONLY via explicit publicUnauthenticated", async () => {
  const running = await startService({ routers: [echoRouter()] });
  try {
    const res = await fetch(`${running.baseUrl}/v1/open`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { open: boolean } };
    assert.equal(body.data.open, true);
  } finally {
    await running.service.stop();
  }
});

test("mounting a publicUnauthenticated route is audited; other routes stay token-guarded", async () => {
  const events: BoundaryAuditEvent[] = [];
  const running = await startService({
    routers: [echoRouter()],
    onAudit: (e) => events.push(e),
  });
  try {
    // The public route is recorded/audited so it surfaces in review.
    const open = events.find(
      (e) => e.type === "unauthenticated_route_mounted" && e.path === "/v1/open",
    );
    assert.ok(open, "mounting /v1/open must emit an audit event");
    assert.equal(open.router, "echo-test");
    // A sibling route without the marker stays token-guarded (no token -> 401).
    const guarded = await fetch(`${running.baseUrl}/v1/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(guarded.status, 401);
  } finally {
    await running.service.stop();
  }
});

test("an unknown route returns a not_found error envelope", async () => {
  const running = await startService();
  try {
    const res = await fetch(`${running.baseUrl}/v1/does-not-exist`, {
      headers: { authorization: `Bearer ${running.clientToken}` },
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "not_found");
  } finally {
    await running.service.stop();
  }
});

test("mounting a duplicate method+path is rejected (fail closed)", () => {
  const service = createService();
  assert.throws(() => service.mount(createHealthCollision()), /collides|duplicate/i);
});

function createHealthCollision(): BoundaryRouter {
  return {
    name: "collision",
    routes: [{ method: "GET", path: "/v1/health", handler: () => ({ status: 200, data: {} }) }],
  };
}

test("an oversized body is rejected with payload_too_large", async () => {
  const running = await startService({ routers: [echoRouter()], maxBodyBytes: 64 });
  try {
    const res = await fetch(`${running.baseUrl}/v1/echo`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.clientToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ big: "x".repeat(500) }),
    });
    assert.equal(res.status, 413);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "payload_too_large");
  } finally {
    await running.service.stop();
  }
});
