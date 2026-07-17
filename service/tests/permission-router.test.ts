/**
 * Permission boundary router test (CGHC-017 service-side transport).
 *
 * Proves the WIRE seam the Allow/Deny UI (Part B) consumes, mounted on a real loopback boundary:
 *  - `GET /v1/permission/pending` returns an EXPLICIT non-secret projection (no surprise fields).
 *  - Every route is token-guarded (fail-closed): no token → 401.
 *  - `POST /v1/permission/decision` allow/deny records the decision on the gate (right args).
 *  - A malformed/missing body → 400 `bad_request` (never 500).
 *  - An unknown requestId → an honest typed `unknown` (404), NOT a fabricated success.
 *  - A second decision on the same request → idempotent `already_resolved`.
 *
 * The router is NOT an authority: it only records on the single {@link PermissionGate}. All seams
 * are in-memory fakes — no live runtime, no network egress, no secrets.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PermissionReply } from "@cowork-ghc/contracts";
import { startService } from "../src/index.js";
import {
  createInMemoryAuditSink,
  createNodeScheduler,
  createPermissionGate,
  createPermissionRequest,
  createPermissionRouter,
  noopSessionDenialSink,
  PERMISSION_DECISION_PATH,
  PERMISSION_PENDING_PATH,
  type PermissionGate,
} from "../src/permission/index.js";

interface Harness {
  readonly gate: PermissionGate;
  readonly replies: PermissionReply[];
  readonly audit: ReturnType<typeof createInMemoryAuditSink>;
}

/** A real gate wired to in-memory seams; the timeout is large so P6 never fires mid-test. */
function harness(): Harness {
  const replies: PermissionReply[] = [];
  const audit = createInMemoryAuditSink();
  const gate = createPermissionGate({
    reply: { reply: (r) => (replies.push(r), Promise.resolve()) },
    audit,
    session: noopSessionDenialSink(),
    scheduler: createNodeScheduler(),
    timeoutMs: 1_000_000,
    now: () => "2026-07-11T00:00:00.000Z",
  });
  return { gate, replies, audit };
}

function submitCreate(gate: PermissionGate, requestId: string): void {
  gate.submit(
    createPermissionRequest({
      requestId,
      sessionId: "sess-1",
      action: { kind: "file_create", targetPath: "notes/todo.txt", description: "Create notes/todo.txt" },
      requestedAt: "2026-07-11T00:00:00.000Z",
    }),
  );
}

const TIMEOUT_MS = 5_000;
async function boundedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

test("no permission route opts out of the token guard (publicUnauthenticated never set)", () => {
  const { gate } = harness();
  const router = createPermissionRouter(gate);
  assert.equal(router.name, "permission");
  for (const route of router.routes) {
    assert.notEqual(route.publicUnauthenticated, true, `${route.path} must stay token-guarded`);
  }
});

test("GET pending is 401 without a token (fail-closed)", async () => {
  const { gate } = harness();
  const running = await startService({ routers: [createPermissionRouter(gate)] });
  try {
    const res = await boundedFetch(`${running.baseUrl}${PERMISSION_PENDING_PATH}`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error?.code, "unauthorized");
  } finally {
    await running.service.stop();
  }
});

test("GET pending returns the explicit non-secret projection (no unexpected fields leak)", async () => {
  const { gate } = harness();
  submitCreate(gate, "req-1");
  const running = await startService({ routers: [createPermissionRouter(gate)] });
  try {
    const res = await boundedFetch(`${running.baseUrl}${PERMISSION_PENDING_PATH}`, {
      headers: authHeaders(running.clientToken),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; data: { pending: Array<Record<string, unknown>> } };
    assert.equal(body.ok, true);
    assert.equal(body.data.pending.length, 1);
    const view = body.data.pending[0]!;
    // Exactly the whitelisted top-level fields — nothing else leaked from the raw request.
    assert.deepEqual(Object.keys(view).sort(), ["action", "approvalLevel", "requestId", "requestedAt", "sessionId"]);
    assert.equal(view["requestId"], "req-1");
    assert.equal(view["sessionId"], "sess-1");
    assert.equal(view["approvalLevel"], "standard");
    const action = view["action"] as Record<string, unknown>;
    assert.deepEqual(Object.keys(action).sort(), ["description", "kind", "targetPath"]);
    assert.equal(action["kind"], "file_create");
    assert.equal(action["targetPath"], "notes/todo.txt");
  } finally {
    await running.service.stop();
  }
});

test("POST decision allow records an Allow on the gate (scope defaults honored, reply forwarded)", async () => {
  const { gate, replies } = harness();
  submitCreate(gate, "req-allow");
  const running = await startService({ routers: [createPermissionRouter(gate)] });
  try {
    const res = await boundedFetch(`${running.baseUrl}${PERMISSION_DECISION_PATH}`, {
      method: "POST",
      headers: authHeaders(running.clientToken),
      body: JSON.stringify({ requestId: "req-allow", decision: "allow", scope: "always" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: { status: string; decision: string; approvalLevel: string; scope?: string };
    };
    assert.equal(body.data.status, "resolved");
    assert.equal(body.data.decision, "allow");
    assert.equal(body.data.approvalLevel, "standard");
    assert.equal(body.data.scope, "always");
    // The gate now holds a live Allow (the router recorded the real decision, not a shadow copy).
    assert.equal(gate.isAllowed("req-allow"), true);
    assert.equal(replies.at(-1)?.decision, "allow");
    assert.equal(replies.at(-1)?.scope, "always");
  } finally {
    await running.service.stop();
  }
});

test("POST decision deny records a Deny on the gate (audited, reply forwarded)", async () => {
  const { gate, replies, audit } = harness();
  submitCreate(gate, "req-deny");
  const running = await startService({ routers: [createPermissionRouter(gate)] });
  try {
    const res = await boundedFetch(`${running.baseUrl}${PERMISSION_DECISION_PATH}`, {
      method: "POST",
      headers: authHeaders(running.clientToken),
      body: JSON.stringify({ requestId: "req-deny", decision: "deny" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { status: string; decision: string; scope?: string } };
    assert.equal(body.data.status, "resolved");
    assert.equal(body.data.decision, "deny");
    assert.equal(body.data.scope, undefined, "a deny carries no scope");
    assert.equal(gate.isAllowed("req-deny"), false);
    assert.equal(audit.events().some((e) => e.requestId === "req-deny" && e.decision === "deny"), true);
    assert.equal(replies.at(-1)?.decision, "deny");
    // The HTTP decision route is the user-facing path — its deny must ALWAYS audit as a real
    // human decision, never the D1 boundary-policy reason (`agent_preset`).
    assert.equal(audit.events().find((e) => e.requestId === "req-deny")?.reason, "user_decision");
  } finally {
    await running.service.stop();
  }
});

test("the HTTP decision route cannot forge the 'agent_preset' audit reason even if a client sends it", async () => {
  const { gate, audit } = harness();
  submitCreate(gate, "req-forge");
  const running = await startService({ routers: [createPermissionRouter(gate)] });
  try {
    const res = await boundedFetch(`${running.baseUrl}${PERMISSION_DECISION_PATH}`, {
      method: "POST",
      headers: authHeaders(running.clientToken),
      // A malicious/buggy client tries to smuggle a `reason` alongside a real user decision.
      body: JSON.stringify({ requestId: "req-forge", decision: "deny", reason: "agent_preset" }),
    });
    assert.equal(res.status, 200);
    const recorded = audit.events().find((e) => e.requestId === "req-forge");
    assert.equal(recorded?.decision, "deny");
    assert.equal(recorded?.reason, "user_decision", "the route ignores any client-supplied reason");
  } finally {
    await running.service.stop();
  }
});

test("a malformed / missing decision body returns 400 bad_request (not 500)", async () => {
  const { gate } = harness();
  const running = await startService({ routers: [createPermissionRouter(gate)] });
  try {
    const bodies = [
      "{}", // missing requestId + decision
      JSON.stringify({ requestId: "x" }), // missing decision
      JSON.stringify({ requestId: "x", decision: "maybe" }), // invalid decision
      JSON.stringify({ requestId: "x", decision: "allow", scope: "forever" }), // invalid scope
      JSON.stringify({ requestId: "", decision: "allow" }), // empty requestId
    ];
    for (const body of bodies) {
      const res = await boundedFetch(`${running.baseUrl}${PERMISSION_DECISION_PATH}`, {
        method: "POST",
        headers: authHeaders(running.clientToken),
        body,
      });
      assert.equal(res.status, 400, `body ${body} must be 400, not 500`);
      const env = (await res.json()) as { ok: boolean; error?: { code: string; message: string } };
      assert.equal(env.ok, false);
      assert.equal(env.error?.code, "bad_request");
      assert.ok((env.error?.message ?? "").length > 0);
    }
  } finally {
    await running.service.stop();
  }
});

test("an unknown requestId returns an honest typed unknown (404), not a fabricated success", async () => {
  const { gate } = harness();
  const running = await startService({ routers: [createPermissionRouter(gate)] });
  try {
    const res = await boundedFetch(`${running.baseUrl}${PERMISSION_DECISION_PATH}`, {
      method: "POST",
      headers: authHeaders(running.clientToken),
      body: JSON.stringify({ requestId: "nope", decision: "allow" }),
    });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { ok: boolean; data: { status: string; requestId: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.status, "unknown");
    assert.equal(body.data.requestId, "nope");
    assert.equal(gate.isAllowed("nope"), false, "an unknown request never becomes allowed");
  } finally {
    await running.service.stop();
  }
});

test("a second decision on the same request is idempotent already_resolved (a late Allow never overrides a Deny)", async () => {
  const { gate } = harness();
  submitCreate(gate, "req-twice");
  const running = await startService({ routers: [createPermissionRouter(gate)] });
  try {
    const first = await boundedFetch(`${running.baseUrl}${PERMISSION_DECISION_PATH}`, {
      method: "POST",
      headers: authHeaders(running.clientToken),
      body: JSON.stringify({ requestId: "req-twice", decision: "deny" }),
    });
    assert.equal(((await first.json()) as { data: { status: string } }).data.status, "resolved");

    const second = await boundedFetch(`${running.baseUrl}${PERMISSION_DECISION_PATH}`, {
      method: "POST",
      headers: authHeaders(running.clientToken),
      body: JSON.stringify({ requestId: "req-twice", decision: "allow" }),
    });
    assert.equal(second.status, 200);
    const body = (await second.json()) as { data: { status: string; decision: string } };
    assert.equal(body.data.status, "already_resolved");
    assert.equal(body.data.decision, "deny", "the recorded Deny stands; the late Allow does not override");
    assert.equal(gate.isAllowed("req-twice"), false);
  } finally {
    await running.service.stop();
  }
});
